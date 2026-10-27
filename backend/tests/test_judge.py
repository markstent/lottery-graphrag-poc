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
from app.config import JudgeSettings, judge_settings_from_env
from app.evaluation import judge as judge_module
from app.evaluation.checks import CitationMetrics
from app.evaluation.judge import (
    ANSWER_CHAR_CAP,
    JUDGE_DIMENSIONS,
    JUDGE_MAX_TOKENS,
    JUDGE_PROMPT_VERSION,
    JUDGE_SYSTEM_PROMPT,
    Agreement,
    FakeJudge,
    GatewayJudge,
    JudgeItem,
    JudgeParseError,
    JudgeScores,
    JudgeVerdict,
    agreement,
    answer_level,
    blind,
    build_judge_prompt,
    check_families,
    judge_pairs,
    judge_prompt_hash,
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


# --- Constants and settings -------------------------------------------------------


def test_versioned_constants() -> None:
    assert JUDGE_PROMPT_VERSION == "1.1.0"
    assert JUDGE_DIMENSIONS == (
        "correctness",
        "completeness",
        "faithfulness",
        "citation_accuracy",
        "abstention",
    )
    assert (ANSWER_CHAR_CAP, JUDGE_MAX_TOKENS) == (2400, 300)


def test_prompt_hash_covers_the_prompt_its_version_and_the_user_template(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    text = JUDGE_SYSTEM_PROMPT + JUDGE_PROMPT_VERSION + judge_module.JUDGE_USER_TEMPLATE
    assert judge_prompt_hash() == hashlib.sha256(text.encode()).hexdigest()
    before = judge_prompt_hash()
    monkeypatch.setattr(
        judge_module, "JUDGE_USER_TEMPLATE", judge_module.JUDGE_USER_TEMPLATE.replace("\n\n", "\n")
    )
    assert judge_prompt_hash() != before


def test_judge_prompt_1_1_0_scores_unwarranted_abstention_zero() -> None:
    assert (
        "correctness: the answer agrees with the reference answer; an answer that says the "
        "sources do not answer scores 0 when the reference answer gives an answer. "
    ) in JUDGE_SYSTEM_PROMPT
    assert (
        "abstention: 2 when the answer correctly says the context does not answer the "
        "question, or answers when the context does; 0 when it guesses without support "
        "in the context; 1 otherwise. "
    ) in JUDGE_SYSTEM_PROMPT


# The judge prompt hash of the v0.2.0 official run (prompt 1.0.0), from
# reproducibility.run.judge_prompt_hash in official-2026-10-26/results.json.
JUDGE_PROMPT_HASH_1_0_0 = "e89e8a186b6d28d997bc5d7a3d253114369bd770248c42d5bed44ad6f6f19ec4"
JUDGE_PROMPT_HASH_1_1_0 = "f0db814c57eb3a2e2b28d1387c62f95df57dbf1f75c9d8a1317d38b4e274abd6"


def test_judge_prompt_hash_changes_with_version() -> None:
    assert judge_prompt_hash() == JUDGE_PROMPT_HASH_1_1_0
    assert JUDGE_PROMPT_HASH_1_1_0 != JUDGE_PROMPT_HASH_1_0_0


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


def test_answer_level() -> None:
    assert [answer_level(s) for s in (0.0, 0.33, 0.92, 1.0)] == [0, 1, 1, 2]


def test_agreement_three_level_and_weighted_kappa() -> None:
    result = agreement([(0, 0), (1, 1), (2, 2), (2, 1), (0, 2)])
    # Linear weights w = 1 - |i - j| / 2 over the levels 0, 1, 2.
    # Observed weighted agreement: (1 + 1 + 1 + 0.5 + 0) / 5 = 0.7.
    # Marginals: answer level 0: 2/5, 1: 1/5, 2: 2/5; judge 0: 1/5, 1: 2/5, 2: 2/5.
    # Expected weighted agreement, row by row (answer level i, sum_j q_j w_ij):
    #   i=0: 0.4 * (0.2*1 + 0.4*0.5 + 0.4*0) = 0.4 * 0.4 = 0.16
    #   i=1: 0.2 * (0.2*0.5 + 0.4*1 + 0.4*0.5) = 0.2 * 0.7 = 0.14
    #   i=2: 0.4 * (0.2*0 + 0.4*0.5 + 0.4*1) = 0.4 * 0.6 = 0.24
    #   total 0.54.
    # Weighted kappa: (0.7 - 0.54) / (1 - 0.54) = 0.16 / 0.46 = 8/23.
    assert result.n == 5
    assert result.agreement == pytest.approx(0.6)
    assert result.weighted_kappa == pytest.approx(8 / 23)


def test_kappa_undefined_when_constant() -> None:
    result = agreement([(2, 2)] * 4)
    assert (result.n, result.agreement, result.weighted_kappa) == (4, 1.0, None)


def test_agreement_without_pairs() -> None:
    assert agreement([]) == Agreement(0, None, None)


def _score(answer: float | None, correctness: int | None, judged: bool = True) -> RunScore:
    """A repeat's score with only what the agreement pairing reads."""
    verdict = None
    if judged:
        scores = None if correctness is None else JudgeScores(correctness, 1, 1, 1, 1)
        verdict = JudgeVerdict(scores, None if scores else "judge failed", "m", 0.0)
    evidence = EvidenceScore(None, None, None, None, 0, None, False)
    return RunScore(answer, evidence, CitationMetrics(None, None), None, verdict)


def test_pairs_split_answered_and_abstained() -> None:
    results = [
        ("answer", _score(1.0, 2)),
        ("answer", _score(0.5, 1)),
        ("Unknown: the sources do not say", _score(0.0, 2)),
        ("unknown", _score(1.0, 0)),
        ("answer", _score(0.0, 0)),
        ("answer", _score(None, 2)),  # no deterministic answer score
        ("answer", _score(1.0, None)),  # the judge failed
        ("answer", _score(1.0, 2, judged=False)),
        ("", None),  # the generation failed
    ]
    assert judge_pairs(results) == {
        "answered": [(2, 2), (1, 1), (0, 0)],
        "abstained": [(0, 2), (2, 0)],
    }
