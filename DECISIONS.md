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
