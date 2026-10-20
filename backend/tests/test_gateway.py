"""The model gateway: one completion call for generation and the judge, and
the reachability probe."""

from __future__ import annotations

import logging

import httpx
import pytest
from app.config import GenerationSettings
from app.models.gateway import (
    COMPLETION_PROBE_CAP_S,
    OLLAMA_DEFAULT_BASE,
    OLLAMA_PROBE_TIMEOUT_S,
    CompletionRequest,
    GatewayError,
    ProbeResult,
    complete,
    generation_api_base,
    parse_reasoning,
    probe,
    probe_timeout_s,
)

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


# -- the reachability probe ---------------------------------------------------


def generation(
    model: str, api_base: str | None = None, timeout_s: float = 120.0
) -> GenerationSettings:
    return GenerationSettings(
        provider="litellm", model=model, temperature=0.0, api_base=api_base, timeout_s=timeout_s
    )


class TagsServer:
    """A stub Ollama ``/api/tags`` over httpx's mock transport (no network)."""

    def __init__(self, names: list[str], status: int = 200) -> None:
        self.names = names
        self.status = status
        self.urls: list[str] = []

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.urls.append(str(request.url))
        body = {"models": [{"name": name, "model": name} for name in self.names]}
        return httpx.Response(self.status, json=body)


def test_a_listed_ollama_model_is_available_without_generating(stub_litellm: StubLiteLLM) -> None:
    server = TagsServer(["bge-m3:latest", "qwen3.6:latest"])
    result = probe(generation("ollama/qwen3.6:latest"), transport=server.transport())
    assert result == ProbeResult(ok=True, detail="available")
    assert server.urls == ["http://localhost:11434/api/tags"]
    assert stub_litellm.calls == []


def test_an_ollama_model_is_listed_at_its_api_base() -> None:
    server = TagsServer(["gemma4:31b"])
    settings = generation("ollama_chat/gemma4:31b", api_base="http://ollama.internal:11434/")
    assert probe(settings, transport=server.transport()).ok is True
    assert server.urls == ["http://ollama.internal:11434/api/tags"]


def test_an_untagged_ollama_model_matches_its_latest_tag() -> None:
    server = TagsServer(["bge-m3:latest"])
    assert probe(generation("ollama/bge-m3"), transport=server.transport()).ok is True


def test_an_unlisted_ollama_model_is_not_pulled() -> None:
    server = TagsServer(["bge-m3:latest"])
    result = probe(generation("ollama/qwen3.6:latest"), transport=server.transport())
    assert result == ProbeResult(ok=False, detail="not pulled")


def test_an_api_base_on_the_ollama_host_routes_to_the_listing() -> None:
    server = TagsServer(["qwen3.6:latest"])
    settings = generation("openai/qwen3.6:latest", api_base="http://ollama.internal:11434")
    result = probe(
        settings, ollama_host="http://ollama.internal:11434", transport=server.transport()
    )
    assert result.detail == "available"
    assert probe_timeout_s(settings, "http://ollama.internal:11434") == OLLAMA_PROBE_TIMEOUT_S


@pytest.mark.parametrize("status", [500, None])
def test_an_unreachable_ollama_is_curated_and_logged(
    status: int | None, caplog: pytest.LogCaptureFixture
) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        if status is None:
            raise httpx.ConnectError("http://ollama.internal:11434 refused", request=request)
        return httpx.Response(status, text="internal trace", request=request)

    settings = generation("ollama/qwen3.6:latest", api_base="http://ollama.internal:11434")
    with caplog.at_level(logging.WARNING):
        result = probe(settings, transport=httpx.MockTransport(refuse))
    assert result == ProbeResult(ok=False, detail="The model provider did not answer.")
    assert any("ollama.internal" in str(r.exc_info) for r in caplog.records if r.exc_info)


def test_another_provider_answers_a_one_token_completion(stub_litellm: StubLiteLLM) -> None:
    result = probe(generation("openai/gpt-test", api_base="http://gateway.internal:4000"))
    assert result == ProbeResult(ok=True, detail="the model answered")
    (call,) = stub_litellm.calls
    assert call["max_tokens"] == 1 and call["timeout"] == COMPLETION_PROBE_CAP_S == 30.0
    assert call["base_url"] == "http://gateway.internal:4000"


def test_the_completion_probe_never_waits_longer_than_the_generation_timeout(
    stub_litellm: StubLiteLLM,
) -> None:
    probe(generation("openai/gpt-test", timeout_s=2.0))
    assert stub_litellm.calls[0]["timeout"] == 2.0


def test_an_empty_one_token_answer_still_proves_the_provider_answered(
    stub_litellm_empty: StubLiteLLM,
) -> None:
    """A thinking model can spend its single token on hidden reasoning."""
    assert probe(generation("openai/gpt-test")).ok is True


def test_a_failing_provider_is_curated_and_logged(
    stub_litellm_raises: StubLiteLLM, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING):
        result = probe(generation("openai/gpt-test"))
    assert result == ProbeResult(ok=False, detail="The model provider did not answer.")
    assert any("provider down" in str(r.exc_info) for r in caplog.records if r.exc_info)


def test_the_probe_asks_the_server_generation_calls_not_ollama_host(
    stub_litellm: StubLiteLLM,
) -> None:
    """With GENERATION_API_BASE unset, generation goes to LiteLLM's Ollama
    default even when OLLAMA_HOST (the embedding server) is elsewhere; the
    probe must ask that same server, or readiness reports a false green."""
    from app.lab import build_generator

    from tests.test_standard_rag import make_settings

    settings = make_settings(generation=generation("ollama/qwen3.6:latest"))
    server = TagsServer(["qwen3.6:latest"])
    probe(settings.generation, ollama_host="http://ollama:11434", transport=server.transport())
    build_generator("litellm", settings).generate("q", [])
    (call,) = stub_litellm.calls
    assert server.urls == [f"{call['base_url']}/api/tags"]
    assert call["base_url"] == generation_api_base(settings.generation) == OLLAMA_DEFAULT_BASE


def test_a_configured_api_base_is_used_unchanged() -> None:
    settings = generation("openai/gpt-test", api_base="http://gateway.internal:4000")
    assert generation_api_base(settings) == "http://gateway.internal:4000"
    assert generation_api_base(generation("openai/gpt-test")) is None
