"""The v0.2.0 addendum: a stored run rescored with scorer 2.1.0 and the
groundedness measure, model-free, written beside the run and never into it."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.evaluation import addendum
from app.evaluation.addendum import rescore, write_addendum
from app.evaluation.runner import instance_result_from_payload
from app.models import gateway

DATE_ANSWER = "The incident started on 2025-10-07T00:00:00 [1]."
BLOCK_TEXT = "Incident INC_024 started 2025-10-07T00:00:00. Source: record INC_024."


def _run_payload(answer: str, verdict: str = "success") -> dict[str, Any]:
    return {
        "pipeline": "A",
        "repeat": 0,
        "verdict": verdict,
        "answer": answer,
        "raw_text": "",
        "cited_blocks": [1],
        "blocks": [{"carrier_id": "INC_024", "title": "incidents: INC_024", "text": BLOCK_TEXT}],
        "selected": ["INC_024"],
        "resolved_ids": [],
        "seeded": False,
        "context_tokens": 30,
        "latency_ms": 5.0,
        "generation_failed": False,
        "generation_error": None,
    }


def _score_payload(answer: float, correctness: int) -> dict[str, Any]:
    return {
        "answer": answer,
        "evidence": {
            "recall": 1.0,
            "precision": 0.5,
            "f1": 0.6,
            "claims_found": 1,
            "claims_total": 1,
            "efficiency_per_1k": 2.0,
            "anchor_resolved": True,
        },
        "citations": {"accuracy": 1.0, "numeric_citation_rate": 1.0},
        "failure_class": "wrong_answer",
        "judge": {
            "scores": {
                "correctness": correctness,
                "completeness": 2,
                "faithfulness": 2,
                "citation_accuracy": 2,
                "abstention": 2,
            },
            "failure": None,
            "model": "ollama/gemma4:31b",
            "latency_ms": 9.0,
        },
    }


def _payload() -> dict[str, Any]:
    instance = {
        "instance_id": "L03-2026-INC_024",
        "question_id": "L03",
        "stratum": "H3",
        "sub_stratum": None,
        "ontology_dependent": False,
        "world_seed": 2026,
        "anchor_id": "INC_024",
        "text": "When did incident INC_024 start?",
        "expected_answer": "It started on 2025-10-07.",
        "checks": [{"kind": "token", "expected": "2025-10-07", "aliases": []}],
        "claims": [],
    }
    return {
        "kind": "official",
        "label": None,
        "selection": {"strata": None, "limit": None},
        "reproducibility": {
            "run": {"scorer_version": "2.0.0", "judge_prompt_version": "1.0.0"},
            "worlds": [],
        },
        "worlds": [
            {
                "world_seed": 2026,
                "bank_hash": "abc",
                "unavailable": [],
                "results": [
                    {
                        "instance": instance,
                        "runs": {"A": [_run_payload(DATE_ANSWER)]},
                        "scores": {"A": [_score_payload(0.0, 2)]},
                    }
                ],
            }
        ],
    }


@pytest.fixture
def run_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "official-2026-10-26"
    directory.mkdir()
    (directory / "results.json").write_text(json.dumps(_payload()), encoding="utf-8")
    (directory / "report.md").write_text("# the published report\n", encoding="utf-8")
    return directory


def _snapshot(directory: Path) -> dict[str, bytes]:
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def test_rescoring_changes_only_answer_scores() -> None:
    payload = _payload()
    recorded = instance_result_from_payload(payload["worlds"][0]["results"][0])
    rescored = addendum.rescore_instance(payload["worlds"][0]["results"][0])
    before = recorded.scores["A"][0]
    after = rescored.scores["A"][0]
    assert before is not None
    assert after is not None
    assert before.answer == 0.0
    assert after.answer == 1.0
    assert after.evidence == before.evidence
    assert after.citations == before.citations
    assert after.judge == before.judge
    assert after.failure_class == before.failure_class
    assert after.groundedness is not None
    assert rescored.runs == recorded.runs


def test_rescore_reports_old_and_new_side_by_side() -> None:
    result = rescore(_payload())
    cell = result["strata"]["H3"]["A"]
    assert cell["repeats"] == 1
    assert cell["answer_recorded"] == {"n": 1, "mean": 0.0}
    assert cell["answer_rescored"] == {"n": 1, "mean": 1.0}
    assert cell["abstentions"] == 0
    assert cell["groundedness"]["n"] == 1
    assert cell["agreement"]["answered"]["recorded"]["agreement"] == 0.0
    assert cell["agreement"]["answered"]["rescored"]["agreement"] == 1.0
    assert result["recorded_scorer_version"] == "2.0.0"
    assert result["recorded_judge_prompt_version"] == "1.0.0"


def test_addendum_never_writes_into_the_run(run_dir: Path, tmp_path: Path) -> None:
    before = _snapshot(run_dir)
    out = write_addendum(run_dir, tmp_path / "addenda" / "official-2026-10-26-scorer-2.1.0")
    assert _snapshot(run_dir) == before
    assert {path.name for path in out.iterdir()} == {"addendum.json", "addendum.md"}
    with pytest.raises(ValueError, match="inside the run"):
        write_addendum(run_dir, run_dir / "addendum")
    assert _snapshot(run_dir) == before


def test_addendum_refuses_an_existing_out_dir(run_dir: Path, tmp_path: Path) -> None:
    existing = tmp_path / "taken"
    existing.mkdir()
    with pytest.raises(ValueError, match="already exists"):
        write_addendum(run_dir, existing)


def test_addendum_header_labels_it(run_dir: Path, tmp_path: Path) -> None:
    out = write_addendum(run_dir, tmp_path / "out")
    text = (out / "addendum.md").read_text(encoding="utf-8")
    assert text.startswith("# Addendum to the official run v0.2.0")
    assert (
        "rescored with scorer 2.1.0 and the groundedness measure, no model was called, "
        "and the original record is unchanged"
    ) in text
    assert "scorer 2.0.0" in text
    assert "judge prompt 1.0.0" in text
    document = json.loads((out / "addendum.json").read_text(encoding="utf-8"))
    assert document["run"] == "official-2026-10-26"


def test_addendum_has_no_tests(run_dir: Path, tmp_path: Path) -> None:
    out = write_addendum(run_dir, tmp_path / "out")
    text = (out / "addendum.md").read_text(encoding="utf-8").casefold()
    assert "p-value" not in text
    assert "holm" not in text
    assert "p =" not in text


def test_addendum_calls_no_model(
    run_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*args: object, **kwargs: object) -> None:
        raise AssertionError("the addendum called a model")

    monkeypatch.setattr(gateway, "complete", refuse)
    assert write_addendum(run_dir, tmp_path / "out").is_dir()
