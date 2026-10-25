# Data Dictionary

The authoritative field-level schema is `docs/01-synthetic-data-spec.md` sections 6 and 7.
The generator derives a machine-readable dictionary directly from the implemented schema
so the two cannot drift.

## Generated artefact

Every generation run writes `_data_dictionary.json` next to the Parquet datasets
(for example `data/generated/dev-seed2026/_data_dictionary.json`), one entry per field:

```json
{
  "table": "tickets",
  "field": "stake_amount",
  "type": "DECIMAL(12,2)",
  "position": 8,
  "primary_key": false,
  "source_system": "warehouse",
  "source_table": "tickets",
  "sensitivity": "none (synthetic)"
}
```

Metadata basis:

- `table`, `field`, `type`: parsed from the declared DDL in `backend/app/datasets/world.py`.
- `primary_key`: the first column of each table is the synthetic record identifier.
- `source_system` / `source_table`: provenance contract (`docs/data/source-system-contracts.md`), recorded per table in the generation manifest.
- `sensitivity`: all values are synthetic; no PII is generated (coarse age bands, no names, no exact dates of birth).

## Enforcement of integrity

Parquet has no constraint engine, so nullability, foreign keys, market/currency
consistency and time-order rules are enforced by `backend/app/datasets/validation.py`.
The CLI refuses to write a world that fails validation.

## Per-field generation rules

Field-level generation behaviour (distributions, segment weights, draw schedules)
is implemented in `backend/app/datasets/` and summarised in `docs/01-synthetic-data-spec.md`
sections 5 and 8. Graph mapping metadata is added when the ontology and ingestion
mappings are finalised (Phase 4 onward, gated by HITL-04).
