"""Reference routes: the ontology, the scenario catalogue and the configured
models (overhaul design section 7.6).

The ontology is read from the repository's YAML, the scenarios from the
catalogue and the active dataset's manifest (``scenarios.applied``: what was
planted, never where or why - the truth ledger is evaluator-only and is not
read here), and the models from configuration with their reachability
(``ModelReachability``, cached for 30 s). Nothing here queries Neo4j.
"""

from __future__ import annotations

import json
from functools import cache
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request

from app.api.data_model import WORLD_MANIFEST_NAME, active_dataset_dir
from app.api.errors import ApiError, ErrorCode
from app.api.readiness import ReadinessChecks
from app.api.schemas import (
    ConceptOut,
    MemberOut,
    ModelOut,
    ModelsOut,
    OntologyOut,
    ScenarioOut,
    error_responses,
)
from app.config import GenerationSettings, RetrievalSettings, from_env, judge_settings_from_env
from app.datasets.master_data import MARKETS
from app.datasets.taxonomies import local_names
from app.ontology.loader import load_ontology
from app.ontology.model import Concept, Ontology
from app.retrieval.standard.sparse import resolve_sparse_provider
from app.scenarios.catalogue import SCENARIO_CATALOGUE

SHARED = "shared"
MARKET_IDS = frozenset(market_id for market_id, *_rest in MARKETS)
IN_PROCESS = "runs in process"


@cache
def _ontology() -> Ontology:
    return load_ontology()


def _concept(ontology: Ontology, concept: Concept) -> ConceptOut:
    bindings = ontology.codes_for(concept.concept_id)
    counts: dict[str, int] = {}
    for binding in bindings:
        key = binding.market_id or SHARED
        counts[key] = counts.get(key, 0) + 1
    relationships = []
    if concept.parent_id is not None or ontology.children(concept.concept_id):
        relationships.append("IS_A")
    if bindings:
        relationships.append("MAPS_TO")
    return ConceptOut(
        concept_id=concept.concept_id,
        parent_id=concept.parent_id,
        definition=concept.definition,
        labels=dict(concept.labels),
        synonyms={language: list(words) for language, words in concept.synonyms.items()},
        relationships=relationships,
        binding_counts=counts,
    )


def _applied_scenarios() -> dict[str, dict[str, Any]]:
    """The active dataset's applied scenarios by id; none when it has no manifest."""
    path = active_dataset_dir() / WORLD_MANIFEST_NAME
    if not path.is_file():
        return {}
    manifest = json.loads(path.read_text(encoding="utf-8"))
    return {
        entry["scenario_id"]: entry for entry in manifest.get("scenarios", {}).get("applied", [])
    }


def _model_out(provider: str, model: str, reachable: bool | None, detail: str) -> ModelOut:
    return ModelOut(provider=provider, model=model, reachable=reachable, detail=detail)


def _in_process(provider: str, model: str, loaded: bool) -> ModelOut:
    return _model_out(provider, model, True if loaded else None, "loaded" if loaded else IN_PROCESS)


def _judge_model(checks: ReadinessChecks, settings: RetrievalSettings) -> ModelOut | None:
    """The benchmark judge, null while the offline judge is set; an invalid
    JUDGE_* setting is reported in the entry, not as a failure of the route."""
    try:
        judge = judge_settings_from_env()
    except ValueError as error:
        return _model_out("invalid", "", False, str(error))
    if judge.provider == "fake":
        return None
    probed = checks.model.check(
        GenerationSettings(
            provider=judge.provider,
            model=judge.model,
            temperature=judge.temperature,
            api_base=judge.api_base,
            model_family=judge.model_family,
            reasoning=judge.reasoning,
        ),
        settings.embedding.host or None,
    )
    return _model_out(judge.provider, judge.model, probed.ok, probed.detail)


# What a model reads on the public read-only site, which runs none (D-117).
NOT_RUN_PUBLIC = "not run on the public read-only site"


def build_reference_router(public_mode: bool = False) -> APIRouter:
    """The reference reads; on the public site the models are named but never probed."""
    router = APIRouter()

    @router.get("/ontology", response_model=OntologyOut, responses=error_responses())
    def read_ontology() -> OntologyOut:
        ontology = _ontology()
        return OntologyOut(
            version=ontology.version,
            concepts=[_concept(ontology, concept) for concept in ontology.concepts],
        )

    @router.get(
        "/ontology/concepts/{concept_id}/members",
        response_model=list[MemberOut],
        responses=error_responses(404, 422),
    )
    def read_members(
        concept_id: str, market: Annotated[str | None, Query()] = None
    ) -> list[MemberOut]:
        ontology = _ontology()
        if concept_id not in {concept.concept_id for concept in ontology.concepts}:
            raise ApiError(404, ErrorCode.NOT_FOUND, f"no ontology concept {concept_id}")
        if market is not None and market not in MARKET_IDS:
            raise ApiError(422, ErrorCode.VALIDATION_ERROR, f"unknown market: {market}")
        names = local_names()
        return [
            MemberOut(
                kind=binding.kind,
                code=binding.code,
                market_id=binding.market_id,
                name=names.get((binding.kind, binding.code)),
            )
            for binding in ontology.codes_for(concept_id)
            if market is None or binding.market_id == market
        ]

    @router.get("/scenarios", response_model=list[ScenarioOut], responses=error_responses())
    def read_scenarios() -> list[ScenarioOut]:
        applied = _applied_scenarios()
        scenarios = []
        for spec in SCENARIO_CATALOGUE:
            if not spec.enabled:
                continue
            entry = applied.get(spec.scenario_id)
            scenarios.append(
                ScenarioOut(
                    scenario_id=spec.scenario_id,
                    scenario_type=spec.scenario_type,
                    title=spec.scenario_type.replace("_", " ").capitalize(),
                    description=spec.description,
                    planted=entry is not None,
                    planted_rows=dict(entry["planted_rows"]) if entry else {},
                    strength=entry["strength"] if entry else None,
                    noise_level=entry["noise_level"] if entry else None,
                )
            )
        return scenarios

    @router.get("/models", response_model=ModelsOut, responses=error_responses())
    def read_models(request: Request) -> ModelsOut:
        checks: ReadinessChecks = request.app.state.readiness
        lab, _state = request.app.state.query_service.lab_status()
        settings: RetrievalSettings = lab.settings if lab is not None else from_env()
        loaded = lab is not None
        embedding: tuple[bool | None, str]
        generation: tuple[bool | None, str]
        if public_mode:
            # Named, never probed: no model runs on the public site.
            embedding = generation = (None, NOT_RUN_PUBLIC)
            judge_model = None
        else:
            dense = checks.model.check_embedding(settings.embedding)
            answer = checks.model.check(settings.generation, settings.embedding.host or None)
            embedding, generation = (dense.ok, dense.detail), (answer.ok, answer.detail)
            judge_model = _judge_model(checks, settings)
        return ModelsOut(
            embedding=_model_out(settings.embedding.provider, settings.embedding.model, *embedding),
            sparse=_in_process(
                resolve_sparse_provider(settings.embedding), settings.embedding.sparse_model, loaded
            ),
            rerank=_in_process(settings.rerank.provider, settings.rerank.model, loaded),
            generation=_model_out(
                settings.generation.provider, settings.generation.model, *generation
            ),
            judge=judge_model,
        )

    return router
