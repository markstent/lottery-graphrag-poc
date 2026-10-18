"""Named distribution constants for world generation.

Every constant shapes one aspect of the synthetic world and carries a one-line
comment. Generators import from here so each value has exactly one definition.
"""

from __future__ import annotations

# Share of each market in the overall player population.
MARKET_SPLIT: dict[str, float] = {"UK": 0.32, "GR": 0.28, "AT": 0.22, "CZ": 0.18}
# Share of retailers located in each market.
MARKET_RETAIL_SHARE: dict[str, float] = {"UK": 0.30, "GR": 0.26, "AT": 0.24, "CZ": 0.20}
# Share of devices registered in each market.
MARKET_DEVICE_SHARE: dict[str, float] = {"UK": 0.32, "GR": 0.27, "AT": 0.22, "CZ": 0.19}

# Share of players who also use a second device.
SECOND_DEVICE_SHARE = 0.08
# Share of players whose payment instrument is shared with another player.
SHARED_PAYMENT_SHARE = 0.04
# Number of distinct payment instruments that shared-payment players draw from.
SHARED_PAYMENT_POOL_SIZE = 80

# Player value segment weights (high, medium, low).
VALUE_SEGMENT_WEIGHTS = (0.10, 0.55, 0.35)
# Player engagement segment weights (engaged, casual, dormant).
ENGAGEMENT_SEGMENT_WEIGHTS = (0.30, 0.45, 0.25)
# Mean digital affinity per market.
DIGITAL_AFFINITY_MEAN: dict[str, float] = {"UK": 0.60, "GR": 0.45, "AT": 0.45, "CZ": 0.45}
# Standard deviation of digital affinity within a market.
DIGITAL_AFFINITY_SD = 0.2

# Pareto shape for per-player activity, producing a heavy-tailed play volume.
PLAYER_ACTIVITY_PARETO_ALPHA = 1.6
# Activity multiplier per engagement segment kind code.
ENGAGEMENT_ACTIVITY_BOOST: dict[str, float] = {"ENGAGED": 1.5, "CASUAL": 1.0, "DORMANT": 0.15}

# Probability that a draw produces a jackpot winner.
DRAW_WIN_PROBABILITY = 0.25
# Jackpot growth multiplier applied on each rollover.
ROLLOVER_FACTOR = 1.4
# Maximum jackpot in minor currency units.
JACKPOT_CAP_MINOR = 200_000_000_00

# Share of retail tickets sold without a player account.
ANONYMOUS_RETAIL_SHARE = 0.15
# Share of tickets that are voided.
VOID_TICKET_SHARE = 0.01
# Share of tickets that win a prize.
PRIZE_WIN_SHARE = 0.35
# Share of won prizes that are claimed.
PRIZE_CLAIM_SHARE = 0.8

# Share of sessions running the dominant app version.
DOMINANT_APP_VERSION_SHARE = 0.45
# Session outcome probabilities.
SESSION_OUTCOME_WEIGHTS: dict[str, float] = {
    "COMPLETE": 0.78,
    "ABANDONED": 0.14,
    "FAIL_PAYMENT": 0.08,
}

# Share of campaign exposures that lead to engagement.
EXPOSURE_ENGAGED_SHARE = 0.30
# Share of engaged exposures that convert.
EXPOSURE_CONVERSION_SHARE = 0.25

# Share of incidents that span more than one market.
CROSS_MARKET_INCIDENT_SHARE = 0.12
# Share of incidents that are resolved.
INCIDENT_RESOLVED_SHARE = 0.9
# Share of resolved incidents with a recorded root cause.
INCIDENT_ROOT_CAUSE_SHARE = 0.4
# Incident severity probabilities.
SEVERITY_WEIGHTS = (("LOW", 0.40), ("MEDIUM", 0.35), ("HIGH", 0.20), ("CRITICAL", 0.05))

# Share of support cases linked to an incident.
SUPPORT_INCIDENT_LINK_SHARE = 0.15
# Share of support cases linked to a player.
SUPPORT_PLAYER_LINK_SHARE = 0.6
# Share of support cases linked to a game.
SUPPORT_GAME_LINK_SHARE = 0.6
# Share of support cases that are closed.
SUPPORT_CLOSED_SHARE = 0.85

# Share of market documents written in English rather than the local language.
MARKET_DOCUMENT_ENGLISH_SHARE = 0.30
# Share of entity mentions that use the name only, without an identifier.
MENTION_NAME_ONLY_SHARE = 0.5

# Payment provider mix per market.
PROVIDER_MIX: dict[str, dict[str, float]] = {
    "UK": {"PP_BLUEHARBOR": 0.55, "PP_NORTHGATE": 0.45},
    "GR": {"PP_BLUEHARBOR": 0.40, "PP_CONTINENTAL": 0.35, "PP_AEGEAN_PAY": 0.25},
    "AT": {"PP_BLUEHARBOR": 0.40, "PP_CONTINENTAL": 0.35, "PP_ALPENKASSE": 0.25},
    "CZ": {"PP_BLUEHARBOR": 0.40, "PP_CONTINENTAL": 0.35, "PP_VLTAVA_PAY": 0.25},
}
