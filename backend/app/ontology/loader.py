"""Reads and validates the ontology YAML into an immutable `Ontology`."""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import yaml

from app.config import REPO_ROOT
from app.ontology.model import BINDING_KINDS, LANGUAGES, Binding, Concept, Ontology

DEFAULT_ONTOLOGY_PATH = REPO_ROOT / "schemas" / "ontology" / "ontology.yaml"


class OntologyError(ValueError):
    """The ontology document is malformed or semantically invalid."""


def load_ontology(path: Path | None = None) -> Ontology:
    """Load and validate the ontology; defaults to the repository's ontology.yaml."""
    source = path or DEFAULT_ONTOLOGY_PATH
    document = _mapping(yaml.safe_load(source.read_text(encoding="utf-8")), str(source))
    version = _text(document.get("ontology_version"), "ontology_version")
    concepts = tuple(
        _concept(_mapping(raw, "concept")) for raw in _list(document.get("concepts"), "concepts")
    )
    bindings = tuple(
        _binding(_mapping(raw, "binding")) for raw in _list(document.get("bindings"), "bindings")
    )
    _validate(concepts, bindings)
    return Ontology(version, concepts, bindings)


def _validate(concepts: tuple[Concept, ...], bindings: tuple[Binding, ...]) -> None:
    ids: set[str] = set()
    for concept in concepts:
        if concept.concept_id in ids:
            raise OntologyError(f"duplicate concept id {concept.concept_id}")
        ids.add(concept.concept_id)
    for concept in concepts:
        if concept.parent_id is not None and concept.parent_id not in ids:
            raise OntologyError(f"{concept.concept_id} has unknown parent {concept.parent_id}")
    for concept in concepts:
        missing = [lang for lang in LANGUAGES if not concept.labels.get(lang)]
        if missing:
            raise OntologyError(f"{concept.concept_id} missing label for {', '.join(missing)}")
    seen: set[tuple[str, str]] = set()
    for binding in bindings:
        key = (binding.kind, binding.code)
        if key in seen:
            raise OntologyError(f"duplicate binding for {binding.kind} {binding.code}")
        seen.add(key)
    for binding in bindings:
        if binding.concept_id not in ids:
            raise OntologyError(f"{binding.code} bound to unknown concept {binding.concept_id}")
    for binding in bindings:
        if binding.kind not in BINDING_KINDS:
            raise OntologyError(f"unknown binding kind {binding.kind} for {binding.code}")
    parents = {c.concept_id: c.parent_id for c in concepts}
    for concept in concepts:
        visited = {concept.concept_id}
        parent = concept.parent_id
        while parent is not None:
            if parent in visited:
                raise OntologyError(f"cycle in parent chain of {concept.concept_id}")
            visited.add(parent)
            parent = parents[parent]


def _concept(raw: Mapping[str, Any]) -> Concept:
    concept_id = _text(raw.get("id"), "concept id")
    parent = raw.get("parent")
    labels = _mapping(raw.get("labels"), f"{concept_id} labels")
    synonyms = _mapping(raw.get("synonyms") or {}, f"{concept_id} synonyms")
    return Concept(
        concept_id=concept_id,
        parent_id=None if parent is None else _text(parent, f"{concept_id} parent"),
        concept_type=_text(raw.get("type"), f"{concept_id} type"),
        labels={
            _text(lang, "language"): _text(label, f"{concept_id} label")
            for lang, label in labels.items()
        },
        synonyms={
            _text(lang, "language"): tuple(
                _text(term, f"{concept_id} synonym") for term in _list(terms, concept_id)
            )
            for lang, terms in synonyms.items()
        },
        definition=_text(raw.get("definition"), f"{concept_id} definition"),
    )


def _binding(raw: Mapping[str, Any]) -> Binding:
    code = _text(raw.get("code"), "binding code")
    market = raw.get("market")
    return Binding(
        kind=_text(raw.get("kind"), f"{code} kind"),
        code=code,
        market_id=None if market is None else _text(market, f"{code} market"),
        concept_id=_text(raw.get("concept"), f"{code} concept"),
    )


def _mapping(value: object, what: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise OntologyError(f"{what} must be a mapping")
    return value


def _list(value: object, what: str) -> list[Any]:
    if not isinstance(value, list):
        raise OntologyError(f"{what} must be a list")
    return value


def _text(value: object, what: str) -> str:
    if not isinstance(value, str) or not value:
        raise OntologyError(f"{what} must be a non-empty string")
    return value
