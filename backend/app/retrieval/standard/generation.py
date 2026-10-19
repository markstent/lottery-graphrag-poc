"""Answer generation through the model gateway (ADR-003).

- FakeAnswerGenerator: deterministic template generator for CI and tests.
  It never fabricates content beyond the retrieved context titles, so tests
  can assert exact outputs.
- LiteLLMAnswerGenerator: the real gateway call (local Ollama or hosted
  OpenRouter through configuration).

Every pipeline shares one prompt (PROMPT_VERSION), one generator and one
parser (`parse_answer`), so answers are produced identically for A, B and C
(docs/retrieval/retrieval-fairness.md). The model is asked for a JSON object
with a verdict and a prose answer citing numbered sources as [n]; the parser
keeps only citations that point at a block actually shown to the model.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Protocol

from app.evidence import EvidenceChunk

PROMPT_VERSION = "2.0.0"

_SYSTEM_PROMPT = (
    "You are an enterprise analyst. Answer using only the numbered context "
    "sources; do not use outside knowledge. Respond with exactly one JSON object "
    'and nothing else: {"verdict": "<one line, or \'unknown\' when the sources do '
    'not answer>", "answer": "<prose with [n] citations>"}. Cite every claim as [n] '
    "matching the source numbers given. If the sources do not answer the question, "
    'set verdict to "unknown" and say so plainly in the answer.'
)

_FENCED_JSON = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
_CITATION = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")
_USAGE_KEYS = ("prompt_tokens", "completion_tokens", "total_tokens")


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

    def generate(
        self,
        question: str,
        contexts: list[EvidenceChunk],
        extra_blocks: list[str] | None = None,
    ) -> GenerationOutput:
        """Return the model output grounded in the given contexts.

        `extra_blocks` carries structured-layer facts (graph pipeline) that
        must be quoted rather than invented.
        """
        ...


def build_user_prompt(
    question: str,
    contexts: list[EvidenceChunk],
    extra_blocks: list[str] | None = None,
) -> str:
    """Numbered context: documents first, then structured blocks.

    [n] in answers maps to the n-th block in that order.
    """
    blocks = [
        f"[{index}] {chunk.title} ({chunk.market_id}, {chunk.language_code})\n{chunk.text}"
        for index, chunk in enumerate(contexts, start=1)
    ]
    next_index = len(blocks) + 1
    for block in extra_blocks or []:
        blocks.append(f"[{next_index}] {block}")
        next_index += 1
    joined = "\n\n".join(blocks) if blocks else "(no context retrieved)"
    return f"Context sources:\n{joined}\n\nQuestion: {question}"


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
        (found for block in _FENCED_JSON.finditer(raw) if (found := _structured(block.group(1)))),
        None,
    )
    verdict, answer = structured if structured else ("", raw)
    cited: list[int] = []
    for match in _CITATION.finditer(answer):
        for part in match.group(1).split(","):
            number = int(part)
            if 1 <= number <= block_count and number not in cited:
                cited.append(number)
    return ParsedAnswer(verdict=verdict, answer=answer, cited_blocks=cited)


class FakeAnswerGenerator:
    """Deterministic template generator (CI and tests)."""

    def __init__(self) -> None:
        self.model_name = "fake-answer-v1"

    def generate(
        self,
        question: str,
        contexts: list[EvidenceChunk],
        extra_blocks: list[str] | None = None,
    ) -> GenerationOutput:
        started = time.perf_counter()
        del question  # deterministic output: context titles only
        blocks = len(extra_blocks or [])
        if contexts or blocks:
            titles = ", ".join(chunk.title for chunk in contexts[:2]) or "structured records"
            verdict = "[fake-model] answered from the retrieved sources"
            answer = (
                f"[fake-model] Based on {len(contexts)} retrieved source(s)"
                + (f" and {blocks} authoritative structured record(s)" if blocks else "")
                + f", the strongest evidence for the question is in: {titles} [1]."
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
    ) -> None:
        self.model_name = model
        self._temperature = temperature
        self._api_base = api_base
        self._max_tokens = max_tokens
        self._timeout_s = timeout_s

    def generate(
        self,
        question: str,
        contexts: list[EvidenceChunk],
        extra_blocks: list[str] | None = None,
    ) -> GenerationOutput:
        import litellm  # imported lazily: heavy import, not needed in CI

        started = time.perf_counter()
        try:
            response = litellm.completion(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": build_user_prompt(question, contexts, extra_blocks),
                    },
                ],
                temperature=self._temperature,
                max_tokens=self._max_tokens,
                base_url=self._api_base,
                timeout=self._timeout_s,
            )
            content = response["choices"][0]["message"]["content"]
        except Exception as error:
            raise GenerationError(f"Model gateway call failed: {error}") from error
        if not isinstance(content, str) or not content.strip():
            raise GenerationError("Model gateway returned an empty answer")
        latency_ms = (time.perf_counter() - started) * 1000
        return GenerationOutput(content.strip(), latency_ms, _usage(response))


def _usage(response: object) -> dict[str, int] | None:
    """Token counts the gateway reported, if any."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    counts = {key: getattr(usage, key, None) for key in _USAGE_KEYS}
    reported = {key: value for key, value in counts.items() if isinstance(value, int)}
    return reported or None
