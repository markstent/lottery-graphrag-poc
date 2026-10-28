"""The hand-labelling sample of v0.2.0 answers and its agreement analysis
(D-089): a blind sheet, empty label templates for two labellers, a key the
labellers do not open, and the agreement of each measure with the labels."""

from __future__ import annotations

import csv
import dataclasses
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest
from app.evaluation import addendum, labelling
from app.evaluation.checks import TokenCheck
from app.evaluation.grounding import FrozenBank
from app.evaluation.judge import JUDGE_SYSTEM_PROMPT, JudgeItem, blind
from app.evaluation.labelling import (
    CELLS,
    build_sample,
    label_agreement,
    render_sheet,
    write_agreement,
    write_sample,
)
from app.evaluation.runner import ShownBlock
from app.models import gateway

pytestmark = pytest.mark.usefixtures("banks_as_recorded")

RUN_NAME = "official-2026-10-26"
# Distinctive recorded values, so a leak into the sheet is visible.
PARTIAL = 0.6667
LOW = 0.3333
TOKEN_CHECK = {"kind": "token", "expected": "2025-10-07", "aliases": []}
SET_CHECK = {
    "kind": "set",
    "expected": ["MKT_GR", "MKT_UK"],
    "universe": {"MKT_AT": [], "MKT_GR": [], "MKT_UK": []},
}


def _check_payloads(question_id: str) -> list[dict[str, Any]]:
    return [SET_CHECK] if question_id == "SET" else [TOKEN_CHECK]


def _blocks(instance_id: str, pipeline: str) -> list[dict[str, str]]:
    return [
        {
            "carrier_id": f"REC_{n}",
            "title": f"incidents: TITLE_{pipeline}_{n}",
            "text": f"Block {n} of {instance_id}: incident started 2025-10-0{n}.",
        }
        for n in range(1, 5)
    ]


def _run(instance_id: str, pipeline: str, repeat: int, verdict: str, answer: str) -> dict[str, Any]:
    return {
        "pipeline": pipeline,
        "repeat": repeat,
        "verdict": verdict,
        "answer": answer,
        "raw_text": "",
        "cited_blocks": [1, 2],
        "blocks": _blocks(instance_id, pipeline),
        "selected": ["REC_1"],
        "resolved_ids": [],
        "seeded": pipeline != "A",
        "context_tokens": 30,
        "latency_ms": 5.0,
        "generation_failed": False,
        "generation_error": None,
    }


def _score(answer: float | None, correctness: int | None) -> dict[str, Any]:
    judge = (
        None
        if correctness is None
        else {
            "scores": {
                "correctness": correctness,
                "completeness": 1,
                "faithfulness": 1,
                "citation_accuracy": 1,
                "abstention": 1,
            },
            "failure": None,
            "model": "ollama/judge-model",
            "latency_ms": 9.0,
        }
    )
    return {
        "answer": answer,
        "evidence": {
            "recall": None,
            "precision": None,
            "f1": None,
            "claims_found": None,
            "claims_total": 0,
            "efficiency_per_1k": None,
            "anchor_resolved": True,
        },
        "citations": {"accuracy": None, "numeric_citation_rate": None},
        "failure_class": None,
        "judge": judge,
    }


# One repeat: (pipeline, repeat, verdict, answer text, recorded score, judge correctness).
Repeat = tuple[str, int, str, str, float | None, int | None]


def _entry(question_id: str, anchor: str, repeats: list[Repeat]) -> dict[str, Any]:
    checks_id = "SET" if question_id.startswith("SET") else question_id
    bank_question = "L05" if checks_id == "SET" else question_id
    instance_id = f"{bank_question}-2026-{anchor}"
    runs: dict[str, list[dict[str, Any]]] = {}
    scores: dict[str, list[dict[str, Any] | None]] = {}
    for pipeline, repeat, verdict, answer, score, correctness in repeats:
        runs.setdefault(pipeline, []).append(_run(instance_id, pipeline, repeat, verdict, answer))
        scores.setdefault(pipeline, []).append(
            None if score is None and correctness is None else _score(score, correctness)
        )
    return {
        "instance": {
            "instance_id": instance_id,
            "question_id": bank_question,
            "stratum": "H3",
            "sub_stratum": None,
            "ontology_dependent": False,
            "world_seed": 2026,
            "anchor_id": anchor,
            "text": f"When did incident {anchor} start?",
            "expected_answer": f"Incident {anchor} started on 2025-10-07.",
            "checks": _check_payloads(checks_id),
            "claims": [
                {
                    "claim_id": f"{anchor}-c1",
                    "statement": f"{anchor} started on 2025-10-07",
                    "carriers": ["REC_1"],
                }
            ],
        },
        "runs": runs,
        "scores": scores,
    }


def _payload(entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "kind": "official",
        "label": None,
        "selection": {"strata": None, "limit": None},
        "reproducibility": {
            "run": {"scorer_version": "2.0.0", "judge_prompt_version": "1.0.0"},
            "worlds": [],
        },
        "worlds": [{"world_seed": 2026, "bank_hash": "abc", "unavailable": [], "results": entries}],
    }


ABSTAIN = "unknown"
DATE_WITH_TIME = "It started on 2025-10-07T00:00:00 [1]."
DATE_WRONG = "It started on 2025-10-09 [2]."
SOURCES_SILENT = "The sources do not say when it started."


def _small_entries() -> list[dict[str, Any]]:
    """One member per cell, a repeat that fits two cells, and three that fit none."""
    return [
        # Abstention judged correct; also an L03 below 1: the first cell wins.
        _entry("L03", "INC_001", [("A", 0, ABSTAIN, SOURCES_SILENT, 0.0, 2)]),
        # L03 below 1 with a set-like partial score: l03_date, not partial_set.
        _entry("L03", "INC_002", [("B", 0, "success", DATE_WITH_TIME, 0.0, 2)]),
        # Version label.
        _entry("L02", "INC_003", [("C", 1, "success", DATE_WRONG, LOW, 2)]),
        # Partial set.
        _entry("SET1", "INC_004", [("A", 2, "success", "MKT_UK only [1].", PARTIAL, 1)]),
        # Agree, at 0 and 0.
        _entry("L01", "INC_005", [("B", 0, "success", DATE_WRONG, 0.0, 0)]),
        # Fits nothing: a partial token score judged 1.
        _entry("L01", "INC_006", [("C", 0, "success", DATE_WRONG, 0.5, 1)]),
        # Not judged: the judge gave no verdict.
        _entry("L01", "INC_007", [("A", 0, "success", DATE_WITH_TIME, 1.0, None)]),
        # An abstention judged 2 and scored 0 is no agree member either way.
        _entry("L01", "INC_008", [("A", 1, ABSTAIN, SOURCES_SILENT, 1.0, 0)]),
    ]


def _bulk_entries() -> list[dict[str, Any]]:
    """30 abstentions judged correct and 3 L03 dates below 1."""
    entries = [
        _entry("L01", f"INC_{100 + n}", [("A", 0, ABSTAIN, SOURCES_SILENT, 0.0, 2)])
        for n in range(30)
    ]
    entries += [
        _entry("L03", f"INC_{200 + n}", [("B", 0, "success", DATE_WRONG, 0.0, 0)]) for n in range(3)
    ]
    return entries


def _write_run(directory: Path, entries: list[dict[str, Any]]) -> Path:
    directory.mkdir(parents=True)
    (directory / "results.json").write_text(json.dumps(_payload(entries)), encoding="utf-8")
    return directory


@pytest.fixture
def run_dir(tmp_path: Path) -> Path:
    return _write_run(tmp_path / RUN_NAME, _small_entries())


@pytest.fixture
def sample_dir(run_dir: Path, tmp_path: Path) -> Path:
    return write_sample(run_dir, tmp_path / "labels" / "v0.2.0-sample")


def _key(sample: Path) -> dict[str, Any]:
    document: dict[str, Any] = json.loads((sample / "key.json").read_text(encoding="utf-8"))
    return document


def _item_ids_by_cell(sample: Path) -> dict[str, str]:
    return {item["cell"]: item_id for item_id, item in _key(sample)["items"].items()}


def _write_labels(path: Path, rows: dict[str, tuple[str, str]], notes: str = "") -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["item_id", "correctness", "abstained", "notes"])
        for item_id, (correctness, abstained) in rows.items():
            writer.writerow([item_id, correctness, abstained, notes])


def _all(sample: Path, correctness: str, abstained: str = "n") -> dict[str, tuple[str, str]]:
    return {item_id: (correctness, abstained) for item_id in _key(sample)["items"]}


def test_cells_follow_the_precedence_order() -> None:
    items = build_sample(_payload(_small_entries()))
    cells = {item.instance.anchor_id: item.cell for item in items}
    assert cells == {
        "INC_001": "abstention_judged_correct",
        "INC_002": "l03_date",
        "INC_003": "version_label",
        "INC_004": "partial_set",
        "INC_005": "agree",
    }
    assert [name for name, _ in CELLS] == [
        "abstention_judged_correct",
        "l03_date",
        "version_label",
        "partial_set",
        "agree",
    ]
    assert dict(CELLS) == {
        "abstention_judged_correct": 25,
        "l03_date": 15,
        "version_label": 10,
        "partial_set": 25,
        "agree": 25,
    }


def test_items_are_numbered_in_hashed_order_across_cells() -> None:
    items = build_sample(_payload(_small_entries()))
    assert [item.item_id for item in items] == [f"S{n:03d}" for n in range(1, 6)]
    hashes = [
        labelling.sample_hash(item.instance.instance_id, item.run.pipeline, item.run.repeat)
        for item in items
    ]
    assert hashes == sorted(hashes)


def test_cell_sizes_and_shortfall_reported(tmp_path: Path) -> None:
    payload = _payload(_bulk_entries())
    items = build_sample(payload)
    by_cell: dict[str, list[str]] = {}
    for item in items:
        by_cell.setdefault(item.cell, []).append(item.instance.instance_id)
    assert len(by_cell["abstention_judged_correct"]) == 25
    assert len(by_cell["l03_date"]) == 3
    # The first 25 by hash, never backfilled from another cell.
    members = sorted(
        (labelling.sample_hash(instance_id, "A", 0), instance_id)
        for instance_id in (f"L01-2026-INC_{100 + n}" for n in range(30))
    )
    assert sorted(by_cell["abstention_judged_correct"]) == sorted(i for _, i in members[:25])
    assert (
        labelling.sample_hash("L01-2026-INC_100", "A", 0)
        == hashlib.sha256(b"v0.3-labels-2026-10-27:L01-2026-INC_100:A:0").hexdigest()
    )
    sample = write_sample(_write_run(tmp_path / RUN_NAME, _bulk_entries()), tmp_path / "out")
    cells = _key(sample)["cells"]
    assert cells["abstention_judged_correct"] == {
        "size": 25,
        "members": 30,
        "taken": 25,
        "shortfall": 0,
    }
    assert cells["l03_date"] == {"size": 15, "members": 3, "taken": 3, "shortfall": 12}
    assert cells["agree"] == {"size": 25, "members": 0, "taken": 0, "shortfall": 25}


def test_sample_is_deterministic(run_dir: Path, tmp_path: Path) -> None:
    payload = _payload(_small_entries())
    reordered = _payload(list(reversed(_small_entries())))
    assert build_sample(payload) == build_sample(payload) == build_sample(reordered)
    first = write_sample(run_dir, tmp_path / "first")
    second = write_sample(run_dir, tmp_path / "second")
    names = sorted(path.name for path in first.iterdir())
    assert names == ["key.json", "labels-controller.csv", "labels-owner.csv", "sheet.md"]
    assert names == sorted(path.name for path in second.iterdir())
    for name in names:
        assert (first / name).read_bytes() == (second / name).read_bytes()


def test_sheet_hides_approach_cell_and_scores(sample_dir: Path) -> None:
    sheet = (sample_dir / "sheet.md").read_text(encoding="utf-8")
    folded = sheet.casefold()
    assert "pipeline" not in folded
    assert "approach" not in folded
    assert "judge" not in folded
    assert "TITLE_" not in sheet
    assert "incidents:" not in sheet
    for cell, _ in CELLS:
        assert not re.search(rf"\b{cell}\b", sheet), cell
    for value in ("0.6667", "0.667", "0.67", "0.3333", "0.333", "0.33"):
        assert value not in sheet
    assert "Do not open key.json before labelling." in sheet
    assert "abstained: y or n" in sheet
    assert labelling.CORRECTNESS_RUBRIC in sheet
    assert labelling.CORRECTNESS_RUBRIC in JUDGE_SYSTEM_PROMPT


def _section(sheet: str, item_id: str) -> str:
    start = sheet.index(f"## {item_id}\n")
    end = sheet.find("\n## ", start + 1)
    return sheet[start : None if end == -1 else end]


def test_blocks_are_blinded_like_the_judge(sample_dir: Path, run_dir: Path) -> None:
    sheet = (sample_dir / "sheet.md").read_text(encoding="utf-8")
    payload = json.loads((run_dir / "results.json").read_text(encoding="utf-8"))
    entries = {e["instance"]["instance_id"]: e for e in payload["worlds"][0]["results"]}
    for item_id, keyed in _key(sample_dir)["items"].items():
        entry = entries[keyed["instance_id"]]
        run = next(r for r in entry["runs"][keyed["pipeline"]] if r["repeat"] == keyed["repeat"])
        blocks = tuple(ShownBlock(**block) for block in run["blocks"])
        shown, answer = blind(
            JudgeItem(
                question=entry["instance"]["text"],
                expected_answer=entry["instance"]["expected_answer"],
                claim_statements=(),
                blocks=blocks,
                answer=run["answer"],
                cited_blocks=tuple(run["cited_blocks"]),
                blind_seed=item_id,
            )
        )
        section = _section(sheet, item_id)
        found = re.findall(r"^\[(\d+)\] (.*)$", section, flags=re.MULTILINE)
        assert found == [(str(n), block.judge_text) for n, block in enumerate(shown, start=1)]
        assert f"> {answer}" in section
        assert f"Verdict: {run['verdict']}" in section
        assert entry["instance"]["text"] in section
        assert entry["instance"]["expected_answer"] in section
        assert entry["instance"]["claims"][0]["statement"] in section


def test_sheet_omits_a_document_title_but_keeps_headings_and_paths(run_dir: Path) -> None:
    """F12-R: the sheet reads judge_text, as the judge does."""
    payload = json.loads((run_dir / "results.json").read_text(encoding="utf-8"))
    item = build_sample(payload)[0]
    blocks = (
        ShownBlock(
            "CHNK_1", "Release Note: R1", "Release Note: R1 (MKT_UK, en)\nNote text.", "chunk"
        ),
        ShownBlock(
            "INC_1",
            "incidents: INC_1",
            "Incident INC_1 (source: s.incidents, record INC_1)",
            "record",
        ),
        ShownBlock(
            "GAME_1",
            "games: GAME_1",
            "Game GAME_1 (source: s.games, record GAME_1)\n"
            "- reached from INC_1: INC_1 -AFFECTS-> GAME_1",
            "node",
        ),
    )
    run = dataclasses.replace(item.run, blocks=blocks, cited_blocks=(1,))
    sheet = render_sheet([dataclasses.replace(item, run=run)])
    assert "Release Note: R1 (MKT_UK, en)" not in sheet and "Note text." in sheet
    assert "Incident INC_1 (source: s.incidents, record INC_1)" in sheet
    assert "Game GAME_1 (source: s.games, record GAME_1)" in sheet
    assert "- reached from INC_1: INC_1 -AFFECTS-> GAME_1" in sheet


def test_label_files_are_empty_templates(sample_dir: Path) -> None:
    ids = list(_key(sample_dir)["items"])
    for name in ("labels-owner.csv", "labels-controller.csv"):
        with (sample_dir / name).open(encoding="utf-8", newline="") as handle:
            rows = list(csv.reader(handle))
        assert rows[0] == ["item_id", "correctness", "abstained", "notes"]
        assert [row[0] for row in rows[1:]] == ids
        assert all(row[1:] == ["", "", ""] for row in rows[1:])
        assert len(rows) - 1 <= 100


def test_agreement_refuses_missing_or_invalid_labels(sample_dir: Path, run_dir: Path) -> None:
    with pytest.raises(ValueError, match="no labeller has labelled"):
        label_agreement(sample_dir, run_dir)
    rows = _all(sample_dir, "2")
    rows["S002"] = ("3", "n")
    rows["S004"] = ("1", "maybe")
    _write_labels(sample_dir / "labels-owner.csv", rows)
    with pytest.raises(ValueError, match="S002, S004") as refused:
        label_agreement(sample_dir, run_dir)
    assert "S001" not in str(refused.value)
    del rows["S005"]
    rows["S002"] = ("2", "n")
    rows["S004"] = ("1", "Y")
    _write_labels(sample_dir / "labels-owner.csv", rows)
    with pytest.raises(ValueError, match="S005"):
        label_agreement(sample_dir, run_dir)


def test_a_half_filled_second_labeller_is_refused(sample_dir: Path, run_dir: Path) -> None:
    _write_labels(sample_dir / "labels-owner.csv", _all(sample_dir, "2"))
    controller = {item_id: ("", "") for item_id in _key(sample_dir)["items"]}
    controller["S003"] = ("2", "n")
    _write_labels(sample_dir / "labels-controller.csv", controller)
    with pytest.raises(ValueError, match=r"labels-controller\.csv.*S001, S002, S004, S005"):
        label_agreement(sample_dir, run_dir)


def test_agreement_needs_consensus_for_disagreements(sample_dir: Path, run_dir: Path) -> None:
    owner = _all(sample_dir, "2")
    controller = dict(owner)
    controller["S002"] = ("1", "n")
    controller["S004"] = ("2", "y")
    _write_labels(sample_dir / "labels-owner.csv", owner)
    _write_labels(sample_dir / "labels-controller.csv", controller)
    with pytest.raises(ValueError, match=r"labels-consensus\.csv.*S002, S004"):
        label_agreement(sample_dir, run_dir)
    _write_labels(sample_dir / "labels-consensus.csv", {"S002": ("1", "n")})
    with pytest.raises(ValueError, match="S004"):
        label_agreement(sample_dir, run_dir)
    _write_labels(
        sample_dir / "labels-consensus.csv",
        {"S002": ("1", "n"), "S004": ("2", "n"), "S001": ("2", "n")},
    )
    with pytest.raises(ValueError, match=r"not disputed.*S001"):
        label_agreement(sample_dir, run_dir)
    _write_labels(sample_dir / "labels-consensus.csv", {"S002": ("1", "n"), "S004": ("2", "n")})
    result = label_agreement(sample_dir, run_dir)
    labellers = result["labellers"]
    assert labellers["names"] == ["owner", "controller"]
    assert labellers["disputed"] == ["S002", "S004"]
    assert labellers["correctness"]["n"] == 5
    assert labellers["correctness"]["agreement"] == pytest.approx(0.8)
    assert labellers["abstained"]["agreement"] == pytest.approx(0.8)


def test_controller_only_names_the_controller(sample_dir: Path, run_dir: Path) -> None:
    _write_labels(sample_dir / "labels-controller.csv", _all(sample_dir, "2"))
    result = label_agreement(sample_dir, run_dir)
    assert result["labellers"]["names"] == ["controller"]
    assert result["labellers"]["correctness"] is None
    assert (
        "Labelled by: controller only (a model labeller; no human labelled this sample,"
        " so there is no labeller-to-labeller agreement).\n"
    ) in labelling.render_agreement(result)


def test_owner_only_says_one_labeller(sample_dir: Path, run_dir: Path) -> None:
    _write_labels(sample_dir / "labels-owner.csv", _all(sample_dir, "2"))
    page = labelling.render_agreement(label_agreement(sample_dir, run_dir))
    assert "Labelled by: owner only (one labeller" in page
    assert "model labeller" not in page


def test_agreement_refuses_when_neither_labeller_labelled(sample_dir: Path, run_dir: Path) -> None:
    with pytest.raises(ValueError, match="no labeller has labelled"):
        label_agreement(sample_dir, run_dir)
    (sample_dir / "labels-owner.csv").unlink()
    with pytest.raises(ValueError, match="no labeller has labelled"):
        label_agreement(sample_dir, run_dir)


def test_one_labeller_needs_no_consensus(sample_dir: Path, run_dir: Path) -> None:
    _write_labels(sample_dir / "labels-owner.csv", _all(sample_dir, "2"))
    result = label_agreement(sample_dir, run_dir)
    assert result["labellers"]["names"] == ["owner"]
    assert result["labellers"]["correctness"] is None


def _labels_by_cell(sample: Path, labels: dict[str, tuple[str, str]]) -> dict[str, tuple[str, str]]:
    ids = _item_ids_by_cell(sample)
    return {ids[cell]: label for cell, label in labels.items()}


def test_agreement_reports_every_measure_per_cell(sample_dir: Path, run_dir: Path) -> None:
    labels = _labels_by_cell(
        sample_dir,
        {
            "abstention_judged_correct": ("0", "y"),
            "l03_date": ("2", "n"),
            "version_label": ("0", "n"),
            "partial_set": ("1", "n"),
            "agree": ("0", "n"),
        },
    )
    _write_labels(sample_dir / "labels-owner.csv", labels)
    result = label_agreement(sample_dir, run_dir)
    measures = [
        "scorer_recorded",
        "scorer_rescored",
        "judge_recorded",
        "judge_abstention_rule",
    ]
    assert list(result["measures"]) == measures
    assert "scorer 2.0.0" in result["measures"]["scorer_recorded"]
    assert "scorer 2.2.0" in result["measures"]["scorer_rescored"]
    assert "judge 1.0.0" in result["measures"]["judge_recorded"]
    assert set(result["cells"]) == {name for name, _ in CELLS}
    for cell in result["cells"].values():
        assert list(cell["measures"]) == measures
        for found in cell["measures"].values():
            assert set(found) == {
                "n",
                "agreement",
                "weighted_kappa",
                "kappa_shown",
                "wrong_share",
                "flagged",
            }
    overall = result["overall"]
    assert list(overall) == measures
    # Scorer 2.0.0 recorded: levels 0, 0, 1, 1, 0 against labels 0, 2, 0, 1, 0.
    assert overall["scorer_recorded"]["agreement"] == pytest.approx(3 / 5)
    # Scorer 2.1.0 counts the date with a time: L03 rescored to 1, level 2.
    cells = result["cells"]
    assert cells["l03_date"]["measures"]["scorer_recorded"]["agreement"] == 0.0
    assert cells["l03_date"]["measures"]["scorer_rescored"]["agreement"] == 1.0
    # Judge 1.0.0 called the abstention correct; the 1.1.0 rule makes it 0.
    abstention = cells["abstention_judged_correct"]["measures"]
    assert abstention["judge_recorded"]["agreement"] == 0.0
    assert abstention["judge_abstention_rule"]["agreement"] == 1.0
    assert result["abstention"]["agreement"] == 1.0
    assert result["run"] == RUN_NAME


def test_agreement_rescores_with_the_checks_grounded_now(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Scorer 2.2.0 (D-095): the version label beside its platform lives in
    # the L02 check as grounded now, not in the check the run recorded.
    answer = "Incident INC_003 was seen on version 2024.3.0 [1]. It hit the Web Portal."
    run = _write_run(
        tmp_path / RUN_NAME, [_entry("L02", "INC_003", [("C", 1, "2024.3.0", answer, 0.0, 2)])]
    )
    sample = write_sample(run, tmp_path / "labels")
    _write_labels(sample / "labels-controller.csv", _all(sample, "2"))
    recorded = addendum.current_banks

    def grounded_now(payload: dict[str, Any]) -> dict[int, FrozenBank]:
        check = TokenCheck("PLV_WEB_3", qualified=(("2024.3.0", ("Web Portal", "PLT_WEB")),))
        return {
            seed: dataclasses.replace(
                bank,
                instances=tuple(dataclasses.replace(i, checks=(check,)) for i in bank.instances),
            )
            for seed, bank in recorded(payload).items()
        }

    monkeypatch.setattr(addendum, "current_banks", grounded_now)
    measures = label_agreement(sample, run)["cells"]["version_label"]["measures"]
    assert measures["scorer_recorded"]["agreement"] == 0.0
    assert measures["scorer_rescored"]["agreement"] == 1.0


def test_agreement_reports_every_measure_per_approach(sample_dir: Path, run_dir: Path) -> None:
    labels = _labels_by_cell(
        sample_dir,
        {
            "abstention_judged_correct": ("0", "y"),
            "l03_date": ("2", "n"),
            "version_label": ("0", "n"),
            "partial_set": ("1", "n"),
            "agree": ("0", "n"),
        },
    )
    _write_labels(sample_dir / "labels-owner.csv", labels)
    result = label_agreement(sample_dir, run_dir)
    approaches = result["approaches"]
    assert list(approaches) == ["A", "B", "C"]
    assert [approaches[tag]["n"] for tag in "ABC"] == [2, 2, 1]
    for found in approaches.values():
        assert list(found["measures"]) == list(result["measures"])
        for measure in found["measures"].values():
            assert set(measure) == {
                "n",
                "agreement",
                "weighted_kappa",
                "kappa_shown",
                "wrong_share",
            }
    # Scorer 2.0.0 recorded: A abstention 0 v 0 and partial set 1 v 1; B L03 date
    # 0 v 2 and agree 0 v 0; C version label 1 v 0.
    recorded = {tag: approaches[tag]["measures"]["scorer_recorded"] for tag in "ABC"}
    assert [recorded[tag]["agreement"] for tag in "ABC"] == [1.0, 0.5, 0.0]
    assert [recorded[tag]["wrong_share"] for tag in "ABC"] == [0.0, 0.5, 1.0]
    page = labelling.render_agreement(result)
    assert "## Approach A (2 items)" in page
    assert "## Approach C (1 items)" in page


def test_kappa_below_ten_items_is_too_few_to_say(sample_dir: Path, run_dir: Path) -> None:
    owner = _all(sample_dir, "2")
    controller = dict(owner)
    controller["S002"] = ("1", "n")
    _write_labels(sample_dir / "labels-owner.csv", owner)
    _write_labels(sample_dir / "labels-controller.csv", controller)
    _write_labels(sample_dir / "labels-consensus.csv", {"S002": ("2", "n")})
    write_agreement(sample_dir, run_dir)
    result = json.loads((sample_dir / "agreement.json").read_text(encoding="utf-8"))
    page = (sample_dir / "agreement.md").read_text(encoding="utf-8")
    assert result["labellers"]["correctness"]["kappa_shown"] is False
    assert all(
        not cell["measures"][m]["kappa_shown"]
        for cell in result["cells"].values()
        for m in cell["measures"]
    )
    assert all(
        not found["measures"][m]["kappa_shown"]
        for found in result["approaches"].values()
        for m in found["measures"]
    )
    assert "Labellers' correctness: n 5, agreement 0.800, weighted kappa too few to say." in page
    measure_lines = [line for line in page.splitlines() if line.startswith("- ")]
    assert measure_lines
    assert all("weighted kappa too few to say" in line for line in measure_lines)


def test_kappa_from_ten_items_is_shown(tmp_path: Path) -> None:
    run = _write_run(tmp_path / RUN_NAME, _bulk_entries())
    sample = write_sample(run, tmp_path / "out")
    keyed = _key(sample)["items"]
    rows = {item_id: ("0", "n") if n % 3 else ("2", "y") for n, item_id in enumerate(keyed)}
    _write_labels(sample / "labels-owner.csv", rows)
    result = label_agreement(sample, run)
    cell = result["cells"]["abstention_judged_correct"]["measures"]["judge_recorded"]
    assert cell["n"] == 25
    assert cell["kappa_shown"] is True
    assert result["approaches"]["A"]["measures"]["judge_recorded"]["kappa_shown"] is True
    assert result["cells"]["l03_date"]["measures"]["judge_recorded"]["kappa_shown"] is False
    page = labelling.render_agreement(result)
    line = next(
        line
        for line in page.split("## Cell abstention_judged_correct")[1].splitlines()
        if line.startswith("- judge 1.0.0 as recorded:")
    )
    assert "too few to say" not in line
    assert re.search(r"weighted kappa (-?\d\.\d{3}|undefined),", line)


def test_eighty_percent_rule_flags_a_cell(tmp_path: Path) -> None:
    run = _write_run(tmp_path / RUN_NAME, _bulk_entries())
    sample = write_sample(run, tmp_path / "out")
    keyed = _key(sample)["items"]
    # Every abstention labelled correct at 2 (the judge right, the scorer and
    # the abstention rule wrong); the three L03 dates labelled 0.
    rows = {
        item_id: ("2", "y") if item["cell"] == "abstention_judged_correct" else ("0", "n")
        for item_id, item in keyed.items()
    }
    _write_labels(sample / "labels-owner.csv", rows)
    result = label_agreement(sample, run)
    abstention = result["cells"]["abstention_judged_correct"]["measures"]
    assert abstention["scorer_recorded"]["wrong_share"] == 1.0
    assert abstention["scorer_recorded"]["flagged"] is True
    assert abstention["judge_abstention_rule"]["flagged"] is True
    assert abstention["judge_recorded"]["wrong_share"] == 0.0
    assert abstention["judge_recorded"]["flagged"] is False
    agree = result["cells"]["agree"]["measures"]["judge_recorded"]
    assert agree == {
        "n": 0,
        "agreement": None,
        "weighted_kappa": None,
        "kappa_shown": False,
        "wrong_share": None,
        "flagged": False,
    }
    written = write_agreement(sample, run)
    assert written == sample
    page = (sample / "agreement.md").read_text(encoding="utf-8")
    cell_lines = page.split("## Cell abstention_judged_correct")[1].split("\n## ")[0]
    flags = {
        line.split(":")[0]: line.endswith("Flagged.")
        for line in cell_lines.splitlines()
        if line.startswith("- ")
    }
    assert flags == {
        "- scorer 2.0.0 as recorded": True,
        "- scorer 2.2.0 rescored": True,
        "- judge 1.0.0 as recorded": False,
        "- judge 1.0.0 with the 1.1.0 abstention rule applied mechanically": True,
    }
    assert json.loads((sample / "agreement.json").read_text(encoding="utf-8")) == result


def test_wrong_share_at_exactly_eighty_percent_is_flagged() -> None:
    assert labelling.measure_cell([(0, 2)] * 8 + [(2, 2)] * 2)["flagged"] is True
    assert labelling.measure_cell([(0, 2)] * 7 + [(2, 2)] * 3)["flagged"] is False


def test_a_cell_of_fewer_than_ten_items_is_never_flagged() -> None:
    small = labelling.measure_cell([(0, 2)] * 9)
    assert small["wrong_share"] == 1.0
    assert small["flagged"] is False
    assert small["kappa_shown"] is False


def test_sample_writer_refuses_an_out_dir_inside_the_run(run_dir: Path, tmp_path: Path) -> None:
    before = sorted(path.name for path in run_dir.iterdir())
    with pytest.raises(ValueError, match="inside the run"):
        write_sample(run_dir, run_dir / "labels")
    assert sorted(path.name for path in run_dir.iterdir()) == before
    taken = tmp_path / "taken"
    taken.mkdir()
    with pytest.raises(ValueError, match="already exists"):
        write_sample(run_dir, taken)


def test_sample_writer_refuses_any_out_dir_under_the_runs_root(
    run_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs_root = tmp_path / "evaluation" / "runs"
    other_run = runs_root / "official-2026-11-01"
    other_run.mkdir(parents=True)
    monkeypatch.setattr(labelling, "RUNS_ROOT", runs_root)
    with pytest.raises(ValueError, match="inside the runs directory"):
        write_sample(run_dir, other_run / "labels")
    with pytest.raises(ValueError, match="inside the runs directory"):
        write_sample(run_dir, runs_root / "labels")
    assert sorted(path.name for path in runs_root.rglob("*")) == ["official-2026-11-01"]


def test_agreement_writer_refuses_a_run_directory(
    sample_dir: Path, run_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _write_labels(sample_dir / "labels-owner.csv", _all(sample_dir, "2"))
    planted = run_dir / "labels"
    planted.mkdir()
    (planted / "key.json").write_bytes((sample_dir / "key.json").read_bytes())
    (planted / "labels-owner.csv").write_bytes((sample_dir / "labels-owner.csv").read_bytes())
    with pytest.raises(ValueError, match="inside the run"):
        write_agreement(planted, run_dir)
    assert sorted(path.name for path in planted.iterdir()) == ["key.json", "labels-owner.csv"]
    monkeypatch.setattr(labelling, "RUNS_ROOT", tmp_path / "labels")
    with pytest.raises(ValueError, match="inside the runs directory"):
        write_agreement(sample_dir, run_dir)
    assert not (sample_dir / "agreement.json").exists()


def test_agreement_refuses_another_run(sample_dir: Path, tmp_path: Path) -> None:
    _write_labels(sample_dir / "labels-owner.csv", _all(sample_dir, "2"))
    other = _write_run(tmp_path / "official-2026-11-01", _small_entries())
    with pytest.raises(ValueError, match="official-2026-10-26"):
        label_agreement(sample_dir, other)


def test_labelling_calls_no_model(
    run_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*args: object, **kwargs: object) -> None:
        raise AssertionError("labelling called a model")

    monkeypatch.setattr(gateway, "complete", refuse)
    sample = write_sample(run_dir, tmp_path / "out")
    _write_labels(sample / "labels-owner.csv", _all(sample, "2"))
    assert write_agreement(sample, run_dir) == sample


def test_cli_writes_the_sample_and_the_agreement(run_dir: Path, tmp_path: Path) -> None:
    from app.evaluation.__main__ import main

    out = tmp_path / "cli-sample"
    assert main(["label-sample", "--run", str(run_dir), "--out", str(out)]) == 0
    assert (out / "sheet.md").is_file()
    _write_labels(out / "labels-owner.csv", _all(out, "2"))
    assert main(["label-agreement", "--run", str(run_dir), "--sample", str(out)]) == 0
    assert (out / "agreement.md").is_file()
    with pytest.raises(SystemExit, match="already exists"):
        main(["label-sample", "--run", str(run_dir), "--out", str(out)])
