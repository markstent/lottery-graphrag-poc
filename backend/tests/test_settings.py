"""One settings module (app.config): repository anchors and API settings."""

from __future__ import annotations

from pathlib import Path

import pytest
from app.config import REPO_ROOT, ApiSettings, api_from_env

BACKEND = Path(__file__).resolve().parents[1]
API_ENV = (
    "CORS_ORIGINS",
    "APP_DB_PATH",
    "RUN_RETENTION",
    "SSE_HEARTBEAT_S",
    "BENCHMARK_DIR",
    "LOG_LEVEL",
)


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    for name in API_ENV:
        monkeypatch.delenv(name, raising=False)
    return monkeypatch


def test_one_repo_root() -> None:
    import app.config
    import app.datasets.config

    assert not hasattr(app.datasets.config, "REPO_ROOT")
    assert app.config.REPO_ROOT.joinpath("backend").is_dir()


def test_no_empty_domain_package() -> None:
    assert not (BACKEND / "app" / "domain").exists()


def test_api_settings_defaults(clean_env: pytest.MonkeyPatch) -> None:
    # Defaults are anchored at the repository, not the working directory.
    assert api_from_env() == ApiSettings(
        cors_origins=("http://localhost:5173", "http://127.0.0.1:5173"),
        db_path=REPO_ROOT / "data" / "app.db",
        run_retention=500,
        sse_heartbeat_s=15.0,
        benchmark_dir=REPO_ROOT / "data" / "evaluation" / "runs",
    )


def test_api_settings_read_the_environment(clean_env: pytest.MonkeyPatch, tmp_path: Path) -> None:
    clean_env.setenv("CORS_ORIGINS", " http://a.test , ,http://b.test")
    clean_env.setenv("APP_DB_PATH", str(tmp_path / "runs.db"))
    clean_env.setenv("RUN_RETENTION", "20")
    clean_env.setenv("SSE_HEARTBEAT_S", "2.5")
    clean_env.setenv("BENCHMARK_DIR", str(tmp_path))
    assert api_from_env() == ApiSettings(
        cors_origins=("http://a.test", "http://b.test"),
        db_path=tmp_path / "runs.db",
        run_retention=20,
        sse_heartbeat_s=2.5,
        benchmark_dir=tmp_path,
    )


def test_empty_benchmark_dir_means_the_default(clean_env: pytest.MonkeyPatch) -> None:
    clean_env.setenv("BENCHMARK_DIR", "")
    assert api_from_env().benchmark_dir == REPO_ROOT / "data" / "evaluation" / "runs"


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("RUN_RETENTION", "0"),
        ("RUN_RETENTION", "-3"),
        ("RUN_RETENTION", "many"),
        ("SSE_HEARTBEAT_S", "0"),
        ("SSE_HEARTBEAT_S", "soon"),
        ("SSE_HEARTBEAT_S", "nan"),
    ],
)
def test_api_settings_refuse_bad_values(
    clean_env: pytest.MonkeyPatch, name: str, value: str
) -> None:
    clean_env.setenv(name, value)
    with pytest.raises(ValueError, match=name):
        api_from_env()


def test_log_level_defaults_and_rejects_unknown_values(clean_env: pytest.MonkeyPatch) -> None:
    assert api_from_env().log_level == "INFO"
    clean_env.setenv("LOG_LEVEL", "debug")
    assert api_from_env().log_level == "DEBUG"
    clean_env.setenv("LOG_LEVEL", "LOUD")
    with pytest.raises(ValueError, match="LOG_LEVEL"):
        api_from_env()
