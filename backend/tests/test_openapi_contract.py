"""The committed OpenAPI contract is the one the frontend types come from; it
must equal what the application serves, and must not depend on the machine."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from app.api.errors import ErrorCode
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


# A failed readiness check answers 503 with the readiness body, not an envelope.
READINESS_FAILURE = ("/api/v1/health/ready", "get", "503")
ENVELOPE_REF = "#/components/schemas/ErrorEnvelope"


def _operations() -> list[tuple[str, str, dict[str, Any]]]:
    paths = create_app(lab_factory=build_lab_offline).openapi()["paths"]
    return [
        (path, method, operation)
        for path, item in paths.items()
        for method, operation in item.items()
    ]


# 405 and the 404 of an unknown path come from the framework and are not documented.
def test_documented_failures_use_the_error_envelope() -> None:
    operations = _operations()
    assert len(operations) == 34
    for path, method, operation in operations:
        failures = {
            status: response
            for status, response in operation["responses"].items()
            if not status.startswith("2")
        }
        assert "500" in failures, f"{method} {path} does not declare 500"
        for status, response in failures.items():
            if (path, method, status) == READINESS_FAILURE:
                continue
            schema = response["content"]["application/json"]["schema"]
            assert schema == {"$ref": ENVELOPE_REF}, f"{method} {path} {status}"


def test_every_route_with_input_declares_its_422() -> None:
    for path, method, operation in _operations():
        takes_input = bool(operation.get("parameters") or operation.get("requestBody"))
        assert ("422" in operation["responses"]) == takes_input, f"{method} {path}"


def test_the_framework_validation_error_is_not_in_the_contract() -> None:
    served = create_app(lab_factory=build_lab_offline).openapi()
    assert "HTTPValidationError" not in json.dumps(served)
    assert "ValidationError" not in served["components"]["schemas"]


def test_the_envelope_names_every_error_code() -> None:
    schemas = create_app(lab_factory=build_lab_offline).openapi()["components"]["schemas"]
    assert schemas["ApiErrorBody"]["properties"]["error_code"] == {
        "$ref": "#/components/schemas/ErrorCode"
    }
    assert set(schemas["ErrorCode"]["enum"]) == {code.value for code in ErrorCode}
