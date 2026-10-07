"""Graph ingestion and Neo4j overlay (Phase 4).

Modules:
- config: environment-derived connection settings
- mapping: pure derivation functions (ontology bindings, similarity, aggregates)
- reader: Parquet dataset reader
- statements: centralised Cypher (docs/02-graph-schema-spec.md section 11)
- ingest: idempotent ingestion pipeline
"""

from __future__ import annotations
