from app.datasets import taxonomies
from app.datasets.master_data import GAME_SPECS, MARKETS


def test_every_local_code_belongs_to_one_market_and_its_language() -> None:
    languages = {m.market_id: m.primary_language for m in MARKETS}
    for family in taxonomies.GAME_FAMILIES:
        assert family.family_id.split("_")[1] == family.market_id[-2:]
        assert family.language_code == languages[family.market_id]
    for category in taxonomies.GAME_CATEGORIES:
        assert category.language_code == languages[category.market_id]
    for mechanic in taxonomies.GAME_MECHANICS:
        assert mechanic.language_code == languages[mechanic.market_id]
    for segment in taxonomies.PLAYER_SEGMENTS:
        assert segment.language_code == languages[segment.market_id]


def test_no_family_code_is_shared_across_markets() -> None:
    ids = [f.family_id for f in taxonomies.GAME_FAMILIES]
    assert len(ids) == len(set(ids)) == 20


def test_taxonomy_row_counts() -> None:
    assert len(taxonomies.GAME_CATEGORIES) == 13
    assert len(taxonomies.GAME_MECHANICS) == 16
    assert len(taxonomies.INCIDENT_TYPES) == 25
    assert len(taxonomies.SUPPORT_CATEGORIES) == 16
    assert len(taxonomies.PLAYER_SEGMENTS) == 24
    assert len(taxonomies.PAYMENT_PROVIDERS) == 6


def test_game_specs_use_codes_of_their_own_market() -> None:
    families = {f.family_id: f.market_id for f in taxonomies.GAME_FAMILIES}
    categories = {c.category_code: c.market_id for c in taxonomies.GAME_CATEGORIES}
    mechanics = {m.mechanic_id: m.market_id for m in taxonomies.GAME_MECHANICS}
    for spec in GAME_SPECS:
        assert families[spec.family_id] == f"MKT_{spec.market_code}"
        assert categories[spec.category_id] == f"MKT_{spec.market_code}"
        assert all(mechanics[m] == f"MKT_{spec.market_code}" for m in spec.mechanics)


def test_incident_type_lookup_falls_back_to_corporate_for_cross_market() -> None:
    assert taxonomies.incident_type_for(None, "PAYMENT") == "ITYPE_CORP_PAYMENT"
    assert taxonomies.incident_type_for("MKT_GR", "PAYMENT") == "ITYPE_GR_PLIROMES"


def test_incident_and_support_lookups_resolve_to_rows() -> None:
    incident_ids = {t.incident_type_id for t in taxonomies.INCIDENT_TYPES}
    support_ids = {c.support_category_id for c in taxonomies.SUPPORT_CATEGORIES}
    for market in (None, "MKT_UK", "MKT_GR", "MKT_AT", "MKT_CZ"):
        for canonical in ("PAYMENT", "APPLICATION", "DRAW", "IDENTITY", "RETAIL"):
            assert taxonomies.incident_type_for(market, canonical) in incident_ids
    for market in ("MKT_UK", "MKT_GR", "MKT_AT", "MKT_CZ"):
        for canonical in ("PAYMENT", "ACCOUNT", "GAME", "TECHNICAL"):
            assert taxonomies.support_category_for(market, canonical) in support_ids
    assert taxonomies.support_category_for("MKT_AT", "ACCOUNT") == "SUPC_AT_KONTO"


def test_segments_for_returns_three_ids_in_canonical_order() -> None:
    assert taxonomies.segments_for("AT", "VALUE") == (
        "SEG_AT_TOPKUNDEN",
        "SEG_AT_STAMMKUNDEN",
        "SEG_AT_SPARSAM",
    )
    assert taxonomies.segments_for("CZ", "ENGAGEMENT") == (
        "SEG_CZ_AKTIVNI",
        "SEG_CZ_OBCASNI",
        "SEG_CZ_NEAKTIVNI",
    )
