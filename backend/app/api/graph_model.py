"""Graph routes: the graph model, ingestion statistics, one node with its
provenance and its bounded neighbours (overhaul design section 7.6).

``/graph/schema`` reads code and configuration only, and ``/graph/stats``
reads the active dataset's ``_graph_stats.json``; neither needs Neo4j.
The node routes open one reader per request, closed in a finally. They first
check that the graph holds the active world (``app.api.graph_world``): node
ids repeat across worlds, so a node of another world is refused, never
shown as the active one's. A Neo4j failure is a ``GRAPH_QUERY_ERROR``.
"""

from __future__ import annotations

import dataclasses
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Query
from neo4j.time import Date, DateTime, Duration, Time
from pydantic import JsonValue

from app.api.data_model import active_dataset_dir
from app.api.errors import RUN_ERROR_MESSAGES, ApiError, ErrorCode, classify
from app.api.graph_world import GraphWorldCheck, read_graph_stats
from app.api.schemas import (
    NEIGHBOURS_LIMIT_DEFAULT,
    NEIGHBOURS_LIMIT_MAX,
    GraphSchema,
    GraphStats,
    NeighbourOut,
    Neighbours,
    NodeOut,
    ProvenanceOut,
    RelTypeOut,
)
from app.config import LABEL_VERSION, GraphConfig, from_env
from app.graph.node_rows import node_table
from app.graph.statements import NODE_LABELS, RELATIONSHIP_ENDPOINTS, RELATIONSHIP_TYPES
from app.lab import bc_graph_settings
from app.retrieval.graph.neo4j_adapter import GraphReader

logger = logging.getLogger(__name__)

OTHER_WORLD_MESSAGE = "the graph holds a different world than the active dataset"


@contextmanager
def _reader(graph: GraphConfig, world: GraphWorldCheck, active: Path) -> Iterator[GraphReader]:
    """A reader on a graph holding the active world ``active``, closed afterwards.

    A graph holding another world is a 409; a Neo4j failure is a
    ``GRAPH_QUERY_ERROR`` (503 when retrying may help, else 500), with the
    driver's text logged only.
    """
    try:
        reader = GraphReader(graph)
        try:
            if world(reader, active) is False:
                raise ApiError(409, ErrorCode.VALIDATION_ERROR, OTHER_WORLD_MESSAGE)
            yield reader
        finally:
            reader.close()
    except Exception as error:
        code, retryable = classify(error)
        if code != ErrorCode.GRAPH_QUERY_ERROR:
            raise
        logger.warning("graph read failed", exc_info=error)
        status = 503 if retryable else 500
        raise ApiError(status, code, RUN_ERROR_MESSAGES[code], retryable) from error


def _json(value: Any) -> JsonValue:
    """Neo4j temporal values as ISO strings; lists element by element."""
    if isinstance(value, Date | DateTime | Time | Duration):
        return str(value.iso_format())
    if isinstance(value, list):
        return [_json(item) for item in value]
    result: JsonValue = value
    return result


def _node(labels: list[str], props: dict[str, Any], dataset_id: str) -> NodeOut:
    """A node; its provenance is the source row ingestion built it from."""
    table = node_table(labels[0]) if labels else None
    row_id = props.get("source_record_id")
    return NodeOut(
        node_id=str(props["id"]),
        labels=labels,
        properties={key: _json(props[key]) for key in sorted(props)},
        provenance=ProvenanceOut(table=table, row_id=str(row_id), dataset_id=dataset_id)
        if table is not None and row_id is not None
        else None,
    )


def _one_node(reader: GraphReader, node_id: str) -> tuple[list[str], dict[str, Any]]:
    found = reader.node(node_id)
    if not found:
        raise ApiError(404, ErrorCode.NOT_FOUND, f"no graph node with id {node_id}")
    if len(found) > 1:
        raise ApiError(409, ErrorCode.VALIDATION_ERROR, f"graph node id {node_id} is not unique")
    return found[0]


def build_graph_router(graph: GraphConfig, world: GraphWorldCheck) -> APIRouter:
    """The graph routes; node reads go to the graph at ``graph``."""
    router = APIRouter()

    @router.get("/graph/schema", response_model=GraphSchema)
    def read_schema() -> GraphSchema:
        settings_b, settings_c = bc_graph_settings(from_env())
        traversal = settings_c.graph
        return GraphSchema(
            labels=list(NODE_LABELS),
            relationship_types=[
                RelTypeOut(type=kind, from_label=start, to_label=end)
                for kind, start, end in RELATIONSHIP_ENDPOINTS
            ],
            allow_list={
                "B": list(settings_b.graph.relationship_types),
                "C": list(traversal.relationship_types),
            },
            weights=dataclasses.asdict(traversal.ranking),
            caps={
                "max_depth": traversal.max_depth,
                "max_nodes_per_hop": traversal.max_nodes_per_hop,
                "max_edges_per_node_type": traversal.max_edges_per_node_type,
                "max_total_nodes": traversal.max_total_nodes,
            },
            label_version=LABEL_VERSION,
        )

    @router.get("/graph/stats", response_model=GraphStats)
    def read_stats() -> GraphStats:
        active = active_dataset_dir()
        stats = read_graph_stats(active)
        if stats is None:
            raise ApiError(
                404,
                ErrorCode.NOT_FOUND,
                f"dataset {active.name} has no graph statistics: it has not been ingested",
            )
        by_type: dict[str, int] = {}
        for rel in stats["relationships"]:
            by_type[rel["type"]] = by_type.get(rel["type"], 0) + int(rel["count"])
        ingestion = stats.get("ingestion_version")
        return GraphStats(
            nodes_by_label=stats["nodes"],
            relationships_by_type=dict(sorted(by_type.items())),
            ingestion_version=LABEL_VERSION
            if ingestion is None
            else f"{LABEL_VERSION}/{ingestion}",
            source="ingestion",
        )

    @router.get("/graph/nodes/{node_id}", response_model=NodeOut)
    def read_node(node_id: str) -> NodeOut:
        active = active_dataset_dir()
        with _reader(graph, world, active) as reader:
            labels, props = _one_node(reader, node_id)
        return _node(labels, props, active.name)

    @router.get("/graph/nodes/{node_id}/neighbours", response_model=Neighbours)
    def read_neighbours(
        node_id: str,
        limit: Annotated[int, Query(ge=1, le=NEIGHBOURS_LIMIT_MAX)] = NEIGHBOURS_LIMIT_DEFAULT,
        rel_type: Annotated[str | None, Query(alias="type")] = None,
    ) -> Neighbours:
        if rel_type is not None and rel_type not in RELATIONSHIP_TYPES:
            raise ApiError(
                422, ErrorCode.VALIDATION_ERROR, f"unknown relationship type: {rel_type}"
            )
        active = active_dataset_dir()
        with _reader(graph, world, active) as reader:
            _one_node(reader, node_id)
            found = reader.node_neighbours(node_id, rel_type, limit + 1)
        return Neighbours(
            node_id=node_id,
            items=[
                NeighbourOut.model_validate(
                    {
                        "rel_type": kind,
                        "direction": direction,
                        "node": _node(labels, props, active.name),
                    }
                )
                for kind, direction, labels, props in found[:limit]
            ],
            truncated=len(found) > limit,
        )

    return router
