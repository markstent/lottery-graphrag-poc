"""The one model gateway: a single LiteLLM completion call, plus the
reachability probe.

Answer generation and the benchmark judge both call `complete`, so every
model request carries the same parameters and fails the same way. `probe`
answers whether the configured model is reachable (not whether it is warm)
for readiness and the models endpoint.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from types import ModuleType
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:  # app.config imports this module
    from app.config import GenerationSettings

logger = logging.getLogger(__name__)

_USAGE_KEYS = ("prompt_tokens", "completion_tokens", "total_tokens")
# "default" leaves the provider's behaviour unchanged; "off" asks a thinking
# model not to spend its token budget on hidden reasoning.
REASONING_MODES = ("default", "off")
# What switches hidden reasoning off, per LiteLLM model prefix. Verified against
# the installed LiteLLM (see tests/test_gateway.py, which runs its offline
# request transformation):
# - ollama/, ollama_chat/: llms/ollama/chat/transformation.py (map_openai_params)
#   and llms/ollama/completion/transformation.py turn reasoning_effort "none"
#   into think=false in the request body.
# - openrouter/: llms/openrouter/chat/transformation.py lists reasoning_effort as
#   supported only for models LiteLLM flags reasoning-capable, so it would raise
#   or be dropped for the rest. extra_body is merged into the request body for
#   every model, so it sends {"reasoning": {"enabled": false}} on all of them.
_REASONING_OFF_BY_PREFIX: dict[str, dict[str, object]] = {
    "ollama/": {"reasoning_effort": "none"},
    "ollama_chat/": {"reasoning_effort": "none"},
    "openrouter/": {"extra_body": {"reasoning": {"enabled": False}}},
}


def parse_reasoning(value: str, variable: str) -> str:
    """A reasoning mode read from ``variable``; anything else is refused."""
    if value not in REASONING_MODES:
        raise ValueError(f"{variable} must be one of {list(REASONING_MODES)}, got {value!r}")
    return value


def _reasoning_off_kwargs(model: str) -> dict[str, object] | None:
    for prefix, kwargs in _REASONING_OFF_BY_PREFIX.items():
        if model.startswith(prefix):
            return kwargs
    return None


def reasoning_mode_supported(model: str) -> bool:
    """Whether reasoning can be switched off for ``model`` (by its provider prefix)."""
    return _reasoning_off_kwargs(model) is not None


def parse_reasoning_for_model(value: str, variable: str, model: str) -> str:
    """``parse_reasoning``, and "off" only for a model whose provider has a switch."""
    mode = parse_reasoning(value, variable)
    if mode == "off" and not reasoning_mode_supported(model):
        prefixes = list(_REASONING_OFF_BY_PREFIX)
        raise ValueError(
            f"{variable}=off is not supported for model {model!r}; "
            f"the supported prefixes are {prefixes}. Use 'default' or a supported model."
        )
    return mode


class GatewayError(RuntimeError):
    """Raised when the provider call fails or returns no content."""


class EmptyCompletionError(GatewayError):
    """The provider answered, but with no text (a thinking model can spend a
    small token budget on hidden reasoning)."""


@dataclass(frozen=True, slots=True)
class CompletionRequest:
    model: str
    system: str
    user: str
    temperature: float
    max_tokens: int
    api_base: str | None
    timeout_s: float
    reasoning: str = "default"

    def __post_init__(self) -> None:
        parse_reasoning(self.reasoning, "reasoning")


@dataclass(frozen=True, slots=True)
class Completion:
    """Stripped model text, call latency and token usage when reported."""

    text: str
    latency_ms: float
    usage: dict[str, int] | None


# LiteLLM imports much of itself on first attribute use. Two threads doing that
# at once deadlocked a live run on Python's per-module import locks, so every
# load goes through one lock, and the API loads it at start-up (`load_litellm`).
_LITELLM_LOCK = threading.Lock()


def load_litellm() -> ModuleType:
    """LiteLLM, fully imported, under one lock. Imported lazily: heavy, not needed in CI."""
    with _LITELLM_LOCK:
        import litellm

        litellm.completion  # noqa: B018 - resolves LiteLLM's lazy imports now
        return litellm


def complete(request: CompletionRequest) -> Completion:
    litellm = load_litellm()
    off_kwargs = _reasoning_off_kwargs(request.model) if request.reasoning == "off" else None
    if request.reasoning == "off" and off_kwargs is None:
        raise GatewayError(f"Reasoning cannot be switched off for model {request.model!r}")
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
            **(off_kwargs or {}),
        )
        content = response["choices"][0]["message"]["content"]
    except Exception as error:
        raise GatewayError(f"Model gateway call failed: {error}") from error
    if not isinstance(content, str) or not content.strip():
        raise EmptyCompletionError("Model gateway returned an empty answer")
    if off_kwargs is not None and _reasoning_tokens(response) > 0:
        raise GatewayError(
            f"Model {request.model!r} reported reasoning tokens although reasoning is off"
        )
    latency_ms = (time.perf_counter() - started) * 1000
    return Completion(content.strip(), latency_ms, _usage(response))


def _reasoning_tokens(response: object) -> int:
    """Hidden reasoning tokens the provider reported, 0 when none."""
    usage = getattr(response, "usage", None)
    details = getattr(usage, "completion_tokens_details", None)
    tokens = getattr(details, "reasoning_tokens", None)
    return tokens if isinstance(tokens, int) else 0


def _usage(response: object) -> dict[str, int] | None:
    """Token counts the provider reported, if any."""
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    counts = {key: getattr(usage, key, None) for key in _USAGE_KEYS}
    reported = {key: value for key, value in counts.items() if isinstance(value, int)}
    return reported or None


# An Ollama model is reachable when the server lists it: asking it to
# generate would load a cold model, which can take longer than any probe.
OLLAMA_PROBE_TIMEOUT_S = 5.0
# Any other provider answers one 1-token completion within this, or within
# GENERATION_TIMEOUT_S when that is shorter.
COMPLETION_PROBE_CAP_S = 30.0
# LiteLLM's base for an ``ollama/`` model when no api_base is configured.
OLLAMA_DEFAULT_BASE = "http://localhost:11434"
_OLLAMA_PREFIXES = ("ollama/", "ollama_chat/")


@dataclass(frozen=True, slots=True)
class ProbeResult:
    """Reachability with a curated detail (never a URL or provider text)."""

    ok: bool
    detail: str


def generation_api_base(settings: GenerationSettings) -> str | None:
    """The base URL every gateway call for ``settings`` goes to.

    The generator and the probe both use it, so readiness checks exactly
    the server generation will call. An Ollama model without a configured
    base goes to LiteLLM's Ollama default, made explicit here.
    """
    if settings.api_base:
        return settings.api_base
    if settings.model.startswith(_OLLAMA_PREFIXES):
        return OLLAMA_DEFAULT_BASE
    return None


def _ollama_base(settings: GenerationSettings, ollama_host: str | None) -> str | None:
    """The Ollama server the model is routed to, or None for another provider."""
    base = generation_api_base(settings)
    if base is None:
        return None
    base = base.rstrip("/")
    if settings.model.startswith(_OLLAMA_PREFIXES):
        return base
    if ollama_host is not None and base == ollama_host.rstrip("/"):
        return base
    return None


def probe_timeout_s(settings: GenerationSettings, ollama_host: str | None = None) -> float:
    if _ollama_base(settings, ollama_host) is not None:
        return OLLAMA_PROBE_TIMEOUT_S
    return min(COMPLETION_PROBE_CAP_S, settings.timeout_s)


def probe(
    settings: GenerationSettings,
    ollama_host: str | None = None,
    transport: httpx.BaseTransport | None = None,
) -> ProbeResult:
    """Whether the configured LiteLLM model is reachable.

    An Ollama-routed model (an ``ollama/`` model, or ``api_base`` equal to
    ``ollama_host``) is checked against the model list of the server
    ``generation_api_base`` names; any other provider must answer a 1-token
    completion. Raw failures are logged.
    """
    base = _ollama_base(settings, ollama_host)
    if base is not None:
        return probe_ollama(base, settings.model, transport)
    request = CompletionRequest(
        model=settings.model,
        system="Reply with one word.",
        user="ping",
        temperature=0.0,
        max_tokens=1,
        api_base=generation_api_base(settings),
        timeout_s=probe_timeout_s(settings, ollama_host),
        reasoning=settings.reasoning,
    )
    try:
        complete(request)
    except EmptyCompletionError:
        pass  # the provider answered; one token may go to hidden reasoning
    except GatewayError as error:
        logger.warning("model probe failed", exc_info=error)
        return ProbeResult(ok=False, detail="The model provider did not answer.")
    return ProbeResult(ok=True, detail="the model answered")


def probe_ollama(base: str, model: str, transport: httpx.BaseTransport | None) -> ProbeResult:
    """Whether the Ollama server at ``base`` lists ``model``."""
    name = model.split("/", 1)[1] if "/" in model else model
    try:
        with httpx.Client(transport=transport, timeout=OLLAMA_PROBE_TIMEOUT_S) as client:
            response = client.get(f"{base}/api/tags")
            response.raise_for_status()
            listed = response.json()["models"]
            names = {str(entry.get("name")) for entry in listed} | {
                str(entry.get("model")) for entry in listed
            }
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as error:
        logger.warning("model probe failed", exc_info=error)
        return ProbeResult(ok=False, detail="The model provider did not answer.")
    # Ollama lists an untagged model under its ":latest" tag.
    wanted = {name} if ":" in name else {name, f"{name}:latest"}
    if names & wanted:
        return ProbeResult(ok=True, detail="available")
    return ProbeResult(ok=False, detail="not pulled")
