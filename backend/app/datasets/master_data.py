"""Fixed master data and the synthetic product catalogue.

All names, suppliers and concepts are fictional. Market profiles follow
docs/01-synthetic-data-spec.md section 5; product categories section 10.
"""

from __future__ import annotations

from dataclasses import dataclass

# ---------------------------------------------------------------- markets ---

MARKET_SPLIT: dict[str, float] = {"UK": 0.32, "GR": 0.28, "AT": 0.22, "CZ": 0.18}

MARKET_CURRENCY: dict[str, str] = {"UK": "GBP", "GR": "EUR", "AT": "EUR", "CZ": "CZK"}

MARKETS: list[tuple[str, str, str, str, str, str, float, float]] = [
    # market_id, code, name, currency, language, timezone, digital, retail
    ("MKT_UK", "UK", "United Kingdom", "GBP", "en", "Europe/London", 0.78, 0.71),
    ("MKT_GR", "GR", "Greece", "EUR", "el", "Europe/Athens", 0.54, 0.86),
    ("MKT_AT", "AT", "Austria", "EUR", "de", "Europe/Vienna", 0.62, 0.74),
    ("MKT_CZ", "CZ", "Czech Republic", "CZK", "cs", "Europe/Prague", 0.58, 0.69),
]

REGIONS: list[tuple[str, str, str]] = [
    # region_id, market_id, name
    ("REG_UK_NORTH", "MKT_UK", "UK Northern"),
    ("REG_UK_MIDLANDS", "MKT_UK", "UK Midlands"),
    ("REG_UK_LONDON", "MKT_UK", "UK London"),
    ("REG_UK_SOUTH", "MKT_UK", "UK Southern"),
    ("REG_GR_MAINLAND", "MKT_GR", "GR Mainland"),
    ("REG_GR_ISLANDS", "MKT_GR", "GR Islands"),
    ("REG_GR_PELOPONNESE", "MKT_GR", "GR Peloponnese"),
    ("REG_GR_CRETE", "MKT_GR", "GR Crete"),
    ("REG_AT_EAST", "MKT_AT", "AT Eastern"),
    ("REG_AT_ALPS", "MKT_AT", "AT Alpine"),
    ("REG_AT_SOUTH", "MKT_AT", "AT Southern"),
    ("REG_AT_URBAN", "MKT_AT", "AT Urban Corridor"),
    ("REG_CZ_WEST", "MKT_CZ", "CZ Western"),
    ("REG_CZ_MORAVIA", "MKT_CZ", "CZ Moravian"),
    ("REG_CZ_SILESIA", "MKT_CZ", "CZ Silesian"),
    ("REG_CZ_PRAGUE", "MKT_CZ", "CZ Prague Region"),
]

CURRENCIES: list[tuple[str, str]] = [
    ("GBP", "Pound sterling"),
    ("EUR", "Euro"),
    ("CZK", "Czech koruna"),
]
LANGUAGES: list[tuple[str, str]] = [
    ("en", "English"),
    ("el", "Greek"),
    ("de", "German"),
    ("cs", "Czech"),
]
CHANNELS: list[tuple[str, str]] = [
    ("APP", "Mobile application"),
    ("WEB", "Web portal"),
    ("RETAIL", "Retail terminal"),
]

PLAYER_SEGMENTS: list[tuple[str, str, str, str]] = [
    # segment_id, kind, code, description
    ("SEG_VALUE_VIP", "VALUE", "VIP", "Highest long-term value players"),
    ("SEG_VALUE_MAINSTREAM", "VALUE", "MAINSTREAM", "Regular value players"),
    ("SEG_VALUE_BUDGET", "VALUE", "BUDGET", "Low-stake players"),
    ("SEG_ENG_ENGAGED", "ENGAGEMENT", "ENGAGED", "Frequently active players"),
    ("SEG_ENG_CASUAL", "ENGAGEMENT", "CASUAL", "Occasional players"),
    ("SEG_ENG_DORMANT", "ENGAGEMENT", "DORMANT", "Rarely active players"),
]

GAME_FAMILIES: list[tuple[str, str]] = [
    ("FAM_NATIONAL_DRAW", "National draw lottery"),
    ("FAM_MULTINATIONAL_JACKPOT", "Multinational jackpot lottery"),
    ("FAM_HIGH_FREQUENCY", "High-frequency number game"),
    ("FAM_INSTANT_WIN", "Instant-win game"),
    ("FAM_DIGITAL_INSTANT", "Digital instant-win game"),
    ("FAM_ADD_ON", "Supplementary add-on game"),
    ("FAM_ANNUITY", "Annuity-style game"),
    ("FAM_FIXED_PRIZE", "Fixed-prize game"),
]

GAME_CATEGORIES: list[tuple[str, str]] = [
    ("CAT_DRAW", "Draw-based"),
    ("CAT_NUMBER", "Number game"),
    ("CAT_INSTANT", "Instant product"),
    ("CAT_SUPPLEMENTARY", "Supplementary product"),
]

GAME_MECHANICS: list[tuple[str, str, str]] = [
    ("MECH_NUMBER_MATCH", "NUM_MATCH", "Match numbers against a draw"),
    ("MECH_QUICK_PICK", "QUICK_PICK", "Auto-selected number lines"),
    ("MECH_SYMBOL_SCRATCH", "SYMBOL_SCRATCH", "Reveal matching symbols"),
    ("MECH_INSTANT_ROUNDS", "INSTANT_ROUNDS", "Immediate win rounds per ticket"),
    ("MECH_PROGRESSIVE_JACKPOT", "PROG_JACKPOT", "Rolling progressive jackpot"),
    ("MECH_SECOND_CHANCE", "SECOND_CHANCE", "Non-winning entries enter a draw"),
]

PRIZE_TYPES: list[tuple[str, str, float, float]] = [
    # prize_type_id, tier, multiplier, weight
    ("PTYPE_JACKPOT", "JACKPOT", 100_000.0, 0.001),
    ("PTYPE_MAJOR", "MAJOR", 1_000.0, 0.009),
    ("PTYPE_MID", "MID", 40.0, 0.05),
    ("PTYPE_MINOR", "MINOR", 4.0, 0.34),
    ("PTYPE_MICRO", "MICRO", 1.0, 0.60),
]

CAMPAIGN_OBJECTIVES: list[tuple[str, str]] = [
    ("OBJ_ACQUISITION", "New player acquisition"),
    ("OBJ_CROSS_SELL", "Cross-sell between products"),
    ("OBJ_REACTIVATION", "Reactivate dormant players"),
    ("OBJ_DIGITAL_SHIFT", "Shift retail players to digital"),
]

INCIDENT_CATEGORIES: list[tuple[str, str]] = [
    ("INC_PAYMENTS", "Payment processing failure"),
    ("INC_APP_STABILITY", "Application stability"),
    ("INC_DRAW_DELAY", "Draw execution delay"),
    ("INC_LOGIN", "Authentication outage"),
    ("INC_RETAIL_TERMINAL", "Retail terminal outage"),
]

SUPPORT_CATEGORIES: list[tuple[str, str]] = [
    ("SUP_PAYMENT", "Payment issue"),
    ("SUP_ACCOUNT", "Account access"),
    ("SUP_GAME_QUERY", "Game or rules query"),
    ("SUP_TECHNICAL", "Technical fault"),
]

SUPPLIERS: list[tuple[str, str]] = [
    ("SUP_MERIDIAN", "Meridian Platform Works"),
    ("SUP_HELIOTROPE", "Heliotrope Systems"),
    ("SUP_CORVID", "Corvid Analytics"),
    ("SUP_BLUEHARBOR", "BlueHarbor Payments"),
    ("SUP_STATIK", "Statik Identity"),
    ("SUP_ORPHEUS", "Orpheus Draw Systems"),
]

BUSINESS_CONCEPTS: list[tuple[str, str, str]] = [
    ("CONCEPT_NATIONAL_DRAW", "Game", "National draw lottery product"),
    ("CONCEPT_MULTINATIONAL_JACKPOT", "Game", "Multinational jackpot product"),
    ("CONCEPT_HIGH_FREQUENCY_GAME", "Game", "High-frequency number product"),
    ("CONCEPT_INSTANT_PRODUCT", "Game", "Instant-win product"),
    ("CONCEPT_ADD_ON_PRODUCT", "Game", "Supplementary add-on product"),
    ("CONCEPT_PROGRESSIVE_JACKPOT", "PrizeModel", "Progressive rolling jackpot"),
    ("CONCEPT_PLAYER_SEGMENT", "PlayerSegment", "Behavioural player cohort"),
    ("CONCEPT_RETAIL_CHANNEL", "Channel", "Physical retail sales channel"),
    ("CONCEPT_DIGITAL_CHANNEL", "Channel", "App and web sales channel"),
    ("CONCEPT_PLATFORM_INCIDENT", "BusinessEvent", "Platform incident affecting products"),
]

# ---------------------------------------------------------- product catalogue


@dataclass(frozen=True, slots=True)
class GameSpec:
    """One synthetic game. Prices are minor units of the market currency."""

    game_id: str
    market_code: str
    name: str
    family_id: str
    category_id: str
    mechanics: tuple[str, ...]
    price_minor: int
    digital: bool
    retail: bool
    draw_frequency: str  # "" | WEEKLY | TWICE_WEEKLY | DAILY
    jackpot_type: str
    prize_model: str
    launch_offset_days: int  # days before WINDOW_START


GAME_SPECS: tuple[GameSpec, ...] = (
    # United Kingdom
    GameSpec(
        "GAME_UK_01",
        "UK",
        "Albion Millions",
        "FAM_NATIONAL_DRAW",
        "CAT_DRAW",
        ("MECH_NUMBER_MATCH", "MECH_QUICK_PICK"),
        250,
        True,
        True,
        "TWICE_WEEKLY",
        "PROGRESSIVE",
        "PARIMUTUEL",
        800,
    ),
    GameSpec(
        "GAME_UK_02",
        "UK",
        "Kingsport Draw",
        "FAM_ANNUITY",
        "CAT_DRAW",
        ("MECH_NUMBER_MATCH",),
        300,
        True,
        True,
        "WEEKLY",
        "FIXED",
        "ANNUITY",
        700,
    ),
    GameSpec(
        "GAME_UK_03",
        "UK",
        "Thames Cash",
        "FAM_HIGH_FREQUENCY",
        "CAT_NUMBER",
        ("MECH_QUICK_PICK",),
        100,
        True,
        False,
        "DAILY",
        "FIXED",
        "PARIMUTUEL",
        600,
    ),
    GameSpec(
        "GAME_UK_04",
        "UK",
        "Union Raffle",
        "FAM_FIXED_PRIZE",
        "CAT_DRAW",
        ("MECH_SECOND_CHANCE",),
        150,
        True,
        True,
        "",
        "FIXED",
        "FIXED_ODDS",
        500,
    ),
    GameSpec(
        "GAME_UK_05",
        "UK",
        "Lioness Instant",
        "FAM_INSTANT_WIN",
        "CAT_INSTANT",
        ("MECH_SYMBOL_SCRATCH",),
        200,
        False,
        True,
        "",
        "FIXED",
        "FIXED_ODDS",
        400,
    ),
    GameSpec(
        "GAME_UK_06",
        "UK",
        "SwiftSix",
        "FAM_DIGITAL_INSTANT",
        "CAT_INSTANT",
        ("MECH_INSTANT_ROUNDS",),
        100,
        True,
        False,
        "",
        "FIXED",
        "FIXED_ODDS",
        300,
    ),
    # Greece
    GameSpec(
        "GAME_GR_01",
        "GR",
        "Aegean Gold",
        "FAM_NATIONAL_DRAW",
        "CAT_DRAW",
        ("MECH_NUMBER_MATCH", "MECH_QUICK_PICK"),
        200,
        True,
        True,
        "TWICE_WEEKLY",
        "PROGRESSIVE",
        "PARIMUTUEL",
        780,
    ),
    GameSpec(
        "GAME_GR_02",
        "GR",
        "Ellas Jackpot",
        "FAM_MULTINATIONAL_JACKPOT",
        "CAT_DRAW",
        ("MECH_NUMBER_MATCH",),
        250,
        True,
        True,
        "TWICE_WEEKLY",
        "PROGRESSIVE",
        "PARIMUTUEL",
        700,
    ),
    GameSpec(
        "GAME_GR_03",
        "GR",
        "Olympia Numbers",
        "FAM_HIGH_FREQUENCY",
        "CAT_NUMBER",
        ("MECH_QUICK_PICK",),
        100,
        True,
        False,
        "DAILY",
        "FIXED",
        "PARIMUTUEL",
        650,
    ),
    GameSpec(
        "GAME_GR_04",
        "GR",
        "Athena Express",
        "FAM_DIGITAL_INSTANT",
        "CAT_INSTANT",
        ("MECH_INSTANT_ROUNDS",),
        100,
        True,
        False,
        "",
        "FIXED",
        "FIXED_ODDS",
        500,
    ),
    GameSpec(
        "GAME_GR_05",
        "GR",
        "Peloponnesus Pull",
        "FAM_INSTANT_WIN",
        "CAT_INSTANT",
        ("MECH_SYMBOL_SCRATCH",),
        150,
        False,
        True,
        "",
        "FIXED",
        "FIXED_ODDS",
        450,
    ),
    # Austria
    GameSpec(
        "GAME_AT_01",
        "AT",
        "Danube Classic",
        "FAM_NATIONAL_DRAW",
        "CAT_DRAW",
        ("MECH_NUMBER_MATCH",),
        250,
        True,
        True,
        "TWICE_WEEKLY",
        "PROGRESSIVE",
        "PARIMUTUEL",
        760,
    ),
    GameSpec(
        "GAME_AT_02",
        "AT",
        "Alpen Jackpot",
        "FAM_MULTINATIONAL_JACKPOT",
        "CAT_DRAW",
        ("MECH_NUMBER_MATCH",),
        250,
        True,
        True,
        "TWICE_WEEKLY",
        "PROGRESSIVE",
        "PARIMUTUEL",
        700,
    ),
    GameSpec(
        "GAME_AT_03",
        "AT",
        "Wiener Zahlen",
        "FAM_HIGH_FREQUENCY",
        "CAT_NUMBER",
        ("MECH_QUICK_PICK",),
        100,
        True,
        False,
        "DAILY",
        "FIXED",
        "PARIMUTUEL",
        600,
    ),
    GameSpec(
        "GAME_AT_04",
        "AT",
        "Alpen Star",
        "FAM_ADD_ON",
        "CAT_SUPPLEMENTARY",
        ("MECH_SECOND_CHANCE",),
        100,
        True,
        True,
        "TWICE_WEEKLY",
        "FIXED",
        "FIXED_ODDS",
        400,
    ),
    GameSpec(
        "GAME_AT_05",
        "AT",
        "Edelweiss Instant",
        "FAM_INSTANT_WIN",
        "CAT_INSTANT",
        ("MECH_SYMBOL_SCRATCH",),
        200,
        False,
        True,
        "",
        "FIXED",
        "FIXED_ODDS",
        420,
    ),
    # Czech Republic
    GameSpec(
        "GAME_CZ_01",
        "CZ",
        "Praha Fortuna",
        "FAM_NATIONAL_DRAW",
        "CAT_DRAW",
        ("MECH_NUMBER_MATCH", "MECH_QUICK_PICK"),
        2000,
        True,
        True,
        "WEEKLY",
        "PROGRESSIVE",
        "PARIMUTUEL",
        740,
    ),
    GameSpec(
        "GAME_CZ_02",
        "CZ",
        "Moravia Multi",
        "FAM_MULTINATIONAL_JACKPOT",
        "CAT_DRAW",
        ("MECH_NUMBER_MATCH",),
        2500,
        True,
        True,
        "TWICE_WEEKLY",
        "PROGRESSIVE",
        "PARIMUTUEL",
        680,
    ),
    GameSpec(
        "GAME_CZ_03",
        "CZ",
        "Rychle Cisla",
        "FAM_HIGH_FREQUENCY",
        "CAT_NUMBER",
        ("MECH_QUICK_PICK",),
        1000,
        True,
        False,
        "DAILY",
        "FIXED",
        "PARIMUTUEL",
        560,
    ),
    GameSpec(
        "GAME_CZ_04",
        "CZ",
        "Stastny Kupon",
        "FAM_INSTANT_WIN",
        "CAT_INSTANT",
        ("MECH_SYMBOL_SCRATCH",),
        1500,
        False,
        True,
        "",
        "FIXED",
        "FIXED_ODDS",
        440,
    ),
)

PLATFORMS: list[tuple[str, str, str, str | None]] = [
    ("PLT_APP_IOS", "Mobile iOS Application", "APP", "SUP_MERIDIAN"),
    ("PLT_APP_ANDROID", "Mobile Android Application", "APP", "SUP_MERIDIAN"),
    ("PLT_WEB", "Web Portal", "WEB", "SUP_HELIOTROPE"),
    ("PLT_PAYMENTS", "Payments Gateway", "PAYMENTS", "SUP_BLUEHARBOR"),
    ("PLT_IDENTITY", "Identity Service", "IDENTITY", "SUP_STATIK"),
    ("PLT_DRAW", "Draw Engine", "DRAW", "SUP_ORPHEUS"),
    ("PLT_ANALYTICS", "Analytics Platform", "ANALYTICS", "SUP_CORVID"),
    ("PLT_RETAIL", "Retail Terminal Network", "RETAIL", "SUP_MERIDIAN"),
]
