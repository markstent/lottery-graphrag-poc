"""Which world the graph holds: the cheap fingerprint.

Neo4j holds one ingested world at a time, and node ids repeat across
worlds, so a graph read for a dataset is only meaningful when the graph
holds that dataset. ``graph_world_matches`` compares the live node count of
every label with the dataset's own ingestion statistics
(``_graph_stats.json``, written by ``python -m app.graph``). Two worlds
generated from different seeds differ in their counts; the check is a
fingerprint, not a proof. It is pure, so the API and the evaluator share it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

from app.graph.ingest import GRAPH_STATS_FILE


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
