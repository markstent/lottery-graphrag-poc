"""Graph ingestion and Neo4j overlay (Phase 4).

Modules:
- config: environment-derived connection settings
- mapping: pure derivation functions (ontology bindings, similarity, aggregates)
- reader: Parquet dataset reader
- node_rows: source tables and ontology to node rows (provenance, validity)
- relationship_rows: source tables, aggregates and ontology to relationship rows
- statements: centralised Cypher (docs/02-graph-schema-spec.md section 11)
- ingest: idempotent ingestion pipeline, count verification and run stats
"""

from __future__ import annotations
