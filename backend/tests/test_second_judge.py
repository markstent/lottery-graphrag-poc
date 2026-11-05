"""The second judge (D-100): a recorded second opinion over stored answers.

It re-judges a stored run's repeats with the item the first judge saw,
resumes an interrupted pass, never writes into a run, refuses a judge of
the answer model's or the first judge's family, and summarises agreement
with the answer level, between the judges and with the hand labels.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from app.api.benchmarks import _second_judge, second_judge_dir
from app.config import JudgeSettings
from app.evaluation import addendum, judges_mark, labelling, official
from app.evaluation import second_judge as sj
from app.evaluation.__main__ import main
from app.evaluation.judge import (
    JUDGE_DIMENSIONS,
    JUDGE_MAX_TOKENS,
    JUDGE_PROMPT_VERSION,
    JudgeItem,
    build_judge_prompt,
    judge_prompt_hash,
)
from app.evaluation.labelling import write_sample
from app.evaluation.report import summarize
from app.evaluation.runner import ShownBlock
from app.models.gateway import (
    Completion,
    CompletionRequest,
    EmptyCompletionError,
    GatewayError,
)

from tests.conftest import recorded_banks
from tests.test_benchmark_report import (
    V03_FIXTURE_LABEL,
    V03_FIXTURE_RUN,
    V03_FIXTURES,
    _benchmark,
)
from tests.test_labelling import (
    RUN_NAME,
    _all,
    _payload,
    _small_entries,
    _write_labels,
)

pytestmark = pytest.mark.usefixtures("banks_as_recorded")

MODEL = "ollama/muse-glimmer:latest"
SLUG = "ollama-muse-glimmer-latest"
# The seven repeats of the small fixture the first judge was asked about
# (INC_007's first judge gave no verdict, so it is not one of them).
JUDGED = 7


def _settings(**changes: Any) -> JudgeSettings:
    values: dict[str, Any] = {
        "provider": "litellm",
        "model": MODEL,
        "model_family": "muse",
        "api_base": None,
        "temperature": 0.0,
        "reasoning": "off",
    }
    return JudgeSettings(**{**values, **changes})


class FakeGateway:
    """Replies correctness 2 on every dimension when the graded answer names
    the expected date 2025-10-07, else 0; records every request."""

    def __init__(self, fail_after: int | None = None) -> None:
        self.requests: list[CompletionRequest] = []
        self.fail_after = fail_after

    def __call__(self, request: CompletionRequest) -> Completion:
        if self.fail_after is not None and len(self.requests) >= self.fail_after:
            raise KeyboardInterrupt
        self.requests.append(request)
        answer = request.user.split("Answer to grade:\n")[1].split("\n\nSources the answer")[0]
        level = 2 if "2025-10-07" in answer else 0
        text = json.dumps(dict.fromkeys(JUDGE_DIMENSIONS, level))
        return Completion(text, 1.0, None, "stop", False)


def _with_families(payload: dict[str, Any]) -> dict[str, Any]:
    payload["reproducibility"]["run"].update(
        {
            "generation_model": "ollama/qwen3.6:latest",
            "generation_model_family": "qwen",
            "judge_model": "ollama/gemma4:31b",
            "judge_model_family": "gemma",
            # Judged with the prompt the second judge uses, so the two marks combine (D-105).
            "judge_prompt_version": JUDGE_PROMPT_VERSION,
        }
    )
    return payload


def _write(directory: Path, payload: dict[str, Any]) -> Path:
    directory.mkdir(parents=True)
    (directory / "results.json").write_text(json.dumps(payload), encoding="utf-8")
    return directory


@pytest.fixture
def run_dir(tmp_path: Path) -> Path:
    return _write(tmp_path / "runs" / RUN_NAME, _with_families(_payload(_small_entries())))


@pytest.fixture
def out_root(tmp_path: Path) -> Path:
    return tmp_path / "second-judge"


def _lines(out_root: Path) -> list[dict[str, Any]]:
    path = out_root / RUN_NAME / SLUG / sj.VERDICTS_FILE
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def _snapshot(directory: Path) -> dict[str, bytes]:
    """Every path under ``directory`` with a file's bytes; a directory reads as empty."""
    return {
        str(p.relative_to(directory)): b"" if p.is_dir() else p.read_bytes()
        for p in directory.rglob("*")
    }


# -- families -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("second", "generation", "first", "message"),
    [
        (None, "qwen", "gemma", "needs a model family"),
        ("", "qwen", "gemma", "needs a model family"),
        ("Qwen", "qwen", "gemma", "than the answer model"),
        ("GEMMA", "qwen", "gemma", "than the first judge"),
        ("muse", None, "gemma", "no answer model family"),
        ("muse", "qwen", None, "no first judge family"),
    ],
)
def test_a_second_judge_of_a_taken_or_unknown_family_is_refused(
    second: str | None, generation: str | None, first: str | None, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        sj.check_second_family(second, generation, first)


def test_another_family_is_accepted() -> None:
    sj.check_second_family("muse", "qwen", "gemma")


def test_judge_run_refuses_the_first_judges_family(run_dir: Path, out_root: Path) -> None:
    gateway = FakeGateway()
    with pytest.raises(ValueError, match="first judge"):
        sj.judge_run(run_dir, _settings(model_family="Gemma"), out_root, gateway)
    assert gateway.requests == []
    assert not out_root.exists()


def test_settings_come_from_the_second_judge_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SECOND_JUDGE_PROVIDER", "litellm")
    monkeypatch.setenv("SECOND_JUDGE_MODEL", MODEL)
    monkeypatch.setenv("SECOND_JUDGE_MODEL_FAMILY", "muse")
    monkeypatch.setenv("SECOND_JUDGE_REASONING", "off")
    monkeypatch.setenv("SECOND_JUDGE_API_BASE", "http://localhost:11434")
    monkeypatch.delenv("SECOND_JUDGE_TEMPERATURE", raising=False)
    monkeypatch.delenv("SECOND_JUDGE_MAX_TOKENS", raising=False)
    monkeypatch.setenv("JUDGE_MODEL", "ollama/gemma4:31b")
    # The reply limit defaults to the first judge's.
    assert sj.second_judge_settings() == JudgeSettings(
        "litellm", MODEL, "muse", "http://localhost:11434", 0.0, "off", JUDGE_MAX_TOKENS
    )
    monkeypatch.setenv("SECOND_JUDGE_MAX_TOKENS", "2048")
    assert sj.second_judge_settings().max_tokens == 2048


@pytest.mark.parametrize("raw", ["0", "-5", "many"])
def test_a_reply_limit_below_one_is_refused(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    monkeypatch.setenv("SECOND_JUDGE_PROVIDER", "litellm")
    monkeypatch.setenv("SECOND_JUDGE_MAX_TOKENS", raw)
    with pytest.raises(ValueError, match="SECOND_JUDGE_MAX_TOKENS"):
        sj.second_judge_settings()


def test_the_reply_limit_is_the_only_call_setting_that_changes(
    run_dir: Path, out_root: Path
) -> None:
    """With a larger reply limit the judge sees the same prompt; the limit is
    recorded in every line and in the summary beside the first judge's."""
    plain, larger = FakeGateway(), FakeGateway()
    sj.judge_run(run_dir, _settings(), out_root, plain)
    tmp = out_root.with_name("second-judge-2048")
    summary = json.loads(sj.judge_run(run_dir, _settings(max_tokens=2048), tmp, larger).read_text())
    assert [(r.system, r.user) for r in plain.requests] == [
        (r.system, r.user) for r in larger.requests
    ]
    assert {r.max_tokens for r in larger.requests} == {2048}
    assert summary["second_judge"]["max_tokens"] == 2048
    assert summary["first_judge"]["max_tokens"] == JUDGE_MAX_TOKENS
    lines = (tmp / RUN_NAME / SLUG / sj.VERDICTS_FILE).read_text(encoding="utf-8").splitlines()
    assert {json.loads(line)["max_tokens"] for line in lines} == {2048}


def test_settings_refuse_a_judge_that_calls_no_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECOND_JUDGE_PROVIDER", raising=False)
    with pytest.raises(ValueError, match="SECOND_JUDGE_PROVIDER=litellm"):
        sj.second_judge_settings()


# -- the item and the record ------------------------------------------------------


def test_the_prompt_is_the_one_the_first_judge_saw(run_dir: Path, out_root: Path) -> None:
    """The item is rebuilt as the runner builds it, with the same blinding
    seed, so the prompt text is identical for a stored repeat."""
    gateway = FakeGateway()
    sj.judge_run(run_dir, _settings(), out_root, gateway)
    assert len(gateway.requests) == JUDGED
    entry = next(e for e in _small_entries() if e["instance"]["anchor_id"] == "INC_002")
    run = entry["runs"]["B"][0]
    instance = entry["instance"]
    expected = build_judge_prompt(
        JudgeItem(
            question=instance["text"],
            expected_answer=instance["expected_answer"],
            claim_statements=tuple(claim["statement"] for claim in instance["claims"]),
            blocks=tuple(ShownBlock(**block) for block in run["blocks"]),
            answer=run["answer"],
            cited_blocks=tuple(run["cited_blocks"]),
            blind_seed=f"{instance['instance_id']}:B:0",
        )
    )
    sent = [(r.system, r.user) for r in gateway.requests]
    assert expected in sent
    request = gateway.requests[0]
    assert (request.model, request.max_tokens, request.temperature, request.reasoning) == (
        MODEL,
        JUDGE_MAX_TOKENS,
        0.0,
        "off",
    )


def test_each_line_records_the_reply_and_the_first_judge(run_dir: Path, out_root: Path) -> None:
    sj.judge_run(run_dir, _settings(), out_root, FakeGateway())
    lines = _lines(out_root)
    assert len(lines) == JUDGED
    line = next(x for x in lines if x["key"] == "L03-2026-INC_002:B:0")
    assert line["model"] == MODEL
    assert line["prompt_version"] == JUDGE_PROMPT_VERSION
    assert line["prompt_hash"] == judge_prompt_hash()
    assert line["scores"]["correctness"] == 2
    assert json.loads(line["raw_reply"])["correctness"] == 2
    assert line["first_judge"]["scores"]["correctness"] == 2
    assert line["first_judge"]["model"] == "ollama/judge-model"
    assert (line["instance_id"], line["pipeline"], line["repeat"]) == ("L03-2026-INC_002", "B", 0)


def test_failures_are_recorded_by_kind(run_dir: Path, out_root: Path) -> None:
    calls = {"n": 0}

    def flaky(request: CompletionRequest) -> Completion:
        calls["n"] += 1
        if calls["n"] == 1:
            raise GatewayError("connection refused")
        if calls["n"] == 2:
            return Completion('{"correctness": 2', 1.0, None, "length", True)
        if calls["n"] == 3:
            # A thinking model that spends the reply cap on hidden reasoning.
            raise EmptyCompletionError("Model gateway returned an empty answer")
        return FakeGateway()(request)

    summary = json.loads(sj.judge_run(run_dir, _settings(), out_root, flaky).read_text())
    counts = summary["counts"]
    assert counts["repeats"] == JUDGED
    assert counts["judged"] == JUDGED - 3
    assert counts["failures"] == 3
    assert counts["failure_kinds"] == {
        sj.EMPTY_REPLY: 1,
        sj.GATEWAY_ERROR: 1,
        sj.UNUSABLE_REPLY: 1,
    }
    assert counts["failure_messages"]["connection refused"] == 1
    assert counts["cut_off_replies"] == 1
    cut = next(line for line in _lines(out_root) if line["failure_kind"] == sj.UNUSABLE_REPLY)
    assert cut["raw_reply"] == '{"correctness": 2'
    assert (cut["scores"], cut["token_limit_reached"]) == (None, True)


def test_a_rerun_retries_the_failures_and_keeps_the_scores(run_dir: Path, out_root: Path) -> None:
    """A resumed pass skips the scored repeats and calls again for each
    failure; the latest line of a repeat counts, so the summary is the final state."""
    failing = {"n": 0}

    def flaky(request: CompletionRequest) -> Completion:
        failing["n"] += 1
        if failing["n"] == 1:
            raise GatewayError("connection refused")
        if failing["n"] == 2:
            raise EmptyCompletionError("Model gateway returned an empty answer")
        if failing["n"] == 3:
            return Completion("not json", 1.0, None, "stop", False)
        return FakeGateway()(request)

    first = json.loads(sj.judge_run(run_dir, _settings(), out_root, flaky).read_text())
    assert first["counts"]["failures"] == 3
    failed = {line["key"] for line in _lines(out_root) if line["scores"] is None}
    retry = FakeGateway()
    summary = json.loads(sj.judge_run(run_dir, _settings(), out_root, retry).read_text())
    assert len(retry.requests) == 3
    lines = _lines(out_root)
    assert len(lines) == JUDGED + 3
    latest = {line["key"]: line for line in lines}
    assert all(latest[key]["scores"] is not None for key in failed)
    counts = summary["counts"]
    assert (counts["judged"], counts["failures"], counts["failure_kinds"]) == (JUDGED, 0, {})
    # Every repeat now has scores: a third pass calls nothing.
    again = FakeGateway()
    sj.judge_run(run_dir, _settings(), out_root, again)
    assert again.requests == []


# -- resume and refusal to mix ----------------------------------------------------


def test_an_interrupted_pass_resumes_where_it_stopped(run_dir: Path, out_root: Path) -> None:
    with pytest.raises(KeyboardInterrupt):
        sj.judge_run(run_dir, _settings(), out_root, FakeGateway(fail_after=3))
    assert len(_lines(out_root)) == 3
    assert not (out_root / RUN_NAME / SLUG / sj.SUMMARY_FILE).exists()
    # A last line cut short by the interruption is dropped, and judged again.
    path = out_root / RUN_NAME / SLUG / sj.VERDICTS_FILE
    path.write_text(path.read_text(encoding="utf-8") + '{"key": "half', encoding="utf-8")
    second = FakeGateway()
    sj.judge_run(run_dir, _settings(), out_root, second)
    assert len(second.requests) == JUDGED - 3
    keys = [line["key"] for line in _lines(out_root)]
    assert len(keys) == len(set(keys)) == JUDGED
    # A finished pass calls nothing more.
    third = FakeGateway()
    sj.judge_run(run_dir, _settings(), out_root, third)
    assert third.requests == []


@pytest.mark.parametrize(
    "changes",
    [{"temperature": 0.2}, {"reasoning": "default"}, {"max_tokens": 2048}],
    ids=["temperature", "reasoning", "reply limit"],
)
def test_one_directory_never_mixes_judge_settings(
    run_dir: Path, out_root: Path, changes: dict[str, Any]
) -> None:
    with pytest.raises(KeyboardInterrupt):
        sj.judge_run(run_dir, _settings(), out_root, FakeGateway(fail_after=2))
    with pytest.raises(ValueError, match="another judge setting"):
        sj.judge_run(run_dir, _settings(**changes), out_root, FakeGateway())


def test_one_directory_never_mixes_prompts(run_dir: Path, out_root: Path) -> None:
    with pytest.raises(KeyboardInterrupt):
        sj.judge_run(run_dir, _settings(), out_root, FakeGateway(fail_after=2))
    path = out_root / RUN_NAME / SLUG / sj.VERDICTS_FILE
    lines = _lines(out_root)
    lines[0]["prompt_hash"] = "older"
    path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
    with pytest.raises(ValueError, match="prompt_hash"):
        sj.judge_run(run_dir, _settings(), out_root, FakeGateway())


def test_each_model_has_its_own_directory() -> None:
    assert sj.model_slug(MODEL) == SLUG
    assert sj.model_slug("openrouter/Meta/Muse-Glimmer") == "openrouter-meta-muse-glimmer"


# -- nothing is written into a run -----------------------------------------------


def test_nothing_is_written_under_the_runs_directory(run_dir: Path, out_root: Path) -> None:
    before = _snapshot(run_dir.parent)
    sj.judge_run(run_dir, _settings(), out_root, FakeGateway())
    assert _snapshot(run_dir.parent) == before
    assert (out_root / RUN_NAME / SLUG / sj.SUMMARY_FILE).is_file()


def test_an_output_root_inside_the_run_or_the_runs_root_is_refused(
    run_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    gateway = FakeGateway()
    with pytest.raises(ValueError, match="never writes there"):
        sj.judge_run(run_dir, _settings(), run_dir / "second", gateway)
    monkeypatch.setattr(labelling, "RUNS_ROOT", run_dir.parent)
    with pytest.raises(ValueError, match="never writes there"):
        sj.judge_run(run_dir, _settings(), run_dir.parent / "elsewhere", gateway)
    assert gateway.requests == []


# -- the summary ------------------------------------------------------------------


def test_summary_maths_on_a_small_run(run_dir: Path, out_root: Path) -> None:
    summary = json.loads(sj.judge_run(run_dir, _settings(), out_root, FakeGateway()).read_text())
    assert summary["schema_version"] == sj.SUMMARY_SCHEMA_VERSION
    assert summary["kind"] == "run"
    assert summary["run_id"] == RUN_NAME
    assert summary["second_judge"] == {
        "model": MODEL,
        "model_family": "muse",
        "reasoning": "off",
        "temperature": 0.0,
        "max_tokens": JUDGE_MAX_TOKENS,
    }
    assert summary["first_judge"]["model_family"] == "gemma"
    assert summary["judge_prompt_hash"] == judge_prompt_hash()
    assert summary["started_at"] <= summary["finished_at"]

    # Answered: first 2, 2, 1, 0, 1 against second 2, 0, 0, 0, 0.
    between = summary["agreement_between_judges"]
    assert between["answered"]["n"] == 5
    assert between["answered"]["agreement"] == pytest.approx(2 / 5)
    assert between["answered"]["confusion"] == [[1, 0, 0], [2, 0, 0], [1, 0, 1]]
    # Abstained: first 2 and 0, second 0 and 0.
    assert between["abstained"]["agreement"] == pytest.approx(1 / 2)
    assert between["abstained"]["confusion"] == [[1, 0, 0], [0, 0, 0], [1, 0, 0]]

    # The second judge against the answer level: levels 0, 1, 1, 0, 1 against 2, 0, 0, 0, 0.
    second = summary["agreement_with_answer_level"]["second"]["overall"]["answered"]
    assert (second["n"], second["agreement"]) == (5, pytest.approx(1 / 5))

    means = summary["means"]
    assert means["A"]["n"] == 3
    assert means["A"]["first"]["correctness"] == pytest.approx(1.0)
    assert means["A"]["second"]["correctness"] == 0.0
    assert means["B"]["second"] == dict.fromkeys(JUDGE_DIMENSIONS, 1.0)


def test_the_first_judges_agreement_equals_the_published_one(out_root: Path) -> None:
    """Recomputed from the stored run, the first judge's agreement is the
    run's published ``judge_agreement``."""
    run = _benchmark("official", h5_per_world=6)
    payload = json.loads(json.dumps(run.to_payload()))
    published = json.loads(json.dumps(summarize(run)))["judge_agreement"]
    summary = json.loads(json.dumps(sj.run_summary("fixture", payload, _settings(), {})))
    assert summary["agreement_with_answer_level"]["first"] == published
    # With no verdicts yet, the second judge has judged nothing.
    assert summary["agreement_with_answer_level"]["second"]["overall"]["answered"]["n"] == 0
    assert summary["counts"]["pending"] == summary["counts"]["repeats"] > 0


# -- the hand labels ----------------------------------------------------------------


@pytest.fixture
def sample_dir(run_dir: Path, tmp_path: Path) -> Path:
    return write_sample(run_dir, tmp_path / "labels" / "v0.2.0-sample")


def test_label_mode_measures_both_judges_against_the_labels(
    sample_dir: Path, run_dir: Path, out_root: Path
) -> None:
    _write_labels(sample_dir / "labels-controller.csv", _all(sample_dir, "0"))
    gateway = FakeGateway()
    path = sj.judge_labels(sample_dir, _settings(), out_root, run_dir, gateway)
    assert path == out_root / "labels-v0.2.0-sample" / SLUG / sj.SUMMARY_FILE
    summary = json.loads(path.read_text(encoding="utf-8"))
    items = json.loads((sample_dir / "key.json").read_text(encoding="utf-8"))["items"]
    assert len(gateway.requests) == len(items) == summary["counts"]["judged"]
    assert summary["kind"] == "labels"
    assert summary["sample"] == "v0.2.0-sample"
    found = summary["agreement_with_labels"]
    assert MODEL in found["measures"][sj.LABEL_MEASURE]
    overall = found["overall"]
    # Every label is 0; the second judge gives 2 only to the date with a time (INC_002).
    assert overall[sj.LABEL_MEASURE]["n"] == len(items)
    assert overall[sj.LABEL_MEASURE]["agreement"] == pytest.approx((len(items) - 1) / len(items))
    assert "judge_recorded" in overall and "judge_abstention_rule" in overall
    for cell in found["cells"].values():
        assert sj.LABEL_MEASURE in cell["measures"]
    lines = {
        json.loads(line)["key"]
        for line in (path.parent / sj.VERDICTS_FILE).read_text(encoding="utf-8").splitlines()
    }
    assert lines == set(items)


def test_label_mode_refuses_unlabelled_items_before_any_call(
    sample_dir: Path, run_dir: Path, out_root: Path
) -> None:
    gateway = FakeGateway()
    with pytest.raises(ValueError, match="no labeller"):
        sj.judge_labels(sample_dir, _settings(), out_root, run_dir, gateway)
    assert gateway.requests == []


# -- reading back and the command ---------------------------------------------------


def test_published_reads_the_newest_run_summary_and_its_label_check(
    sample_dir: Path, run_dir: Path, out_root: Path
) -> None:
    assert sj.published(out_root, RUN_NAME) is None
    sj.judge_run(run_dir, _settings(), out_root, FakeGateway())
    found = sj.published(out_root, RUN_NAME)
    assert found is not None and found[1] is None
    _write_labels(sample_dir / "labels-controller.csv", _all(sample_dir, "0"))
    sj.judge_labels(sample_dir, _settings(), out_root, run_dir, FakeGateway())
    found = sj.published(out_root, RUN_NAME)
    assert found is not None and found[1] is not None
    assert found[1]["kind"] == "labels"


def test_cli_runs_the_second_judge(
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
    monkeypatch.setattr(sj, "run_dir", lambda name: run_dir.parent / name)
    monkeypatch.setattr(sj, "SECOND_JUDGE_ROOT", out_root)
    monkeypatch.setattr(sj, "complete", FakeGateway())
    assert main(["second-judge", "--run", RUN_NAME]) == 0
    output = capsys.readouterr().out
    assert f"judged {JUDGED} of {JUDGED}" in output
    assert str(out_root / RUN_NAME / SLUG / sj.SUMMARY_FILE) in output
    monkeypatch.setenv("SECOND_JUDGE_MODEL_FAMILY", "qwen")
    with pytest.raises(SystemExit, match="answer model"):
        main(["second-judge", "--run", RUN_NAME])


# The Results screen's second-judge fixture (frontend/e2e/fixtures/
# results-v03-second-judge.json): the report tests' synthetic v0.3 run and the
# labelling tests' small sample, judged again with a hashed fake reply, with
# the two judges' combined mark (D-105), and served by the API's own builder,
# so it is real output with test values. The clock and checkout fields are
# fixed so it reproduces. Rewrite it from backend/ with
#     uv run python -m tests.test_second_judge
SECOND_JUDGE_FIXTURE = V03_FIXTURES / "results-v03-second-judge.json"
# The reply limit the official second judge runs with, so the panel shows it.
FIXTURE_SETTINGS = _settings(max_tokens=2048)
FIXED = {"started_at": "2026-11-02T09:00:00+00:00", "finished_at": "2026-11-02T10:00:00+00:00"}


class HashedGateway:
    """A fake reply whose levels follow a hash of the call's number (the
    synthetic run's prompts repeat, so the prompt alone would not vary)."""

    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, request: CompletionRequest) -> Completion:
        self.calls += 1
        digest = hashlib.sha256(f"{self.calls}:{request.user}".encode()).digest()
        levels = dict(zip(JUDGE_DIMENSIONS, (b % 3 for b in digest), strict=False))
        return Completion(json.dumps(levels), 1.0, None, "stop", False)


def _fix(path: Path) -> None:
    summary = json.loads(path.read_text(encoding="utf-8"))
    summary.update({**FIXED, "git_sha": "fixture", "git_dirty": False})
    path.write_text(json.dumps(summary), encoding="utf-8")


def _fix_combined(path: Path) -> None:
    combined = json.loads(path.read_text(encoding="utf-8"))
    combined.update(computed_at=FIXED["finished_at"], git_sha="fixture", git_dirty=False)
    # The synthetic run asks "question?" everywhere; the Results screenshot
    # lists these rows, so each says which question it stands for.
    for row in combined["disagreements"]:
        row["question"] = f"Test question {row['question_id']} (fixture only)"
    path.write_text(json.dumps(combined), encoding="utf-8")


def second_judge_fixture_text(directory: Path) -> str:
    """The fixture's text, as the API serves the fixture run's second judge."""
    runs = directory / "runs"
    runs.mkdir()
    run = _benchmark("official", h5_per_world=6, label=V03_FIXTURE_LABEL)
    # Judged with the prompt the second judge uses, so the two marks combine.
    run = dataclasses.replace(
        run, record=dataclasses.replace(run.record, judge_prompt_version=JUDGE_PROMPT_VERSION)
    )
    published = runs / V03_FIXTURE_RUN
    published.mkdir()
    (published / "results.json").write_text(json.dumps(run.to_payload()), encoding="utf-8")
    (published / "summary.json").write_text(json.dumps(summarize(run)), encoding="utf-8")
    root = second_judge_dir(runs)
    judged = sj.judge_run(published, FIXTURE_SETTINGS, root, HashedGateway())
    _fix(judged)
    combined = judges_mark.write_combined(published, judged.parent)
    _fix_combined(combined)
    labelled = _write(runs / RUN_NAME, _with_families(_payload(_small_entries())))
    sample = write_sample(labelled, directory / "labels" / "v0.2.0-sample")
    _write_labels(sample / "labels-controller.csv", _all(sample, "0"))
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(addendum, "current_banks", recorded_banks)
        _fix(sj.judge_labels(sample, FIXTURE_SETTINGS, root, labelled, HashedGateway()))
    served = _second_judge(runs, V03_FIXTURE_RUN)
    return json.dumps(served.model_dump(mode="json"), indent=2) + "\n"


def test_the_second_judge_fixture_is_the_writers_output(tmp_path: Path) -> None:
    assert SECOND_JUDGE_FIXTURE.read_text(encoding="utf-8") == second_judge_fixture_text(tmp_path)


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        SECOND_JUDGE_FIXTURE.write_text(
            second_judge_fixture_text(Path(directory)), encoding="utf-8"
        )
