# ADR-006 — DuckDB over Parquet for the Structured Data Layer

**Decision:** The synthetic structured data layer is stored as deterministic Parquet datasets queried through DuckDB (embedded, in-process).

**Reason:** Runtime access is read-heavy and analytical (ticket counts, conversion rates, incident correlations, KPI questions). DuckDB answers these aggregations quickly at Dev (250k tickets), Demo (5m) and Stress (50m) scale on laptop hardware. Generation is deterministic batch output, which maps directly to Parquet files. DuckDB adds zero services to run: no extra container, server or credential surface, keeping the POC lean.

**Consequences:**

- Configuration A performs "SQL/API-style retrieval" as SQL over DuckDB views of the Parquet datasets.
- Graph ingestion, vector ingestion and document generation all read the same Parquet artefacts.
- Parquet datasets are the canonical generated artefact under `data/generated/` (gitignored); regeneration replaces files atomically.
- Rows are written through Arrow tables (`pyarrow`), DuckDB's native interchange; row-by-row INSERT was measured at ~30x slower for the development profile.
- Provenance (source system, table, key, ingestion version) is recorded per table in the generation manifest rather than repeated as constant columns on every row; Phase 4 materialises these properties onto graph nodes.
- Numeric authority for final answers stays in this layer, per the graph augmentation principle.
- DuckDB is an embedded engine: single backend process, no concurrent writers. Acceptable for a single-operator POC; revisit only if multi-user runtime is ever required (not a stated goal).
- Rejected alternatives: PostgreSQL (adds an always-on service and ops for no retrieval benefit; OLTP strengths unused), SQLite (fine at Dev scale but slower columnar aggregation at Demo/Stress and no Parquet interop).
