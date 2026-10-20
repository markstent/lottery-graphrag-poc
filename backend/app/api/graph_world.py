"""Which world the graph holds.

Neo4j holds one ingested world at a time, and node ids repeat across
worlds, so a graph read for the active dataset is only meaningful when the
graph holds that dataset. ``graph_world_matches`` compares the live node
count of every label with the dataset's own ingestion statistics
(``_graph_stats.json``, written by ``python -m app.graph``). Two worlds
generated from different seeds differ in their counts; the check is a
cheap fingerprint, not a proof.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from app.graph.ingest import GRAPH_STATS_FILE

Clock = Callable[[], float]

WORLD_CHECK_TTL_S = 30.0


class LabelCounts(Protocol):
    """The one graph read the check needs (``GraphReader.label_counts``)."""

    def label_counts(self) -> dict[str, int]: ...


def read_graph_stats(dataset_dir: Path) -> dict[str, Any] | None:
    """The dataset's ingestion statistics, or None when it was never ingested."""
    path = dataset_dir / GRAPH_STATS_FILE
    if not path.is_file():
        return None
    stats: dict[str, Any] = json.loads(path.read_text("utf-8"))
    return stats


def graph_world_matches(reader: LabelCounts, dataset_dir: Path) -> bool | None:
    """Whether the graph's node count per label equals the dataset's
    ingestion statistics; None when the dataset has no statistics."""
    stats = read_graph_stats(dataset_dir)
    if stats is None:
        return None
    recorded: dict[str, int] = stats["nodes"]
    live = {label: count for label, count in reader.label_counts().items() if count}
    return live == recorded


class GraphWorldCheck:
    """``graph_world_matches`` cached for ``WORLD_CHECK_TTL_S`` for the last
    dataset and statistics file checked, so a re-ingestion that rewrites the
    file is seen at once. A failed graph read is not cached. Safe for
    concurrent calls."""

    def __init__(self, clock: Clock = time.monotonic) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        # (dataset directory, statistics mtime), when read, result: the last check.
        self._cached: tuple[tuple[Path, int], float, bool | None] | None = None

    def __call__(self, reader: LabelCounts, dataset_dir: Path) -> bool | None:
        try:
            stamp = (dataset_dir / GRAPH_STATS_FILE).stat().st_mtime_ns
        except FileNotFoundError:
            return None
        key = (dataset_dir.resolve(), stamp)
        with self._lock:
            cached = self._cached
            now = self._clock()
            if cached is not None and cached[0] == key and now - cached[1] < WORLD_CHECK_TTL_S:
                return cached[2]
        result = graph_world_matches(reader, dataset_dir)
        with self._lock:
            self._cached = (key, now, result)
        return result
