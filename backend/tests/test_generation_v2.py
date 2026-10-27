"""Structured answer contract: prompt 3.0.0, the rendered blocks, the
parser and generator output."""

from __future__ import annotations

import hashlib
import json

import pytest
from app.events import GRAPH_GENERATION_COMPLETED, RAG_GENERATION_COMPLETED
from app.evidence import EvidenceChunk
from app.models.gateway import GatewayError
from app.retrieval.standard.generation import (
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    FakeAnswerGenerator,
    GenerationError,
    GenerationOutput,
    LiteLLMAnswerGenerator,
    context_block,
    parse_answer,
)

from tests.conftest import StubLiteLLM
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


def test_prompt_3_0_0_hash() -> None:
    assert PROMPT_VERSION == "3.0.0"
    assert (
        hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest()
        == "ac71b7bebd16b82f96fa0988c535966973bb5abb94c819a2b9424fa790b98daa"
    )


def _record(**update: object) -> EvidenceChunk:
    return _chunk().model_copy(
        update={
            "kind": "record",
            "chunk_id": "REC_incidents_INC_024",
            "document_id": "INC_024",
            "title": "incidents: INC_024",
            "market_id": "MKT_CZ",
            "language_code": "en",
            "source_system": "incident_management",
            "record_table": "incidents",
            "facts_heading": "Incident INC_024",
            "facts": [("market", "MKT_CZ (Czech Republic)"), ("severity", "MEDIUM")],
            **update,
        }
    )


def test_a_document_is_its_title_line_and_text() -> None:
    assert context_block(_chunk()) == "Price Notice (GR, el)\nThe ticket price is 2.50."


def test_a_record_is_its_heading_with_source_and_one_line_per_fact() -> None:
    assert context_block(_record()) == (
        "Incident INC_024 (source: incident_management.incidents, record INC_024)\n"
        "- market: MKT_CZ (Czech Republic)\n"
        "- severity: MEDIUM"
    )


def test_a_graph_record_adds_its_path_from_the_seed() -> None:
    path = "INC_037 -RELATED_TO_VERSION-> PLV_IDENTITY_2 <-RELATED_TO_VERSION- INC_024"
    node = _record(kind="node", chunk_id="INC_024", graph_path=path)
    assert context_block(node) == (f"{context_block(_record())}\n- reached from INC_037: {path}")


def test_a_graph_node_without_a_record_keeps_its_title_and_text_and_path() -> None:
    node = _chunk().model_copy(
        update={
            "kind": "node",
            "chunk_id": "DEV_UK_000009",
            "document_id": "DEV_UK_000009",
            "title": "Device: DEV_UK_000009",
            "market_id": "",
            "language_code": "-",
            "text": "Device DEV_UK_000009",
            "graph_path": "PLAYER_UK_000001 -USES-> DEV_UK_000009",
        }
    )
    assert context_block(node) == (
        "Device: DEV_UK_000009 (, -)\nDevice DEV_UK_000009\n"
        "- reached from PLAYER_UK_000001: PLAYER_UK_000001 -USES-> DEV_UK_000009"
    )


def test_a_record_without_facts_is_refused() -> None:
    with pytest.raises(ValueError, match="REC_incidents_INC_024"):
        context_block(_record(facts_heading=None, facts=[]))


def test_litellm_generator_records_usage_and_passes_max_tokens(stub_litellm: StubLiteLLM) -> None:
    generator = LiteLLMAnswerGenerator(model="stub/model", temperature=0.0, max_tokens=321)
    output = generator.generate("What is the price?", [_chunk()])

    assert isinstance(output, GenerationOutput)
    assert output.raw_text == "ok"
    assert output.usage == {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}
    assert (
        stub_litellm.calls[0]["max_tokens"] == 321 and stub_litellm.calls[0]["temperature"] == 0.0
    )


def test_generator_maps_gateway_errors_to_generation_errors(
    stub_litellm_raises: StubLiteLLM,
) -> None:
    with pytest.raises(GenerationError) as raised:
        LiteLLMAnswerGenerator(model="m").generate("q", [])
    assert isinstance(raised.value.__cause__, GatewayError)


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
    """One list in prompt order: the selected documents (cross-encoder
    order) and nodes (graph order) alternate, documents first (D-084), and
    cited block n is citations[n - 1]."""
    pipeline = build_graph_pipeline()
    generator = CitingLastBlockGenerator()
    pipeline.generator = generator
    reranker = RecordingReranker()
    pipeline.reranker = reranker
    result = pipeline.run("Why did checkout fail in Greece?")

    nodes = sorted(
        (evidence for evidence in result.node_evidence if evidence.selected),
        key=lambda evidence: evidence.graph_rank or 0,
    )
    assert nodes, "the fixture must select structured nodes"
    selected_documents = {c.chunk_id for c in result.document_evidence if c.selected}
    documents = [c.chunk_id for c in reranker.reranked if c.chunk_id in selected_documents]
    assert documents, "the fixture must select documents"
    expected: list[str] = []
    for index in range(max(len(documents), len(nodes))):
        expected += documents[index : index + 1] + [e.node_id for e in nodes[index : index + 1]]
    assert generator.blocks == expected
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


def test_generation_reasoning_comes_from_the_environment(
    monkeypatch: pytest.MonkeyPatch, stub_litellm: StubLiteLLM
) -> None:
    from app.config import from_env
    from app.lab import build_generator

    monkeypatch.delenv("GENERATION_REASONING", raising=False)
    assert from_env().generation.reasoning == "default"
    monkeypatch.setenv("GENERATION_PROVIDER", "litellm")
    monkeypatch.setenv("GENERATION_MODEL", "ollama/m")
    monkeypatch.setenv("GENERATION_REASONING", "off")
    settings = from_env()
    assert settings.generation.reasoning == "off"
    build_generator("litellm", settings).generate("q", [_chunk()])
    assert stub_litellm.calls[0]["reasoning_effort"] == "none"
    monkeypatch.setenv("GENERATION_REASONING", "minimal")
    with pytest.raises(ValueError, match="GENERATION_REASONING"):
        from_env()
