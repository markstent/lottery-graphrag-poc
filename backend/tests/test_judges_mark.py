"""The judges' mark (D-105): the two judges' correctness combined per answer
and tested as its own family, from a run and its second judge's finished
pass, with no model call and nothing written into the run.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.api.benchmarks import _second_judge, second_judge_dir
from app.api.schemas import SecondJudgeOut
from app.evaluation import judges_mark as jm
from app.evaluation import official
from app.evaluation import second_judge as sj
from app.evaluation.__main__ import main
from app.evaluation.report import (
    COMPARISONS,
    HOLM_FAMILY,
    STRATUM_KEYS,
    observe,
    paired_comparisons,
    summarize,
)
from app.evaluation.statistics import holm

from tests.test_benchmark_report import _benchmark
from tests.test_labelling import RUN_NAME, _payload, _small_entries
from tests.test_second_judge import (
    MODEL,
    SLUG,
    FakeGateway,
    _settings,
    _snapshot,
    _with_families,
    _write,
)

pytestmark = pytest.mark.usefixtures("banks_as_recorded")


@pytest.fixture
def run_dir(tmp_path: Path) -> Path:
    return _write(tmp_path / "runs" / RUN_NAME, _with_families(_payload(_small_entries())))


@pytest.fixture
def out_root(tmp_path: Path) -> Path:
    return tmp_path / "second-judge"


@pytest.fixture
def judged(run_dir: Path, out_root: Path) -> Path:
    """The second judge's finished pass over the small run: its directory."""
    return sj.judge_run(run_dir, _settings(), out_root, FakeGateway()).parent


def _combined(run_dir: Path, judged: Path) -> dict[str, Any]:
    found: dict[str, Any] = json.loads(jm.write_combined(run_dir, judged).read_text())
    return found


# -- the mark ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("first", "second", "mark", "disagree"),
    [
        (0, 0, 0.0, False),
        (0, 1, 0.25, False),
        (1, 1, 0.5, False),
        (2, 1, 0.75, False),
        (2, 2, 1.0, False),
        (2, 0, 0.5, True),
        (0, 2, 0.5, True),
    ],
)
def test_the_mark_and_the_disagreement_rule(
    first: int, second: int, mark: float, disagree: bool
) -> None:
    assert jm.judge_mark(first, second) == mark
    assert jm.judges_disagree(first, second) is disagree


def test_the_judges_family_is_the_answer_scores_cells_on_the_mark() -> None:
    answer_cells = {(c, s) for c, s, m in HOLM_FAMILY if m == "answer"}
    assert {(c, s) for c, s, _ in jm.JUDGE_FAMILY} == answer_cells
    assert {m for _, _, m in jm.JUDGE_FAMILY} == {jm.JUDGE_MARK}
    assert len(jm.JUDGE_FAMILY) == 8
    assert {c for c, _, _ in jm.JUDGE_FAMILY} == {"B_vs_A", "C_vs_B"}
    assert {s for _, s, _ in jm.JUDGE_FAMILY} == {"H1", "H2", "H3", "H5"}


# -- on the small run ---------------------------------------------------------------


def test_counts_means_and_the_disagreement_list(run_dir: Path, judged: Path) -> None:
    """First judge 2, 2, 2, 1, 0, 1, none, 0 on INC_001 to INC_008; the fake
    second judge gives 2 only to the answers naming 2025-10-07 (INC_002)."""
    combined = _combined(run_dir, judged)
    assert combined["schema_version"] == jm.COMBINED_SCHEMA_VERSION
    assert (combined["kind"], combined["family"], combined["measure"]) == (
        "combined",
        "judges",
        "judge_mark",
    )
    assert combined["counts"] == {
        "answers": 8,
        "both_judged": 7,
        # (2, 2) on INC_002 and (0, 0) on INC_005 and INC_008.
        "agreed": 3,
        "missing": {
            "generation_failed": 0,
            "first_judge_failed": 1,
            "second_judge_pending": 0,
            "second_judge_failed": 0,
        },
        "disagreements": 2,
    }
    overall = combined["metrics"]["overall"]
    # A: INC_001 (2, 0), INC_004 (1, 0), INC_008 (0, 0); INC_007 has no mark, not 0.
    assert overall["A"] == {"mean": pytest.approx(0.25), "n": 3, "repeats": 3}
    assert overall["B"]["mean"] == pytest.approx(0.5)
    assert overall["C"]["mean"] == pytest.approx(0.375)
    assert [
        (d["instance_id"].split("-")[-1], d["pipeline"], d["first"], d["second"])
        for d in combined["disagreements"]
    ] == [("INC_001", "A", 2, 0), ("INC_003", "C", 2, 0)]
    first = combined["disagreements"][0]
    assert first["question"] and first["world_seed"] == 2026 and first["repeat"] == 0
    assert combined["disagreements_by_stratum"]["overall"] == 2
    assert sum(combined["disagreements_by_stratum"][k] for k in STRATUM_KEYS) == 2
    # The agreement block is the second judge's own between-judges block.
    summary = json.loads((judged / sj.SUMMARY_FILE).read_text())
    assert combined["agreement"] == summary["agreement_between_judges"]
    assert combined["second_judge"] == summary["second_judge"]
    assert combined["second_judge_finished_at"] == summary["finished_at"]


def test_a_failed_or_missing_second_verdict_is_counted_not_zero(
    run_dir: Path, judged: Path
) -> None:
    path = judged / sj.VERDICTS_FILE
    lines = [json.loads(line) for line in path.read_text().splitlines()]
    failed = next(line for line in lines if line["instance_id"].endswith("INC_004"))
    failed.update(scores=None, failure="boom", failure_kind=sj.GATEWAY_ERROR)
    kept = [line for line in lines if not line["instance_id"].endswith("INC_008")]
    path.write_text("".join(json.dumps(line) + "\n" for line in kept))
    combined = _combined(run_dir, judged)
    assert combined["counts"]["missing"]["second_judge_failed"] == 1
    assert combined["counts"]["missing"]["second_judge_pending"] == 1
    assert combined["counts"]["both_judged"] == 5
    # A keeps INC_001 only: 0.5 over one answer, not 0.5 over three.
    assert combined["metrics"]["overall"]["A"] == {"mean": 0.5, "n": 1, "repeats": 1}


def test_combining_calls_no_model_and_writes_only_beside_the_summary(
    run_dir: Path, judged: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(*_: object) -> None:
        raise AssertionError("no model call")

    monkeypatch.setattr(sj, "complete", refuse)
    run_before, judged_before = _snapshot(run_dir), _snapshot(judged)
    path = jm.write_combined(run_dir, judged)
    assert path == judged / jm.COMBINED_FILE
    assert _snapshot(run_dir) == run_before
    after = _snapshot(judged)
    assert set(after) - set(judged_before) == {jm.COMBINED_FILE}
    assert {k: v for k, v in after.items() if k != jm.COMBINED_FILE} == judged_before


def test_a_pass_still_writing_is_read_without_touching_the_file(
    run_dir: Path, judged: Path
) -> None:
    """A last line not yet complete is left out and the file is not rewritten,
    unlike the writer's own read, which trims it."""
    path = judged / sj.VERDICTS_FILE
    path.write_text(path.read_text() + '{"key": "INC_0')
    before = path.read_bytes()
    combined = _combined(run_dir, judged)
    assert path.read_bytes() == before
    assert combined["counts"]["both_judged"] == 7


def test_an_unfinished_second_judge_is_refused(run_dir: Path, judged: Path) -> None:
    (judged / sj.SUMMARY_FILE).unlink()
    with pytest.raises(ValueError, match="has not finished"):
        jm.write_combined(run_dir, judged)


def test_marks_of_two_prompts_are_not_combined(run_dir: Path, judged: Path) -> None:
    payload = json.loads((run_dir / "results.json").read_text())
    payload["reproducibility"]["run"]["judge_prompt_version"] = "1.0.0"
    (run_dir / "results.json").write_text(json.dumps(payload))
    with pytest.raises(ValueError, match="not combined"):
        jm.write_combined(run_dir, judged)


def test_verdicts_of_another_setting_are_refused(run_dir: Path, judged: Path) -> None:
    summary = json.loads((judged / sj.SUMMARY_FILE).read_text())
    summary["second_judge"]["max_tokens"] = 99
    (judged / sj.SUMMARY_FILE).write_text(json.dumps(summary))
    with pytest.raises(ValueError, match="another judge setting"):
        jm.write_combined(run_dir, judged)


def test_nothing_is_written_inside_the_run(run_dir: Path) -> None:
    with pytest.raises(ValueError, match="never writes there"):
        jm.write_combined(run_dir, run_dir / "second")


# -- the tested family --------------------------------------------------------------


def test_the_family_is_tested_as_the_answer_score_with_its_own_holm(tmp_path: Path) -> None:
    """On the synthetic v0.3 run, with a second judge that agrees with the
    first, the judges' cells pass the same gates as the answer score's cells,
    their Holm p-values come from their own tested p-values alone, and the
    run's published summary is unchanged."""
    run = _benchmark("official", h5_per_world=6)
    payload = json.loads(json.dumps(run.to_payload()))
    published = json.loads(json.dumps(summarize(run)))
    verdicts = {
        target.key: {
            "scores": {"correctness": target.score.judge.scores.correctness}
            if target.score.judge and target.score.judge.scores
            else None
        }
        for target in sj.judged_repeats(payload)
    }
    summary = {
        "judge_prompt_version": payload["reproducibility"]["run"]["judge_prompt_version"],
        "judge_prompt_hash": "h",
        "first_judge": {},
        "second_judge": {},
        "finished_at": "t",
        "min_kappa_items": 10,
    }
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(sj, "between_judges", lambda *_: {})
        combined = jm.combine("fixture", payload, summary, verdicts)
    cells = combined["comparisons"]
    assert len(cells) == len(STRATUM_KEYS) * len(COMPARISONS)
    tested = [c for c in cells if c["in_family"]]
    assert tested, "the synthetic run has enough pairs for some tested cells"
    assert {(c["comparison"], c["stratum"], c["metric"]) for c in tested} <= jm.JUDGE_FAMILY
    assert all(c["reason"] != "tested" for c in cells if c["metric"] != jm.JUDGE_MARK)
    adjusted = holm({str(i): c["p"] for i, c in enumerate(tested)})
    assert [c["p_holm"] for c in tested] == [adjusted[str(i)] for i in range(len(tested))]
    # The gates match the answer score's: the same cells are too few.
    answer = {
        (c["comparison"], c["stratum"]): c["reason"]
        for c in published["comparisons"]
        if c["metric"] == "answer"
    }
    assert {(c["comparison"], c["stratum"]): c["reason"] for c in cells} == answer
    assert len(combined["headlines"]) == 10
    # The name-anchored sub-group lines are on the mark, in its unit.
    assert all("judges' mark points" in line for line in combined["headlines"][8:])
    assert json.loads(json.dumps(summarize(run))) == published


def test_paired_comparisons_defaults_are_the_published_family() -> None:
    """The generalised call with no arguments is the summary's comparisons."""
    run = _benchmark("official", h5_per_world=6)
    results = [r for world in run.worlds for r in world.results]
    cells = [c.to_payload() for c in paired_comparisons([observe(r) for r in results])]
    assert cells == summarize(run)["comparisons"]


# -- reading back, the API and the commands -----------------------------------------


def test_published_is_none_until_computed_and_when_stale(
    run_dir: Path, judged: Path, out_root: Path
) -> None:
    summary = json.loads((judged / sj.SUMMARY_FILE).read_text())
    assert jm.published(out_root, RUN_NAME, summary) is None
    jm.write_combined(run_dir, judged)
    found = jm.published(out_root, RUN_NAME, summary)
    assert found is not None and found["family"] == "judges"
    # A newer pass of the second judge makes the mark stale until it is recomputed.
    assert jm.published(out_root, RUN_NAME, {**summary, "finished_at": "later"}) is None


def test_the_api_serves_the_mark_with_the_second_judge(
    run_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs = run_dir.parent
    (run_dir / "summary.json").write_text("{}")
    monkeypatch.setattr("app.api.benchmarks._published", lambda *_: None)
    root = second_judge_dir(runs)
    judged = sj.judge_run(run_dir, _settings(), root, FakeGateway()).parent
    assert _second_judge(runs, RUN_NAME).combined is None
    jm.write_combined(run_dir, judged)
    served: SecondJudgeOut = _second_judge(runs, RUN_NAME)
    assert served.combined is not None
    assert served.combined.counts.disagreements == 2
    assert served.combined.metrics["overall"]["B"].mean == pytest.approx(0.5)


def test_the_commands_write_the_mark(
    run_dir: Path,
    out_root: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("SECOND_JUDGE_PROVIDER", "litellm")
    monkeypatch.setenv("SECOND_JUDGE_MODEL", MODEL)
    monkeypatch.setenv("SECOND_JUDGE_MODEL_FAMILY", "muse")
    monkeypatch.setenv("SECOND_JUDGE_REASONING", "off")
    monkeypatch.setattr(official, "run_dir", lambda name: run_dir.parent / name)
    monkeypatch.setattr(sj, "SECOND_JUDGE_ROOT", out_root)
    monkeypatch.setattr(sj, "complete", FakeGateway())
    path = out_root / RUN_NAME / SLUG / jm.COMBINED_FILE
    assert main(["second-judge", "--run", RUN_NAME]) == 0
    assert f"wrote {path}" in capsys.readouterr().out
    path.unlink()
    assert main(["judges-combined", "--run", RUN_NAME]) == 0
    assert f"wrote {path}" in capsys.readouterr().out
    assert json.loads(path.read_text())["counts"]["disagreements"] == 2
    with pytest.raises(SystemExit, match="no finished second judge"):
        main(["judges-combined", "--run", "official-2099-01-01"])
