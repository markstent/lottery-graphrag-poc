"""Synthetic document corpus and chunking.

Documents are multilingual per market profiles (docs/01 section 5/9/20):
local operational documents use the market language, corporate documents use
English. Bodies are template-composed from fictional content and reference
stable generated IDs so downstream retrieval and graph ingestion can link them.
"""

from __future__ import annotations

import random
from datetime import datetime, time, timedelta
from typing import Any

from app.datasets.config import WINDOW_DAYS, WINDOW_START
from app.datasets.util import chunk_text, word_count

_MARKET_LANGUAGE = {"MKT_UK": "en", "MKT_GR": "el", "MKT_AT": "de", "MKT_CZ": "cs"}

_CORPORATE_TYPES = {
    "POLICY",
    "PLATFORM_DOCUMENTATION",
    "TECHNICAL_INTEGRATION_NOTE",
    "EXPERIMENT_REPORT",
}

_TYPE_WEIGHTS: tuple[tuple[str, int], ...] = (
    ("PRODUCT_SPEC", 18),
    ("GAME_RULES", 28),
    ("RELEASE_NOTE", 30),
    ("INCIDENT_REPORT", 22),
    ("POST_INCIDENT_REVIEW", 10),
    ("MARKETING_BRIEF", 14),
    ("CAMPAIGN_EVALUATION", 14),
    ("SUPPORT_SUMMARY", 18),
    ("MONTHLY_MARKET_REVIEW", 18),
    ("EXPERIMENT_REPORT", 6),
    ("MEETING_NOTE", 20),
    ("PLATFORM_DOCUMENTATION", 10),
    ("POLICY", 5),
    ("TECHNICAL_INTEGRATION_NOTE", 10),
)

_TEMPLATES: dict[str, dict[str, list[str]]] = {
    "en": {
        "open": [
            "This document describes {subject}.",
            "Summary of findings for {subject}.",
            "Operational notes covering {subject}.",
        ],
        "detail": [
            "The product team reviewed performance against the agreed plan.",
            "Customer impact was contained and monitored through support channels.",
            "Relevant obligations were checked against the responsible gaming policy.",
            "Release {app_version} was deployed to the market during the reporting window.",
            "Incident {incident} was resolved and follow-up actions were agreed.",
            "Campaign {campaign} targeted the selected audience segments.",
            "Ticket sales for {game} developed in line with seasonal expectations.",
        ],
        "close": [
            "Next review is scheduled with the market operations team.",
            "Ownership of follow-up items sits with the product owner.",
            "No further action is required for this reporting period.",
        ],
    },
    "el": {
        "open": [
            "Το παρόν έγγραφο περιγράφει {subject}.",
            "Σύνοψη παρατηρήσεων για {subject}.",
        ],
        "detail": [
            "Η ομάδα προϊόντος εξέτασε την πορεία έναντι του σχεδίου.",
            "Ο αντίκτυπος στους πελάτες ήταν περιορισμένος και παρακολουθήθηκε.",
            "Το incident {incident} επιλύθηκε και ορίστηκαν ενέργειες παρακολούθησης.",
            "Οι πωλήσεις για {game} κινήθηκαν σύμφωνα με τις εποχικές προσδοκίες.",
        ],
        "close": [
            "Το επόμενο review προγραμματίζεται με την τοπική ομάδα.",
            "Δεν απαιτείται περαιτέρω ενέργεια για την περίοδο αυτή.",
        ],
    },
    "de": {
        "open": [
            "Dieses Dokument beschreibt {subject}.",
            "Zusammenfassung der Beobachtungen zu {subject}.",
        ],
        "detail": [
            "Das Produktteam hat den Verlauf gegen den Plan geprüft.",
            "Die Kundenauswirkung blieb begrenzt und wurde überwacht.",
            "Der Vorfall {incident} wurde behoben und Maßnahmen wurden vereinbart.",
            "Die Verkäufe von {game} entsprachen den saisonalen Erwartungen.",
        ],
        "close": [
            "Das nächste Review ist mit dem Marktteam geplant.",
            "Für diese Periode sind keine weiteren Maßnahmen erforderlich.",
        ],
    },
    "cs": {
        "open": [
            "Tento dokument popisuje {subject}.",
            "Souhrn poznatků k {subject}.",
        ],
        "detail": [
            "Produktový tým posoudil vývoj proti plánu.",
            "Dopad na zákazníky byl omezený a byl sledován.",
            "Incident {incident} byl vyřešen a byla domluvena následná opatření.",
            "Prodeje hry {game} odpovídaly sezónním očekáváním.",
        ],
        "close": [
            "Další revize je naplánována s tržním týmem.",
            "Pro toto období nejsou potřeba žádná další opatření.",
        ],
    },
}


def _reference_for(
    doc_type: str, pools: dict[str, list[str]], rng: random.Random
) -> tuple[str, str, int]:
    """Return (subject description, reference id, created offset in days)."""
    if doc_type in ("INCIDENT_REPORT", "POST_INCIDENT_REVIEW") and pools["incidents"]:
        ref = pools["incidents"][rng.randrange(len(pools["incidents"]))]
        return f"incident {ref}", ref, rng.randrange(1, 10)
    if doc_type == "RELEASE_NOTE" and pools["app_versions"]:
        ref = pools["app_versions"][rng.randrange(len(pools["app_versions"]))]
        return f"release {ref}", ref, rng.randrange(0, 5)
    if doc_type in ("MARKETING_BRIEF", "CAMPAIGN_EVALUATION") and pools["campaigns"]:
        ref = pools["campaigns"][rng.randrange(len(pools["campaigns"]))]
        return f"campaign {ref}", ref, rng.randrange(1, 20)
    if doc_type in ("PRODUCT_SPEC", "GAME_RULES") and pools["games"]:
        ref = pools["games"][rng.randrange(len(pools["games"]))]
        return f"game {ref}", ref, 0
    if doc_type == "EXPERIMENT_REPORT" and pools["experiments"]:
        ref = pools["experiments"][rng.randrange(len(pools["experiments"]))]
        return f"experiment {ref}", ref, 0
    return "the reporting period", "", rng.randrange(0, WINDOW_DAYS)


def generate_documents(
    rng: random.Random,
    total: int,
    game_rows: list[tuple[Any, ...]],
    incidents: list[tuple[Any, ...]],
    campaigns: list[tuple[Any, ...]],
    app_versions: list[tuple[Any, ...]],
    experiments: list[tuple[Any, ...]],
) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
    """Multilingual synthetic documents and their chunks."""
    pools = {
        "games": [g[0] for g in game_rows],
        "incidents": [i[0] for i in incidents],
        "campaigns": [c[0] for c in campaigns],
        "app_versions": [a[0] for a in app_versions],
        "experiments": [e[0] for e in experiments],
    }

    type_plan: list[str] = []
    for doc_type, weight in _TYPE_WEIGHTS:
        type_plan.extend([doc_type] * weight)
    rng.shuffle(type_plan)

    documents: list[tuple[Any, ...]] = []
    chunks: list[tuple[Any, ...]] = []
    markets = ["MKT_UK", "MKT_GR", "MKT_AT", "MKT_CZ"]
    for i in range(total):
        doc_id = f"DOC_{i + 1:04d}"
        doc_type = type_plan[i % len(type_plan)]
        corporate = doc_type in _CORPORATE_TYPES
        market_id: str | None = None if corporate else markets[rng.randrange(len(markets))]
        language = (
            "en"
            if market_id is None
            else ("en" if rng.random() < 0.30 else _MARKET_LANGUAGE[market_id])
        )
        templates = _TEMPLATES[language]
        subject, _ref, offset_days = _reference_for(doc_type, pools, rng)

        sentences = [
            templates["open"][rng.randrange(len(templates["open"]))].format(subject=subject)
        ]
        for _ in range(rng.randrange(3, 7)):
            sentences.append(
                templates["detail"][rng.randrange(len(templates["detail"]))].format(
                    subject=subject,
                    incident=pools["incidents"][rng.randrange(len(pools["incidents"]))]
                    if pools["incidents"]
                    else "n/a",
                    campaign=pools["campaigns"][rng.randrange(len(pools["campaigns"]))]
                    if pools["campaigns"]
                    else "n/a",
                    game=pools["games"][rng.randrange(len(pools["games"]))]
                    if pools["games"]
                    else "n/a",
                    app_version=pools["app_versions"][rng.randrange(len(pools["app_versions"]))]
                    if pools["app_versions"]
                    else "n/a",
                )
            )
        sentences.append(templates["close"][rng.randrange(len(templates["close"]))])
        body = " ".join(sentences)

        created = datetime.combine(WINDOW_START, time.min) + timedelta(
            days=min(offset_days + rng.randrange(0, 60), WINDOW_DAYS - 1),
            seconds=rng.randrange(24 * 60 * 60),
        )
        documents.append(
            (
                doc_id,
                doc_type,
                market_id,
                language,
                f"{doc_type.replace('_', ' ').title()}: {_ref or 'Reporting Period'}",
                created,
                created,
                None,
                "document_store",
                None,
                body,
            )
        )
        for index, chunk_body in enumerate(chunk_text(body)):
            chunks.append(
                (
                    f"CHNK_{doc_id[4:]}_{index:02d}",
                    doc_id,
                    index,
                    chunk_body,
                    word_count(chunk_body),
                    None,
                )
            )
    documents.sort(key=lambda d: d[0])
    chunks.sort(key=lambda c: c[0])
    return documents, chunks
