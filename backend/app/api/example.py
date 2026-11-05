"""The Data Model Overview example: one incident the screen follows through
the tables, the graph and the ontology (data model redesign, Overview).

The rule, over the active world's ``incidents`` table in ``incident_id``
order: leave out every incident whose id, platform version or app version
the world's truth ledger names, then take the first whose platform version
is also the version of an incident left in another market (a null market is
a market of its own), else the first one left, else none. No part of the
example's path is planted, because the Overview would then point at a
story's answer.

This is one of the three API modules that may import ``app.evaluation``
(ADR-008): it asks the evaluator which identifiers are planted and answers
with the example's id only. When the active world has no ledger of its own
the planted check cannot be made, so there is no example, and the reason is
logged; the rule is never applied without the check.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Sequence
from pathlib import Path

import duckdb
from fastapi import APIRouter

from app.api.data_model import active_dataset_dir
from app.api.errors import ApiError, ErrorCode
from app.api.schemas import DataModelExample, error_responses
from app.evaluation.official import NoMatchingLedger, presentation_planted_ids

logger = logging.getLogger(__name__)

INCIDENTS_FILE = "incidents.parquet"

# (incident_id, market_id, platform_version_id, app_version_id)
IncidentRow = tuple[str, str | None, str | None, str | None]


def _incidents(world: Path) -> list[IncidentRow]:
    """The world's incidents in id order; a world without the table is a 404."""
    path = world / INCIDENTS_FILE
    if not path.is_file():
        raise ApiError(404, ErrorCode.NOT_FOUND, f"dataset {world.name} has no table incidents")
    with duckdb.connect() as connection:
        rows = connection.execute(
            "SELECT incident_id, market_id, platform_version_id, app_version_id "
            "FROM read_parquet(?) "
            "ORDER BY incident_id",
            [str(path)],
        ).fetchall()
    return [(row[0], row[1], row[2], row[3]) for row in rows]


def _choose(incidents: Sequence[IncidentRow], planted: frozenset[str]) -> str | None:
    """The example of ``incidents`` (in id order) once ``planted`` is left out."""
    kept = [row for row in incidents if planted.isdisjoint((row[0], row[2], row[3]))]
    markets: defaultdict[str, set[str | None]] = defaultdict(set)
    for _incident, market, version, _app_version in kept:
        if version is not None:
            markets[version].add(market)
    for incident, _market, version, _app_version in kept:
        if version is not None and len(markets[version]) > 1:
            return incident
    return kept[0][0] if kept else None


def build_example_router() -> APIRouter:
    router = APIRouter()

    @router.get(
        "/data-model/example", response_model=DataModelExample, responses=error_responses(404)
    )
    def read_example() -> DataModelExample:
        try:
            planted = presentation_planted_ids()
        except NoMatchingLedger as error:
            logger.warning("no example incident", extra={"reason": str(error)})
            return DataModelExample(incident_id=None)
        return DataModelExample(incident_id=_choose(_incidents(active_dataset_dir()), planted))

    return router
