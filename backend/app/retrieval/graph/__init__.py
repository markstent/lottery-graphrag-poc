"""Graph-enhanced retrieval (docs/08 Phase 9).

Modules:

- resolution: deterministic entity resolution (graph seeds) and query expansion
- traversal: bounded breadth-first traversal with a provider seam
- ranking: transparent evidence scoring with recorded components
- source_lookup: authoritative structured-layer facts for graph nodes
- neo4j_adapter: read-side Neo4j wrappers over centralised statements
- pipeline: pipelines B/C (graph without/with ontology expansion)
"""

from __future__ import annotations

from app.retrieval.graph.pipeline import GraphRagPipeline

__all__ = ["GraphRagPipeline"]
