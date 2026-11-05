"""Easy-to-read wordings of the Live Lab's saved questions (D-108).

Each wording names its record as a person would (its name or kind, its
country, its date), keeps the record's id in brackets so the graph
approaches can start from it as they do for the tested wording, and adds
nothing else. They were written by hand from the presentation world's own
records (``data/generated/dev-seed2026``), never from the truth ledger or
the answer key.

A wording is asked as written, as a question the reader typed: it is not
in the tested set, so it runs live and is not scored. It is served only for
the world it was written from, matched by the world manifest hash the bank
records, because another world may give the same id to another record.
"""

from __future__ import annotations

# The manifest hash of data/generated/dev-seed2026, the world these were written from.
WRITTEN_FOR_WORLD = "6c60b5845fc4b1d1a9bbf583037bc5c1bb39030b9c3250ec9cc10f1fc8de3a89"

# Bank instance id to its easy-to-read wording.
EASY_WORDINGS: dict[str, str] = {
    "L05-2026-INC_037": (
        "Which other countries had incidents on the same platform version as the UK "
        "sign-in incident of 7 February 2025 (INC_037)?"
    ),
    "L09-2026-GAME_AT_05": (
        "Which games in other countries are the same kind of game as Edelweiss Instant, "
        "a game in Austria (GAME_AT_05)?"
    ),
    "L01-2026-GAME_AT_04": (
        "How much does a ticket for Alpen Star, a game in Austria (GAME_AT_04), cost?"
    ),
    "L15-2026-INC_041": (
        "What caused the app incident in Greece that began on 25 June 2025 (INC_041)?"
    ),
}


def easy_wording(instance_id: str, world_manifest_hash: str) -> str | None:
    """The instance's easy-to-read wording, or None when it has none or the
    world is not the one the wordings were written from."""
    if world_manifest_hash != WRITTEN_FOR_WORLD:
        return None
    return EASY_WORDINGS.get(instance_id)
