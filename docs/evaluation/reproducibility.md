# Reproducibility

Every benchmark run persists a provenance block as the `reproducibility`
object in its `results.json` (`app/evaluation/runner.py`):

- git SHA
- question bank version (`app.evaluation.bank.BANK_VERSION`)
- world directory, profile, world seed, scenario seed, generator version
  (from the world manifest)
- embedding model, generation model, generation parameters
- reranker configuration, top-k, context budget
- graph limits and relationship allow-list size
- ontology version (`app.graph.mapping.ONTOLOGY_VERSION`)

Run outputs live under `data/evaluation/run-<timestamp>/` as `results.json`
plus a rendered `report.md`. `data/` is not committed; committed evaluation
documents summarise runs and always name the command that produced them.

Determinism expectations: grounding and scoring are fully deterministic.
Retrieval is deterministic for fixed seeds, models and indices. Generation
with a local model at temperature 0 is reproducible in practice but its
prose is not part of any committed contract.
