# Owner Decisions

Record explicit project-owner decisions here.

| ID | Date | Decision | Rationale | Affects |
|---|---|---|---|---|
| D-001 | Initial | Synthetic markets are UK, Greece, Austria and Czech Republic. | Required project scope. | Data, ontology, UX |
| D-002 | Initial | Real company name must never appear. | Synthetic POC requirement. | Entire repo |
| D-003 | Initial | The word `Atlas` must not be used as a project/system/codename. | Conflicts with an existing internal system. | Naming |
| D-004 | Initial | Neo4j is an augmentation layer over the existing data layer. | Main POC thesis. | Architecture |
| D-005 | Initial | Product must visually compare RAG and graph-enhanced retrieval. | Presentation requirement. | UX |
| D-006 | Initial | Actual graph traversal must be visible and replayable. | Demonstration requirement. | Backend events, UX |
| D-007 | Initial | OpenCode + a hosted open-source model may build the software; runtime must support local open models. | Development/runtime separation. | Model layer |
| D-008 | 2026-10-07 | Frontend routing uses a ~40-line hash router instead of adding react-router. | Seven static routes with one query parameter each; a dependency cannot be justified for this surface. Revisit only if routes gain nested layouts or guards. | Frontend |
| D-009 | 2026-10-07 | Playwright visual baselines run locally only (separate config, not in CI) with maxDiffPixelRatio 0.02. | Font rendering differs between macOS and Linux CI; committed baselines are the HITL-07 approved screenshots and are regenerated on the owning machine. | Frontend, CI |
| D-010 | 2026-10-07 | Vector layer uses `qdrant-client`; embeddings call Ollama over `httpx`; generation uses `litellm` behind the ADR-003 gateway contract with a deterministic fake default in CI. | Implements the approved ADR-002/ADR-003 architecture with the smallest direct API surfaces. | Retrieval, CI |
| D-011 | 2026-10-07 | Retrieval consumes the generation-time `document_chunks.parquet` as the single chunk source; Qdrant point ids are deterministic UUIDs derived from chunk ids with `check_compatibility` disabled. | One corpus for A/B/C fairness; chunk ids stay stable across rebuilds; no outbound phone-home from the vector client. | Retrieval, datasets |
| D-012 | 2026-10-18 | PyYAML is added as the ontology source format. | The ontology is a nested, multilingual document that is edited by hand; YAML keeps it readable and is the single source for concepts and bindings. | Ontology, dependencies |
| D-013 | 2026-10-18 | Channel codes stay shared across markets while every other taxonomy is market-local. | Channels are genuinely common across the four operators, whereas families, categories, mechanics, incident types, support categories and segments are what each source system names for itself. | Data, ontology, graph |
| D-014 | 2026-10-19 | Planted ids continue the table sequences and carry no scenario marker. | Retrieval must not be able to infer a plant from an identifier; scenario membership lives in the truth ledger only. | Scenarios, data |
| D-015 | 2026-10-19 | KPIs are derived after planting; injectors never edit `kpi_daily`. | Derived KPIs stay consistent with the rows they summarise, so no aggregate can contradict its source. | Scenarios, data |
| D-016 | 2026-10-19 | Scenario targets are drawn from the scenario seed among eligible candidates. | Different scenario seeds then plant different targets, and the same seed reproduces the same plant. | Scenarios, evaluation |
| D-017 | 2026-10-19 | Pipeline B's allow-list excludes exactly the ontology relationship types, and the per-question fraud profile is removed. | B is C minus the ontology, which isolates the value of the ontology; question-specific profiles would bias the comparison. | Retrieval, experiment |
| D-018 | 2026-10-19 | Every label the ranking treats as structured resolves to an authoritative source table. | Numerical and factual claims must come from the source layer, so ranked structured evidence needs a source record to cite. | Retrieval, provenance |
