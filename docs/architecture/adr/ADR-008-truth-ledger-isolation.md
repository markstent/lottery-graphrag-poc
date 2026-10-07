# ADR-008 — Truth-Ledger Isolation Mechanism

**Decision:** The truth ledger is generated alongside the world into `data/truth/` (gitignored), is never written to the application database, Neo4j, Qdrant or the document store, and is loadable only from the evaluator namespace (`app/evaluation/`). The boundary is enforced by automated tests, not convention.

**Reason:** Retrieval systems must never access evaluator truth. The only reliable control at POC scale is structural: a separate store the retrieval code has no path to, plus a restricted module namespace, plus tests that fail CI if either is violated.

**Enforcement:**
- Generation writes `data/truth/ledger.json` with scenario truth keyed by `scenario_id`.
- Only `app/evaluation/` may import the truth-ledger loader. A unit test statically scans every module under `app/retrieval/`, `app/api/`, `app/datasets/`, `app/scenarios/` and `app/graph/` for imports of the loader or references to the truth path and fails on any hit.
- An integration test generates a world with a planted scenario and asserts the ledger contents do not appear in any retrievable artefact: not in Parquet datasets, not in Qdrant payloads, not in Neo4j properties, not in SQLite run/event rows.
- The truth-ledger loader is not exposed through any API route.

**Consequences:**
- Scoring reads the ledger only inside evaluation, after retrieval has completed and returned evidence.
- If a future feature legitimately needs truth (for example, a scenario-debugging view), it requires a new ADR and explicit owner approval, because it weakens experimental integrity.
