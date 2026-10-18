"""Document scenario: superseded rules document contradicting the price (SCN-015).

The game is drawn from the scenario stream among draw games priced at least
`SCN015_MIN_PRICE` in their own currency (design 10a.5). The legacy rules
leaflet is written in the game's market language, names the local product
family and states a stale price; its validity window marks it superseded.
"""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from app.datasets.rows import DocumentRow
from app.datasets.taxonomies import MARKET_LANGUAGE
from app.scenarios.planter import ScenarioPlanter, at

# Eligible draw games cost at least this much in their own currency.
SCN015_MIN_PRICE = Decimal("1.50")
# The legacy leaflet states 60% of the current price: a clear gap in every currency.
SCN015_STALE_PRICE_FACTOR = 0.6
SCN015_NO_DRAW = "NONE"
SCN015_CREATED_DAY = 20
SCN015_CREATED_HOUR = 10
SCN015_VALID_DAYS = 200  # superseded well before the window ends

# Legacy leaflet bodies per market language: four sentences, no internal ". ".
SCN015_RULES_TEMPLATES = {
    "en": (
        "Game rules for {family} ({game}). Each line costs {currency} {price}. "
        "This leaflet reflects the launch configuration of the product. "
        "Draws take place according to the published schedule."
    ),
    "el": (
        "Κανόνες παιχνιδιού για «{family}» ({game}). Κάθε στήλη κοστίζει {price} {currency}. "
        "Το έντυπο περιγράφει τη διαμόρφωση του προϊόντος κατά την κυκλοφορία του. "
        "Οι κληρώσεις γίνονται σύμφωνα με το δημοσιευμένο πρόγραμμα."
    ),
    "de": (
        "Spielregeln für „{family}“ ({game}). Jeder Tipp kostet {price} {currency}. "
        "Dieses Merkblatt beschreibt die Konfiguration des Produkts zum Start. "
        "Die Ziehungen finden laut veröffentlichtem Ziehungsplan statt."
    ),
    "cs": (
        "Pravidla hry „{family}“ ({game}). Každý sloupec stojí {price} {currency}. "
        "Tento leták popisuje nastavení produktu při jeho uvedení. "
        "Losování probíhá podle zveřejněného plánu."
    ),
}


def plant_document_structured_conflict(plan: ScenarioPlanter) -> None:
    """SCN-015: a superseded rules document contradicts the authoritative price."""
    candidates = sorted(
        (
            g
            for g in plan.tables["games"]
            if g.draw_frequency_code != SCN015_NO_DRAW and g.ticket_price >= SCN015_MIN_PRICE
        ),
        key=lambda g: g.game_id,
    )
    if not candidates:
        raise RuntimeError("scenario SCN-015: no eligible draw game")
    game = plan.rng.choice(candidates)
    stale_price = round(float(game.ticket_price) * SCN015_STALE_PRICE_FACTOR, 2)
    family = plan.names[("family", game.game_family_id)]
    language = MARKET_LANGUAGE[game.market_id]

    created = at(SCN015_CREATED_DAY, SCN015_CREATED_HOUR)
    document = DocumentRow(
        document_id=plan.next_id("documents"),
        document_type="GAME_RULES",
        market_id=game.market_id,
        language_code=language,
        title=f"Game Rules: {family} ({game.game_id}) (Legacy Pricing)",
        created_at=created,
        valid_from=created,
        valid_to=created + timedelta(days=SCN015_VALID_DAYS),
        source_system_code="document_store",
        source_record_id=game.game_id,
        body=SCN015_RULES_TEMPLATES[language].format(
            family=family,
            game=game.game_id,
            currency=game.currency_code,
            price=f"{stale_price:.2f}",
        ),
    )
    plan.add("documents", [document])
    plan.add("document_chunks", plan.chunk_rows(document))

    plan.affected_markets = [game.market_id]
    plan.affected_games = [game.game_id]
    plan.start_date = created.date()
    plan.duration_days = SCN015_VALID_DAYS
    plan.truth = {
        "conflicting_document": document.document_id,
        "stale_price": stale_price,
        "authoritative_source": f"warehouse:games:{game.game_id}",
        "authoritative_price": float(game.ticket_price),
        "validity_note": "document valid_to marks it superseded within the generation window",
        "expected_behaviour": (
            "identify the conflict, prefer the structured record, and cite validity timestamps"
        ),
    }
    plan.required_evidence = [document.document_id, game.game_id]
