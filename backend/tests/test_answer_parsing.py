"""Reading model outputs that the strict JSON reader refused (D-096).

The real outputs are copied verbatim from stored runs into
``fixtures/model_outputs_unparsed.json`` (synthetic data): every repeat of
each instance and approach gave the same text. Parser 1.0.0 read each one as
plain text with an empty verdict.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.api.benchmarks import _count_answers
from app.evaluation.runner import PipelineRun
from app.evidence import AnswerForm, EvidenceChunk
from app.retrieval.standard.generation import (
    ANSWER_PARSER_VERSION,
    FakeAnswerGenerator,
    GenerationOutput,
    LiteLLMAnswerGenerator,
    is_cut_off,
    parse_answer,
)

from tests.conftest import StubLiteLLM
from tests.test_graph_rag import build_pipeline as build_graph_pipeline
from tests.test_standard_rag import build_pipeline as build_rag_pipeline
from tests.test_standard_rag import make_corpus

FIXTURE = Path(__file__).parent / "fixtures" / "model_outputs_unparsed.json"


def _real(instance_id: str, pipeline: str) -> str:
    entries: list[dict[str, Any]] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    (entry,) = [e for e in entries if (e["instance_id"], e["pipeline"]) == (instance_id, pipeline)]
    return str(entry["raw_text"])


def _answer_body(raw: str) -> str:
    """The text after the answer's opening quote, as the model wrote it."""
    return raw.split('"answer": "', 1)[1]


def test_the_parser_version_is_2_0_0() -> None:
    assert ANSWER_PARSER_VERSION == "2.0.0"


@pytest.mark.parametrize(
    ("instance_id", "verdict", "ending"),
    [
        ("L05-2026-INC_017", "yes", "The other market is Austria.\n\nAnswer: Austria."),
        ("L05-2028-INC_001", "Greece and Austria", "Therefore, the only other market is Greece."),
    ],
)
def test_a_closed_object_with_bare_quotes_in_its_answer_is_repaired(
    instance_id: str, verdict: str, ending: str
) -> None:
    """Both C outputs close with "} but quote the question with bare double
    quotes inside the answer, which no JSON reader accepts."""
    raw = _real(instance_id, "C")
    with pytest.raises(json.JSONDecodeError):
        json.loads(raw, strict=False)
    parsed = parse_answer(raw, block_count=12)
    assert parsed.form == "repaired"
    assert parsed.verdict == verdict
    assert parsed.answer.startswith(f"Incident {instance_id[-7:]} occurred on platform version")
    assert parsed.answer.endswith(ending)
    assert '"' in parsed.answer and "\\n" not in parsed.answer
    assert not parsed.answer.lstrip().startswith("{")


def test_the_repaired_answer_keeps_every_quote_and_citation_the_model_wrote() -> None:
    raw = _real("L05-2026-INC_017", "C")
    parsed = parse_answer(raw, block_count=12)
    assert (
        '"Which other markets had incidents on the same platform version as incident INC_017?"'
        in parsed.answer
    )
    assert parsed.cited_blocks == [1, 7, 12, 8, 9, 6, 10, 11]
    # Nothing is lost: re-escaping the answer gives back the model's text.
    assert json.dumps(parsed.answer, ensure_ascii=False)[1:-1].replace('\\"', '"') == (
        _answer_body(raw).rsplit('"', 1)[0].replace('\\"', '"')
    )


@pytest.mark.parametrize(
    ("instance_id", "pipeline", "verdict", "ending"),
    [
        ("L05-2028-INC_018", "A", "unknown", "If the question meant 'same version number',"),
        ("L05-2026-INC_037", "C", "Austria, Czech Republic", "then Austria is also included"),
    ],
)
def test_an_object_cut_off_inside_its_answer_keeps_the_verdict_and_the_text_to_the_cut(
    instance_id: str, pipeline: str, verdict: str, ending: str
) -> None:
    raw = _real(instance_id, pipeline)
    body = _answer_body(raw)
    assert "\\" not in body and '"' not in body  # so the answer is the body itself
    parsed = parse_answer(raw, block_count=15)
    assert parsed.form == "cut_off"
    assert parsed.verdict == verdict
    assert parsed.answer == body and parsed.answer.endswith(ending)


def test_the_h1_recording_answer_is_read_with_its_citations() -> None:
    parsed = parse_answer(_real("L05-2026-INC_037", "C"), block_count=15)
    assert parsed.cited_blocks == [1, 4, 6, 15]


def test_an_output_cut_off_inside_the_verdict_has_no_verdict_and_no_answer() -> None:
    raw = _real("L22-2026-GAME_AT_02", "A")
    assert raw == '{"verdict": "'
    parsed = parse_answer(raw, block_count=3)
    assert (parsed.form, parsed.verdict, parsed.answer, parsed.cited_blocks) == (
        "cut_off",
        "",
        "",
        [],
    )


def test_two_objects_with_text_between_stay_plain_text() -> None:
    """The model closed one object, wrote a correction, then a second
    object: which one is the answer is not for the parser to choose, and
    taking either would drop answer text the model wrote."""
    raw = _real("L10-2026-INC_013", "B")
    parsed = parse_answer(raw, block_count=12)
    assert (parsed.form, parsed.verdict, parsed.answer) == ("plain", "", raw)


def test_control_characters_inside_strings_are_accepted() -> None:
    raw = '{"verdict": "Greece", "answer": "Line one [1].\nLine two\tends [2]."}'
    parsed = parse_answer(raw, block_count=2)
    assert parsed.form == "json" and parsed.verdict == "Greece"
    assert parsed.answer == "Line one [1].\nLine two\tends [2]." and parsed.cited_blocks == [1, 2]


def test_control_characters_inside_a_fenced_object_are_accepted() -> None:
    raw = '```json\n{"verdict": "no", "answer": "Not offered\n[1]."}\n```'
    parsed = parse_answer(raw, block_count=1)
    assert (parsed.form, parsed.verdict, parsed.answer) == ("json", "no", "Not offered\n[1].")


def test_a_valid_object_is_read_as_json() -> None:
    parsed = parse_answer('{"verdict": "yes", "answer": "Said \\"so\\" [1]."}', block_count=1)
    assert (parsed.form, parsed.answer) == ("json", 'Said "so" [1].')


def test_plain_text_is_plain() -> None:
    assert parse_answer("The price is 2.50 [1].", block_count=1).form == "plain"


@pytest.mark.parametrize(
    ("raw", "verdict", "answer"),
    [
        ('{"verdict": "x", "answer": "ends with \\"quoted\\" text', "x", 'ends with "quoted" text'),
        ('{"verdict": "x", "answer": "a dangling escape \\', "x", "a dangling escape"),
        ('{"verdict": "x", "answer": "half an escape \\u00', "x", "half an escape"),
        ('{"verdict": "x", "answer": "an escaped backslash \\\\', "x", "an escaped backslash \\"),
        ('{"verdict": "x", "answer": "line\\none', "x", "line\none"),
        ('{"verdict": "x", "answer": "', "x", ""),
        ('{"verdict": "x", "ans', "x", ""),
        ('{"verdict": "x",', "x", ""),
        ('{"verdict": "x"', "x", ""),
        ('{\n  "verdict" : "x" ,\n  "answer" : "spaced', "x", "spaced"),
        ('{"verdict": "Aust', "", ""),
    ],
)
def test_a_cut_off_object_is_read_up_to_the_cut(raw: str, verdict: str, answer: str) -> None:
    parsed = parse_answer(raw, block_count=1)
    assert (parsed.form, parsed.verdict, parsed.answer) == ("cut_off", verdict, answer)


@pytest.mark.parametrize(
    "raw",
    [
        '{"answer": "answer first, never closed',
        '{"verdict": "x", "note": "another key',
        '{"verdict": "x", "answer": "bad escape \\q here"}',
        '{"verdict": "x" "answer": "no comma"}',
        'Here is the answer: {"verdict": "x", "answer": "late',
        '{"verdict": "x"}',
    ],
)
def test_an_output_not_in_the_prompted_shape_stays_plain_text(raw: str) -> None:
    parsed = parse_answer(raw, block_count=1)
    assert (parsed.form, parsed.verdict, parsed.answer) == ("plain", "", raw)


def test_a_closed_object_with_bare_quotes_and_an_escape_is_repaired() -> None:
    raw = '{"verdict": "no", "answer": "It says "closed" on\\nMonday [1]."\n}'
    parsed = parse_answer(raw, block_count=1)
    assert (parsed.form, parsed.verdict, parsed.answer) == (
        "repaired",
        "no",
        'It says "closed" on\nMonday [1].',
    )


class RecordedOutputGenerator:
    """Returns the H1 recording's C output as the gateway reported it."""

    model_name = "recorded-v1"

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        del question, contexts
        usage = {"completion_tokens": 1200, "prompt_tokens": 3348, "total_tokens": 4548}
        return GenerationOutput(_real("L05-2026-INC_037", "C"), 1.0, usage, "stop", True, 1200)


def test_a_and_b_record_the_same_reading_of_the_same_output() -> None:
    """One answer builder for every approach: the same output gives the same
    verdict, answer, form and cut-off record in A, B and C."""
    rag = build_rag_pipeline(make_corpus())
    rag.generator = RecordedOutputGenerator()
    graph = build_graph_pipeline()
    graph.generator = RecordedOutputGenerator()
    answers = [
        rag.run("checkout regression in Greece").answer,
        graph.run("Why did checkout fail in Greece?").answer,
    ]
    for answer in answers:
        assert answer.verdict == "Austria, Czech Republic"
        assert answer.text.endswith("then Austria is also included")
        assert (answer.answer_form, answer.finish_reason) == ("cut_off", "stop")
        assert (answer.token_limit_reached, answer.max_tokens, answer.cut_off) == (True, 1200, True)
    fields = ("text", "verdict", "answer_form", "finish_reason", "token_limit_reached", "cut_off")
    assert {tuple(getattr(a, f) for f in fields) for a in answers} == {
        tuple(getattr(answers[0], f) for f in fields)
    }


def test_the_litellm_generator_reports_how_the_output_ended(stub_litellm: StubLiteLLM) -> None:
    stub_litellm.finish_reason = "length"
    output = LiteLLMAnswerGenerator(model="stub/model", max_tokens=321).generate("q", [])
    assert (output.finish_reason, output.token_limit_reached, output.max_tokens) == (
        "length",
        True,
        321,
    )


def test_the_fake_generator_reports_no_cap() -> None:
    output = FakeAnswerGenerator().generate("q", [])
    assert (output.finish_reason, output.token_limit_reached, output.max_tokens) == (
        None,
        None,
        None,
    )


@pytest.mark.parametrize(
    ("form", "reached", "cut"),
    [
        ("json", False, False),
        ("json", None, False),
        ("repaired", False, False),
        ("cut_off", False, True),
        ("cut_off", None, True),
        ("plain", True, True),
        ("json", True, True),
    ],
)
def test_an_answer_is_cut_off_when_its_object_never_closed_or_it_hit_the_cap(
    form: AnswerForm, reached: bool | None, cut: bool
) -> None:
    assert is_cut_off(form, reached) is cut


def _repeat(cut_off: bool | None, reached: bool | None, failed: bool = False) -> PipelineRun:
    return PipelineRun(
        pipeline="C",
        repeat=0,
        verdict="",
        answer="",
        raw_text="",
        cited_blocks=(),
        blocks=(),
        selected=(),
        resolved_ids=(),
        seeded=True,
        context_tokens=0,
        latency_ms=0.0,
        generation_failed=failed,
        token_limit_reached=reached,
        cut_off=cut_off,
    )


def test_results_count_the_repeats_cut_off_and_those_at_the_cap() -> None:
    runs = [
        _repeat(True, True),
        _repeat(True, False),
        _repeat(False, False),
        _repeat(None, None, True),
    ]
    assert _count_answers(runs, "cut_off") == 2
    assert _count_answers(runs, "token_limit_reached") == 1


def test_results_say_nothing_for_a_run_that_did_not_record_it() -> None:
    """A run recorded before parser 2.0.0 (such as v0.2.0) has no record."""
    runs = [_repeat(None, None), _repeat(None, None)]
    assert _count_answers(runs, "cut_off") is None
    assert _count_answers(runs, "token_limit_reached") is None
