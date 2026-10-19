"""Fixed master data and the synthetic product catalogue.

All names, suppliers and concepts are fictional. Market profiles follow
docs/01-synthetic-data-spec.md section 5; product categories section 10.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.datasets.rows import CurrencyRow, LanguageRow, MarketRow, RegionRow

# ---------------------------------------------------------------- markets ---

MARKET_CURRENCY: dict[str, str] = {"UK": "GBP", "GR": "EUR", "AT": "EUR", "CZ": "CZK"}

MARKETS: tuple[MarketRow, ...] = (
    MarketRow("MKT_UK", "UK", "United Kingdom", "GBP", "en", "Europe/London", 0.78, 0.71),
    MarketRow("MKT_GR", "GR", "Greece", "EUR", "el", "Europe/Athens", 0.54, 0.86),
    MarketRow("MKT_AT", "AT", "Austria", "EUR", "de", "Europe/Vienna", 0.62, 0.74),
    MarketRow("MKT_CZ", "CZ", "Czech Republic", "CZK", "cs", "Europe/Prague", 0.58, 0.69),
)

REGIONS: tuple[RegionRow, ...] = (
    RegionRow("REG_UK_NORTH", "MKT_UK", "UK Northern"),
    RegionRow("REG_UK_MIDLANDS", "MKT_UK", "UK Midlands"),
    RegionRow("REG_UK_LONDON", "MKT_UK", "UK London"),
    RegionRow("REG_UK_SOUTH", "MKT_UK", "UK Southern"),
    RegionRow("REG_GR_MAINLAND", "MKT_GR", "GR Mainland"),
    RegionRow("REG_GR_ISLANDS", "MKT_GR", "GR Islands"),
    RegionRow("REG_GR_PELOPONNESE", "MKT_GR", "GR Peloponnese"),
    RegionRow("REG_GR_CRETE", "MKT_GR", "GR Crete"),
    RegionRow("REG_AT_EAST", "MKT_AT", "AT Eastern"),
    RegionRow("REG_AT_ALPS", "MKT_AT", "AT Alpine"),
    RegionRow("REG_AT_SOUTH", "MKT_AT", "AT Southern"),
    RegionRow("REG_AT_URBAN", "MKT_AT", "AT Urban Corridor"),
    RegionRow("REG_CZ_WEST", "MKT_CZ", "CZ Western"),
    RegionRow("REG_CZ_MORAVIA", "MKT_CZ", "CZ Moravian"),
    RegionRow("REG_CZ_SILESIA", "MKT_CZ", "CZ Silesian"),
    RegionRow("REG_CZ_PRAGUE", "MKT_CZ", "CZ Prague Region"),
)

CURRENCIES: tuple[CurrencyRow, ...] = (
    CurrencyRow("GBP", "Pound sterling"),
    CurrencyRow("EUR", "Euro"),
    CurrencyRow("CZK", "Czech koruna"),
)
LANGUAGES: tuple[LanguageRow, ...] = (
    LanguageRow("en", "English"),
    LanguageRow("el", "Greek"),
    LanguageRow("de", "German"),
    LanguageRow("cs", "Czech"),
)
CHANNELS: list[tuple[str, str]] = [
    ("APP", "Mobile application"),
    ("WEB", "Web portal"),
    ("RETAIL", "Retail terminal"),
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


SUPPLIERS: list[tuple[str, str]] = [
    ("SUP_MERIDIAN", "Meridian Platform Works"),
    ("SUP_HELIOTROPE", "Heliotrope Systems"),
    ("SUP_CORVID", "Corvid Analytics"),
    ("SUP_BLUEHARBOR", "BlueHarbor Payments"),
    ("SUP_STATIK", "Statik Identity"),
    ("SUP_ORPHEUS", "Orpheus Draw Systems"),
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
        "FAM_UK_NATIONAL_DRAW",
        "CAT_UK_DRAW",
        ("MECH_UK_NUMBER_MATCH", "MECH_UK_QUICK_PICK"),
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
        "FAM_UK_ANNUITY",
        "CAT_UK_DRAW",
        ("MECH_UK_NUMBER_MATCH",),
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
        "FAM_UK_RAPID_NUMBERS",
        "CAT_UK_NUMBERS",
        ("MECH_UK_QUICK_PICK",),
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
        "FAM_UK_FIXED_PRIZE",
        "CAT_UK_DRAW",
        ("MECH_UK_SECOND_CHANCE",),
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
        "FAM_UK_SCRATCHCARD",
        "CAT_UK_INSTANT",
        ("MECH_UK_SCRATCH",),
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
        "FAM_UK_ONLINE_INSTANT",
        "CAT_UK_INSTANT",
        ("MECH_UK_INSTANT_ROUNDS",),
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
        "FAM_GR_ARITHMOLACHEIO",
        "CAT_GR_KLIROSEIS",
        ("MECH_GR_EPILOGI_ARITHMON", "MECH_GR_TYCHAIA_EPILOGI"),
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
        "FAM_GR_POLYETHNIKO_TZAKPOT",
        "CAT_GR_KLIROSEIS",
        ("MECH_GR_EPILOGI_ARITHMON",),
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
        "FAM_GR_SYCHNES_KLIROSEIS",
        "CAT_GR_ARITHMOPAICHNIDIA",
        ("MECH_GR_TYCHAIA_EPILOGI",),
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
        "FAM_GR_PSIFIAKO_STIGMIAIO",
        "CAT_GR_STIGMIAIA",
        ("MECH_GR_AMESOI_GYROI",),
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
        "FAM_GR_STIGMIAIO",
        "CAT_GR_STIGMIAIA",
        ("MECH_GR_XYSIMO",),
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
        "FAM_AT_ZAHLENZIEHUNG",
        "CAT_AT_ZIEHUNG",
        ("MECH_AT_ZAHLENWAHL",),
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
        "FAM_AT_LAENDER_JACKPOT",
        "CAT_AT_ZIEHUNG",
        ("MECH_AT_ZAHLENWAHL",),
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
        "FAM_AT_SCHNELLZIEHUNG",
        "CAT_AT_ZAHLEN",
        ("MECH_AT_SCHNELLWAHL",),
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
        "FAM_AT_ZUSATZSPIEL",
        "CAT_AT_ZUSATZ",
        ("MECH_AT_ZWEITE_CHANCE",),
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
        "FAM_AT_RUBBELLOS",
        "CAT_AT_SOFORT",
        ("MECH_AT_RUBBELN",),
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
        "Vltava Výhra",
        "FAM_CZ_CISELNA_LOTERIE",
        "CAT_CZ_LOSOVANI",
        ("MECH_CZ_VYBER_CISEL", "MECH_CZ_NAHODNY_TIP"),
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
        "FAM_CZ_MEZINARODNI_JACKPOT",
        "CAT_CZ_LOSOVANI",
        ("MECH_CZ_VYBER_CISEL",),
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
        "FAM_CZ_RYCHLA_CISLA",
        "CAT_CZ_CISLA",
        ("MECH_CZ_NAHODNY_TIP",),
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
        "FAM_CZ_STIRACI_LOS",
        "CAT_CZ_OKAMZITE",
        ("MECH_CZ_STIRANI",),
        1500,
        False,
        True,
        "",
        "FIXED",
        "FIXED_ODDS",
        440,
    ),
)

PLATFORMS: list[tuple[str, str, str, str]] = [
    ("PLT_APP_IOS", "Mobile iOS Application", "APP", "SUP_MERIDIAN"),
    ("PLT_APP_ANDROID", "Mobile Android Application", "APP", "SUP_MERIDIAN"),
    ("PLT_WEB", "Web Portal", "WEB", "SUP_HELIOTROPE"),
    ("PLT_PAYMENTS", "Payments Gateway", "PAYMENTS", "SUP_BLUEHARBOR"),
    ("PLT_IDENTITY", "Identity Service", "IDENTITY", "SUP_STATIK"),
    ("PLT_DRAW", "Draw Engine", "DRAW", "SUP_ORPHEUS"),
    ("PLT_ANALYTICS", "Analytics Platform", "ANALYTICS", "SUP_CORVID"),
    ("PLT_RETAIL", "Retail Terminal Network", "RETAIL", "SUP_MERIDIAN"),
]
