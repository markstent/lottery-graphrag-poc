"""Three-seed orchestration, the H1 depth sweep and the H7 model comparison.

An official benchmark runs the bank over three generated worlds in turn
(spec 10a.6): for each seed, :func:`prepare_world` brings the world, its
graph, its vector collection and its frozen bank up to date, then the
runner scores the world. Neo4j holds one world at a time, so after the
last world (or a failure) the presentation world's graph is ingested again.

:func:`run_benchmark` writes ``results.json``, ``report.md`` and
``summary.json`` into the run directory, each through a temporary file and
``os.replace`` so the API never reads a half-written summary. A run is
cancelled cooperatively: between instances and before each world it checks
its ``cancelled`` flag, and a cancelled run raises :class:`BenchmarkCancelled`
after restoring the presentation graph, writing nothing.
:func:`run_sweep` runs the multi-hop questions with B and C at each graph
depth and reports descriptive means only. :func:`compare_runs` pairs two
official runs of different generation models over the same banks.

Evaluator-only (ADR-008): retrieval code never imports this module.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
import logging
import os
import tempfile
import threading
from collections import Counter, defaultdict
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, cast

from app.config import (
    REPO_ROOT,
    GraphConfig,
    RetrievalSettings,
    from_env,
    judge_settings_from_env,
)
from app.datasets import __main__ as datasets_cli
from app.datasets.config import GENERATOR_VERSION
from app.evaluation.bank import BANK_VERSION, STRATA, question_by_id
from app.evaluation.grounding import (
    FrozenBank,
    GroundingError,
    freeze_bank,
    instance_from_payload,
    load_frozen_bank,
    write_frozen_bank,
)
from app.evaluation.judge import GatewayJudge, check_families
from app.evaluation.report import (
    COMPARED_METRICS,
    OVERALL,
    STRATUM_KEYS,
    metric_tables,
    render_report,
    stratum_key,
    summarize,
)
from app.evaluation.runner import (
    OFFICIAL_MIN_REPEATS,
    PIPELINES,
    SMOKE_LABEL,
    WORLD_MANIFEST,
    BenchmarkRun,
    BenchmarkRunner,
    ReproducibilityRecord,
    Selection,
    WorldRun,
    check_run_config,
)
from app.evaluation.settings_check import (
    COMPARE_MAY_DIFFER,
    PER_WORLD_FIELDS,
    describe_differences,
    settings_differences,
)
from app.evaluation.statistics import cluster_bootstrap, points
from app.graph import __main__ as graph_cli
from app.lab import build_generator, build_lab
from app.retrieval.standard.index import MANIFEST_NAME, build_index, build_store
from app.retrieval.standard.records import RECORD_SERIALISER_VERSION
from app.scenarios.ledger import DEFAULT_TRUTH_PATH

PRESENTATION_SEED = 2026
DEV_ONLY_MESSAGE = (
    "benchmarks run on the dev-profile worlds only; unset DATASET_DIR and TRUTH_LEDGER_PATH "
    "(the demo environment cannot run one)"
)
# The presentation world's truth ledger; read only here, inside the evaluator.
TRUTH_LEDGER_ENV = "TRUTH_LEDGER_PATH"
OFFICIAL_SEEDS = (2026, 2027, 2028)
PROFILE = "dev"
# Official cells and headline tiles use depth 2; the sweep varies it (spec 10a.7).
OFFICIAL_DEPTH = 2
SWEEP_DEPTHS = (0, 1, 2, 3)
SWEEP_STRATUM = "H1"
SWEEP_PIPELINES = ("B", "C")
DATA_DIR = REPO_ROOT / "data"

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class WorldPaths:
    """Where one world seed's data, ledger, frozen bank and collection live."""

    seed: int
    world_dir: Path
    ledger_path: Path
    bank_path: Path
    collection: str


@dataclass(frozen=True, slots=True)
class PrepareSteps:
    """The preparation steps of one world; tests replace them with recorders.

    ``indexed_points`` counts the points in the world's collection, so an
    emptied collection is indexed again.
    """

    generate: Callable[[WorldPaths], None]
    ingest: Callable[[WorldPaths], None]
    index: Callable[[WorldPaths], None]
    ground: Callable[[WorldPaths], None]
    indexed_points: Callable[[WorldPaths], int]


# Called before each instance and once after the last: (instances done, instances total).
InstanceHook = Callable[[int, int], None]
# The progress of a run: (world seed, instances done, instances total).
ProgressHook = Callable[[int, int, int], None]


class BenchmarkCancelled(Exception):
    """A run's ``cancelled`` flag was set; the run stopped and wrote nothing."""


class WorldRunner(Protocol):
    """What a run needs of a runner: one world's results, calling
    ``on_instance`` between instances (it may raise to stop the world)."""

    def run(self, on_instance: InstanceHook | None = None) -> WorldRun: ...


class RunnerFactory(Protocol):
    """Builds the runner of one prepared world; tests pass recorders."""

    def __call__(
        self,
        paths: WorldPaths,
        bank: FrozenBank,
        *,
        kind: str,
        repeats: int,
        pipelines: tuple[str, ...],
        depth: int,
    ) -> WorldRunner: ...


class NotDevWorld(ValueError):
    """A benchmark was asked of a presentation world that is not the dev world."""


def _dev_presentation_world() -> tuple[Path, Path]:
    """The dev-profile presentation world's directory and truth ledger."""
    ledger = DATA_DIR / DEFAULT_TRUTH_PATH.relative_to(REPO_ROOT / "data")
    return DATA_DIR / "generated" / f"{PROFILE}-seed{PRESENTATION_SEED}", ledger


def on_dev_world() -> bool:
    """Whether the presentation world is the dev-profile world with its own
    ledger (neither ``DATASET_DIR`` nor ``TRUTH_LEDGER_PATH`` names another)."""
    paths = world_paths(PRESENTATION_SEED)
    world_dir, ledger = _dev_presentation_world()
    return (
        paths.world_dir.resolve() == world_dir.resolve()
        and paths.ledger_path.resolve() == ledger.resolve()
    )


def ground_command() -> str:
    """The command that grounds the active world's bank."""
    return "make ground-bank" if on_dev_world() else "make ground-demo-bank"


def bank_path_for(world_dir: Path) -> Path:
    """The frozen bank of a world, named after the world's directory."""
    return DATA_DIR / "evaluation" / "bank" / f"bank-{BANK_VERSION}-{world_dir.name}.json"


def world_paths(seed: int) -> WorldPaths:
    """Where one world's data, ledger, bank and collection live.

    The presentation seed is the one place the presentation world is
    defined: its directory is ``DATASET_DIR`` and its ledger is
    ``TRUTH_LEDGER_PATH`` (default ``data/truth/ledger.json``), so the demo
    world is the same world with other values of those two variables. Other
    seeds live beside the development world. Every bank is named after its
    world's directory. ``ValueError`` names an invalid setting.
    """
    collection = os.environ.get("QDRANT_COLLECTION", "semantic_context_lab")
    if seed == PRESENTATION_SEED:
        world_dir = Path(from_env().dataset_dir)
        configured = os.environ.get(TRUTH_LEDGER_ENV)
        ledger_path = Path(configured) if configured else _dev_presentation_world()[1]
        collection_name = collection
    else:
        world_dir = DATA_DIR / "generated" / f"{PROFILE}-seed{seed}"
        ledger_path = DATA_DIR / "truth" / f"dev-seed{seed}.json"
        collection_name = f"{collection}_seed{seed}"
    return WorldPaths(
        seed=seed,
        world_dir=world_dir,
        ledger_path=ledger_path,
        bank_path=bank_path_for(world_dir),
        collection=collection_name,
    )


def run_dir(name: str) -> Path:
    """A run directory under ``data/evaluation/runs``, where the API looks."""
    return DATA_DIR / "evaluation" / "runs" / name


def comparison_dir(name: str) -> Path:
    """A comparison directory under ``data/evaluation/comparisons``."""
    return DATA_DIR / "evaluation" / "comparisons" / name


def world_settings(paths: WorldPaths, depth: int | None = None) -> RetrievalSettings:
    """The environment's retrieval settings pointed at one world and collection."""
    settings = from_env()
    graph = (
        settings.graph if depth is None else dataclasses.replace(settings.graph, max_depth=depth)
    )
    return dataclasses.replace(
        settings,
        dataset_dir=str(paths.world_dir),
        vector=dataclasses.replace(settings.vector, collection=paths.collection),
        graph=graph,
    )


def _generate(paths: WorldPaths) -> None:
    seed = str(paths.seed)
    code = datasets_cli.main(
        [
            *("--profile", PROFILE, "--world-seed", seed, "--scenario-seed", seed),
            *("--output-dir", str(paths.world_dir.parent), "--truth-path", str(paths.ledger_path)),
        ]
    )
    if code != 0:
        raise RuntimeError(f"generating world seed {paths.seed} failed (exit code {code})")


def _ingest(paths: WorldPaths) -> None:
    code = graph_cli.main(["--dataset", str(paths.world_dir), "--wipe"])
    if code != 0:
        raise RuntimeError(f"ingesting world seed {paths.seed} failed (exit code {code})")


def _index(paths: WorldPaths) -> None:
    build_index(world_settings(paths), rebuild=True)


def _ground(paths: WorldPaths) -> None:
    write_frozen_bank(freeze_bank(paths.world_dir, paths.ledger_path), paths.bank_path)


def _indexed_points(paths: WorldPaths) -> int:
    settings = world_settings(paths)
    store = build_store(settings.vector, settings.embedding.dimensions, settings.embedding.provider)
    return store.count()


def default_steps() -> PrepareSteps:
    """The real steps: the generation, graph and index CLIs' functions, in process."""
    return PrepareSteps(_generate, _ingest, _index, _ground, _indexed_points)


def prepare_world(seed: int, steps: PrepareSteps) -> WorldPaths:
    """Bring one world up to date and leave its graph in Neo4j.

    The world is generated when it, or its ledger, is missing or its
    manifest names another generator version, world seed or scenario seed
    (the scenario seed equals the world seed). The graph is ingested with a
    wipe every time. The collection is indexed when the world was just
    generated, the collection is empty, or the index manifest names another
    serialiser version or collection. The bank is grounded when its file is
    missing, fails its own hash, or names another bank version, world
    manifest, ledger or serialiser version.
    """
    paths = world_paths(seed)
    generated = not _world_is_current(paths)
    if generated:
        steps.generate(paths)
    steps.ingest(paths)
    if generated or not _index_is_current(paths, steps):
        steps.index(paths)
    if not _bank_is_current(paths):
        steps.ground(paths)
    return paths


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def _world_is_current(paths: WorldPaths) -> bool:
    manifest = _read_json(paths.world_dir / WORLD_MANIFEST)
    return (
        manifest is not None
        and paths.ledger_path.exists()
        and manifest.get("generator_version") == GENERATOR_VERSION
        and manifest.get("profile") == PROFILE
        and manifest.get("world_seed") == paths.seed
        and manifest.get("scenario_seed") == paths.seed
    )


def _index_is_current(paths: WorldPaths, steps: PrepareSteps) -> bool:
    manifest = _read_json(paths.world_dir / MANIFEST_NAME)
    return (
        manifest is not None
        and manifest.get("record_serialiser_version") == RECORD_SERIALISER_VERSION
        and manifest.get("collection") == paths.collection
        and steps.indexed_points(paths) > 0
    )


def _bank_is_current(paths: WorldPaths) -> bool:
    if not paths.bank_path.exists():
        return False
    try:
        bank = load_frozen_bank(paths.bank_path)
    except GroundingError:
        return False
    return (
        bank.bank_version == BANK_VERSION
        and bank.world_manifest_hash == _sha256(paths.world_dir / WORLD_MANIFEST)
        and bank.ledger_hash == _sha256(paths.ledger_path)
        and bank.record_serialiser_version == RECORD_SERIALISER_VERSION
    )


def bank_matches_active_world() -> bool:
    """Whether the presentation bank is current for the world the API serves
    (``DATASET_DIR`` and ``TRUTH_LEDGER_PATH``), with every check the runner
    makes before it uses a bank: its version, world manifest, ledger and
    record serialiser. A bank whose world or ledger is missing does not
    match."""
    paths = world_paths(PRESENTATION_SEED)
    if not ((paths.world_dir / WORLD_MANIFEST).is_file() and paths.ledger_path.is_file()):
        return False
    return _bank_is_current(paths)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def select_instances(
    bank: FrozenBank, strata: Sequence[str] | None, limit: int | None
) -> FrozenBank:
    """The bank's instances of ``strata`` (all when None), at most ``limit`` per
    logical question in bank order; the bank keeps its hash, the identity of
    the frozen file the instances came from."""
    if strata is not None and (unknown := sorted(set(strata) - set(STRATA))):
        raise ValueError(f"unknown strata {unknown}; expected some of {list(STRATA)}")
    taken: Counter[str] = Counter()
    kept = []
    for instance in bank.instances:
        if strata is not None and instance.stratum not in strata:
            continue
        if limit is not None and taken[instance.question_id] >= limit:
            continue
        taken[instance.question_id] += 1
        kept.append(instance)
    unavailable = tuple(
        u
        for u in bank.unavailable
        if strata is None or question_by_id(u.question_id).stratum in strata
    )
    return dataclasses.replace(bank, instances=tuple(kept), unavailable=unavailable)


def build_runner(
    paths: WorldPaths,
    bank: FrozenBank,
    *,
    kind: str,
    repeats: int,
    pipelines: tuple[str, ...],
    depth: int,
) -> BenchmarkRunner:
    """The real runner over one prepared world: a smoke run always uses the
    fake generator; other kinds use the configured one."""
    settings = world_settings(paths, depth)
    provider = "fake" if kind == "smoke" else settings.generation.provider
    lab = build_lab(settings, build_generator(provider, settings))
    return BenchmarkRunner(
        lab, GraphConfig.from_env(), bank, paths.world_dir, kind, repeats, pipelines=pipelines
    )


def preflight(kind: str, repeats: int) -> None:
    """Check the world, run kind, repeats, generator and judge settings from
    the environment before any world is prepared, as the runner will after.

    A benchmark generates, ingests and grounds the dev-profile worlds, so it
    is refused (:class:`NotDevWorld`) unless the presentation world is the
    dev world: the demo environment would write dev truth to the demo ledger.

    A smoke run always gets the fake generator and the fake judge
    (:func:`build_runner`); other kinds need the gateway for both.
    """
    if not on_dev_world():
        raise NotDevWorld(DEV_ONLY_MESSAGE)
    generation = from_env().generation
    fake = kind == "smoke" or generation.provider == "fake"
    check_run_config(kind, repeats, fake, generation.model_family)
    if kind != "smoke":
        judge = GatewayJudge(judge_settings_from_env())
        if kind == "official":
            check_families(generation.model_family, judge.model_family)


def run_label(kind: str, selection: Selection) -> str | None:
    """Smoke runs are labelled as such; a run over part of the bank says so."""
    if kind == "smoke":
        return SMOKE_LABEL
    if not selection.full:
        return f"subset run ({selection.describe()})"
    return None


def run_id(kind: str, now: datetime | None = None) -> str:
    """``YYYYMMDDTHHMMSSZ-kind`` in UTC: sorts in time order, safe as a file name."""
    moment = now or datetime.now(UTC)
    return f"{moment.astimezone(UTC):%Y%m%dT%H%M%SZ}-{kind}"


def run_benchmark(
    kind: str,
    seeds: Sequence[int],
    repeats: int,
    out_dir: Path,
    strata: Sequence[str] | None = None,
    limit: int | None = None,
    depth: int = OFFICIAL_DEPTH,
    steps: PrepareSteps | None = None,
    runner_factory: RunnerFactory | None = None,
    cancelled: threading.Event | None = None,
    on_progress: ProgressHook | None = None,
) -> BenchmarkRun:
    """Prepare and run each world in turn, restore the presentation graph,
    then write the run's three files into ``out_dir``.

    ``cancelled`` is checked before each world and between instances; once
    it is set the run raises :class:`BenchmarkCancelled`. ``on_progress``
    hears each world's instances done and total as the runner reaches them.
    """
    _refuse_used_dir(out_dir)
    preflight(kind, repeats)
    selection = Selection(None if strata is None else tuple(strata), limit)
    steps = steps or default_steps()
    factory: RunnerFactory = runner_factory or build_runner
    worlds: list[WorldRun] = []
    with _presentation_graph_restored(steps):
        for seed in seeds:
            _stop_if_cancelled(cancelled)
            paths = prepare_world(seed, steps)
            bank = select_instances(load_frozen_bank(paths.bank_path), strata, limit)
            runner = factory(
                paths, bank, kind=kind, repeats=repeats, pipelines=PIPELINES, depth=depth
            )
            worlds.append(runner.run(_instance_hook(seed, cancelled, on_progress)))
    _stop_if_cancelled(cancelled)
    run = BenchmarkRun(kind, run_label(kind, selection), _first_record(worlds), worlds, selection)
    out_dir.mkdir(parents=True, exist_ok=True)
    _write_atomic(out_dir / "results.json", _json(run.to_payload()))
    _write_atomic(out_dir / "report.md", render_report(run))
    # Last: the API publishes summary.json, so the other files exist once it does.
    _write_atomic(out_dir / "summary.json", _json(summarize(run)))
    return run


def _stop_if_cancelled(cancelled: threading.Event | None) -> None:
    if cancelled is not None and cancelled.is_set():
        raise BenchmarkCancelled("the benchmark run was cancelled")


def _instance_hook(
    seed: int, cancelled: threading.Event | None, on_progress: ProgressHook | None
) -> InstanceHook:
    """The runner's hook for one world: stop when cancelled, else report progress."""

    def hook(done: int, total: int) -> None:
        _stop_if_cancelled(cancelled)
        if on_progress is not None:
            on_progress(seed, done, total)

    return hook


def run_sweep(
    seeds: Sequence[int],
    out_dir: Path,
    depths: Sequence[int] = SWEEP_DEPTHS,
    repeats: int = OFFICIAL_MIN_REPEATS,
    limit: int | None = None,
    steps: PrepareSteps | None = None,
    runner_factory: RunnerFactory | None = None,
) -> dict[int, BenchmarkRun]:
    """The H1 depth sweep: B and C on the multi-hop questions at each depth.

    One run per depth over every seed; ``sweep.json`` lists the metrics per
    depth and pipeline with no test. It writes no ``summary.json``, so the
    API never publishes a sweep.
    """
    _refuse_used_dir(out_dir)
    preflight("sweep", repeats)
    selection = Selection((SWEEP_STRATUM,), limit)
    steps = steps or default_steps()
    factory: RunnerFactory = runner_factory or build_runner
    by_depth: dict[int, list[WorldRun]] = defaultdict(list)
    with _presentation_graph_restored(steps):
        for seed in seeds:
            paths = prepare_world(seed, steps)
            bank = select_instances(load_frozen_bank(paths.bank_path), [SWEEP_STRATUM], limit)
            for depth in depths:
                runner = factory(
                    paths,
                    bank,
                    kind="sweep",
                    repeats=repeats,
                    pipelines=SWEEP_PIPELINES,
                    depth=depth,
                )
                by_depth[depth].append(runner.run())
    runs = {
        depth: BenchmarkRun("sweep", None, _first_record(worlds), worlds, selection)
        for depth, worlds in by_depth.items()
    }
    sweep = sweep_summary(runs)
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {"kind": "sweep", "depths": {str(d): r.to_payload() for d, r in runs.items()}}
    _write_atomic(out_dir / "results.json", _json(payload))
    _write_atomic(out_dir / "report.md", render_sweep(sweep))
    _write_atomic(out_dir / "sweep.json", _json(sweep))
    return runs


def sweep_summary(runs: dict[int, BenchmarkRun]) -> dict[str, Any]:
    """Per depth: the multi-hop metrics per pipeline and the depth's run record."""
    first = next(iter(runs.values()))
    return {
        "run_kind": "sweep",
        "bank_version": first.record.bank_version,
        "worlds": [world.world_seed for world in first.worlds],
        "stratum": SWEEP_STRATUM,
        "selection": first.selection.to_payload(),
        "pipelines": list(SWEEP_PIPELINES),
        "note": "Descriptive means per depth; no test is run and no headline is made.",
        "depths": {
            str(depth): {
                "metrics": metric_tables([r for w in run.worlds for r in w.results])[SWEEP_STRATUM],
                "reproducibility": run.reproducibility(),
            }
            for depth, run in sorted(runs.items())
        },
    }


SWEEP_REPORT_METRICS = ("evidence_f1", "evidence_recall", "answer", "context_tokens", "latency_ms")


def render_sweep(sweep: dict[str, Any]) -> str:
    """``report.md`` of a sweep: one row per depth and pipeline."""
    lines = [
        "# Depth sweep",
        "",
        f"Multi-hop questions ({sweep['stratum']}), bank version {sweep['bank_version']}, "
        f"worlds {', '.join(str(seed) for seed in sweep['worlds'])}.",
        sweep["note"],
        "",
        "| Depth | Pipeline | Instances | " + " | ".join(SWEEP_REPORT_METRICS) + " |",
        "|---" * (len(SWEEP_REPORT_METRICS) + 3) + "|",
    ]
    for depth, cell in sweep["depths"].items():
        for tag in sweep["pipelines"]:
            values = [cell["metrics"][metric][tag]["mean"] for metric in SWEEP_REPORT_METRICS]
            shown = ["-" if v is None else f"{v:.3f}" for v in values]
            n = cell["metrics"]["evidence_f1"][tag]["n"]
            lines.append(f"| {depth} | {tag} | {n} | " + " | ".join(shown) + " |")
    return "\n".join(lines) + "\n"


def compare_runs(small: Path, large: Path) -> dict[str, Any]:
    """H7: large minus small per pipeline, stratum and compared metric.

    Both directories must hold official runs of different generation models
    over the same frozen banks (the same bank hash per world). Instances pair
    by ``instance_id``; an instance's value is the mean over its scored
    repeats; pairs cluster by logical question and world. Each cell reports
    the clustered bootstrap interval only, with no test.
    """
    runs = {name: load_results(path) for name, path in (("small", small), ("large", large))}
    for name, payload in runs.items():
        if payload["kind"] != "official":
            raise ValueError(f"the {name} run is a {payload['kind']} run, not an official run")
    models = {name: p["reproducibility"]["run"]["generation_model"] for name, p in runs.items()}
    if models["small"] == models["large"]:
        raise ValueError(f"both runs used generation model {models['small']}")
    selections = {name: p["selection"] for name, p in runs.items()}
    if selections["small"] != selections["large"]:
        raise ValueError(
            f"the runs scored different selections of the bank: {selections['small']} and "
            f"{selections['large']}"
        )
    banks = {name: _bank_hashes(p) for name, p in runs.items()}
    if banks["small"] != banks["large"]:
        raise ValueError(
            f"the runs were scored on different banks: {banks['small']} and {banks['large']}"
        )
    _require_equal_settings(runs["small"]["reproducibility"], runs["large"]["reproducibility"])
    values = {name: instance_means(p) for name, p in runs.items()}
    cells = []
    for tag in PIPELINES:
        for stratum in (*STRATUM_KEYS, OVERALL):
            for metric in COMPARED_METRICS:
                diffs, clusters = [], []
                for instance_id, (key, cluster, small_value) in values["small"].items():
                    large_value = values["large"].get(instance_id)
                    if stratum not in (key, OVERALL) or large_value is None:
                        continue
                    a, b = small_value.get((tag, metric)), large_value[2].get((tag, metric))
                    if a is not None and b is not None:
                        diffs.append(b - a)
                        clusters.append(cluster)
                interval = cluster_bootstrap(diffs, clusters) if diffs else None
                cells.append(
                    {
                        "pipeline": tag,
                        "stratum": stratum,
                        "metric": metric,
                        "n": len(diffs),
                        "clusters": len(set(clusters)),
                        "mean": None if interval is None else interval.mean,
                        "low": None if interval is None else interval.low,
                        "high": None if interval is None else interval.high,
                    }
                )
    return {
        "hypothesis": "H7",
        "small": _run_identity(small, runs["small"]),
        "large": _run_identity(large, runs["large"]),
        "bank_hashes": banks["small"],
        "selection": selections["small"],
        "note": "Large minus small, as a clustered 95 percent interval; no test is run.",
        "cells": cells,
    }


def _require_equal_settings(small: dict[str, Any], large: dict[str, Any]) -> None:
    """Refuse two runs whose recorded settings differ beyond the model, the
    code revision and where they ran; name every differing field."""
    pairs = [("the run records", small["run"], large["run"], COMPARE_MAY_DIFFER | PER_WORLD_FIELDS)]
    if len(small["worlds"]) != len(large["worlds"]):
        raise ValueError("the runs record a different number of worlds")
    pairs += [
        (f"world {a.get('world_seed')}", a, b, COMPARE_MAY_DIFFER)
        for a, b in zip(small["worlds"], large["worlds"], strict=True)
    ]
    problems = []
    for where, a, b, allowed in pairs:
        names = settings_differences(a, b, allowed)
        if names:
            problems.append(
                f"{where} differ in {describe_differences(names, a, b, ('small', 'large'))}"
            )
    if problems:
        raise ValueError("the runs were made with different settings: " + "; ".join(problems))


def render_comparison(comparison: dict[str, Any]) -> str:
    """A plain-text table of the comparison, for the CLI."""
    lines = [
        f"{comparison['large']['generation_model']} minus "
        f"{comparison['small']['generation_model']} ({comparison['note']})"
    ]
    for c in comparison["cells"]:
        shown = (
            "no pairs"
            if c["mean"] is None
            else f"{points(c['mean'])} points ({points(c['low'])} to {points(c['high'])})"
        )
        lines.append(
            f"{c['pipeline']} {c['stratum']} {c['metric']}: {shown}, "
            f"{c['n']} pairs in {c['clusters']} groups"
        )
    return "\n".join(lines)


def write_comparison(comparison: dict[str, Any], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "comparison.json"
    _write_atomic(path, _json(comparison))
    return path


_COMPARED_VALUES: dict[str, Callable[[dict[str, Any]], float | None]] = {
    "answer": lambda score: score["answer"],
    "evidence_f1": lambda score: score["evidence"]["f1"],
}


def instance_means(
    payload: dict[str, Any],
) -> dict[str, tuple[str, str, dict[tuple[str, str], float]]]:
    """Per instance id: its stratum key, its cluster and, per pipeline and
    compared metric, the mean over the repeats that define it."""
    values = {}
    for world in payload["worlds"]:
        for result in world["results"]:
            instance = instance_from_payload(result["instance"])
            means: dict[tuple[str, str], float] = {}
            for tag, scores in result["scores"].items():
                for metric in COMPARED_METRICS:
                    defined = [
                        value
                        for score in scores
                        if score is not None
                        and (value := _COMPARED_VALUES[metric](score)) is not None
                    ]
                    if defined:
                        means[(tag, metric)] = sum(defined) / len(defined)
            cluster = f"{instance.question_id}:{instance.world_seed}"
            values[instance.instance_id] = (stratum_key(instance), cluster, means)
    return values


def load_results(run_dir: Path) -> dict[str, Any]:
    path = run_dir / "results.json"
    if not path.exists():
        raise ValueError(f"{run_dir} holds no results.json")
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def _bank_hashes(payload: dict[str, Any]) -> dict[str, str]:
    return {str(world["world_seed"]): world["bank_hash"] for world in payload["worlds"]}


def _run_identity(run_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    record = payload["reproducibility"]["run"]
    return {
        "run": run_dir.name,
        "generation_model": record["generation_model"],
        "generation_model_family": record["generation_model_family"],
        "generation_quantisation": record["generation_quantisation"],
    }


@contextmanager
def _presentation_graph_restored(steps: PrepareSteps) -> Iterator[None]:
    """Ingest the presentation world (``DATASET_DIR``'s) on exit, whether the block failed or not.

    When the block failed, its error is raised; a failed restore is logged
    and attached to it as a note rather than replacing it.
    """
    presentation = world_paths(PRESENTATION_SEED)
    try:
        yield
    except BaseException as error:
        try:
            steps.ingest(presentation)
        except Exception as restore_error:
            logger.error(
                "restoring the presentation graph failed after a failed run",
                extra={"world_seed": PRESENTATION_SEED, "error": repr(restore_error)},
            )
            error.add_note(
                f"restoring the presentation graph (seed {PRESENTATION_SEED}) also failed: "
                f"{restore_error!r}"
            )
        raise
    steps.ingest(presentation)


def _first_record(worlds: Sequence[WorldRun]) -> ReproducibilityRecord:
    if not worlds or worlds[0].record is None:
        raise RuntimeError("a run needs at least one world with a reproducibility record")
    return worlds[0].record


def _refuse_used_dir(out_dir: Path) -> None:
    for name in ("results.json", "summary.json", "sweep.json"):
        if (out_dir / name).exists():
            raise FileExistsError(f"{out_dir} already holds a run ({name}); choose another --out")


def _json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def _write_atomic(path: Path, text: str) -> None:
    """Write ``text`` to a temporary file beside ``path``, then replace ``path``."""
    descriptor, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(name, path)
    except BaseException:
        Path(name).unlink(missing_ok=True)
        raise
