"""The v0.2.0 addendum: a stored run rescored with the current scorer and the
groundedness measure, model-free, written beside the run and never into it."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path
from typing import Any

import pytest
from app.evaluation import addendum
from app.evaluation.addendum import current_checks, rescore, rescoring_checks, write_addendum
from app.evaluation.checks import Check, QualifiedAlias, SetCheck, TokenCheck
from app.evaluation.grounding import FrozenBank, freeze_bank
from app.evaluation.official import world_paths
from app.evaluation.report import kappa_text
from app.evaluation.runner import instance_result_from_payload
from app.models import gateway

pytestmark = pytest.mark.usefixtures("banks_as_recorded")

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
    checks = rescoring_checks(payload)
    rescored = addendum.rescore_instance(payload["worlds"][0]["results"][0], checks)
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
    payload = _payload()
    result = rescore(payload, rescoring_checks(payload))
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


# Scorer 2.2.0 (D-095): the L02 rule lives in the check the grounder builds.
VERSION_ANSWER = (
    "Incident INC_022 was seen on platform version 2024.3.0 [1]. It hit the Web Portal."
)


def _l02_payload() -> dict[str, Any]:
    payload = _payload()
    (entry,) = payload["worlds"][0]["results"]
    entry["instance"].update(
        instance_id="L02-2026-INC_022",
        question_id="L02",
        anchor_id="INC_022",
        text="Which platform version was incident INC_022 seen on?",
        expected_answer="Incident INC_022 was seen on platform version PLV_WEB_3.",
        checks=[TokenCheck("PLV_WEB_3").to_payload()],
    )
    entry["runs"]["A"][0].update(verdict="2024.3.0", answer=VERSION_ANSWER)
    return payload


def _grounded_now(payload: dict[str, Any], **changes: Any) -> dict[int, FrozenBank]:
    """The run's bank as grounded now: the L02 check with its version label."""
    (bank,) = addendum.current_banks(payload).values()
    (instance,) = bank.instances
    check = TokenCheck(
        "PLV_WEB_3", qualified=(QualifiedAlias("2024.3.0", ("Web Portal", "PLT_WEB")),)
    )
    now = dataclasses.replace(instance, checks=(check,), **changes)
    return {bank.world_seed: dataclasses.replace(bank, instances=(now,))}


def test_rescoring_scores_with_the_checks_grounded_now() -> None:
    payload = _l02_payload()
    result = rescore(payload, current_checks(payload, _grounded_now(payload)))
    cell = result["strata"]["H3"]["A"]
    assert cell["answer_recorded"] == {"n": 1, "mean": 0.0}
    assert cell["answer_rescored"] == {"n": 1, "mean": 1.0}


def test_rescoring_refuses_an_instance_grounded_differently_now() -> None:
    payload = _l02_payload()
    changed = _grounded_now(payload, text="Which platform version did INC_022 hit?")
    with pytest.raises(ValueError, match="L02-2026-INC_022 of world 2026 is not grounded now"):
        current_checks(payload, changed)


def _with_checks(payload: dict[str, Any], *checks: Check) -> dict[int, FrozenBank]:
    (bank,) = addendum.current_banks(payload).values()
    (instance,) = bank.instances
    now = dataclasses.replace(instance, checks=checks)
    return {bank.world_seed: dataclasses.replace(bank, instances=(now,))}


def test_rescoring_refuses_a_check_that_drifted_in_its_aliases() -> None:
    # Only the qualified aliases (D-095) may differ from the recorded check.
    payload = _l02_payload()
    drifted = _with_checks(payload, TokenCheck("PLV_WEB_3", ("Web Portal 3",)))
    with pytest.raises(ValueError, match=r"checks of L02-2026-INC_022 .* differ"):
        current_checks(payload, drifted)


def test_rescoring_refuses_a_set_check_whose_universe_drifted() -> None:
    payload = _l02_payload()
    (entry,) = payload["worlds"][0]["results"]
    recorded = SetCheck.of({"MKT_GR"}, {"MKT_GR": ["Greece"], "MKT_UK": ["United Kingdom"]})
    entry["instance"]["checks"] = [recorded.to_payload()]
    wider = SetCheck.of({"MKT_GR"}, {"MKT_GR": ["Greece"], "MKT_AT": ["Austria"]})
    with pytest.raises(ValueError, match=r"checks of L02-2026-INC_022 .* differ"):
        current_checks(payload, _with_checks(payload, wider))


def test_rescoring_accepts_a_change_in_the_qualified_aliases_only() -> None:
    payload = _l02_payload()
    (entry,) = payload["worlds"][0]["results"]
    # As a run of scorer 2.2.0 recorded it: the alias without its rivals.
    entry["instance"]["checks"] = [
        TokenCheck("PLV_WEB_3", qualified=(QualifiedAlias("2024.3.0", ("PLT_WEB",)),)).to_payload()
    ]
    now = TokenCheck(
        "PLV_WEB_3",
        qualified=(QualifiedAlias("2024.3.0", ("Web Portal", "PLT_WEB"), ("PLT_DRAW",)),),
    )
    assert current_checks(payload, _with_checks(payload, now)) == {"L02-2026-INC_022": (now,)}


def test_rescoring_refuses_an_instance_the_bank_lacks() -> None:
    payload = _l02_payload()
    (bank,) = addendum.current_banks(payload).values()
    empty = {bank.world_seed: dataclasses.replace(bank, instances=())}
    with pytest.raises(ValueError, match="not grounded now as the run recorded it"):
        current_checks(payload, empty)


def test_current_banks_ground_the_runs_worlds_again(
    tiny_planted: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    world_dir, ledger = tiny_planted
    monkeypatch.undo()  # the real current_banks, not the recorded instances
    monkeypatch.setattr(
        addendum,
        "world_paths",
        lambda seed: dataclasses.replace(
            world_paths(seed), world_dir=world_dir, ledger_path=ledger
        ),
    )
    bank = freeze_bank(world_dir, ledger)
    (l02, *_) = [i for i in bank.instances if i.question_id == "L02"]
    (check,) = l02.checks
    assert isinstance(check, TokenCheck) and check.qualified
    # As a run of scorer 2.1.0 recorded it: the same instance, the id-only check.
    recorded = dataclasses.replace(l02, checks=(TokenCheck(check.expected),))
    payload = {"worlds": [{"world_seed": 42, "results": [{"instance": recorded.to_payload()}]}]}
    assert addendum.rescoring_checks(payload) == {l02.instance_id: (check,)}


def test_addendum_never_writes_into_the_run(run_dir: Path, tmp_path: Path) -> None:
    before = _snapshot(run_dir)
    out = write_addendum(run_dir, tmp_path / "addenda" / "official-2026-10-26-scorer-2.2.1")
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
        "rescored with scorer 2.2.1 and the groundedness measure, no model was called, "
        "and the original record is unchanged"
    ) in text
    assert "scorer 2.0.0" in text
    assert "judge prompt 1.0.0" in text
    document = json.loads((out / "addendum.json").read_text(encoding="utf-8"))
    assert document["run"] == "official-2026-10-26"


def test_addendum_shows_agreement_with_n_and_kappa_only_from_ten(
    run_dir: Path, tmp_path: Path
) -> None:
    out = write_addendum(run_dir, tmp_path / "out")
    text = (out / "addendum.md").read_text(encoding="utf-8")
    line = next(row for row in text.splitlines() if "Judge agreement on answered repeats" in row)
    assert "n 1, agreement 0.000, weighted kappa too few to say." in line
    assert "weighted kappa undefined" not in text
    assert kappa_text(10, 0.5) == "0.500"
    assert kappa_text(9, 0.5) == "too few to say"


def test_groundedness_line_says_which_repeats_its_means_cover() -> None:
    """The means cover only answers that state an id, date or number; the
    line names that count beside every repeat groundedness was computed for."""
    cell = {
        "repeats": 108,
        "abstentions": 0,
        "answer_recorded": {"n": 108, "mean": 0.5},
        "answer_rescored": {"n": 108, "mean": 0.5},
        "groundedness": {
            "n": 108,
            "supported": {"n": 69, "mean": 0.8221},
            "unsupported": {"n": 69, "mean": 0.0091},
        },
        "agreement": {
            key: {
                v: {"n": 0, "agreement": None, "weighted_kappa": None}
                for v in ("recorded", "rescored")
            }
            for key in ("answered", "abstained")
        },
    }
    lines = addendum._cell_lines("A", cell)
    assert (
        "- Groundedness, over the 69 of 108 repeats"
        " whose answer states an id, date or number not in the question:"
        " supported 0.822, unsupported 0.009."
    ) in lines
    assert not any("scored repeats" in line for line in lines)


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
