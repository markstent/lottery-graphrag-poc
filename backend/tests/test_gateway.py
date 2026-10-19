"""The model gateway: one completion call for generation and the judge."""

from __future__ import annotations

import pytest
from app.models.gateway import CompletionRequest, GatewayError, complete

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
