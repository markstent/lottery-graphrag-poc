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
from typing import Annotated, Any, Literal

import duckdb
from fastapi import APIRouter, Query
from pydantic import JsonValue

from app.api.errors import ApiError, ErrorCode, classify
from app.api.graph_world import GraphWorldCheck
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
    error_responses,
)
from app.config import GraphConfig, from_env
from app.datasets.schema import FOREIGN_KEYS, TABLE_PROVENANCE, TABLE_SCHEMAS, primary_key
from app.datasets.util import split_columns
from app.graph.node_rows import node_identity
from app.retrieval.graph.neo4j_adapter import GraphReader
from app.retrieval.standard.index import MANIFEST_NAME as INDEX_MANIFEST_NAME

logger = logging.getLogger(__name__)

WORLD_MANIFEST_NAME = "_manifest.json"
WORLD_DICTIONARY_NAME = "_data_dictionary.json"
# DuckDB's OFFSET is a signed 64-bit integer.
_MAX_OFFSET = 2**63 - 1


def active_dataset_dir() -> Path:
    """The world the lab is built from, read from configuration."""
    return Path(from_env().dataset_dir).resolve()


def _worlds(active: Path) -> dict[str, Path]:
    """Every directory beside the active world that holds a world manifest.
    An entry that resolves outside that directory (a symlink) is refused."""
    root = active.parent
    if not root.is_dir():
        return {}
    return {
        path.name: path
        for path in sorted(root.iterdir())
        if path.resolve().parent == root
        and path.is_dir()
        and (path / WORLD_MANIFEST_NAME).is_file()
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


def _table_provenance(provenance: dict[str, Any], table: str) -> TableProvenance | None:
    recorded = provenance.get(table)
    return TableProvenance.model_validate(recorded) if recorded is not None else None


def _registry_foreign_keys(table: str) -> list[ForeignKeyOut]:
    return [
        ForeignKeyOut(
            column=key.child_column,
            table=key.parent_table,
            ref_column=primary_key(key.parent_table),
        )
        for key in FOREIGN_KEYS
        if key.child_table == table
    ]


def _registry_dictionary(provenance: dict[str, Any]) -> list[TableSchemaOut]:
    """The dictionary from the code's schema registry, for a world without
    its own dictionary file. The registry holds no column descriptions."""
    return [
        TableSchemaOut(
            table=table,
            source_system=TABLE_PROVENANCE[table][0],
            primary_key=primary_key(table),
            columns=[
                ColumnOut(name=name, type=kind, description=None) for name, kind in _columns(table)
            ],
            foreign_keys=_registry_foreign_keys(table),
            provenance=_table_provenance(provenance, table),
            dictionary_source="registry",
        )
        for table in TABLE_SCHEMAS
    ]


def _world_dictionary(recorded: dict[str, Any], provenance: dict[str, Any]) -> list[TableSchemaOut]:
    """The dictionary the world's generator wrote, in its own table order.

    A field the file lacks is taken from the code's registry: a table's
    source system, its primary key, or (when the file has no foreign-key
    list) its foreign keys. A missing column description stays null.
    """
    fields: dict[str, list[dict[str, Any]]] = {}
    for entry in recorded["tables"]:
        fields.setdefault(entry["table"], []).append(entry)
    keys = {
        table: next((f["field"] for f in entries if f.get("primary_key")), None)
        for table, entries in fields.items()
    }

    def key_of(table: str) -> str:
        return keys.get(table) or primary_key(table)

    recorded_keys = recorded.get("foreign_keys")
    return [
        TableSchemaOut(
            table=table,
            source_system=entries[0].get("source_system") or TABLE_PROVENANCE[table][0],
            primary_key=key_of(table),
            columns=[
                ColumnOut(name=f["field"], type=f["type"], description=f.get("description"))
                for f in sorted(entries, key=lambda f: int(f["position"]))
            ],
            foreign_keys=_registry_foreign_keys(table)
            if recorded_keys is None
            else [
                ForeignKeyOut(
                    column=key["child_column"],
                    table=key["parent_table"],
                    ref_column=key_of(key["parent_table"]),
                )
                for key in recorded_keys
                if key["child_table"] == table
            ],
            provenance=_table_provenance(provenance, table),
            dictionary_source="world",
        )
        for table, entries in fields.items()
    ]


def _parquet(world: Path, table: str) -> str:
    """The table's Parquet file, built from the registry-checked name only."""
    path = world / f"{table}.parquet"
    if not path.is_file():
        raise ApiError(404, ErrorCode.NOT_FOUND, f"dataset {world.name} has no table {table}")
    return str(path)


def _quoted(column: str) -> str:
    return f'"{column}"'


# Declared registry type -> the DuckDB type a bound filter value is cast to.
# Only these fixed names reach a statement, never a registry string itself.
_DUCKDB_TYPES: dict[str, str] = {
    "VARCHAR": "VARCHAR",
    "INTEGER": "INTEGER",
    "DOUBLE": "DOUBLE",
    "BOOLEAN": "BOOLEAN",
    "DATE": "DATE",
    "TIMESTAMP": "TIMESTAMP",
    "DECIMAL(12,2)": "DECIMAL(12,2)",
}


def _matches(connection: duckdb.DuckDBPyConnection, column: str, kind: str, value: str) -> str:
    """A bound equality on ``column`` with ``value`` cast to the column's
    declared type, so an ISO timestamp from a row's JSON matches its row.
    A value that does not cast is a 422 before any row is read."""
    cast = f"TRY_CAST(? AS {_DUCKDB_TYPES[kind]})"
    casts = connection.execute(f"SELECT {cast} IS NOT NULL", [value]).fetchone()
    if casts is None or not casts[0]:
        raise ApiError(
            422, ErrorCode.VALIDATION_ERROR, f"{value!r} is not a {kind} value for {column}"
        )
    return f"{_quoted(column)} = {cast}"


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


GraphError = Literal["GRAPH_QUERY_ERROR", "OTHER_WORLD"]


def _edges(
    graph: GraphConfig, graph_world: GraphWorldCheck, active: Path, label: str, node_id: str
) -> tuple[list[EdgeSummary] | None, GraphError | None]:
    """The node's edge summary, or None with why: the graph holds another
    world than ``active`` (always so while a benchmark job holds it), or it
    cannot be read."""
    if graph_world.benchmark_running:
        return None, "OTHER_WORLD"
    try:
        reader = GraphReader(graph)
        try:
            if graph_world(reader, active) is False:
                return None, "OTHER_WORLD"
            summary = reader.edge_summary(label, node_id)
        finally:
            reader.close()
    except Exception as error:
        code, _retryable = classify(error)
        if code != ErrorCode.GRAPH_QUERY_ERROR:
            raise
        logger.warning("record edge summary failed", exc_info=error, extra={"node_id": node_id})
        return None, "GRAPH_QUERY_ERROR"
    edges = [
        EdgeSummary.model_validate({"type": kind, "direction": way, "count": count})
        for kind, way, count in summary
    ]
    return edges, None


def build_data_model_router(graph: GraphConfig, graph_world: GraphWorldCheck) -> APIRouter:
    """The Data Model routes; record edge summaries read the graph at
    ``graph`` unless ``graph_world`` finds it holding another world."""
    router = APIRouter()

    @router.get("/datasets", response_model=list[DatasetSummary], responses=error_responses())
    def list_datasets() -> list[DatasetSummary]:
        active = active_dataset_dir()
        return [_summary(world, active) for world in _worlds(active).values()]

    @router.get(
        "/datasets/{dataset_id}", response_model=DatasetDetail, responses=error_responses(404, 422)
    )
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

    @router.get(
        "/datasets/{dataset_id}/dictionary",
        response_model=list[TableSchemaOut],
        responses=error_responses(404, 422),
    )
    def read_dictionary(dataset_id: str) -> list[TableSchemaOut]:
        world = _world(dataset_id, active_dataset_dir())
        provenance = _manifest(world).get("provenance", {})
        path = world / WORLD_DICTIONARY_NAME
        if not path.is_file():
            return _registry_dictionary(provenance)
        return _world_dictionary(json.loads(path.read_text("utf-8")), provenance)

    @router.get(
        "/datasets/{dataset_id}/tables/{table}/rows",
        response_model=RowPage,
        responses=error_responses(404, 422),
    )
    def read_rows(
        dataset_id: str,
        table: str,
        offset: Annotated[int, Query(ge=0, le=_MAX_OFFSET)] = 0,
        limit: Annotated[int, Query(ge=1, le=ROWS_LIMIT_MAX)] = ROWS_LIMIT_DEFAULT,
        column: str | None = None,
        value: str | None = None,
    ) -> RowPage:
        kinds = dict(_columns(table))
        columns = list(kinds)
        if (column is None) != (value is None):
            raise ApiError(422, ErrorCode.VALIDATION_ERROR, "a filter needs both column and value")
        if column is not None and column not in kinds:
            raise ApiError(422, ErrorCode.VALIDATION_ERROR, f"unknown column: {column}")
        path = _parquet(_world(dataset_id, active_dataset_dir()), table)
        with _duckdb() as connection:
            where, bound = ("", [])
            if column is not None and value is not None:
                where = f"WHERE {_matches(connection, column, kinds[column], value)}"
                bound = [value]
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

    @router.get(
        "/datasets/{dataset_id}/tables/{table}/rows/{row_id}",
        response_model=RecordOut,
        responses=error_responses(404, 409, 422),
    )
    def read_record(dataset_id: str, table: str, row_id: str) -> RecordOut:
        kinds = dict(_columns(table))
        columns = list(kinds)
        active = active_dataset_dir()
        world = _world(dataset_id, active)
        path = _parquet(world, table)
        key = primary_key(table)
        with _duckdb() as connection:
            where = f"WHERE {_matches(connection, key, kinds[key], row_id)}"
            fetched = connection.execute(
                _select(columns, where) + " LIMIT 2", [path, row_id]
            ).fetchall()
        if not fetched:
            raise ApiError(404, ErrorCode.NOT_FOUND, f"no {table} row with {key} {row_id}")
        if len(fetched) > 1:
            raise ApiError(
                409,
                ErrorCode.CONFLICT,
                f"row id {row_id} is not unique in {table}; filter its rows page instead",
            )
        row = {name: _json(cell) for name, cell in zip(columns, fetched[0], strict=True)}
        identity = node_identity(table)
        if identity is None:
            return RecordOut(table=table, row=row, graph_node_id=None, edges=[])
        # The graph holds the active world only, and ids repeat across worlds.
        if world.resolve() != active:
            return RecordOut(
                table=table, row=row, graph_node_id=None, edges=None, graph_error="OTHER_WORLD"
            )
        label, id_column = identity
        node_id = str(row[id_column])
        edges, graph_error = _edges(graph, graph_world, active, label, node_id)
        return RecordOut(
            table=table,
            row=row,
            graph_node_id=None if graph_error == "OTHER_WORLD" else node_id,
            edges=edges,
            graph_error=graph_error,
        )

    return router
