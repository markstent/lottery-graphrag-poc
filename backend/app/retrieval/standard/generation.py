"""Answer generation through the model gateway (ADR-003).

- FakeAnswerGenerator: deterministic template generator for CI and tests.
  It never fabricates content beyond the retrieved context titles, so tests
  can assert exact outputs.
- LiteLLMAnswerGenerator: the real gateway call (local Ollama or hosted
  OpenRouter through configuration). Citations are derived from the selected
  context by the pipeline, never from model output, so answers cannot invent
  citation targets.

Citations therefore always correspond to context that was actually retrieved
and shown (docs/retrieval/retrieval-fairness.md).
"""

from __future__ import annotations

import time
from typing import Protocol

from app.evidence import EvidenceChunk

_SYSTEM_PROMPT = (
    "You are an enterprise analyst. Answer using only the numbered context "
    "sources. Cite sources as [n] matching the numbers given. If the sources "
    "do not contain the answer, say so plainly."
)


class GenerationError(RuntimeError):
    """Raised when the model gateway fails or returns unusable output."""


class AnswerGenerator(Protocol):
    model_name: str

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> tuple[str, float]:
        """Return (answer_text, latency_ms) grounded in the given contexts."""
        ...


def build_user_prompt(question: str, contexts: list[EvidenceChunk]) -> str:
    """Numbered context block; [n] in answers maps to contexts[n-1]."""
    blocks = [
        f"[{index}] {chunk.title} ({chunk.market_id}, {chunk.language_code})\n{chunk.text}"
        for index, chunk in enumerate(contexts, start=1)
    ]
    joined = "\n\n".join(blocks) if blocks else "(no context retrieved)"
    return f"Context sources:\n{joined}\n\nQuestion: {question}"


class FakeAnswerGenerator:
    """Deterministic template generator (CI and tests)."""

    def __init__(self) -> None:
        self.model_name = "fake-answer-v1"

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> tuple[str, float]:
        started = time.perf_counter()
        if contexts:
            titles = ", ".join(chunk.title for chunk in contexts[:2])
            text = (
                f"[fake-model] Based on {len(contexts)} retrieved source(s), the strongest "
                f"evidence for the question is in: {titles}."
            )
        else:
            text = "[fake-model] No context was retrieved for this question."
        return text.strip(), (time.perf_counter() - started) * 1000


class LiteLLMAnswerGenerator:
    """Provider-neutral completion through the LiteLLM gateway."""

    def __init__(
        self,
        model: str,
        temperature: float = 0.0,
        api_base: str | None = None,
        timeout_s: float = 120.0,
    ) -> None:
        self.model_name = model
        self._temperature = temperature
        self._api_base = api_base
        self._timeout_s = timeout_s

    def generate(self, question: str, contexts: list[EvidenceChunk]) -> tuple[str, float]:
        import litellm  # imported lazily: heavy import, not needed in CI

        started = time.perf_counter()
        try:
            response = litellm.completion(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": build_user_prompt(question, contexts)},
                ],
                temperature=self._temperature,
                base_url=self._api_base,
                timeout=self._timeout_s,
            )
            content = response["choices"][0]["message"]["content"]
        except Exception as error:
            raise GenerationError(f"Model gateway call failed: {error}") from error
        if not isinstance(content, str) or not content.strip():
            raise GenerationError("Model gateway returned an empty answer")
        latency_ms = (time.perf_counter() - started) * 1000
        return content.strip(), latency_ms
