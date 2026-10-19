"""The one model gateway: a single LiteLLM completion call.

Answer generation and the benchmark judge both call `complete`, so every
model request carries the same parameters and fails the same way.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

_USAGE_KEYS = ("prompt_tokens", "completion_tokens", "total_tokens")


class GatewayError(RuntimeError):
    """Raised when the provider call fails or returns no content."""


@dataclass(frozen=True, slots=True)
class CompletionRequest:
    model: str
    system: str
    user: str
    temperature: float
    max_tokens: int
    api_base: str | None
    timeout_s: float


@dataclass(frozen=True, slots=True)
class Completion:
    """Stripped model text, call latency and token usage when reported."""

    text: str
    latency_ms: float
    usage: dict[str, int] | None


def complete(request: CompletionRequest) -> Completion:
    import litellm  # imported lazily: heavy import, not needed in CI

    started = time.perf_counter()
    try:
        response = litellm.completion(
            model=request.model,
            messages=[
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            base_url=request.api_base,
            timeout=request.timeout_s,
        )
        content = response["choices"][0]["message"]["content"]
    except Exception as error:
        raise GatewayError(f"Model gateway call failed: {error}") from error
    if not isinstance(content, str) or not content.strip():
        raise GatewayError("Model gateway returned an empty answer")
    latency_ms = (time.perf_counter() - started) * 1000
    return Completion(content.strip(), latency_ms, _usage(response))


def _usage(response: object) -> dict[str, int] | None:
    """Token counts the provider reported, if any."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    counts = {key: getattr(usage, key, None) for key in _USAGE_KEYS}
    reported = {key: value for key, value in counts.items() if isinstance(value, int)}
    return reported or None
