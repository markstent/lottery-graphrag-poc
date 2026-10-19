"""The model gateway: one completion call for generation and the judge."""

from __future__ import annotations

import pytest
from app.models.gateway import CompletionRequest, GatewayError, complete, parse_reasoning

from tests.conftest import StubLiteLLM


def test_complete_returns_text_usage_and_latency(stub_litellm: StubLiteLLM) -> None:
    result = complete(CompletionRequest("m", "sys", "user", 0.0, 50, None, 5.0))
    assert result.text == "ok"
    assert result.usage == {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4}
    assert result.latency_ms >= 0
    assert stub_litellm.calls[0]["max_tokens"] == 50
    assert stub_litellm.calls[0]["messages"][0] == {"role": "system", "content": "sys"}
    assert stub_litellm.calls[0]["base_url"] is None and stub_litellm.calls[0]["timeout"] == 5.0


def test_complete_raises_gateway_error_on_empty_content(stub_litellm_empty: StubLiteLLM) -> None:
    with pytest.raises(GatewayError):
        complete(CompletionRequest("m", "s", "u", 0.0, 50, None, 5.0))


def test_complete_raises_gateway_error_on_provider_failure(
    stub_litellm_raises: StubLiteLLM,
) -> None:
    with pytest.raises(GatewayError) as raised:
        complete(CompletionRequest("m", "s", "u", 0.0, 50, None, 5.0))
    assert isinstance(raised.value.__cause__, RuntimeError)


def test_reasoning_off_asks_the_provider_not_to_think(stub_litellm: StubLiteLLM) -> None:
    complete(CompletionRequest("m", "s", "u", 0.0, 50, None, 5.0, reasoning="off"))
    # LiteLLM maps reasoning_effort "none" to Ollama's think=false.
    assert stub_litellm.calls[0]["reasoning_effort"] == "none"


def test_default_reasoning_leaves_the_provider_unchanged(stub_litellm: StubLiteLLM) -> None:
    complete(CompletionRequest("m", "s", "u", 0.0, 50, None, 5.0))
    assert "reasoning_effort" not in stub_litellm.calls[0]


def test_an_unknown_reasoning_mode_is_refused() -> None:
    with pytest.raises(ValueError, match="reasoning"):
        CompletionRequest("m", "s", "u", 0.0, 50, None, 5.0, reasoning="low")
    with pytest.raises(ValueError, match="GENERATION_REASONING"):
        parse_reasoning("Off", "GENERATION_REASONING")
