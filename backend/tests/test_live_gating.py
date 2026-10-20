"""The live-test gating (tests/live.py): a set flag never skips, an unset
flag always does, and the presentation graph is put back after a wipe."""

from __future__ import annotations

import json
from pathlib import Path
from typing import ClassVar

import pytest
from app.config import GraphConfig
from app.graph import __main__ as graph_cli

from tests import live

FLAGS = (live.GRAPH, live.VECTOR, live.WORLD)


@pytest.fixture(autouse=True)
def flags_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    for flag in FLAGS:
        monkeypatch.delenv(flag, raising=False)


def test_a_test_is_skipped_unless_every_flag_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(pytest.skip.Exception, match="GRAPH_E2E=1 and LIVE_WORLD_E2E=1"):
        live.skip_without(live.GRAPH, live.WORLD)
    monkeypatch.setenv(live.GRAPH, "1")
    with pytest.raises(pytest.skip.Exception):
        live.skip_without(live.GRAPH, live.WORLD)
    monkeypatch.setenv(live.WORLD, "1")
    live.skip_without(live.GRAPH, live.WORLD)  # does not skip


def test_a_flag_must_be_exactly_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(live.GRAPH, "true")
    assert not live.enabled(live.GRAPH)


def test_a_missing_prerequisite_fails_and_never_skips(tmp_path: Path) -> None:
    present = tmp_path / "world"
    present.mkdir()
    live.require_paths(present)
    with pytest.raises(pytest.fail.Exception, match="missing") as failed:
        live.require_paths(present, tmp_path / "bank.json")
    assert "bank.json" in str(failed.value)


def test_an_unreachable_neo4j_fails_and_never_skips() -> None:
    unreachable = GraphConfig(
        uri="bolt://127.0.0.1:1", user="u", password="p", database="neo4j", timeout_s=0.5
    )
    with pytest.raises(pytest.fail.Exception, match="not reachable"):
        live.require_neo4j(unreachable)


class _Reader:
    counts: ClassVar[dict[str, int]] = {}

    def __init__(self, config: GraphConfig) -> None:
        del config

    def ping(self) -> None:
        pass

    def label_counts(self) -> dict[str, int]:
        return type(self).counts

    def close(self) -> None:
        pass


@pytest.fixture
def world(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, list[list[str]]]:
    """A presentation world with statistics, and the ingestions requested of it."""
    directory = tmp_path / "presentation"
    directory.mkdir()
    (directory / "_graph_stats.json").write_text(json.dumps({"nodes": {"Player": 3}}))
    monkeypatch.setattr(live, "PRESENTATION_DATASET_DIR", str(directory))
    monkeypatch.setattr(live, "GraphReader", _Reader)
    ingestions: list[list[str]] = []

    def main(argv: list[str]) -> int:
        ingestions.append(argv)
        return 0

    monkeypatch.setattr(graph_cli, "main", main)
    return directory, ingestions


def test_a_graph_holding_another_world_is_restored(world: tuple[Path, list[list[str]]]) -> None:
    directory, ingestions = world
    _Reader.counts = {"Player": 99}
    assert live.restore_presentation_graph() is True
    assert ingestions == [["--dataset", str(directory), "--wipe"]]


def test_a_graph_holding_the_presentation_world_is_left_alone(
    world: tuple[Path, list[list[str]]],
) -> None:
    _, ingestions = world
    _Reader.counts = {"Player": 3, "Game": 0}
    assert live.restore_presentation_graph() is False
    assert ingestions == []


def test_a_world_never_ingested_has_nothing_to_restore(
    world: tuple[Path, list[list[str]]],
) -> None:
    directory, ingestions = world
    (directory / "_graph_stats.json").unlink()
    assert live.restore_presentation_graph() is False
    assert ingestions == []


def test_a_failed_restore_fails_the_run(
    world: tuple[Path, list[list[str]]], monkeypatch: pytest.MonkeyPatch
) -> None:
    _Reader.counts = {"Player": 99}
    monkeypatch.setattr(graph_cli, "main", lambda argv: 1)
    with pytest.raises(pytest.fail.Exception, match="restoring the presentation graph"):
        live.restore_presentation_graph()


def test_the_module_fixture_restores_only_when_the_graph_flag_is_set(
    world: tuple[Path, list[list[str]]], monkeypatch: pytest.MonkeyPatch
) -> None:
    _, ingestions = world
    _Reader.counts = {"Player": 99}
    list(live.graph_restored_after())  # runs the body: nothing is restored without the flag
    assert ingestions == []
    monkeypatch.setenv(live.GRAPH, "1")
    list(live.graph_restored_after())
    assert len(ingestions) == 1
