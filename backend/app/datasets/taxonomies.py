"""Market-local reference taxonomies.

Each market owns its game families, categories, mechanics, incident types,
support categories and player segments, named in its own language. Cross-market
concepts are reconciled by the ontology, never by shared codes here.
"""

from __future__ import annotations

from app.datasets.rows import (
    GameCategoryRow,
    GameFamilyRow,
    GameMechanicRow,
    IncidentTypeRow,
    PaymentProviderRow,
    PlayerSegmentRow,
    SupportCategoryRow,
)

MARKET_LANGUAGE: dict[str, str] = {"MKT_UK": "en", "MKT_GR": "el", "MKT_AT": "de", "MKT_CZ": "cs"}

_FAMILIES: dict[str, tuple[tuple[str, str], ...]] = {
    "MKT_UK": (
        ("FAM_UK_NATIONAL_DRAW", "National Draw"),
        ("FAM_UK_ANNUITY", "Annuity Draw"),
        ("FAM_UK_RAPID_NUMBERS", "Rapid Numbers"),
        ("FAM_UK_FIXED_PRIZE", "Fixed Prize Raffle"),
        ("FAM_UK_SCRATCHCARD", "Scratchcard"),
        ("FAM_UK_ONLINE_INSTANT", "Online Instant"),
    ),
    "MKT_GR": (
        ("FAM_GR_ARITHMOLACHEIO", "Αριθμολαχείο"),
        ("FAM_GR_POLYETHNIKO_TZAKPOT", "Πολυεθνικό Τζάκποτ"),
        ("FAM_GR_SYCHNES_KLIROSEIS", "Συχνές Κληρώσεις"),
        ("FAM_GR_XYSTO", "Ξυστό"),
        ("FAM_GR_PSIFIAKO_XYSTO", "Ψηφιακό Ξυστό"),
    ),
    "MKT_AT": (
        ("FAM_AT_ZAHLENLOTTO", "Zahlenlotto"),
        ("FAM_AT_LAENDER_JACKPOT", "Länderübergreifender Jackpot"),
        ("FAM_AT_SCHNELLZIEHUNG", "Schnellziehung"),
        ("FAM_AT_ZUSATZSPIEL", "Zusatzspiel"),
        ("FAM_AT_RUBBELLOS", "Rubbellos"),
    ),
    "MKT_CZ": (
        ("FAM_CZ_CISELNA_LOTERIE", "Číselná loterie"),
        ("FAM_CZ_MEZINARODNI_JACKPOT", "Mezinárodní jackpot"),
        ("FAM_CZ_RYCHLA_CISLA", "Rychlá čísla"),
        ("FAM_CZ_STIRACI_LOS", "Stírací los"),
    ),
}

_CATEGORIES: dict[str, tuple[tuple[str, str], ...]] = {
    "MKT_UK": (
        ("CAT_UK_DRAW", "Draw games"),
        ("CAT_UK_NUMBERS", "Number games"),
        ("CAT_UK_INSTANT", "Instant games"),
    ),
    "MKT_GR": (
        ("CAT_GR_KLIROSEIS", "Κληρώσεις"),
        ("CAT_GR_ARITHMOPAICHNIDIA", "Αριθμοπαιχνίδια"),
        ("CAT_GR_STIGMIAIA", "Στιγμιαία"),
    ),
    "MKT_AT": (
        ("CAT_AT_ZIEHUNG", "Ziehungsspiele"),
        ("CAT_AT_ZAHLEN", "Zahlenspiele"),
        ("CAT_AT_SOFORT", "Sofortspiele"),
        ("CAT_AT_ZUSATZ", "Zusatzprodukte"),
    ),
    "MKT_CZ": (
        ("CAT_CZ_LOSOVANI", "Losované hry"),
        ("CAT_CZ_CISLA", "Číselné hry"),
        ("CAT_CZ_OKAMZITE", "Okamžité výhry"),
    ),
}

# mechanic_id, local short code, description in the market language
_MECHANICS: dict[str, tuple[tuple[str, str, str], ...]] = {
    "MKT_UK": (
        ("MECH_UK_NUMBER_MATCH", "NUMBER_MATCH", "Match your numbers against the draw"),
        ("MECH_UK_LUCKY_DIP", "LUCKY_DIP", "Randomly selected number lines"),
        ("MECH_UK_SCRATCH", "SCRATCH", "Scratch to reveal matching symbols"),
        ("MECH_UK_INSTANT_ROUNDS", "INSTANT_ROUNDS", "Instant win rounds on every ticket"),
        ("MECH_UK_SECOND_CHANCE", "SECOND_CHANCE", "Losing entries go into a second draw"),
    ),
    "MKT_GR": (
        ("MECH_GR_EPILOGI_ARITHMON", "EPILOGI_ARITHMON", "Επιλογή αριθμών και αντιστοίχιση"),
        ("MECH_GR_TYCHAIA_EPILOGI", "TYCHAIA_EPILOGI", "Τυχαία επιλογή αριθμών"),
        ("MECH_GR_XYSIMO", "XYSIMO", "Ξύστε για να αποκαλύψετε σύμβολα"),
        ("MECH_GR_AMESOI_GYROI", "AMESOI_GYROI", "Άμεσοι γύροι κερδών ανά δελτίο"),
    ),
    "MKT_AT": (
        ("MECH_AT_ZAHLENWAHL", "ZAHLENWAHL", "Zahlen wählen und mit der Ziehung vergleichen"),
        ("MECH_AT_QUICKTIPP", "QUICKTIPP", "Zufällig gewählte Zahlenreihen"),
        ("MECH_AT_RUBBELN", "RUBBELN", "Aufrubbeln und Symbole aufdecken"),
        ("MECH_AT_ZWEITE_CHANCE", "ZWEITE_CHANCE", "Nieten nehmen an einer zweiten Ziehung teil"),
    ),
    "MKT_CZ": (
        ("MECH_CZ_VYBER_CISEL", "VYBER_CISEL", "Výběr čísel a porovnání s losováním"),
        ("MECH_CZ_NAHODNY_TIP", "NAHODNY_TIP", "Náhodně vybrané řady čísel"),
        ("MECH_CZ_STIRANI", "STIRANI", "Setřete a odhalte shodné symboly"),
    ),
}

# Canonical kinds in a fixed order shared by every market.
_INCIDENT_KINDS = ("PAYMENT", "APPLICATION", "DRAW", "IDENTITY", "RETAIL")
_SUPPORT_KINDS = ("PAYMENT", "ACCOUNT", "GAME", "TECHNICAL")

_INCIDENT_TYPES: dict[str | None, tuple[tuple[str, str], ...]] = {
    None: (
        ("ITYPE_CORP_PAYMENT", "Payment processing failure"),
        ("ITYPE_CORP_APPLICATION", "Application stability"),
        ("ITYPE_CORP_DRAW", "Draw execution delay"),
        ("ITYPE_CORP_IDENTITY", "Authentication outage"),
        ("ITYPE_CORP_RETAIL", "Retail terminal outage"),
    ),
    "MKT_UK": (
        ("ITYPE_UK_PAYMENT_FAILURE", "Payment failure"),
        ("ITYPE_UK_APP_STABILITY", "App stability"),
        ("ITYPE_UK_DRAW_DELAY", "Draw delay"),
        ("ITYPE_UK_SIGN_IN", "Sign-in outage"),
        ("ITYPE_UK_TERMINAL", "Terminal outage"),
    ),
    "MKT_GR": (
        ("ITYPE_GR_PLIROMES", "Αποτυχία πληρωμών"),
        ("ITYPE_GR_EFARMOGI", "Αστάθεια εφαρμογής"),
        ("ITYPE_GR_KLIROSI", "Καθυστέρηση κλήρωσης"),
        ("ITYPE_GR_SYNDESI", "Διακοπή σύνδεσης"),
        ("ITYPE_GR_TERMATIKA", "Διακοπή τερματικών"),
    ),
    "MKT_AT": (
        ("ITYPE_AT_ZAHLUNG", "Zahlungsausfall"),
        ("ITYPE_AT_APP", "App-Instabilität"),
        ("ITYPE_AT_ZIEHUNG", "Ziehungsverzögerung"),
        ("ITYPE_AT_ANMELDUNG", "Anmeldestörung"),
        ("ITYPE_AT_TERMINAL", "Terminalausfall"),
    ),
    "MKT_CZ": (
        ("ITYPE_CZ_PLATBY", "Selhání plateb"),
        ("ITYPE_CZ_APLIKACE", "Nestabilita aplikace"),
        ("ITYPE_CZ_LOSOVANI", "Zpoždění losování"),
        ("ITYPE_CZ_PRIHLASENI", "Výpadek přihlášení"),
        ("ITYPE_CZ_TERMINAL", "Výpadek terminálů"),
    ),
}

_SUPPORT_CATEGORIES: dict[str, tuple[tuple[str, str], ...]] = {
    "MKT_UK": (
        ("SUPC_UK_PAYMENT", "Payment issue"),
        ("SUPC_UK_ACCOUNT", "Account access"),
        ("SUPC_UK_GAME", "Game or rules query"),
        ("SUPC_UK_TECHNICAL", "Technical fault"),
    ),
    "MKT_GR": (
        ("SUPC_GR_PLIROMI", "Πρόβλημα πληρωμής"),
        ("SUPC_GR_LOGARIASMOS", "Πρόσβαση λογαριασμού"),
        ("SUPC_GR_PAICHNIDI", "Ερώτηση για παιχνίδι"),
        ("SUPC_GR_TECHNIKO", "Τεχνικό πρόβλημα"),
    ),
    "MKT_AT": (
        ("SUPC_AT_ZAHLUNG", "Zahlungsproblem"),
        ("SUPC_AT_KONTO", "Kontozugang"),
        ("SUPC_AT_SPIEL", "Frage zum Spiel"),
        ("SUPC_AT_TECHNIK", "Technische Störung"),
    ),
    "MKT_CZ": (
        ("SUPC_CZ_PLATBA", "Problém s platbou"),
        ("SUPC_CZ_UCET", "Přístup k účtu"),
        ("SUPC_CZ_HRA", "Dotaz ke hře"),
        ("SUPC_CZ_TECHNIKA", "Technická závada"),
    ),
}

# VALUE (high, mid, low) then ENGAGEMENT (engaged, casual, dormant) per market.
_SEGMENTS: dict[str, tuple[tuple[str, str, str], ...]] = {
    "MKT_UK": (
        ("SEG_UK_VIP", "VALUE", "VIP"),
        ("SEG_UK_MAINSTREAM", "VALUE", "Mainstream"),
        ("SEG_UK_BUDGET", "VALUE", "Budget"),
        ("SEG_UK_ENGAGED", "ENGAGEMENT", "Engaged"),
        ("SEG_UK_CASUAL", "ENGAGEMENT", "Casual"),
        ("SEG_UK_DORMANT", "ENGAGEMENT", "Dormant"),
    ),
    "MKT_GR": (
        ("SEG_GR_KORYFAIOI", "VALUE", "Κορυφαίοι"),
        ("SEG_GR_TAKTIKOI", "VALUE", "Τακτικοί"),
        ("SEG_GR_OIKONOMIKOI", "VALUE", "Οικονομικοί"),
        ("SEG_GR_ENERGOI", "ENGAGEMENT", "Ενεργοί"),
        ("SEG_GR_PERISTASIAKOI", "ENGAGEMENT", "Περιστασιακοί"),
        ("SEG_GR_ADRANEIS", "ENGAGEMENT", "Αδρανείς"),
    ),
    "MKT_AT": (
        ("SEG_AT_TOPKUNDEN", "VALUE", "Topkunden"),
        ("SEG_AT_STAMMKUNDEN", "VALUE", "Stammkunden"),
        ("SEG_AT_SPARSAM", "VALUE", "Sparsam"),
        ("SEG_AT_AKTIV", "ENGAGEMENT", "Aktiv"),
        ("SEG_AT_GELEGENTLICH", "ENGAGEMENT", "Gelegentlich"),
        ("SEG_AT_INAKTIV", "ENGAGEMENT", "Inaktiv"),
    ),
    "MKT_CZ": (
        ("SEG_CZ_VIP", "VALUE", "VIP"),
        ("SEG_CZ_BEZNI", "VALUE", "Běžní"),
        ("SEG_CZ_USPORNI", "VALUE", "Úsporní"),
        ("SEG_CZ_AKTIVNI", "ENGAGEMENT", "Aktivní"),
        ("SEG_CZ_OBCASNI", "ENGAGEMENT", "Občasní"),
        ("SEG_CZ_NEAKTIVNI", "ENGAGEMENT", "Neaktivní"),
    ),
}

GAME_FAMILIES: tuple[GameFamilyRow, ...] = tuple(
    GameFamilyRow(family_id, name, market, MARKET_LANGUAGE[market])
    for market, entries in _FAMILIES.items()
    for family_id, name in entries
)
GAME_CATEGORIES: tuple[GameCategoryRow, ...] = tuple(
    GameCategoryRow(code, name, market, MARKET_LANGUAGE[market])
    for market, entries in _CATEGORIES.items()
    for code, name in entries
)
GAME_MECHANICS: tuple[GameMechanicRow, ...] = tuple(
    GameMechanicRow(mechanic_id, code, description, market, MARKET_LANGUAGE[market])
    for market, entries in _MECHANICS.items()
    for mechanic_id, code, description in entries
)
INCIDENT_TYPES: tuple[IncidentTypeRow, ...] = tuple(
    IncidentTypeRow(type_id, market, name, MARKET_LANGUAGE.get(market or "", "en"))
    for market, entries in _INCIDENT_TYPES.items()
    for type_id, name in entries
)
SUPPORT_CATEGORIES: tuple[SupportCategoryRow, ...] = tuple(
    SupportCategoryRow(category_id, market, name, MARKET_LANGUAGE[market])
    for market, entries in _SUPPORT_CATEGORIES.items()
    for category_id, name in entries
)
PLAYER_SEGMENTS: tuple[PlayerSegmentRow, ...] = tuple(
    PlayerSegmentRow(segment_id, market, kind, name, MARKET_LANGUAGE[market])
    for market, entries in _SEGMENTS.items()
    for segment_id, kind, name in entries
)
PAYMENT_PROVIDERS: tuple[PaymentProviderRow, ...] = (
    PaymentProviderRow("PP_BLUEHARBOR", "BlueHarbor Payments", None, "PLT_PAYMENTS"),
    PaymentProviderRow("PP_CONTINENTAL", "Continental Pay", None, "PLT_PAYMENTS"),
    PaymentProviderRow("PP_NORTHGATE", "Northgate Payments", "MKT_UK", "PLT_PAYMENTS"),
    PaymentProviderRow("PP_AEGEAN_PAY", "Aegean Pay", "MKT_GR", "PLT_PAYMENTS"),
    PaymentProviderRow("PP_ALPENKASSE", "Alpenkasse", "MKT_AT", "PLT_PAYMENTS"),
    PaymentProviderRow("PP_VLTAVA_PAY", "Vltava Pay", "MKT_CZ", "PLT_PAYMENTS"),
)


def segments_for(market_code: str, kind: str) -> tuple[str, str, str]:
    """Segment ids of a kind: high/mid/low (VALUE) or engaged/casual/dormant (ENGAGEMENT)."""
    high, mid, low = (
        s.segment_id
        for s in PLAYER_SEGMENTS
        if s.market_id == f"MKT_{market_code}" and s.segment_kind == kind
    )
    return high, mid, low


def incident_type_for(market_id: str | None, canonical: str) -> str:
    """Incident type id for a canonical kind; `None` selects the corporate taxonomy."""
    return _INCIDENT_TYPES[market_id][_INCIDENT_KINDS.index(canonical)][0]


def support_category_for(market_id: str, canonical: str) -> str:
    """Support category id for a canonical kind in a market."""
    return _SUPPORT_CATEGORIES[market_id][_SUPPORT_KINDS.index(canonical)][0]
