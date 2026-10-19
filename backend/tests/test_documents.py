"""Coherent multilingual documents with local names (Task 7 rules 1 to 7)."""

from __future__ import annotations

import random
import re
from collections import Counter

import pytest
from app.datasets.config import GenerationConfig
from app.datasets.documents import WorldIndex, generate_documents
from app.datasets.taxonomies import MARKET_LANGUAGE
from app.datasets.util import split_sentences
from app.datasets.world import World, build_world

_CORPORATE_TYPES = {
    "POLICY",
    "PLATFORM_DOCUMENTATION",
    "TECHNICAL_INTEGRATION_NOTE",
    "EXPERIMENT_REPORT",
}


@pytest.fixture(scope="module")
def tiny_world() -> World:
    return build_world(GenerationConfig(profile="tiny", world_seed=42))


def _title_id(title: str) -> str:
    return title.rsplit("(", 1)[1].rstrip(")")


def test_market_documents_match_their_subjects_market(tiny_world: World) -> None:
    by_id = {g.game_id: g for g in tiny_world.tables["games"]}
    for doc in tiny_world.tables["documents"]:
        if doc.document_type in ("PRODUCT_SPEC", "GAME_RULES"):
            game_id = doc.title.rsplit("(", 1)[1].rstrip(")")
            assert by_id[game_id].market_id == doc.market_id


def test_market_documents_use_market_language_most_of_the_time(tiny_world: World) -> None:
    # UK documents are English either way, so they cannot show the local share.
    market_docs = [
        d
        for d in tiny_world.tables["documents"]
        if d.market_id and MARKET_LANGUAGE[d.market_id] != "en"
    ]
    local = sum(1 for d in market_docs if d.language_code != "en")
    assert local >= 0.5 * len(market_docs)


def test_game_documents_name_family_and_mechanic_locally(tiny_world: World) -> None:
    families = {f.family_id: f.name for f in tiny_world.tables["game_families"]}
    games = {g.game_id: g for g in tiny_world.tables["games"]}
    for doc in tiny_world.tables["documents"]:
        if doc.document_type == "GAME_RULES":
            game = games[doc.title.rsplit("(", 1)[1].rstrip(")")]
            assert families[game.game_family_id] in doc.body


def test_no_sentence_repeats_inside_a_document(tiny_world: World) -> None:
    for doc in tiny_world.tables["documents"]:
        sentences = split_sentences(doc.body)
        assert len(sentences) == len(set(sentences)), doc.document_id


def test_corporate_documents_are_english_without_market(tiny_world: World) -> None:
    corporate = [d for d in tiny_world.tables["documents"] if d.document_type in _CORPORATE_TYPES]
    assert corporate
    for doc in corporate:
        assert doc.market_id is None
        assert doc.language_code == "en"


def test_market_documents_are_local_or_english(tiny_world: World) -> None:
    for doc in tiny_world.tables["documents"]:
        if doc.market_id is not None:
            assert doc.language_code in ("en", MARKET_LANGUAGE[doc.market_id])


def test_subject_market_matches_for_every_subject_kind(tiny_world: World) -> None:
    markets: dict[str, str | None] = {}
    for table, key in (
        ("games", "game_id"),
        ("incidents", "incident_id"),
        ("campaigns", "campaign_id"),
        ("app_versions", "app_version_id"),
    ):
        for row in tiny_world.tables[table]:
            markets[getattr(row, key)] = row.market_id
    for doc in tiny_world.tables["documents"]:
        if doc.source_record_id in markets and doc.document_type not in _CORPORATE_TYPES:
            assert markets[doc.source_record_id] == doc.market_id, doc.document_id


def test_title_always_carries_name_and_id(tiny_world: World) -> None:
    games = {g.game_id: g.game_name for g in tiny_world.tables["games"]}
    for doc in tiny_world.tables["documents"]:
        if doc.source_record_id:
            assert doc.title.endswith(f"({doc.source_record_id})")
            assert _title_id(doc.title) == doc.source_record_id
        if doc.source_record_id in games:
            assert f"{games[doc.source_record_id]} ({doc.source_record_id})" in doc.title


def test_mentions_mix_name_only_and_name_with_id(tiny_world: World) -> None:
    families = {f.family_id: f.name for f in tiny_world.tables["game_families"]}
    games = {g.game_id: g for g in tiny_world.tables["games"]}
    forms: Counter[str] = Counter()
    for doc in tiny_world.tables["documents"]:
        game = games.get(doc.source_record_id)
        if game is None:
            continue
        name = families[game.game_family_id]
        with_id = f"{name} ({game.game_family_id})"
        forms["with_id"] += doc.body.count(with_id)
        forms["name_only"] += doc.body.count(name) - doc.body.count(with_id)
    assert forms["with_id"] > 0
    assert forms["name_only"] > 0


def test_game_documents_reference_only_related_entities(tiny_world: World) -> None:
    incidents_of_game: dict[str, set[str]] = {}
    for link in tiny_world.tables["incident_game_map"]:
        incidents_of_game.setdefault(link.game_id, set()).add(link.incident_id)
    campaigns_of_game: dict[str, set[str]] = {}
    for link in tiny_world.tables["campaign_game_map"]:
        campaigns_of_game.setdefault(link.game_id, set()).add(link.campaign_id)
    games = {g.game_id for g in tiny_world.tables["games"]}
    for doc in tiny_world.tables["documents"]:
        if doc.source_record_id not in games:
            continue
        game_id = doc.source_record_id
        assert set(re.findall(r"GAME_[A-Z]{2}_\d+", doc.body)) <= {game_id}
        assert set(re.findall(r"INC_\d+", doc.body)) <= incidents_of_game.get(game_id, set())
        assert set(re.findall(r"CMP_\d+", doc.body)) <= campaigns_of_game.get(game_id, set())


def test_incident_documents_reference_only_affected_games(tiny_world: World) -> None:
    games_of_incident: dict[str, set[str]] = {}
    for link in tiny_world.tables["incident_game_map"]:
        games_of_incident.setdefault(link.incident_id, set()).add(link.game_id)
    for doc in tiny_world.tables["documents"]:
        if doc.document_type in ("INCIDENT_REPORT", "POST_INCIDENT_REVIEW") and (
            doc.source_record_id
        ):
            found = set(re.findall(r"GAME_[A-Z]{2}_\d+", doc.body))
            assert found <= games_of_incident.get(doc.source_record_id, set())


def test_no_placeholder_or_missing_value_leaks(tiny_world: World) -> None:
    for doc in tiny_world.tables["documents"]:
        assert "{" not in doc.body and "}" not in doc.body
        assert "n/a" not in doc.body
        assert "None" not in doc.body


def test_documents_and_chunks_are_sorted_with_stable_ids(tiny_world: World) -> None:
    docs = tiny_world.tables["documents"]
    chunks = tiny_world.tables["document_chunks"]
    assert [d.document_id for d in docs] == sorted(d.document_id for d in docs)
    doc_ids = {d.document_id for d in docs}
    per_doc: dict[str, list[int]] = {}
    for chunk in chunks:
        assert chunk.document_id in doc_ids
        number = chunk.document_id.removeprefix("DOC_")
        assert chunk.chunk_id == f"CHNK_{number}_{chunk.chunk_index:02d}"
        per_doc.setdefault(chunk.document_id, []).append(chunk.chunk_index)
    assert set(per_doc) == doc_ids
    for indexes in per_doc.values():
        assert indexes == list(range(len(indexes)))


def test_documents_are_deterministic(tiny_world: World) -> None:
    again = build_world(GenerationConfig(profile="tiny", world_seed=42))
    assert again.tables["documents"] == tiny_world.tables["documents"]
    assert again.tables["document_chunks"] == tiny_world.tables["document_chunks"]


def test_template_fields_keep_template_order_without_duplicates() -> None:
    from app.datasets.documents import _fields

    assert _fields("{a} and {b} and {a}") == ["a", "b"]


def test_some_monthly_reviews_cover_the_reporting_period(tiny_world: World) -> None:
    reviews = [
        d for d in tiny_world.tables["documents"] if d.document_type == "MONTHLY_MARKET_REVIEW"
    ]
    subjectless = [d for d in reviews if d.source_record_id == ""]
    assert subjectless
    for doc in subjectless:
        assert doc.title == "Monthly Market Review: Reporting Period"
        assert doc.market_id is not None


def test_cross_market_incidents_get_corporate_english_documents(tiny_world: World) -> None:
    cross_market = {i.incident_id for i in tiny_world.tables["incidents"] if i.market_id is None}
    assert cross_market
    # The full document type plan, so every incident document type is drawn many times.
    documents, _ = generate_documents(
        random.Random(0), 253, WorldIndex.from_tables(tiny_world.tables)
    )
    corporate_incident_docs = [d for d in documents if d.source_record_id in cross_market]
    assert corporate_incident_docs
    for doc in corporate_incident_docs:
        assert doc.document_type in ("INCIDENT_REPORT", "POST_INCIDENT_REVIEW")
        assert doc.market_id is None
        assert doc.language_code == "en"


def test_baseline_incident_summaries_name_their_platform_version(tiny_world: World) -> None:
    labels = {
        v.platform_version_id: v.version_label for v in tiny_world.tables["platform_versions"]
    }
    versioned = [i for i in tiny_world.tables["incidents"] if i.platform_version_id]
    assert versioned
    for incident in versioned:
        assert labels[incident.platform_version_id] in incident.summary
