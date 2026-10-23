"""Cross-language guard: each backend relationship type has a frontend phrase."""

import re
from pathlib import Path

from app.config import DEFAULT_RELATIONSHIP_TYPES
from app.graph.statements import ONTOLOGY_RELATIONSHIP_TYPES

PHRASES_FILE = Path(__file__).parents[2] / "frontend" / "src" / "design" / "relationships.ts"


def _phrase_keys() -> set[str]:
    source = PHRASES_FILE.read_text(encoding="utf-8")
    return set(re.findall(r"^\s*([A-Z][A-Z_]*):\s*'", source, flags=re.MULTILINE))


def test_every_backend_relationship_type_has_a_frontend_phrase() -> None:
    keys = _phrase_keys()
    assert keys, "no phrase keys parsed from relationships.ts"
    backend = set(DEFAULT_RELATIONSHIP_TYPES) | set(ONTOLOGY_RELATIONSHIP_TYPES)
    missing = sorted(backend - keys)
    assert not missing, f"relationship types without a phrase in relationships.ts: {missing}"
