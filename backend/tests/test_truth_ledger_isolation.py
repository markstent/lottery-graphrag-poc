"""Truth-ledger isolation enforcement (ADR-008).

The boundary is structural, not conventional:

1. No module under ``app/retrieval``, ``app/api``, ``app/datasets``,
   ``app/graph`` or ``app/ontology`` may import ``app.evaluation`` or reference the truth path.
2. The scenario package may write the ledger but must never import the
   loader; producer and consumer share only the JSON contract.
3. ``app.evaluation`` is imported by nothing under ``app/`` except itself.
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
ISOLATED_NAMESPACES = ("retrieval", "api", "datasets", "graph", "ontology")
FORBIDDEN_STRINGS = ("data/truth", "truth_ledger", "load_ledger", "app.evaluation")


def _tree(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"))


def _imported_modules(tree: ast.Module) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def test_isolated_namespaces_never_reference_evaluator_truth() -> None:
    for namespace in ISOLATED_NAMESPACES:
        for path in sorted((APP_DIR / namespace).rglob("*.py")):
            source = path.read_text(encoding="utf-8")
            assert not any(marker in source for marker in FORBIDDEN_STRINGS), (
                f"{namespace}/{path.name} references evaluator truth machinery"
            )
            imports = _imported_modules(_tree(path))
            assert not any(name.startswith("app.evaluation") for name in imports), (
                f"{namespace}/{path.name} imports app.evaluation"
            )


def test_ontology_package_is_independent_of_bank_and_scenarios() -> None:
    allowed = {"app.datasets.config"}
    for path in sorted((APP_DIR / "ontology").rglob("*.py")):
        imports = _imported_modules(_tree(path))
        offenders = {
            name
            for name in imports
            if name.startswith(("app.scenarios", "app.evaluation", "app.datasets"))
            and name not in allowed
        }
        assert not offenders, (path.name, offenders)


def test_scenario_writer_never_imports_the_loader() -> None:
    for path in sorted((APP_DIR / "scenarios").rglob("*.py")):
        imports = _imported_modules(_tree(path))
        assert not any(name.startswith("app.evaluation") for name in imports), (
            f"scenarios/{path.name} imports app.evaluation"
        )


def test_evaluation_loader_is_imported_only_by_itself() -> None:
    for path in sorted(APP_DIR.rglob("*.py")):
        if path.relative_to(APP_DIR).parts[0] == "evaluation":
            continue
        imports = _imported_modules(_tree(path))
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
