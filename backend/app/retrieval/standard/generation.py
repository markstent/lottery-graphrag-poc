"""Answer generation through the model gateway (ADR-003).

- FakeAnswerGenerator: deterministic template generator for CI and tests.
  It never fabricates content beyond the retrieved context titles, so tests
  can assert exact outputs.
- LiteLLMAnswerGenerator: the real gateway call (local Ollama or hosted
  OpenRouter through configuration).

Every pipeline shares one prompt (PROMPT_VERSION), one generator, one
parser (`parse_answer`) and one citation builder (`citations_for`), and
hands the generator one list of selected evidence in judge order, so the
same selected evidence gives the same prompt in A, B and C
(docs/reference/retrieval/retrieval-fairness.md). The model is asked for a JSON object
with a verdict and a prose answer citing numbered sources as [n]; the parser
keeps only citations that point at a block actually shown to the model.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Protocol

from app.evidence import Citation, EvidenceChunk
from app.models.gateway import CompletionRequest, GatewayError, complete

PROMPT_VERSION = "2.0.0"

SYSTEM_PROMPT = (
    "You are an enterprise analyst. Answer using only the numbered context "
    "sources; do not use outside knowledge. Respond with exactly one JSON object "
    'and nothing else: {"verdict": "<one line, or \'unknown\' when the sources do '
    'not answer>", "answer": "<prose with [n] citations>"}. Cite every claim as [n] '
    "matching the source numbers given. If the sources do not answer the question, "
    'set verdict to "unknown" and say so plainly in the answer.'
)

FENCED_JSON = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
CITATION = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")


class GenerationError(RuntimeError):
    """Raised when the model gateway fails or returns unusable output."""


@dataclass(frozen=True, slots=True)
class GenerationOutput:
    """Verbatim model output, its latency and token usage when reported."""

    raw_text: str
    latency_ms: float
    usage: dict[str, int] | None = None


@dataclass(frozen=True, slots=True)
class ParsedAnswer:
    """The structured reading of one model output."""

    verdict: str
    answer: str
    cited_blocks: list[int]


class AnswerGenerator(Protocol):
    model_name: str

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        """Return the model output grounded in the given contexts.

        ``contexts`` is the pipeline's selected evidence in judge order:
        document chunks, record blocks and graph nodes alike.
        """
        ...


def context_block(chunk: EvidenceChunk) -> str:
    """One context block: a title line, then the text. Every pipeline renders
    documents, records and structured graph nodes with this one format."""
    return f"{chunk.title} ({chunk.market_id}, {chunk.language_code})\n{chunk.text}"


def build_user_prompt(question: str, contexts: list[EvidenceChunk]) -> str:
    """Numbered context in the order given (judge order); [n] in answers
    maps to the n-th block."""
    blocks = [f"[{index}] {context_block(chunk)}" for index, chunk in enumerate(contexts, start=1)]
    joined = "\n\n".join(blocks) if blocks else "(no context retrieved)"
    return f"Context sources:\n{joined}\n\nQuestion: {question}"


def citations_for(contexts: list[EvidenceChunk]) -> list[Citation]:
    """One citation per prompt block, in prompt order: cited block n is
    ``citations[n - 1]``. A graph node carries its source table and record
    id through the same provenance fields as a record block."""
    return [
        Citation(
            chunk_id=chunk.chunk_id,
            document_id=chunk.document_id,
            title=chunk.title,
            source_system=chunk.source_system,
            source_record_id=chunk.document_id,
            record_table=chunk.record_table,
            market_id=chunk.market_id,
            language_code=chunk.language_code,
        )
        for chunk in contexts
    ]


def _structured(text: str) -> tuple[str, str] | None:
    """(verdict, answer) when text is the v2 JSON object, else None."""
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    verdict, answer = payload.get("verdict"), payload.get("answer")
    if not isinstance(verdict, str) or not isinstance(answer, str):
        return None
    return verdict.strip(), answer.strip()


def parse_answer(raw: str, block_count: int) -> ParsedAnswer:
    """Read a model output: strict JSON, then fenced JSON, then plain text.

    Citations are the [n] markers in the answer that point at one of the
    `block_count` blocks shown to the model, deduplicated in first-seen order.
    A bracket may group comma-separated numbers ([1, 2]); ranges such as [1-3]
    are not supported and cite nothing.
    """
    structured = _structured(raw) or next(
        (found for block in FENCED_JSON.finditer(raw) if (found := _structured(block.group(1)))),
        None,
    )
    verdict, answer = structured if structured else ("", raw)
    cited: list[int] = []
    for match in CITATION.finditer(answer):
        for part in match.group(1).split(","):
            number = int(part)
            if 1 <= number <= block_count and number not in cited:
                cited.append(number)
    return ParsedAnswer(verdict=verdict, answer=answer, cited_blocks=cited)


class FakeAnswerGenerator:
    """Deterministic template generator (CI and tests)."""

    def __init__(self) -> None:
        self.model_name = "fake-answer-v1"

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        started = time.perf_counter()
        del question  # deterministic output: context titles only
        if contexts:
            titles = ", ".join(chunk.title for chunk in contexts[:2])
            verdict = "[fake-model] answered from the retrieved sources"
            answer = (
                f"[fake-model] Based on {len(contexts)} retrieved source(s), the strongest "
                f"evidence for the question is in: {titles} [1]."
            )
        else:
            verdict = "unknown"
            answer = "[fake-model] No context was retrieved for this question."
        raw_text = json.dumps({"verdict": verdict, "answer": answer})
        return GenerationOutput(raw_text, (time.perf_counter() - started) * 1000)


class LiteLLMAnswerGenerator:
    """Provider-neutral completion through the LiteLLM gateway."""

    def __init__(
        self,
        model: str,
        temperature: float = 0.0,
        api_base: str | None = None,
        max_tokens: int = 1200,
        timeout_s: float = 120.0,
        reasoning: str = "default",
    ) -> None:
        self.model_name = model
        self._reasoning = reasoning
        self._temperature = temperature
        self._api_base = api_base
        self._max_tokens = max_tokens
        self._timeout_s = timeout_s

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> GenerationOutput:
        request = CompletionRequest(
            model=self.model_name,
            system=SYSTEM_PROMPT,
            user=build_user_prompt(question, contexts),
            temperature=self._temperature,
            max_tokens=self._max_tokens,
            api_base=self._api_base,
            timeout_s=self._timeout_s,
            reasoning=self._reasoning,
        )
        try:
            completion = complete(request)
        except GatewayError as error:
            raise GenerationError(str(error)) from error
        return GenerationOutput(completion.text, completion.latency_ms, completion.usage)
