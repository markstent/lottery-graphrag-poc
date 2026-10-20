# ADR-008 — Truth-Ledger Isolation Mechanism

**Decision:** The truth ledger is generated alongside the world into `data/truth/` (gitignored), is never written to the application database, Neo4j, Qdrant or the document store, and is loadable only from the evaluator namespace (`app/evaluation/`). The boundary is enforced by automated tests, not convention.

**Reason:** Retrieval systems must never access evaluator truth. The only reliable control at POC scale is structural: a separate store the retrieval code has no path to, plus a restricted module namespace, plus tests that fail CI if either is violated.

**Enforcement:**
- Generation writes `data/truth/ledger.json` with scenario truth keyed by `scenario_id`. `app/scenarios/ledger.py` is the single sanctioned writer; it references the truth path but never imports the loader.
- Only `app/evaluation/` may import the truth-ledger loader. A unit test statically scans every module under `app/retrieval/`, `app/api/`, `app/datasets/` and `app/graph/` for imports of the loader or references to the truth path and fails on any hit, and scans `app/scenarios/` for imports of the loader.
- An integration test generates a world with a planted scenario and asserts the ledger contents do not appear in any retrievable artefact: not in Parquet datasets, not in Qdrant payloads, not in Neo4j properties, not in SQLite run/event rows.
- The truth-ledger loader is not exposed through any API route.

**As built (Phase 4, Product API):**
- Two API modules may import `app.evaluation`: `app/api/benchmarks.py` (published runs, the question catalogue, benchmark jobs) and `app/api/scoring.py` (post-run scoring).
- Every other module under `app/api/` stays under the static scan above, and no `app/api/` module may name the truth path or the loader module; the two reach the ledger only through evaluator functions such as `app.evaluation.catalogue.question_catalogue`.
- The Help screen's hidden truths (owner-approved in the overhaul design, goal G6) are evaluator output served after the fact; no retrieval pipeline can reach them, because retrieval never imports `app.api` or `app.evaluation`.
- `test_only_two_api_modules_import_evaluation` and `test_api_reads_the_ledger_only_through_evaluation` enforce this.
- The two-module rule covers direct imports inside the API process: `app.main` imports both modules, so `app.evaluation` is loaded in that process, and what keeps it away from retrieval is that no retrieval module imports `app.api` or `app.evaluation`. The static scans see direct imports only, so a subprocess test (`test_the_lab_and_every_retrieval_module_load_no_evaluation_module`) imports `app.lab` and every `app.retrieval.*` module in a fresh interpreter and asserts that no `app.evaluation` module is loaded, directly or through a dependency.
- The trace CLI (`app/traces.py`) is not under the runtime rule, by choice. It runs the demo questions of the frozen bank, which is an evaluator artefact, and it gets them through `app.api.scoring.demo_questions` and `app.api.benchmarks.presentation_bank`, so `app.evaluation` is loaded as a dependency of that process. The alternatives were: (1) a small module outside `app.evaluation` that reads only the question texts from the bank file, which puts the answer keys in the same file the CLI opens and duplicates the bank format; (2) a separate demo-questions file written when the bank is grounded, which adds a second artefact that can go stale against the bank; (3) fetching `GET /demo/questions` from a running API, which makes a CLI that needs no server depend on one. None of them removes the evaluator from the repository's tooling, and the first two only hide it, so the CLI uses the one source of the demo set. It is therefore listed apart (`OPERATOR_TOOLS`), still held to the static rules (no direct `app.evaluation` import, no ledger name), and only each question's text reaches the pipelines. Revisit it if a second artefact for the demo set is ever wanted for another reason.

**Consequences:**
- Scoring reads the ledger only inside evaluation, after retrieval has completed and returned evidence.
- If a future feature legitimately needs truth (for example, a scenario-debugging view), it requires a new ADR and explicit owner approval, because it weakens experimental integrity.
