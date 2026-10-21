"""Write the application's OpenAPI schema to the file the frontend types come from.

Run with ``python -m app.api.openapi_export`` (``make api-contract``).
The schema is built from the routes alone, so the output does not depend on
the environment, the machine or the lab's state.
"""

import json
from pathlib import Path

from fastapi import FastAPI

from app.main import create_app

CONTRACT_PATH = Path(__file__).resolve().parents[3] / "frontend" / "src" / "api" / "openapi.json"


def render_contract(application: FastAPI) -> str:
    """The schema as sorted, two-space JSON with a trailing newline."""
    return json.dumps(application.openapi(), indent=2, sort_keys=True) + "\n"


def main() -> None:
    CONTRACT_PATH.write_text(render_contract(create_app()))


if __name__ == "__main__":
    main()
