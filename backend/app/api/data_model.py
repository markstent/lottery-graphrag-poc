"""Data Model routes: generated worlds, the data dictionary, sample rows and
single records with their graph node (overhaul design section 7.6).

A world is a directory holding a ``_manifest.json`` beside the active
dataset (``DATASET_DIR``, the world the lab is built from); the routes list
that directory's children and serve only those, so the evaluator-only ledger,
which lives outside it, is never reachable. The routes read configuration and
files only: they never wait for the lab build.

Every identifier that reaches SQL is checked first: ``dataset_id`` must be a
listed directory name, ``table`` and ``column`` names in the schema
registry. Each request opens its own in-memory DuckDB connection; the
Parquet path and the filter value are bound parameters, and only a
registry-checked column name is quoted into a statement.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any

import duckdb
from fastapi import APIRouter, Query
from pydantic import JsonValue

from app.api.errors import ApiError, ErrorCode, classify
from app.api.schemas import (
    ROWS_LIMIT_DEFAULT,
    ROWS_LIMIT_MAX,
    ColumnOut,
    DatasetDetail,
    DatasetSummary,
    EdgeSummary,
    ForeignKeyOut,
    IndexStatus,
    RecordOut,
    RowPage,
    TableProvenance,
    TableSchemaOut,
)
from app.config import GraphConfig, from_env
from app.datasets.schema import FOREIGN_KEYS, TABLE_PROVENANCE, TABLE_SCHEMAS, primary_key
from app.datasets.util import split_columns
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.graph.source_lookup import label_for_table
from app.retrieval.standard.index import MANIFEST_NAME as INDEX_MANIFEST_NAME

logger = logging.getLogger(__name__)

WORLD_MANIFEST_NAME = "_manifest.json"
# DuckDB's OFFSET is a signed 64-bit integer.
_MAX_OFFSET = 2**63 - 1


def active_dataset_dir() -> Path:
    """The world the lab is built from, read from configuration."""
    return Path(from_env().dataset_dir).resolve()


def _worlds(active: Path) -> dict[str, Path]:
    """Every directory beside the active world that holds a world manifest."""
    root = active.parent
    if not root.is_dir():
        return {}
    return {
        path.name: path
        for path in sorted(root.iterdir())
        if path.is_dir() and (path / WORLD_MANIFEST_NAME).is_file()
    }


def _world(dataset_id: str, active: Path) -> Path:
    world = _worlds(active).get(dataset_id)
    if world is None:
        raise ApiError(404, ErrorCode.NOT_FOUND, f"unknown dataset: {dataset_id}")
    return world


def _manifest(world: Path) -> dict[str, Any]:
    manifest: dict[str, Any] = json.loads((world / WORLD_MANIFEST_NAME).read_text("utf-8"))
    return manifest


def _summary(world: Path, active: Path) -> DatasetSummary:
    manifest = _manifest(world)
    return DatasetSummary(
        dataset_id=world.name,
        generator_version=manifest["generator_version"],
        world_seed=manifest["world_seed"],
        scenario_seed=manifest["scenario_seed"],
        profile=manifest["profile"],
        row_counts=manifest["row_counts"],
        active=world.resolve() == active,
    )


def _index_status(world: Path) -> IndexStatus | None:
    """The persistent index built over the world, from its index manifest."""
    path = world / INDEX_MANIFEST_NAME
    if not path.is_file():
        return None
    manifest = json.loads(path.read_text("utf-8"))
    return IndexStatus(
        collection=manifest["collection"],
        points=int(manifest["chunk_count"]) + int(manifest["record_count"]),
        serialiser_version=manifest["record_serialiser_version"],
        built_at=manifest["indexed_at"],
    )


def _columns(table: str) -> list[tuple[str, str]]:
    """(name, type) of a registered table; any other name is a 422."""
    ddl = TABLE_SCHEMAS.get(table)
    if ddl is None:
        raise ApiError(422, ErrorCode.VALIDATION_ERROR, f"unknown table: {table}")
    return split_columns(ddl)


def _dictionary_entry(table: str, provenance: dict[str, Any]) -> TableSchemaOut:
    recorded = provenance.get(table)
    return TableSchemaOut(
        table=table,
        source_system=TABLE_PROVENANCE[table][0],
        primary_key=primary_key(table),
        # The registry holds no column descriptions; none is invented.
        columns=[
            ColumnOut(name=name, type=kind, description=None) for name, kind in _columns(table)
        ],
        foreign_keys=[
            ForeignKeyOut(
                column=key.child_column,
                table=key.parent_table,
                ref_column=primary_key(key.parent_table),
            )
            for key in FOREIGN_KEYS
            if key.child_table == table
        ],
        provenance=TableProvenance.model_validate(recorded) if recorded is not None else None,
    )


def _parquet(world: Path, table: str) -> str:
    """The table's Parquet file, built from the registry-checked name only."""
    path = world / f"{table}.parquet"
    if not path.is_file():
        raise ApiError(404, ErrorCode.NOT_FOUND, f"dataset {world.name} has no table {table}")
    return str(path)


def _quoted(column: str) -> str:
    return f'"{column}"'


def _matches(column: str) -> str:
    """A bound equality on a column's text form, so a value of any column
    type compares without a cast error."""
    return f"CAST({_quoted(column)} AS VARCHAR) = ?"


def _json(value: Any) -> JsonValue:
    """Dates and timestamps as ISO strings; decimals as their exact text."""
    if isinstance(value, date | datetime | time):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    result: JsonValue = value
    return result


@contextmanager
def _duckdb() -> Iterator[duckdb.DuckDBPyConnection]:
    connection = duckdb.connect()
    try:
        yield connection
    finally:
        connection.close()


def _select(columns: list[str], where: str) -> str:
    """Every column, ordered by the primary key (the first column) then the
    rest, so pages are stable even where the key repeats (link tables)."""
    quoted = ", ".join(_quoted(name) for name in columns)
    return f"SELECT {quoted} FROM read_parquet(?) {where} ORDER BY {quoted}"


def _edges(graph: GraphConfig, label: str, node_id: str) -> list[EdgeSummary] | None:
    """The node's edge summary, or None when the graph cannot be read."""
    try:
        reader = GraphReader(graph)
        try:
            summary = reader.edge_summary(label, node_id)
        finally:
            reader.close()
    except Exception as error:
        code, _retryable = classify(error)
        if code != ErrorCode.GRAPH_QUERY_ERROR:
            raise
        logger.warning("record edge summary failed", exc_info=error, extra={"node_id": node_id})
        return None
    return [
        EdgeSummary.model_validate({"type": kind, "direction": way, "count": count})
        for kind, way, count in summary
    ]


def build_data_model_router(graph: GraphConfig) -> APIRouter:
    """The Data Model routes; record edge summaries read the graph at ``graph``."""
    router = APIRouter()

    @router.get("/datasets", response_model=list[DatasetSummary])
    def list_datasets() -> list[DatasetSummary]:
        active = active_dataset_dir()
        return [_summary(world, active) for world in _worlds(active).values()]

    @router.get("/datasets/{dataset_id}", response_model=DatasetDetail)
    def read_dataset(dataset_id: str) -> DatasetDetail:
        active = active_dataset_dir()
        world = _world(dataset_id, active)
        provenance = _manifest(world).get("provenance", {})
        return DatasetDetail(
            summary=_summary(world, active),
            provenance={
                table: TableProvenance.model_validate(entry) for table, entry in provenance.items()
            },
            index_status=_index_status(world),
        )

    @router.get("/datasets/{dataset_id}/dictionary", response_model=list[TableSchemaOut])
    def read_dictionary(dataset_id: str) -> list[TableSchemaOut]:
        world = _world(dataset_id, active_dataset_dir())
        provenance = _manifest(world).get("provenance", {})
        return [_dictionary_entry(table, provenance) for table in TABLE_SCHEMAS]

    @router.get("/datasets/{dataset_id}/tables/{table}/rows", response_model=RowPage)
    def read_rows(
        dataset_id: str,
        table: str,
        offset: Annotated[int, Query(ge=0, le=_MAX_OFFSET)] = 0,
        limit: Annotated[int, Query(ge=1, le=ROWS_LIMIT_MAX)] = ROWS_LIMIT_DEFAULT,
        column: str | None = None,
        value: str | None = None,
    ) -> RowPage:
        columns = [name for name, _kind in _columns(table)]
        if (column is None) != (value is None):
            raise ApiError(422, ErrorCode.VALIDATION_ERROR, "a filter needs both column and value")
        if column is not None and column not in columns:
            raise ApiError(422, ErrorCode.VALIDATION_ERROR, f"unknown column: {column}")
        path = _parquet(_world(dataset_id, active_dataset_dir()), table)
        where, bound = (f"WHERE {_matches(column)}", [value]) if column is not None else ("", [])
        with _duckdb() as connection:
            counted = connection.execute(
                f"SELECT count(*) FROM read_parquet(?) {where}", [path, *bound]
            ).fetchone()
            fetched = connection.execute(
                _select(columns, where) + " LIMIT ? OFFSET ?",
                [path, *bound, limit, offset],
            ).fetchall()
        return RowPage(
            table=table,
            offset=offset,
            limit=limit,
            total=int(counted[0]) if counted is not None else 0,
            rows=[
                {name: _json(cell) for name, cell in zip(columns, row, strict=True)}
                for row in fetched
            ],
        )

    @router.get("/datasets/{dataset_id}/tables/{table}/rows/{row_id}", response_model=RecordOut)
    def read_record(dataset_id: str, table: str, row_id: str) -> RecordOut:
        columns = [name for name, _kind in _columns(table)]
        active = active_dataset_dir()
        world = _world(dataset_id, active)
        path = _parquet(world, table)
        key = primary_key(table)
        with _duckdb() as connection:
            fetched = connection.execute(
                _select(columns, f"WHERE {_matches(key)}") + " LIMIT 2",
                [path, row_id],
            ).fetchall()
        if not fetched:
            raise ApiError(404, ErrorCode.NOT_FOUND, f"no {table} row with {key} {row_id}")
        if len(fetched) > 1:
            raise ApiError(
                409,
                ErrorCode.VALIDATION_ERROR,
                f"{table} rows are not unique by {key}; filter the rows page instead",
            )
        row = {name: _json(cell) for name, cell in zip(columns, fetched[0], strict=True)}
        # The graph holds the active world only: a record of another world
        # has no node in it.
        label = label_for_table(table)
        if label is None or world.resolve() != active:
            return RecordOut(table=table, row=row, graph_node_id=None, edges=[])
        node_id = str(row[key])
        edges = _edges(graph, label, node_id)
        return RecordOut(
            table=table,
            row=row,
            graph_node_id=node_id,
            edges=edges,
            graph_error="GRAPH_QUERY_ERROR" if edges is None else None,
        )

    return router
