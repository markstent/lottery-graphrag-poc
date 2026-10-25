"""The model gateway: one completion call for generation and the judge, and
the reachability probe."""

from __future__ import annotations

import json
import logging
import sys
import threading
import time
import types

import httpx
import pytest
from app.config import GenerationSettings, from_env, judge_settings_from_env
from app.models.gateway import (
    COMPLETION_PROBE_CAP_S,
    OLLAMA_DEFAULT_BASE,
    OLLAMA_PROBE_TIMEOUT_S,
    CompletionRequest,
    EmptyCompletionError,
    GatewayError,
    ProbeResult,
    _reasoning_off_kwargs,
    complete,
    generation_api_base,
    load_litellm,
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


def test_reasoning_off_sends_the_provider_switch(stub_litellm: StubLiteLLM) -> None:
    complete(CompletionRequest("ollama/m", "s", "u", 0.0, 50, None, 5.0, reasoning="off"))
    complete(CompletionRequest("openrouter/a/b", "s", "u", 0.0, 50, None, 5.0, reasoning="off"))
    assert stub_litellm.calls[0]["reasoning_effort"] == "none"
    assert "extra_body" not in stub_litellm.calls[0]
    assert stub_litellm.calls[1]["extra_body"] == {"reasoning": {"enabled": False}}
    assert "reasoning_effort" not in stub_litellm.calls[1]


def test_reasoning_off_for_ollama_sends_think_false() -> None:
    """LiteLLM's own offline request transformation, no network and no model."""
    from litellm import OllamaConfig
    from litellm.llms.ollama.chat.transformation import OllamaChatConfig
    from litellm.utils import get_optional_params

    kwargs = _reasoning_off_kwargs("ollama/qwen3.6:latest")
    messages = [{"role": "user", "content": "hi"}]
    for provider, config in (("ollama_chat", OllamaChatConfig()), ("ollama", OllamaConfig())):
        params = get_optional_params(
            model="qwen3.6:latest", custom_llm_provider=provider, max_tokens=5, **(kwargs or {})
        )
        body = config.transform_request(
            model="qwen3.6:latest",
            messages=messages,  # type: ignore[arg-type]
            optional_params=dict(params),
            litellm_params={},
            headers={},
        )
        assert body["think"] is False, provider


@pytest.mark.parametrize("model", ["qwen/qwen3-8b", "meta-llama/llama-3-8b-instruct"])
def test_reasoning_off_for_openrouter_sends_reasoning_disabled(model: str) -> None:
    """Holds for a model LiteLLM flags reasoning-capable and for one it does not."""
    from litellm.llms.openrouter.chat.transformation import OpenrouterConfig
    from litellm.utils import get_optional_params

    kwargs = _reasoning_off_kwargs(f"openrouter/{model}")
    params = get_optional_params(
        model=model, custom_llm_provider="openrouter", max_tokens=5, **(kwargs or {})
    )
    body = OpenrouterConfig().transform_request(
        model=model,
        messages=[{"role": "user", "content": "hi"}],
        optional_params=dict(params),
        litellm_params={},
        headers={},
    )
    assert body["reasoning"] == {"enabled": False}


def test_reasoning_off_refused_for_unmapped_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GENERATION_PROVIDER", "litellm")
    monkeypatch.setenv("GENERATION_MODEL", "anthropic/x")
    monkeypatch.setenv("GENERATION_REASONING", "default")
    assert from_env().generation.reasoning == "default"
    monkeypatch.setenv("GENERATION_REASONING", "off")
    with pytest.raises(ValueError, match=r"ollama/.*openrouter/"):
        from_env()
    monkeypatch.setenv("JUDGE_PROVIDER", "litellm")
    monkeypatch.setenv("JUDGE_MODEL", "anthropic/x")
    monkeypatch.setenv("JUDGE_REASONING", "default")
    assert judge_settings_from_env().reasoning == "default"
    monkeypatch.setenv("JUDGE_REASONING", "off")
    with pytest.raises(ValueError, match="JUDGE_REASONING"):
        judge_settings_from_env()
    monkeypatch.setenv("JUDGE_MODEL", "openrouter/a/b")
    assert judge_settings_from_env().reasoning == "off"
    with pytest.raises(GatewayError, match="anthropic/x"):
        complete(CompletionRequest("anthropic/x", "s", "u", 0.0, 50, None, 5.0, reasoning="off"))


def test_fake_providers_accept_reasoning_off_with_their_default_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("GENERATION_MODEL", "GENERATION_PROVIDER", "JUDGE_MODEL", "JUDGE_PROVIDER"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GENERATION_REASONING", "off")
    monkeypatch.setenv("JUDGE_REASONING", "off")
    assert from_env().generation.reasoning == "off"
    assert judge_settings_from_env().reasoning == "off"


# LiteLLM 1.104 warns about a TypedDict qualifier when it first builds a response.
@pytest.mark.filterwarnings("ignore:Item 'summary' on TypedDict:UserWarning")
def test_reasoning_off_reaches_the_openrouter_request_through_litellm_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The real gateway and the real litellm.completion; only the HTTP send is
    replaced, so nothing leaves the machine."""
    sent: list[dict[str, object]] = []

    def send(self: httpx.Client, request: httpx.Request, **kwargs: object) -> httpx.Response:
        sent.append(json.loads(request.content))
        answer = {"role": "assistant", "content": "ok"}
        body = {
            "id": "x",
            "object": "chat.completion",
            "created": 1,
            "model": "m",
            "choices": [{"index": 0, "finish_reason": "stop", "message": answer}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        }
        return httpx.Response(200, json=body, request=request)

    monkeypatch.setattr(httpx.Client, "send", send)
    monkeypatch.setenv("OPENROUTER_API_KEY", "not-a-real-key")
    model = "openrouter/meta-llama/llama-3-8b-instruct"
    assert complete(CompletionRequest(model, "s", "u", 0.0, 50, None, 5.0, "off")).text == "ok"
    assert sent[0]["reasoning"] == {"enabled": False}


def test_each_call_gets_its_own_reasoning_kwargs() -> None:
    first = _reasoning_off_kwargs("openrouter/a/b")
    assert first is not None
    first["extra_body"] = "mutated"  # type: ignore[assignment]
    assert _reasoning_off_kwargs("openrouter/a/b") == {
        "extra_body": {"reasoning": {"enabled": False}}
    }


@pytest.mark.parametrize(
    "usage",
    [
        {"completion_tokens_details": {"reasoning_tokens": 7}},
        {"completion_tokens_details": types.SimpleNamespace(reasoning_tokens=7)},
        types.SimpleNamespace(completion_tokens_details={"reasoning_tokens": 7}),
    ],
)
def test_reasoning_tokens_are_read_from_dict_and_object_usage(
    stub_litellm: StubLiteLLM, monkeypatch: pytest.MonkeyPatch, usage: object
) -> None:
    monkeypatch.setattr("tests.conftest._Response.usage", usage)
    with pytest.raises(GatewayError, match="reasoning tokens"):
        complete(CompletionRequest("ollama/m", "s", "u", 0.0, 50, None, 5.0, "off"))


def test_missing_usage_is_not_reasoning(
    stub_litellm: StubLiteLLM, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("tests.conftest._Response.usage", None)
    assert complete(CompletionRequest("ollama/m", "s", "u", 0.0, 50, None, 5.0, "off")).text


def test_reasoning_error_wins_over_the_empty_answer(
    stub_litellm_empty: StubLiteLLM, monkeypatch: pytest.MonkeyPatch
) -> None:
    usage = {"completion_tokens_details": {"reasoning_tokens": 50}}
    monkeypatch.setattr("tests.conftest._Response.usage", usage)
    with pytest.raises(GatewayError, match="reasoning tokens") as raised:
        complete(CompletionRequest("ollama/m", "s", "u", 0.0, 50, None, 5.0, "off"))
    assert not isinstance(raised.value, EmptyCompletionError)


def test_reasoning_off_but_model_reasoned_is_an_error(
    stub_litellm: StubLiteLLM, monkeypatch: pytest.MonkeyPatch
) -> None:
    usage = types.SimpleNamespace(
        prompt_tokens=3,
        completion_tokens=9,
        total_tokens=12,
        completion_tokens_details=types.SimpleNamespace(reasoning_tokens=7),
    )
    monkeypatch.setattr("tests.conftest._Response.usage", usage)
    with pytest.raises(GatewayError, match="openrouter/a/thinker"):
        complete(CompletionRequest("openrouter/a/thinker", "s", "u", 0.0, 50, None, 5.0, "off"))
    # With reasoning left on, reported reasoning tokens are expected.
    assert complete(CompletionRequest("openrouter/a/thinker", "s", "u", 0.0, 50, None, 5.0)).text


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


class _SlowLazyLiteLLM(types.ModuleType):
    """A litellm whose first attribute use takes a while, like its lazy imports."""

    def __init__(self) -> None:
        super().__init__("litellm")
        self.inside = 0
        self.most_inside = 0
        self._count = threading.Lock()

    @property
    def completion(self) -> None:
        with self._count:
            self.inside += 1
            self.most_inside = max(self.most_inside, self.inside)
        time.sleep(0.05)
        with self._count:
            self.inside -= 1


def test_litellm_is_loaded_by_one_thread_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    # Two threads resolving LiteLLM's lazy imports at once deadlocked a live run.
    stub = _SlowLazyLiteLLM()
    monkeypatch.setitem(sys.modules, "litellm", stub)
    threads = [threading.Thread(target=load_litellm) for _ in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert stub.most_inside == 1
