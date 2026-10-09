"""The 30-question benchmark bank (docs/05-benchmark-spec.md section 15,
docs/evaluation/question-bank.md).

The bank is the logical question set. Grounding into concrete record ids for
one generated world happens in ``app.evaluation.grounding``; the evaluator
truth ledger is only ever consulted there, never by retrieval.

Questions whose home scenario is not planted in the configured world ground
to ``NOT_PLANTED`` and are reported but never scored, so the benchmark never
invents truth.
"""

from __future__ import annotations

from dataclasses import dataclass

BANK_VERSION = "1.0.0"

# Difficulty levels follow docs/05-benchmark-spec.md section 3.
CATEGORY_DIFFICULTY: dict[str, int] = {
    "FACT": 1,
    "SEMANTIC": 2,
    "RELATIONSHIP": 3,
    "TWO_HOP": 4,
    "MULTI_HOP": 4,
    "CROSS_DOMAIN": 5,
    "CROSS_MARKET": 6,
    "ONTOLOGY": 6,
    "PATTERN": 6,
    "TEMPORAL_ONTOLOGY": 6,
}


@dataclass(frozen=True, slots=True)
class BankQuestion:
    """One logical benchmark question (docs/05 section 4 record, logical part)."""

    question_id: str
    category: str
    markets: tuple[str, ...]
    # Logical question text; {anchor} placeholders are filled with concrete
    # record ids at grounding time so pipelines always see real ids.
    template: str
    binding_key: str
    # Scenario the question needs planted truth from. None for base-world
    # questions; a scenario id that is not planted in this world makes the
    # question NOT_PLANTED (reported, not scored).
    scenario_id: str | None = None
    # "fraud" adds the player-instrument/device edges to the traversal
    # allow-list for this question (SCN-003 pattern); None = default profile.
    profile: str | None = None


def _q(
    question_id: str,
    category: str,
    markets: tuple[str, ...],
    template: str,
    binding_key: str,
    scenario_id: str | None = None,
    profile: str | None = None,
) -> BankQuestion:
    return BankQuestion(
        question_id=question_id,
        category=category,
        markets=markets,
        template=template,
        binding_key=binding_key,
        scenario_id=scenario_id,
        profile=profile,
    )


BANK: tuple[BankQuestion, ...] = (
    _q(
        "Q01",
        "FACT",
        ("UK",),
        "What is the configured ticket price of the synthetic UK flagship draw game {anchor}?",
        "game_price",
    ),
    _q(
        "Q02",
        "FACT",
        ("GR",),
        "Which channels offer the selected Greek high-frequency game {anchor}?",
        "game_channels",
    ),
    _q(
        "Q03",
        "FACT",
        ("AT",),
        "What platform version was active for the selected Austrian digital "
        "game {anchor} on the target date {target_date}?",
        "platform_version",
    ),
    _q(
        "Q04",
        "FACT",
        ("CZ",),
        "How many synthetic support cases were recorded for the selected "
        "Czech game {anchor} in the target week beginning {week_start}?",
        "support_count",
    ),
    _q(
        "Q05",
        "SEMANTIC",
        ("UK",),
        "Summarise the mechanics of the synthetic UK annuity-style game {anchor}.",
        "product_mechanics",
    ),
    _q(
        "Q06",
        "SEMANTIC",
        ("GR",),
        "Which support documents are most relevant to checkout problems for "
        "the selected Greek game {anchor}?",
        "support_retrieval",
    ),
    _q(
        "Q07",
        "SEMANTIC",
        ("AT",),
        "Which release note best explains changes to the selected Austrian mobile flow {anchor}?",
        "release_retrieval",
    ),
    _q(
        "Q08",
        "SEMANTIC",
        ("CZ",),
        "Which synthetic experiment report is most relevant to the selected "
        "Czech product {anchor}?",
        "experiment_retrieval",
    ),
    _q(
        "Q09",
        "RELATIONSHIP",
        ("UK",),
        "Which player segment has the strongest affinity with the selected "
        "game mechanic of {anchor}?",
        "segment_mechanic",
    ),
    _q(
        "Q10",
        "RELATIONSHIP",
        ("GR",),
        "Which platform supports the selected Greek digital game {anchor}?",
        "game_platform",
    ),
    _q(
        "Q11",
        "RELATIONSHIP",
        ("AT",),
        "Which campaign promoted the selected Austrian game {anchor} during the target period?",
        "campaign_game",
    ),
    _q(
        "Q12",
        "RELATIONSHIP",
        ("CZ",),
        "Which incidents are directly connected to the selected Czech platform {anchor}?",
        "platform_incident",
    ),
    _q(
        "Q13",
        "TWO_HOP",
        ("UK",),
        "Which games run on the platform associated with the selected UK incident {anchor}?",
        "incident_platform_games",
    ),
    _q(
        "Q14",
        "TWO_HOP",
        ("GR",),
        "Which player segments were affected by the incident linked to the "
        "selected Greek app version?",
        "version_incident_segment",
        "SCN-001",
    ),
    _q(
        "Q15",
        "TWO_HOP",
        ("AT",),
        "Which game mechanics are shared by games targeted by the selected "
        "Austrian campaign {anchor}?",
        "campaign_games_mechanics",
    ),
    _q(
        "Q16",
        "TWO_HOP",
        ("CZ",),
        "Which support cases relate to incidents affecting the selected Czech game {anchor}?",
        "game_incident_support",
    ),
    _q(
        "Q17",
        "MULTI_HOP",
        ("GR",),
        "Why did digital conversion fall for the selected Greek game after the target release?",
        "app_release_conversion_failure",
        "SCN-001",
    ),
    _q(
        "Q18",
        "MULTI_HOP",
        ("AT",),
        "Which other products may have been affected by the same underlying "
        "platform issue as the selected Austrian game {anchor}?",
        "shared_platform_issue",
    ),
    _q(
        "Q19",
        "MULTI_HOP",
        ("UK",),
        "Did the selected campaign cause players to migrate between product families?",
        "promotion_product_migration",
        "SCN-004",
    ),
    _q(
        "Q20",
        "MULTI_HOP",
        ("CZ",),
        "Is the selected product launch cannibalising another structurally similar Czech game?",
        "product_cannibalisation",
        "SCN-005",
    ),
    _q(
        "Q21",
        "CROSS_DOMAIN",
        ("GR",),
        "Did support complaints provide an earlier signal of the selected "
        "Greek incident {anchor} than KPI reporting?",
        "support_precursor",
        "SCN-007",
    ),
    _q(
        "Q22",
        "CROSS_DOMAIN",
        ("UK",),
        "Did a large jackpot create measurable halo activity in related synthetic UK products?",
        "jackpot_halo",
        "SCN-006",
    ),
    _q(
        "Q23",
        "CROSS_DOMAIN",
        ("AT",),
        "Why did the selected Austrian campaign {anchor} underperform despite high exposure?",
        "campaign_mismatch",
        "SCN-008",
    ),
    _q(
        "Q24",
        "CROSS_DOMAIN",
        ("CZ",),
        "What best explains the selected regional retailer anomaly?",
        "retailer_anomaly",
        "SCN-013",
    ),
    _q(
        "Q25",
        "CROSS_MARKET",
        ("GR", "AT", "CZ", "UK"),
        "Have we seen the selected Greek platform problem {anchor} in another market?",
        "cross_market_platform_incident",
        "SCN-007",
    ),
    _q(
        "Q26",
        "ONTOLOGY",
        ("UK", "AT"),
        "Which Austrian product is structurally most similar to the "
        "synthetic UK flagship draw game {anchor}, and why?",
        "cross_market_product_similarity",
    ),
    _q(
        "Q27",
        "ONTOLOGY",
        ("GR", "CZ"),
        "Which Czech product is most comparable to the selected Greek "
        "high-frequency game {anchor} based on canonical mechanics?",
        "ontology_equivalence",
    ),
    _q(
        "Q28",
        "PATTERN",
        ("CZ", "GR"),
        "Are the case accounts {anchor} connected to wider account clusters "
        "through shared devices or payment instruments?",
        "shared_identity_cluster",
        "SCN-002",
        "fraud",
    ),
    _q(
        "Q29",
        "CROSS_MARKET",
        ("AT", "CZ"),
        "Which successful Austrian campaign appears most transferable to a "
        "Czech product and segment?",
        "campaign_transferability",
        "SCN-011",
    ),
    _q(
        "Q30",
        "TEMPORAL_ONTOLOGY",
        ("UK",),
        "Where do current structured facts for the synthetic UK flagship "
        "draw game {anchor} conflict with older documentation, and which "
        "source should be treated as authoritative?",
        "document_structured_conflict",
        "SCN-015",
    ),
)


def question_by_id(question_id: str) -> BankQuestion:
    for question in BANK:
        if question.question_id == question_id:
            return question
    raise KeyError(f"unknown benchmark question: {question_id!r}")
