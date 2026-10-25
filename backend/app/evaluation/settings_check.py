"""One equality check over run settings, shared by comparing and resuming.

Two runs may be compared, or a failed run resumed, only when every recorded
setting agrees except those the caller allows to differ. Evaluator-only
(ADR-008).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

# A resumed run is the same experiment: only when and where it ran may differ.
RESUME_MAY_DIFFER = frozenset({"started_at", "world_dir", "git_dirty"})
# H7 compares two models, so the model and the code revision may differ too.
COMPARE_MAY_DIFFER = RESUME_MAY_DIFFER | {
    "git_sha",
    "generation_model",
    "generation_model_family",
    "generation_quantisation",
}
# Each world has its own seeds and bank; they are compared world by world.
PER_WORLD_FIELDS = frozenset({"world_seed", "scenario_seed", "bank_hash", "world_dir"})


def settings_differences(
    a: Mapping[str, Any], b: Mapping[str, Any], allowed: frozenset[str]
) -> list[str]:
    """The sorted names of the fields whose values differ, outside ``allowed``.

    A field present on one side only differs.
    """
    missing = object()
    return sorted(
        name
        for name in a.keys() | b.keys()
        if name not in allowed and a.get(name, missing) != b.get(name, missing)
    )


def describe_differences(
    names: list[str], a: Mapping[str, Any], b: Mapping[str, Any], labels: tuple[str, str]
) -> str:
    """One clause per differing field with both values, for a refusal message."""
    return "; ".join(
        f"{name}: {labels[0]} {a.get(name, '(absent)')!r}, {labels[1]} {b.get(name, '(absent)')!r}"
        for name in names
    )
