"""Structured answer contract v2: prompt, parser and generator output."""

from __future__ import annotations

import json
import sys
import types
from typing import Any

import pytest
from app.events import GRAPH_GENERATION_COMPLETED, RAG_GENERATION_COMPLETED
from app.evidence import EvidenceChunk
from app.retrieval.standard.generation import (
    PROMPT_VERSION,
    FakeAnswerGenerator,
    GenerationOutput,
    LiteLLMAnswerGenerator,
    parse_answer,
)

from tests.test_graph_rag import RecordingReranker
from tests.test_graph_rag import build_pipeline as build_graph_pipeline
from tests.test_standard_rag import build_pipeline as build_rag_pipeline
from tests.test_standard_rag import make_corpus


def _chunk() -> EvidenceChunk:
    return EvidenceChunk(
        chunk_id="CHUNK-1",
        document_id="DOC-1",
        chunk_index=0,
        text="The ticket price is 2.50.",
        title="Price Notice",
        document_type="notice",
        market_id="GR",
        language_code="el",
        source_system="docs",
        similarity=0.9,
        rank=1,
    )


def test_parse_answer_reads_json_and_citations() -> None:
    parsed = parse_answer(
        '{"verdict": "yes", "answer": "Price is 2.50 [2] and [9]."}', block_count=3
    )
    assert parsed.verdict == "yes" and parsed.cited_blocks == [2]


def test_parse_answer_falls_back_to_plain_text() -> None:
    parsed = parse_answer("The price is 2.50 [1].", block_count=2)
    assert (
        parsed.verdict == ""
        and parsed.answer.startswith("The price")
        and parsed.cited_blocks == [1]
    )


def test_fake_generator_emits_json_with_a_citation() -> None:
    output = FakeAnswerGenerator().generate("What is the price?", [_chunk()])
    payload = json.loads(output.raw_text)
    assert set(payload) == {"verdict", "answer"}
    assert parse_answer(output.raw_text, block_count=1).cited_blocks == [1]


def test_fake_generator_without_context_says_unknown() -> None:
    output = FakeAnswerGenerator().generate("What is the price?", [])
    parsed = parse_answer(output.raw_text, block_count=0)
    assert parsed.verdict == "unknown" and parsed.cited_blocks == []
    assert "No context was retrieved" in parsed.answer


def test_parse_answer_reads_fenced_json() -> None:
    raw = 'Here you go:\n```json\n{"verdict": "no", "answer": "Not offered [1]."}\n```'
    parsed = parse_answer(raw, block_count=1)
    assert parsed == parse_answer('{"verdict": "no", "answer": "Not offered [1]."}', 1)
    assert parsed.verdict == "no" and parsed.answer == "Not offered [1]."


def test_parse_answer_skips_an_earlier_non_json_fence() -> None:
    raw = (
        "Setup:\n```python\nprint(1)\n```\n"
        'Answer:\n```json\n{"verdict": "no", "answer": "Not offered [1]."}\n```'
    )
    parsed = parse_answer(raw, block_count=1)
    assert parsed.verdict == "no" and parsed.answer == "Not offered [1]."


def test_parse_answer_json_missing_keys_falls_to_plain_text() -> None:
    raw = '{"answer": "Price is 2.50 [1]."}'
    parsed = parse_answer(raw, block_count=1)
    assert parsed.verdict == "" and parsed.answer == raw and parsed.cited_blocks == [1]


def test_parse_answer_drops_out_of_range_citations() -> None:
    parsed = parse_answer('{"verdict": "x", "answer": "[0] [4] [3]"}', block_count=3)
    assert parsed.cited_blocks == [3]


def test_parse_answer_dedupes_citations_in_order() -> None:
    parsed = parse_answer('{"verdict": "x", "answer": "[2] then [1] and [2] [1]"}', 2)
    assert parsed.cited_blocks == [2, 1]


def test_parse_answer_json_array_falls_to_plain_text() -> None:
    parsed = parse_answer('["a [1]"]', block_count=1)
    assert parsed.verdict == "" and parsed.answer == '["a [1]"]' and parsed.cited_blocks == [1]


def test_parse_answer_non_string_answer_falls_to_plain_text() -> None:
    raw = '{"verdict": "x", "answer": 7}'
    parsed = parse_answer(raw, block_count=1)
    assert parsed.verdict == "" and parsed.answer == raw


@pytest.mark.parametrize("fence", ["```", "```JSON", "```Json"])
def test_parse_answer_reads_untagged_and_any_case_fences(fence: str) -> None:
    raw = f'Sure:\n{fence}\n{{"verdict": "no", "answer": "Not offered [1]."}}\n```'
    parsed = parse_answer(raw, block_count=1)
    assert parsed.verdict == "no" and parsed.cited_blocks == [1]


def test_parse_answer_reads_grouped_citations() -> None:
    parsed = parse_answer('{"verdict": "x", "answer": "See [1, 2] and [3,2] [9, 1]."}', 3)
    assert parsed.cited_blocks == [1, 2, 3]


def test_prompt_version_is_v2() -> None:
    assert PROMPT_VERSION == "2.0.0"


def test_litellm_generator_records_usage_and_passes_max_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    class Response(dict[str, Any]):
        """Subscriptable choices and an attribute usage, like a litellm ModelResponse."""

        usage = types.SimpleNamespace(prompt_tokens=120, completion_tokens=30, total_tokens=150)

    def completion(**kwargs: Any) -> Response:
        calls.append(kwargs)
        return Response(
            choices=[{"message": {"content": '{"verdict": "yes", "answer": "2.50 [1]."}'}}]
        )

    monkeypatch.setitem(sys.modules, "litellm", types.SimpleNamespace(completion=completion))
    generator = LiteLLMAnswerGenerator(model="stub/model", temperature=0.0, max_tokens=321)
    output = generator.generate("What is the price?", [_chunk()])

    assert isinstance(output, GenerationOutput)
    assert output.raw_text == '{"verdict": "yes", "answer": "2.50 [1]."}'
    assert output.usage == {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}
    assert calls[0]["max_tokens"] == 321 and calls[0]["temperature"] == 0.0


class CitingLastBlockGenerator:
    """Records the prompt blocks and cites the last one shown."""

    model_name = "citing-last-v1"

    def __init__(self) -> None:
        self.blocks: list[str] = []

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        self.blocks = [chunk.chunk_id for chunk in contexts]
        answer = f"See [{len(self.blocks)}]."
        return GenerationOutput(json.dumps({"verdict": "yes", "answer": answer}), 1.0)


def test_graph_citations_follow_prompt_block_order() -> None:
    """One list in judge order: nodes and documents interleave as judged,
    and cited block n is citations[n - 1]."""
    pipeline = build_graph_pipeline()
    generator = CitingLastBlockGenerator()
    pipeline.generator = generator
    reranker = RecordingReranker()
    pipeline.reranker = reranker
    result = pipeline.run("Why did checkout fail in Greece?")

    nodes = [evidence for evidence in result.node_evidence if evidence.selected]
    assert nodes, "the fixture must select structured nodes"
    selected = {e.node_id for e in nodes} | {
        chunk.chunk_id for chunk in result.document_evidence if chunk.selected
    }
    judge_order = [c.chunk_id for c in reranker.reranked if c.chunk_id in selected]
    assert generator.blocks == judge_order
    cited_ids = [citation.chunk_id for citation in result.answer.citations]
    assert cited_ids == generator.blocks
    assert result.answer.cited_blocks == [len(cited_ids)]
    assert result.answer.verdict == "yes" and result.answer.raw_text.startswith("{")


def test_generation_completed_events_carry_verdict_and_citation_count() -> None:
    rag = build_rag_pipeline(make_corpus())
    rag.run("checkout regression in Greece")
    graph = build_graph_pipeline()
    graph.run("Why did checkout fail in Greece?")

    for pipeline, event_type in (
        (rag, RAG_GENERATION_COMPLETED),
        (graph, GRAPH_GENERATION_COMPLETED),
    ):
        payload = pipeline.events[-1].payload
        assert pipeline.events[-1].event_type == event_type
        assert payload["verdict"] == "[fake-model] answered from the retrieved sources"
        assert payload["cited_blocks"] == 1


def test_generation_max_tokens_defaults_to_1200(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import GenerationSettings, from_env

    monkeypatch.delenv("GENERATION_MAX_TOKENS", raising=False)
    assert from_env().generation.max_tokens == 1200
    assert GenerationSettings("fake", "m", 0.0, None).max_tokens == 1200
