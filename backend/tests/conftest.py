"""Shared fixtures: a stand-in for the lazily imported litellm module."""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest


class StubLiteLLM(types.ModuleType):
    """Replaces ``sys.modules["litellm"]``; records each ``completion`` call."""

    def __init__(self, content: str | None, error: Exception | None = None) -> None:
        super().__init__("litellm")
        self.calls: list[dict[str, Any]] = []
        self._content = content
        self._error = error

    def completion(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return _Response(choices=[{"message": {"content": self._content}}])


class _Response(dict[str, Any]):
    """Subscriptable choices and an attribute usage, like a litellm ModelResponse."""

    usage = types.SimpleNamespace(prompt_tokens=3, completion_tokens=1, total_tokens=4)


def _install(monkeypatch: pytest.MonkeyPatch, stub: StubLiteLLM) -> StubLiteLLM:
    monkeypatch.setitem(sys.modules, "litellm", stub)
    return stub


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    return _install(monkeypatch, StubLiteLLM("ok"))


@pytest.fixture
def stub_litellm_empty(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    return _install(monkeypatch, StubLiteLLM("  "))


@pytest.fixture
def stub_litellm_raises(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    return _install(monkeypatch, StubLiteLLM(None, RuntimeError("provider down")))
