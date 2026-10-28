"""Help's settings fixture is what GET /settings serves for a fixed environment.

``frontend/src/test/settings.fixture.json`` is the answer of the API's own
builder (``_experiment_settings``) with only these variables set, so it carries
exactly the fields an official run records now and is never edited by hand.
Rewrite it from backend/ with
    uv run python -m tests.test_settings_fixture
The file is the writer's output byte for byte: frontend/.prettierignore
leaves it alone, and the test compares bytes.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest import mock

from app.api.benchmarks import _experiment_settings
from app.config import REPO_ROOT

SETTINGS_FIXTURE = REPO_ROOT / "frontend/src/test/settings.fixture.json"
# Test values, not a configuration anyone runs: names that read as stand-ins.
FIXTURE_ENV = {
    "GENERATION_MODEL": "generation-model",
    "GENERATION_MODEL_FAMILY": "generation-family",
    "JUDGE_PROVIDER": "litellm",
    "JUDGE_MODEL": "judge-model",
    "JUDGE_MODEL_FAMILY": "judge-family",
}


def fixture_settings() -> dict[str, Any]:
    """The settings the API serves with only ``FIXTURE_ENV`` set."""
    with mock.patch.dict(os.environ, FIXTURE_ENV, clear=True):
        return _experiment_settings().model_dump(mode="json")


def fixture_text() -> str:
    """The fixture file, byte for byte (frontend/.prettierignore keeps it as written)."""
    return json.dumps(fixture_settings(), indent=2) + "\n"


def test_the_settings_fixture_is_what_the_api_serves() -> None:
    assert SETTINGS_FIXTURE.read_text(encoding="utf-8") == fixture_text()


if __name__ == "__main__":
    SETTINGS_FIXTURE.write_text(fixture_text(), encoding="utf-8")
