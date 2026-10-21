"""The committed OpenAPI contract is the one the frontend types come from; it
must equal what the application serves, and must not depend on the machine."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from app.api.openapi_export import CONTRACT_PATH, render_contract
from app.main import create_app

from tests.conftest import build_lab_offline


def test_committed_contract_matches_the_app() -> None:
    served = create_app(lab_factory=build_lab_offline).openapi()
    assert json.loads(CONTRACT_PATH.read_text()) == served, (
        "frontend/src/api/openapi.json is out of date: run make api-contract"
    )


def test_contract_is_independent_of_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = render_contract(create_app(lab_factory=build_lab_offline))
    monkeypatch.setenv("DATASET_DIR", str(tmp_path / "another-world"))
    monkeypatch.setenv("APP_DB_PATH", str(tmp_path / "another.db"))
    assert render_contract(create_app(lab_factory=build_lab_offline)) == first


def test_contract_is_sorted_two_space_json_with_a_trailing_newline() -> None:
    text = CONTRACT_PATH.read_text()
    assert text == render_contract(create_app(lab_factory=build_lab_offline))
    assert text.endswith("}\n")
    assert text.startswith('{\n  "')
