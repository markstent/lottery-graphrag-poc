"""The blinded LLM judge (Phase 3 benchmark v2, Task 8): blinding, prompt,
parsing, the gateway and fake judges, the family rule and agreement.

Offline throughout: the gateway judge calls a stub in place of the model
gateway.
"""

from __future__ import annotations

import dataclasses
import hashlib
import json
from collections.abc import Callable

import pytest
from app.evaluation.checks import CitationMetrics
from app.evaluation.judge import (
    ANSWER_CHAR_CAP,
    JUDGE_DIMENSIONS,
    JUDGE_MAX_TOKENS,
    JUDGE_PROMPT_VERSION,
    JUDGE_SYSTEM_PROMPT,
    FakeJudge,
    GatewayJudge,
    JudgeItem,
    JudgeParseError,
    JudgeScores,
    JudgeSettings,
    JudgeVerdict,
    agreement,
    blind,
    build_judge_prompt,
    check_families,
    judge_pairs,
    judge_prompt_hash,
    judge_settings_from_env,
    parse_judge,
)
from app.evaluation.runner import RunScore, ShownBlock
from app.evaluation.scoring import EvidenceScore
from app.models.gateway import Completion, CompletionRequest, GatewayError

SETTINGS = JudgeSettings(
    provider="litellm",
    model="ollama/gemma4:31b",
    model_family="gemma",
    api_base="http://localhost:11434",
    temperature=0.0,
)
ITEM = JudgeItem(
    question="Which release did INC_S007_GR follow?",
    expected_answer="INC_S007_GR followed PLV_PAYMENTS_3.",
    claim_statements=("INC_S007_GR followed release PLV_PAYMENTS_3.",),
    blocks=(ShownBlock("REL_1", "Release PLV_PAYMENTS_3", "Released on 1 March."),),
    answer="It followed PLV_PAYMENTS_3 [1].",
    cited_blocks=(1,),
    blind_seed="L06-2026-INC_S007_GR:A:0",
)
GOOD_REPLY = json.dumps(dict.fromkeys(JUDGE_DIMENSIONS, 2))

Gateway = Callable[[CompletionRequest], Completion]


def stub_gateway(raw: str, calls: list[CompletionRequest] | None = None) -> Gateway:
    """A model gateway that always replies ``raw``, recording each request."""

    def gateway(request: CompletionRequest) -> Completion:
        if calls is not None:
            calls.append(request)
        return Completion(raw, 12.5, None)

    return gateway


@pytest.fixture
def stub_gateway_returning() -> Callable[[str], Gateway]:
    return stub_gateway


# --- The brief's tests --------------------------------------------------------


def test_blinding_shuffles_renumbers_and_remaps_citations() -> None:
    blocks = tuple(ShownBlock(f"R{i}", f"t{i}", f"text {i}") for i in range(1, 6))
    shown, answer = blind(
        JudgeItem("q", "e", (), blocks, "A [1] and B [2, 5] and C [9].", (1, 2, 5), "seed")
    )
    order = [b.carrier_id for b in shown]
    assert sorted(order) == ["R1", "R2", "R3", "R4", "R5"] and order != [
        "R1",
        "R2",
        "R3",
        "R4",
        "R5",
    ]
    new = {cid: i for i, cid in enumerate(order, start=1)}
    assert f"[{new['R1']}]" in answer and "[?]" in answer
    assert f"[{new['R2']}, {new['R5']}]" in answer


def test_blinding_is_deterministic_per_seed() -> None:
    item = JudgeItem(
        "q", "e", (), tuple(ShownBlock(str(i), "t", "x") for i in range(8)), "a", (), "s1"
    )
    assert blind(item) == blind(item)


def test_prompt_never_names_a_pipeline() -> None:
    system, user = build_judge_prompt(
        JudgeItem("q", "e", ("c",), (ShownBlock("R1", "games: G", "x"),), "a", (), "s")
    )
    text = (system + user).lower()
    assert not any(word in text for word in ("pipeline", "graph", "ontology", "text search", "rag"))


def test_long_answers_are_capped() -> None:
    _, answer = blind(JudgeItem("q", "e", (), (), "x" * 5000, (), "s"))
    assert len(answer) <= ANSWER_CHAR_CAP + len(" [truncated]")


def test_malformed_judge_reply_is_a_recorded_failure(
    stub_gateway_returning: Callable[[str], Gateway],
) -> None:
    for raw in (
        "not json",
        '{"correctness": 3, "completeness": 1, "faithfulness": 1, "citation_accuracy": 1, '
        '"abstention": 1}',
    ):
        verdict = GatewayJudge(SETTINGS, gateway=stub_gateway_returning(raw)).judge(ITEM)
        assert verdict.scores is None and verdict.failure


def test_judge_family_must_differ() -> None:
    with pytest.raises(ValueError):
        check_families("qwen", "Qwen")


def test_agreement_and_kappa() -> None:
    result = agreement([(True, True), (False, False), (True, False), (True, True)])
    assert result.n == 4 and result.agreement == 0.75 and result.kappa == pytest.approx(0.5)


# --- Constants and settings -------------------------------------------------------


def test_versioned_constants() -> None:
    assert JUDGE_PROMPT_VERSION == "1.0.0"
    assert JUDGE_DIMENSIONS == (
        "correctness",
        "completeness",
        "faithfulness",
        "citation_accuracy",
        "abstention",
    )
    assert (ANSWER_CHAR_CAP, JUDGE_MAX_TOKENS) == (2400, 300)


def test_prompt_hash_covers_the_prompt_and_its_version() -> None:
    expected = hashlib.sha256((JUDGE_SYSTEM_PROMPT + JUDGE_PROMPT_VERSION).encode()).hexdigest()
    assert judge_prompt_hash() == expected


def test_judge_settings_come_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("PROVIDER", "MODEL", "MODEL_FAMILY", "API_BASE", "TEMPERATURE", "REASONING"):
        monkeypatch.delenv(f"JUDGE_{name}", raising=False)
    assert judge_settings_from_env() == JudgeSettings("fake", "fake-judge-v1", None, None, 0.0)
    monkeypatch.setenv("JUDGE_PROVIDER", "litellm")
    monkeypatch.setenv("JUDGE_MODEL", "ollama/gemma4:31b")
    monkeypatch.setenv("JUDGE_MODEL_FAMILY", "gemma")
    monkeypatch.setenv("JUDGE_API_BASE", "http://localhost:11434")
    monkeypatch.setenv("JUDGE_TEMPERATURE", "0.2")
    monkeypatch.setenv("JUDGE_REASONING", "off")
    assert judge_settings_from_env() == JudgeSettings(
        "litellm", "ollama/gemma4:31b", "gemma", "http://localhost:11434", 0.2, "off"
    )
    monkeypatch.setenv("JUDGE_REASONING", "on")
    with pytest.raises(ValueError, match="JUDGE_REASONING"):
        judge_settings_from_env()


# --- Blinding ---------------------------------------------------------------------


def test_blinding_differs_between_seeds() -> None:
    blocks = tuple(ShownBlock(f"R{i}", "t", "x") for i in range(8))
    orders = {
        tuple(b.carrier_id for b in blind(JudgeItem("q", "e", (), blocks, "a", (), seed))[0])
        for seed in ("s1", "s2", "s3")
    }
    assert len(orders) > 1


def test_block_titles_never_reach_the_judge() -> None:
    """A graph node block is titled "<Label>: <id>" and a record block
    "<table>: <id>": a title would tell the judge which pipeline ran."""
    blocks = (
        ShownBlock("PLY_1", "Player: PLY_1", "Player PLY_1"),
        ShownBlock("INC_1", "incidents: INC_1", "Incident INC_1 in Greece."),
    )
    _, user = build_judge_prompt(JudgeItem("q", "e", (), blocks, "a [1].", (1,), "s"))
    assert "Player: PLY_1" not in user and "incidents: INC_1" not in user
    assert "Player PLY_1" in user and "Incident INC_1 in Greece." in user


@pytest.mark.parametrize("marker", ["[1-3]", "[ 1 ]", "[1;2]", "[1,]", "[#2]"])
def test_markers_outside_the_citation_grammar_point_nowhere(marker: str) -> None:
    """A stale number must never point at a reshuffled block."""
    blocks = tuple(ShownBlock(f"R{i}", "t", "x") for i in range(1, 6))
    _, answer = blind(JudgeItem("q", "e", (), blocks, f"A {marker} and B [2].", (2,), "seed"))
    assert marker not in answer
    assert answer.startswith("A [?] and B [")


def test_short_answers_are_not_truncated() -> None:
    _, answer = blind(JudgeItem("q", "e", (), (), "x" * ANSWER_CHAR_CAP, (), "s"))
    assert answer == "x" * ANSWER_CHAR_CAP
    _, cut = blind(JudgeItem("q", "e", (), (), "x" * (ANSWER_CHAR_CAP + 1), (), "s"))
    assert cut == "x" * ANSWER_CHAR_CAP + " [truncated]"


# --- Prompt -----------------------------------------------------------------------


def test_system_prompt_states_the_rubric_and_the_json_contract() -> None:
    assert all(f'"{dimension}"' in JUDGE_SYSTEM_PROMPT for dimension in JUDGE_DIMENSIONS)
    assert "exactly one JSON object" in JUDGE_SYSTEM_PROMPT
    assert "0, 1 or 2" in JUDGE_SYSTEM_PROMPT


def test_user_prompt_shows_the_blinded_item_and_no_carrier_ids() -> None:
    blocks = (
        ShownBlock("REL_1", "Release one", "first"),
        ShownBlock("REL_2", "Release two", "second"),
    )
    item = JudgeItem(
        "Which?", "The first.", ("Fact one.", "Fact two."), blocks, "One [1].", (1,), "s"
    )
    shown, answer = blind(item)
    system, user = build_judge_prompt(item)
    assert system == JUDGE_SYSTEM_PROMPT
    for text in ("Which?", "The first.", "- Fact one.", "- Fact two.", answer):
        assert text in user
    for number, block in enumerate(shown, start=1):
        assert f"[{number}] {block.text}" in user
    assert "REL_1" not in user and "REL_2" not in user
    assert "Release one" not in user and "Release two" not in user
    new = 1 + [b.carrier_id for b in shown].index("REL_1")
    assert f"Sources the answer cites: {new}" in user


# --- Parsing ----------------------------------------------------------------------


def test_parse_judge_reads_strict_and_fenced_json() -> None:
    expected = JudgeScores(2, 2, 2, 2, 2)
    assert parse_judge(GOOD_REPLY) == expected
    assert parse_judge(f"Here it is:\n```json\n{GOOD_REPLY}\n```") == expected


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "[1, 2]",
        json.dumps({"correctness": 2}),
        json.dumps({**dict.fromkeys(JUDGE_DIMENSIONS, 1), "abstention": "2"}),
        json.dumps({**dict.fromkeys(JUDGE_DIMENSIONS, 1), "abstention": 1.5}),
        json.dumps({**dict.fromkeys(JUDGE_DIMENSIONS, 1), "abstention": True}),
        json.dumps({**dict.fromkeys(JUDGE_DIMENSIONS, 1), "abstention": -1}),
        json.dumps({**dict.fromkeys(JUDGE_DIMENSIONS, 1), "abstention": 3}),
    ],
)
def test_parse_judge_refuses_unusable_replies(raw: str) -> None:
    with pytest.raises(JudgeParseError):
        parse_judge(raw)


# --- Gateway judge ------------------------------------------------------------------


def test_gateway_judge_sends_the_prompt_with_the_judge_settings() -> None:
    calls: list[CompletionRequest] = []
    judge = GatewayJudge(SETTINGS, gateway=stub_gateway(GOOD_REPLY, calls))
    verdict = judge.judge(ITEM)
    assert verdict.scores == JudgeScores(2, 2, 2, 2, 2) and verdict.failure is None
    assert verdict.model == "ollama/gemma4:31b" and verdict.latency_ms >= 0
    (request,) = calls
    assert (request.system, request.user) == build_judge_prompt(ITEM)
    assert request.model == SETTINGS.model and request.temperature == SETTINGS.temperature
    assert request.api_base == SETTINGS.api_base and request.max_tokens == JUDGE_MAX_TOKENS
    assert request.reasoning == "default"
    assert (judge.model_name, judge.model_family) == ("ollama/gemma4:31b", "gemma")


def test_gateway_judge_passes_its_reasoning_mode() -> None:
    calls: list[CompletionRequest] = []
    settings = dataclasses.replace(SETTINGS, reasoning="off")
    judge = GatewayJudge(settings, gateway=stub_gateway(GOOD_REPLY, calls))
    judge.judge(ITEM)
    assert calls[0].reasoning == "off" and judge.reasoning == "off"


def test_a_gateway_failure_is_a_recorded_failure() -> None:
    def failing(request: CompletionRequest) -> Completion:
        raise GatewayError("Model gateway call failed: provider down")

    verdict = GatewayJudge(SETTINGS, gateway=failing).judge(ITEM)
    assert verdict.scores is None and verdict.failure is not None
    assert "provider down" in verdict.failure and verdict.model == SETTINGS.model


def test_gateway_judge_needs_the_litellm_provider() -> None:
    with pytest.raises(ValueError, match="JUDGE_PROVIDER"):
        GatewayJudge(JudgeSettings("fake", "fake-judge-v1", None, None, 0.0))


# --- Fake judge ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("answer", "correctness"),
    [
        ("INC_S007_GR followed PLV_PAYMENTS_3 [1].", 2),
        ("INC_S007_GR followed a release [1].", 1),
        ("The context does not say.", 0),
    ],
)
def test_fake_judge_scores_identifier_overlap(answer: str, correctness: int) -> None:
    item = JudgeItem("q", "INC_S007_GR followed PLV_PAYMENTS_3.", (), (), answer, (), "s")
    verdict = FakeJudge().judge(item)
    assert verdict.scores == JudgeScores(correctness, 1, 1, 1, 1)
    assert verdict.failure is None and verdict.model == "fake-judge-v1"
    assert FakeJudge().judge(item) == verdict


# --- Family rule and agreement --------------------------------------------------------


@pytest.mark.parametrize(("generation", "judge"), [(None, "gemma"), ("qwen", None), ("", "gemma")])
def test_both_families_are_required(generation: str | None, judge: str | None) -> None:
    with pytest.raises(ValueError, match="family"):
        check_families(generation, judge)


def test_different_families_pass() -> None:
    check_families("qwen", "gemma")


def test_agreement_without_pairs_or_variation() -> None:
    assert agreement([]).n == 0 and agreement([]).agreement is None and agreement([]).kappa is None
    same = agreement([(True, True), (True, True)])
    assert (same.n, same.agreement, same.kappa) == (2, 1.0, None)


def _score(answer: float | None, correctness: int | None, judged: bool = True) -> RunScore:
    """A repeat's score with only what the agreement pairing reads."""
    verdict = None
    if judged:
        scores = None if correctness is None else JudgeScores(correctness, 1, 1, 1, 1)
        verdict = JudgeVerdict(scores, None if scores else "judge failed", "m", 0.0)
    evidence = EvidenceScore(None, None, None, None, 0, None, False)
    return RunScore(answer, evidence, CitationMetrics(None, None), None, verdict)


def test_judge_pairs_take_every_judged_repeat_with_an_answer_score() -> None:
    scores = [
        _score(1.0, 2),
        _score(0.5, 1),
        _score(0.0, 2),
        _score(None, 2),  # no deterministic answer score
        _score(1.0, None),  # the judge failed
        _score(1.0, 2, judged=False),
        None,  # the generation failed
    ]
    assert judge_pairs(scores) == [(True, True), (True, False), (False, True)]
