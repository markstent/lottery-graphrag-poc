"""Parquet writing via DuckDB (ADR-006).

Rows are converted to columnar Arrow tables (DuckDB's native interchange)
and exported with COPY; row-by-row INSERT is orders of magnitude slower.
Arrow types are derived from the declared DDL so stored types stay exact.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, time
from pathlib import Path
from typing import Any

import duckdb
import pyarrow as pa

from app.datasets.util import split_columns

_BASE_TYPES: dict[str, pa.DataType] = {
    "VARCHAR": pa.string(),
    "INTEGER": pa.int32(),
    "BIGINT": pa.int64(),
    "TIMESTAMP": pa.timestamp("us"),
    "DATE": pa.date32(),
    "DOUBLE": pa.float64(),
    "BOOLEAN": pa.bool_(),
}


def _arrow_type(type_text: str) -> pa.DataType:
    base = type_text.split("(")[0].strip().upper()
    if base == "DECIMAL":
        precision, scale = type_text[type_text.find("(") + 1 : type_text.find(")")].split(",")
        return pa.decimal128(int(precision), int(scale))
    return _BASE_TYPES[base]


def _arrow_table(ddl: str, rows: Sequence[tuple[Any, ...]]) -> pa.Table:
    columns = split_columns(ddl)
    if rows:
        values: list[list[Any]] = [list(column) for column in zip(*rows, strict=True)]
    else:
        values = [[] for _ in columns]
    arrays = []
    for i, (_, type_text) in enumerate(columns):
        arrow_type = _arrow_type(type_text)
        column = values[i]
        if arrow_type == pa.timestamp("us"):
            # TIMESTAMP columns receive date objects from upstream generators;
            # Arrow requires datetimes, so anchor dates at midnight. The
            # isinstance order matters: datetime is a subclass of date.
            column = [
                v if v is None or isinstance(v, datetime) else datetime.combine(v, time.min)
                for v in column
            ]
        arrays.append(pa.array(column, type=arrow_type))
    return pa.Table.from_arrays(arrays, names=[name for name, _ in columns])


def write_world(
    output_dir: Path, schemas: dict[str, str], tables: dict[str, list[Any]]
) -> list[Path]:
    """Write every table to ``<output_dir>/<table>.parquet``; returns file paths."""
    output_dir.mkdir(parents=True, exist_ok=True)
    connection = duckdb.connect()
    written: list[Path] = []
    try:
        for name, ddl in schemas.items():
            target = (output_dir / f"{name}.parquet").as_posix()
            connection.register(f"_src_{name}", _arrow_table(ddl, tables[name]))
            try:
                connection.execute(f"COPY _src_{name} TO '{target}' (FORMAT PARQUET)")
            finally:
                connection.unregister(f"_src_{name}")
            written.append(Path(target))
    finally:
        connection.close()
    return written
