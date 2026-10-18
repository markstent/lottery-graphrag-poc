"""Scenario catalogue (docs/04-scenario-catalogue.md section 2).

Static scenario configuration. Which scenarios are planted is not secret;
the truth ledger (what exactly was planted where) is evaluator-only.

Eight scenarios are enabled, covering the distinct signal surfaces: an app
release cohort failure with incident, document and KPI evidence (SCN-001),
graph topology (SCN-002, SCN-003), cross-market operational incidents
(SCN-007), an intermittent payment provider degradation visible only through
payment-method links before any incident (SCN-009), ontology-dependent
cross-market patterns over local mechanic, family and segment codes (SCN-010,
SCN-011), and document/structured conflict (SCN-015). The remaining catalogue
entries are registered but disabled; enabling one means implementing its
injector and registering it in app/scenarios/plant.py, not flipping a flag.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class ScenarioSpec:
    """Configuration for one scenario type (docs/04 section 2)."""

    scenario_id: str
    scenario_type: str
    description: str
    strength: float  # 0.2 subtle, 0.5 moderate, 0.8 strong, 1.0 obvious
    noise_level: str
    expected_signals: tuple[str, ...]
    benchmark_questions: tuple[str, ...] = field(default_factory=tuple)
    enabled: bool = False


SCENARIO_CATALOGUE: tuple[ScenarioSpec, ...] = (
    ScenarioSpec(
        "SCN-001",
        "app_release_conversion_failure",
        "A new app release introduces a checkout problem for a device/OS cohort.",
        0.8,
        "moderate",
        (
            "lower checkout completion for one app version cohort",
            "higher abandoned sessions",
            "elevated support contacts after release",
        ),
        ("Why did digital participation fall?", "Which cohort was most affected?"),
        enabled=True,
    ),
    ScenarioSpec(
        "SCN-002",
        "shared_device_cluster",
        "A group of accounts is unusually connected through shared devices.",
        0.8,
        "low",
        (
            "high device-sharing connectivity between accounts",
            "time-coordinated purchase activity",
            "normal-looking individual transactions",
        ),
        (
            "Which accounts show unusual device connectivity?",
            "Is the cluster evidence of wrongdoing or only of coordination?",
        ),
        enabled=True,
    ),
    ScenarioSpec(
        "SCN-003",
        "shared_payment_cluster",
        "Multiple accounts share a small number of payment instruments.",
        0.8,
        "low",
        (
            "abnormal shared-instrument topology",
            "normal spend per account",
            "cross-account overlap on few instruments",
        ),
        (
            "Which accounts share payment instruments abnormally?",
            "How many accounts form the connected component?",
        ),
        enabled=True,
    ),
    ScenarioSpec(
        "SCN-004",
        "promotion_driven_product_migration",
        "A campaign causes a cohort to migrate from one product family to another.",
        0.5,
        "moderate",
        ("shift in product mix after campaign exposure",),
    ),
    ScenarioSpec(
        "SCN-005",
        "product_cannibalisation",
        "A new product grows while a structurally similar existing product shrinks.",
        0.5,
        "moderate",
        ("flat category spend with opposing product trends",),
    ),
    ScenarioSpec(
        "SCN-006",
        "jackpot_halo_effect",
        "A large jackpot increases activity in related products.",
        0.5,
        "moderate",
        ("cross-product activity increase around a large jackpot",),
    ),
    ScenarioSpec(
        "SCN-007",
        "cross_market_platform_incident",
        "A shared platform version causes similar symptoms across several markets.",
        0.8,
        "moderate",
        (
            "incidents on one platform version in multiple markets with graded severity",
            "release/deferral document explaining an unaffected market",
            "checkout KPI degradation in the most affected market",
        ),
        (
            "Have we seen this problem elsewhere?",
            "Which other markets used the same platform version?",
            "Why was one market unaffected?",
        ),
        enabled=True,
    ),
    ScenarioSpec(
        "SCN-008",
        "campaign_audience_mismatch",
        "A campaign performs poorly because its audience has low mechanic affinity.",
        0.5,
        "moderate",
        ("high exposure with low conversion for one segment",),
    ),
    ScenarioSpec(
        "SCN-009",
        "payment_provider_degradation",
        "One payment provider degrades intermittently across products.",
        0.5,
        "moderate",
        ("elevated payment failure rate tied to one provider",),
        enabled=True,
    ),
    ScenarioSpec(
        "SCN-010",
        "game_mechanic_affinity",
        "A segment performs strongly on products sharing a mechanic across markets.",
        0.8,
        "low",
        ("cross-market mechanic affinity for one segment",),
        enabled=True,
    ),
    ScenarioSpec(
        "SCN-011",
        "transferable_campaign",
        "A successful campaign has a structurally similar transfer target elsewhere.",
        0.5,
        "low",
        ("similar segment and product structure across markets",),
        enabled=True,
    ),
    ScenarioSpec(
        "SCN-012",
        "support_complaint_precursor",
        "Support complaints rise before KPI reporting shows degradation.",
        0.5,
        "moderate",
        ("complaint topic cluster preceding metric decline",),
    ),
    ScenarioSpec(
        "SCN-013",
        "retailer_regional_anomaly",
        "A set of retailers in one region shows unusual performance.",
        0.5,
        "moderate",
        ("regional retailer outlier pattern with competing explanations",),
    ),
    ScenarioSpec(
        "SCN-014",
        "digital_adoption_shift",
        "A cohort migrates from retail to digital over several months.",
        0.5,
        "moderate",
        ("channel migration with device uptake and stable player value",),
    ),
    ScenarioSpec(
        "SCN-015",
        "document_structured_conflict",
        "A document carries outdated guidance while structured records are current.",
        0.8,
        "low",
        (
            "document asserts a value that contradicts the authoritative table",
            "document validity window marks it superseded",
        ),
        (
            "What is the current ticket price for the game?",
            "Why does the rules document disagree with the source record?",
        ),
        enabled=True,
    ),
)

BY_ID = {spec.scenario_id: spec for spec in SCENARIO_CATALOGUE}
ENABLED: tuple[str, ...] = tuple(spec.scenario_id for spec in SCENARIO_CATALOGUE if spec.enabled)
