"""Truth-ledger isolation enforcement (ADR-008).

The boundary is structural, not conventional:

1. No module in an isolated namespace (``ISOLATED_NAMESPACES``) or among the
   isolated top-level modules (the lab and the trace CLI) may import
   ``app.evaluation`` or reference the truth path by name; the scenario
   package reaches its output path only through ``DEFAULT_TRUTH_PATH``.
2. The scenario package may write the ledger but must never import the
   loader; producer and consumer share only the JSON contract.
3. ``app.evaluation`` is imported by nothing under ``app/`` except itself and
   the two API modules that publish evaluator output (``EVALUATION_API_MODULES``):
   the benchmark routes and post-run scoring. Every other API module stays
   under rule 1, and no API module names the ledger: the two reach it only
   through the evaluator's own functions.
4. Retrievable artefacts (Parquet datasets, manifest) contain no ledger
   fields; scenario configuration in the manifest records only ids,
   strengths and row counts, never planted specifics.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

from app.evaluation import load_ledger
from app.scenarios.catalogue import ENABLED
from app.scenarios.engine import apply_scenarios

APP_DIR = Path(__file__).resolve().parents[1] / "app"
ISOLATED_NAMESPACES = (
    "retrieval",
    "api",
    "datasets",
    "graph",
    "ontology",
    "scenarios",
    "config",
    "events",
    "observability",
    "persistence",
    "models",
)
ISOLATED_MODULES = ("lab.py", "traces.py")
FORBIDDEN_STRINGS = ("data/truth", "truth_ledger", "load_ledger", "app.evaluation")
# The only API modules that may import app.evaluation (Phase 4).
EVALUATION_API_MODULES = frozenset({"benchmarks.py", "scoring.py"})
LEDGER_STRINGS = ("data/truth", "truth_ledger", "load_ledger")
API_DIR = APP_DIR / "api"


def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"))


def _imported_modules(tree: ast.Module, module_path: Path) -> set[str]:
    """Dotted names imported by a module, with relative imports resolved.

    ``from pkg import name`` yields both ``pkg`` and ``pkg.name`` so that
    submodule imports cannot hide behind the package name.
    """
    package = list(module_path.relative_to(APP_DIR.parent).with_suffix("").parts[:-1])
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = package[: len(package) - (node.level - 1)] if node.level else []
            parts = [*base, *([node.module] if node.module else [])]
            if not parts:
                continue
            origin = ".".join(parts)
            modules.add(origin)
            modules.update(f"{origin}.{alias.name}" for alias in node.names)
    return modules


def _imports_evaluation(path: Path) -> bool:
    return any(name.startswith("app.evaluation") for name in _imported_modules(_tree(path), path))


def _evaluation_api_module(path: Path) -> bool:
    return path.parent == API_DIR and path.name in EVALUATION_API_MODULES


def _isolated_paths() -> list[Path]:
    paths = [path for ns in ISOLATED_NAMESPACES for path in sorted((APP_DIR / ns).rglob("*.py"))]
    kept = [path for path in paths if not _evaluation_api_module(path)]
    return [*kept, *(APP_DIR / name for name in ISOLATED_MODULES)]


def test_isolated_modules_exist() -> None:
    for name in (*ISOLATED_NAMESPACES, *ISOLATED_MODULES):
        assert (APP_DIR / name).exists(), f"isolated module app/{name} is missing"


def test_isolated_namespaces_never_reference_evaluator_truth() -> None:
    for path in _isolated_paths():
        where = path.relative_to(APP_DIR)
        source = path.read_text(encoding="utf-8")
        assert not any(marker in source for marker in FORBIDDEN_STRINGS), (
            f"{where} references evaluator truth machinery"
        )
        imports = _imported_modules(_tree(path), path)
        assert not any(name.startswith("app.evaluation") for name in imports), (
            f"{where} imports app.evaluation"
        )


def test_only_two_api_modules_import_evaluation() -> None:
    importing = {path.name for path in sorted(API_DIR.rglob("*.py")) if _imports_evaluation(path)}
    assert importing <= EVALUATION_API_MODULES, importing - EVALUATION_API_MODULES
    assert all(
        path.parent == API_DIR for path in API_DIR.rglob("*.py") if _imports_evaluation(path)
    )
    assert importing == {"benchmarks.py", "scoring.py"}


def test_api_reads_the_ledger_only_through_evaluation() -> None:
    for path in sorted(API_DIR.rglob("*.py")):
        source = path.read_text(encoding="utf-8")
        assert not any(marker in source for marker in LEDGER_STRINGS), (
            f"{path.relative_to(APP_DIR)} names the truth ledger"
        )


def test_retrieval_imports_nothing_from_api() -> None:
    for path in sorted((APP_DIR / "retrieval").rglob("*.py")):
        imports = _imported_modules(_tree(path), path)
        assert not any(name == "app.api" or name.startswith("app.api.") for name in imports), (
            f"{path.relative_to(APP_DIR)} imports app.api"
        )


def test_ontology_package_is_independent_of_bank_and_scenarios() -> None:
    for path in sorted((APP_DIR / "ontology").rglob("*.py")):
        imports = _imported_modules(_tree(path), path)
        offenders = {
            name
            for name in imports
            if name.startswith(("app.scenarios", "app.evaluation", "app.datasets"))
        }
        assert not offenders, (path.name, offenders)


def test_import_extraction_catches_bypass_forms() -> None:
    source = "from app import evaluation\nfrom ..scenarios import plant\nfrom . import model\n"
    fake_path = APP_DIR / "ontology" / "fake.py"
    names = _imported_modules(ast.parse(source), fake_path)
    assert {"app.evaluation", "app.scenarios.plant", "app.ontology.model"} <= names


def test_scenario_writer_never_imports_the_loader() -> None:
    for path in sorted((APP_DIR / "scenarios").rglob("*.py")):
        imports = _imported_modules(_tree(path), path)
        assert not any(name.startswith("app.evaluation") for name in imports), (
            f"scenarios/{path.name} imports app.evaluation"
        )


def test_evaluation_is_imported_only_by_itself_and_the_two_api_modules() -> None:
    for path in sorted(APP_DIR.rglob("*.py")):
        if path.relative_to(APP_DIR).parts[0] == "evaluation" or _evaluation_api_module(path):
            continue
        imports = _imported_modules(_tree(path), path)
        assert not any(name.startswith("app.evaluation") for name in imports), (
            f"{path.relative_to(APP_DIR)} imports app.evaluation outside the evaluator namespace"
        )


def test_retrievable_artefacts_carry_no_ledger_fields(tmp_path: Path) -> None:
    """Manifest and dataset columns stay free of truth-ledger content."""
    from app.datasets.config import GenerationConfig
    from app.datasets.parquet import write_world
    from app.datasets.schema import TABLE_SCHEMAS
    from app.datasets.world import build_world

    world = build_world(GenerationConfig(profile="tiny", world_seed=7, scenario_seed=7))
    apply_scenarios(world)

    dataset_dir = tmp_path / "tiny"
    write_world(dataset_dir, TABLE_SCHEMAS, world.tables)
    manifest_text = json.dumps(world.manifest, sort_keys=True)

    for marker in ("truth", "required_evidence", "expected_signals", "unaffected_explanation"):
        assert marker not in manifest_text, f"manifest leaks ledger field: {marker}"
    assert "planted_rows" in manifest_text  # configuration, not truth

    for table in TABLE_SCHEMAS:
        header = (dataset_dir / f"{table}.parquet").read_bytes()[:4]
        assert header == b"PAR1"  # sanity: table written as Parquet


def test_cli_produces_a_loadable_ledger(tmp_path: Path) -> None:
    """End-to-end: the CLI writes a ledger only the evaluator can interpret."""
    from app.datasets.__main__ import main as datasets_main

    output_dir = tmp_path / "generated"
    truth_path = tmp_path / "truth" / "ledger.json"
    exit_code = datasets_main(
        [
            "--profile",
            "tiny",
            "--world-seed",
            "7",
            "--scenario-seed",
            "7",
            "--output-dir",
            str(output_dir),
            "--truth-path",
            str(truth_path),
        ]
    )
    assert exit_code == 0
    ledger = load_ledger(truth_path)
    assert ledger.world.profile == "tiny"
    assert [scenario.scenario_id for scenario in ledger.scenarios] == list(ENABLED)
    assert len(ledger.scenarios) == 8
    by_id = {scenario.scenario_id: scenario for scenario in ledger.scenarios}
    assert by_id["SCN-007"].truth["primary_market"] in {"MKT_GR", "MKT_AT", "MKT_CZ"}
    assert by_id["SCN-015"].truth["authoritative_price"] > by_id["SCN-015"].truth["stale_price"]
