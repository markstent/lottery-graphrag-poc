"""Structured logging: JSON shape, run context, redaction, stage timing, request id."""

import json
import logging
from collections.abc import Iterator

import pytest
from app.main import create_app
from app.observability.logging import (
    JsonFormatter,
    configure_logging,
    run_context,
    stage_timer,
)
from fastapi.testclient import TestClient


@pytest.fixture
def restored_root() -> Iterator[None]:
    root = logging.getLogger()
    handlers, level = list(root.handlers), root.level
    yield
    root.handlers[:] = handlers
    root.setLevel(level)


def test_records_are_json_with_run_context(
    capsys: pytest.CaptureFixture[str], restored_root: None
) -> None:
    configure_logging()
    with run_context(run_id="RUN-1", pipeline="B"):
        logging.getLogger("x").info("hello", extra={"api_key": "s3cret", "n": 3})
    line = json.loads(capsys.readouterr().err.strip().splitlines()[-1])
    assert line["run_id"] == "RUN-1" and line["pipeline"] == "B" and line["n"] == 3
    assert "api_key" not in line
    assert {"ts", "level", "logger", "message"} <= set(line)


def test_configure_logging_is_idempotent(restored_root: None) -> None:
    configure_logging()
    configure_logging("DEBUG")
    root = logging.getLogger()
    assert sum(isinstance(h.formatter, JsonFormatter) for h in root.handlers) == 1
    assert root.level == logging.DEBUG


def test_context_nests_and_restores(caplog: pytest.LogCaptureFixture) -> None:
    log = logging.getLogger("nest")
    with caplog.at_level(logging.INFO), run_context(run_id="R"):
        with run_context(pipeline="A"):
            log.info("inner")
        log.info("outer")
    inner, outer = caplog.records[-2:]
    assert inner.context == {"run_id": "R", "pipeline": "A"}  # type: ignore[attr-defined]
    assert outer.context == {"run_id": "R"}  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    "name", ["API_KEY", "auth_token", "DbPassword", "client_secret", "accessToken", "Authorization"]
)
def test_secret_named_fields_are_dropped(name: str) -> None:
    record = logging.makeLogRecord({"msg": "m", name: "hidden", "kept": 1})
    payload = json.loads(JsonFormatter().format(record))
    assert name not in payload and payload["kept"] == 1


def test_stage_timer_logs_duration_and_outcome(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO), pytest.raises(KeyError), stage_timer("reranking"):
        raise KeyError
    record = caplog.records[-1]
    assert record.stage == "reranking" and record.outcome == "KeyError"  # type: ignore[attr-defined]
    assert record.duration_ms >= 0  # type: ignore[attr-defined]


def test_stage_timer_ok_and_unknown_stage(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO), stage_timer("pipeline_run"):
        pass
    assert caplog.records[-1].outcome == "ok"  # type: ignore[attr-defined]
    with pytest.raises(ValueError, match="unknown stage"), stage_timer("nonsense"):
        pass


def test_request_id_is_accepted_or_generated(caplog: pytest.LogCaptureFixture) -> None:
    client = TestClient(create_app())
    assert (
        client.get("/api/v1/health", headers={"X-Request-ID": "abc-123"}).headers["x-request-id"]
        == "abc-123"
    )
    for bad in ("x" * 65, "has space", "semi;colon"):
        echoed = client.get("/api/v1/health", headers={"X-Request-ID": bad}).headers["x-request-id"]
        assert echoed != bad and len(echoed) == 32 and echoed.isalnum()
    assert len(client.get("/api/v1/health").headers["x-request-id"]) == 32


def test_request_id_is_bound_into_log_context(caplog: pytest.LogCaptureFixture) -> None:
    app = create_app()

    @app.get("/probe")
    def probe() -> dict[str, str]:
        logging.getLogger("probe").warning("inside request")
        return {}

    with caplog.at_level(logging.WARNING):
        TestClient(app).get("/probe", headers={"X-Request-ID": "req-9"})
    probe_record = next(r for r in caplog.records if r.name == "probe")
    assert probe_record.context["request_id"] == "req-9"  # type: ignore[attr-defined]


def _line(extra: dict[str, object], **context: str) -> dict[str, object]:
    record = logging.makeLogRecord({"msg": "m", "context": context, **extra})
    result: dict[str, object] = json.loads(JsonFormatter().format(record))
    return result


def test_extra_clashing_with_context_wins_and_does_not_crash(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO), run_context(run_id="R", pipeline="A"):
        logging.getLogger("clash").info("x", extra={"pipeline": "B"})
    record = caplog.records[-1]
    assert record.pipeline == "B" and record.context["pipeline"] == "A"  # type: ignore[attr-defined]
    line = json.loads(JsonFormatter().format(record))
    assert line["pipeline"] == "B" and line["run_id"] == "R"


def test_nested_secrets_are_dropped_but_token_counts_survive() -> None:
    line = _line(
        {
            "d": {"api_key": "LEAK", "ok": 1, "items": [{"accessToken": "LEAK2", "n": 2}]},
            "max_tokens": 512,
            "prompt_tokens": 7,
        }
    )
    assert line["d"] == {"ok": 1, "items": [{"n": 2}]}
    assert line["max_tokens"] == 512 and line["prompt_tokens"] == 7
    assert "LEAK" not in json.dumps(line)


def test_non_string_dict_keys_are_stringified() -> None:
    assert _line({"d": {(1, 2): 3}})["d"] == {"(1, 2)": 3}


def test_unserialisable_payload_falls_back_to_a_line() -> None:
    cyclic: dict[str, object] = {}
    cyclic["self"] = cyclic
    line = _line({"bad": cyclic})
    assert line["message"] == "m" and "extra_repr" in line and "level" in line


def test_reserved_keys_are_renamed() -> None:
    line = _line({"level": "x", "ts": 1, "logger": "z"})
    assert line["level"] != "x" and line["message"] == "m" and line["logger"] != "z"
    assert line["extra_level"] == "x" and line["extra_ts"] == 1
    assert line["extra_logger"] == "z"
