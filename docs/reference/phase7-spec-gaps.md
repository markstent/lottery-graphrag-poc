# Phase 7 code versus archived specification gaps

These are places where the code and an archived specification disagree, found while writing the ten primary documents in Phase 7.
The primary documents follow the code.
Each item says what the code does, what the archived document says, and where.
The numbering continues the list in the Phase 7 working notes, where gaps 1 and 2 (the dev server proxy and the `.env` loader) were fixed in the code and are not repeated here.
The owner decides, for each item, whether the code or the specification should change.
Decision D-071 records the rule.

3. **Incident validity window.**
   `docs/reference/data/graph-ingestion.md:99` says Incident `valid_to` is `resolved_at`.
   `backend/app/graph/node_rows.py:393-394` writes no `valid_to` for an incident (as the archived `02-graph-schema-spec.md` as-built part says).
4. **Readiness check count.**
   D-038 (`DECISIONS.md:44`) says four checks (`lab`, `index`, `graph`, `model`).
   `backend/app/api/readiness.py:282-290` runs five, adding `embedding`.
   The archived `07-api-event-spec.md` and the Settings and header code agree with the code.
   The Screen specification (`docs/reference/ux/screen-specifications.md`, section 0.1) lists four names, and `frontend/src/app/shell.tsx:118-124` has five.
5. **Truth-ledger integration test.**
   ADR-008 describes an integration test that ledger contents appear in no Parquet table, Qdrant payload, Neo4j property or SQLite row.
   `backend/tests/test_truth_ledger_isolation.py:223-243` checks only that four marker words are absent from the manifest and that table files start with `PAR1`.
   The static scan (lines 40-100) is wider than ADR-008 says: it covers eleven namespaces and `lab.py`.
   `docs/architecture.md` states what is tested.
6. **Data Model warehouse map.**
   `docs/reference/ux/screen-specifications.md:348` and `HITL_STATUS.md:94` say the real dictionary has one source system and the map is one 27-table group.
   The seed 2026 dictionary has 39 tables in seven source systems (27 warehouse, 3 release management, 3 campaign platform, 2 document store, 2 incident management, 1 telemetry, 1 support), and `frontend/src/screens/data-model/model.ts:56-66` groups by source system, so the map has seven groups.
   The fixture `frontend/e2e/fixtures/data-model-world.json` also has seven systems.
   The baseline image `data-model-warehouse-map` was not viewed.
7. **ADR-006 consequence.**
   ADR-006 says configuration A runs SQL over DuckDB at query time.
   Pipeline A reads the vector index only; DuckDB reads Parquet at index build and for the source lookup, the corpus and the Data Model routes (`retrieval/standard/records.py:439`, `corpus.py:141`).
8. **Router comment and D-008.**
   `frontend/src/app/router.ts:4` cites D-011 for the hash router, but the decision is D-008 (D-011 is the chunk source).
   D-008 says seven static routes, and the router has five (`router.ts:16-47`).
9. **Failure taxonomy.**
   `docs/reference/evaluation/failure-taxonomy.md` lists ten classes.
   `backend/app/evaluation/scoring.py:64-78` produces three: `entity_resolution_failure`, `retrieval_failure`, `generation_failure`.
10. **H4 path explainability.**
    The archived hypotheses say H4 covers provenance and evidence-path explainability.
    `backend/app/evaluation/` has no explainability metric (`bank.py:5` names it as a metric of every question, but `report.py` METRICS holds only citation accuracy and the numeric citation rate).
11. **Stale instance id in the API spec.**
    `docs/reference/07-api-event-spec.md:183,199` uses `L05-2026-INC_S007_GR`.
    Real ids are `L05-2026-INC_037` form (frozen bank, `frontend/src/run/fixtures/recorded/index.json`), and D-014 says planted ids carry no scenario marker.
12. **Stale comments in operational files.**
    `Makefile:102` prints "restart serve-demo-api to clear in-memory runs", but runs are stored in SQLite.
    `docker-compose.yml:1-3` says "Phase 0 skeleton".
    `Makefile:66-72` labels targets "(Phase 3)", "(Phase 4)" and "(Phase 8)".
13. **Run kind `recorded`.**
    `backend/app/persistence/store.py:31` allows `kind` `recorded`, and the archived ADR-007 says recorded runs are never pruned, but no API code creates one.
14. **`.env.example` rerank default.**
    `.env.example:48-51` says an unset `RERANK_PROVIDER` means lexical under the hashing embedder, then sets `RERANK_PROVIDER=cross_encoder` explicitly.
    Exporting the whole file keeps the cross-encoder in a hashing setup.
15. **Settings drawer contents.**
    The Screen specification (section 0.1) says Settings holds reduced motion and the node cap.
    `frontend/src/app/settings-drawer.tsx:41-118` also shows the world and model names, seeds and versions, as the archived information architecture says.
16. **Copy budget numbers.**
    D-055 says the count is 1,200 outside Help.
    `frontend/src/copy/budget.ts` comment and the Screen specification say 1,298 after the Phase 7 copy pass, with caps of 1,300 and 1,650 (`budget.ts:18,21`).
17. **Chunk size in the design.**
    The overhaul design (section 5.1) says 128 to 256 token windows.
    The built rule is at most 160 words (`backend/app/datasets/distributions.py:103`).
18. **Archived pages that describe superseded state.**
    `docs/reference/demo/presentation.md` (four scenarios, "Demo story" source, v1 benchmark numbers, in-memory run state), `docs/reference/testing/coverage.md` (127 tests, 5 baselines), `docs/reference/architecture/system-architecture.md` section 11 (four scenarios, lexical re-rank) and `frontend/README.md` (v1 views "remain until Phase 6") no longer match the code.
    The first three are archived and replaced; `frontend/README.md` is a live file that is stale.
19. **ADR-005.**
    ADR-005 leaves the graph library open; D-043 chose React Flow with elkjs layout.

## Changes since this list was written

Gap 12 is closed: the Makefile labels, the `demo-reset` message and the `docker-compose.yml` header were corrected in a later Phase 7 commit.
Gap 16 is settled by D-066, which records the copy cap as built.
In gap 18, `frontend/README.md` is now a pointer to the primary documents, so only the three archived pages still describe superseded state.

## Found while writing Help v2 (2026-10-27)

Help follows the code in each case.

20. **Record texts in the document channel of B and C.**
    `docs/retrieval.md:102` says the document channel "drops exactly their record blocks", and `docs/retrieval.md:264` says B's document candidates are A's minus the record blocks of B's nodes.
    `backend/app/retrieval/graph/stages.py:501-521` (`document_channel`) keeps every search hit, and `backend/app/retrieval/standard/context.py` refuses a record block as `superseded_by_structured_fact` only when its node holds a graph slot (D-081).
    `backend/tests/test_lab_fairness.py:200` is named `test_b_judges_exactly_a_documents_including_its_nodes_record_blocks`.
    `docs/retrieval.md:184-186` already describes the code; the two older sentences predate D-081.
21. **Scenario noise level.**
    `docs/scenarios.md:96` describes `noise_level` as "how much noise surrounds" the signal, and the archived `docs/reference/04-scenario-catalogue.md` section 20 asks for tests that "unrelated noise also exists".
    In the code `noise_level` is a label only: `backend/app/scenarios/catalogue.py:30` declares it, `engine.py:78` and `ledger.py:39` record it, and no injector reads it.
    Strength, by contrast, scales the planted volume (`backend/app/scenarios/planter.py:121-122`).
22. **A citation of a block that was not shown.**
    `docs/evaluation.md:171` says such a citation "counts as inaccurate".
    `backend/app/retrieval/standard/generation.py:146-150` (`parse_answer`) keeps only citations of blocks 1 to the number shown, and `backend/app/evaluation/runner.py:703-705` passes those to `citation_metrics`, so the out-of-range branch in `backend/app/evaluation/checks.py:179` never sees one.
    The citation is dropped, and an answer that cites only unshown blocks has an undefined citation accuracy, not 0.
    Help chapters 6 and 7 and the glossary follow the code.
23. **Help's purpose sentence.**
    The overhaul design (`docs/superpowers/specs/2026-10-18-overhaul-design.md:295`) gives Help the purpose "How it works in plain language, every benchmark question with its answer key, glossary, how to run it".
    Help v2 has a Plain and a Technical level, and the purpose sentence shows at both, so `frontend/src/app/router.ts:48` drops "in plain language".
