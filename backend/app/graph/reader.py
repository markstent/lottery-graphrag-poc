"""Read a generated Parquet dataset into row dictionaries."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb

from app.datasets.world import TABLE_SCHEMAS


def load_dataset(dataset_dir: Path) -> dict[str, list[dict[str, Any]]]:
    """Load every table of a generated dataset as a list of row dicts."""
    connection = duckdb.connect()
    try:
        tables: dict[str, list[dict[str, Any]]] = {}
        for name in TABLE_SCHEMAS:
            path = dataset_dir / f"{name}.parquet"
            if not path.exists():
                raise FileNotFoundError(f"dataset table missing: {path}")
            cursor = connection.execute(f"SELECT * FROM '{path.as_posix()}'")
            columns = [description[0] for description in cursor.description]
            tables[name] = [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]
        return tables
    finally:
        connection.close()
