// Example 4 — multilingual document lookup through canonical concepts.
// Documents are written in market languages (el/de/cs/en); the concept
// binding is language-independent, so an English concept id retrieves
// Greek, German and Czech documents in one query.
// Traversal class 3-4, bounded by LIMIT.
// Parameter: $concept_id (string), $limit (integer)

MATCH (document:Document)-[:REFERENCES]->(:Game)-[:INSTANCE_OF]->(concept:BusinessConcept {id: $concept_id})
RETURN DISTINCT document.id AS document_id,
       document.language_code AS language,
       document.title AS title
ORDER BY language, document_id
LIMIT $limit
