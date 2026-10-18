"""Scenario injector registry (docs/04-scenario-catalogue.md).

Maps each enabled scenario id to its injector. Injectors plant into an
already generated world through a `ScenarioPlanter`, drawing every target
from their own scenario stream; the pipeline validates the combined world
after injection.
"""

from __future__ import annotations

from collections.abc import Callable

from app.scenarios.inject_checkout import (
    plant_app_release_conversion_failure,
    plant_payment_provider_degradation,
)
from app.scenarios.inject_documents import plant_document_structured_conflict
from app.scenarios.inject_operations import plant_cross_market_platform_incident
from app.scenarios.inject_topology import plant_shared_device_cluster, plant_shared_payment_cluster
from app.scenarios.planter import ScenarioPlanter

PLANTERS: dict[str, Callable[[ScenarioPlanter], None]] = {
    "SCN-001": plant_app_release_conversion_failure,
    "SCN-002": plant_shared_device_cluster,
    "SCN-003": plant_shared_payment_cluster,
    "SCN-007": plant_cross_market_platform_incident,
    "SCN-009": plant_payment_provider_degradation,
    "SCN-015": plant_document_structured_conflict,
}
