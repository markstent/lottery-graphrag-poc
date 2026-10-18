// Example 2: cross-market incident transfer THROUGH the ontology.
// Plain graph relationships contain no Incident-to-Incident edges, so this
// path only exists via MAPS_TO canonical concepts. This is the canonical
// demonstration of ontology value beyond plain graph relationships.
// Traversal class 4 (ontology-assisted), bounded by LIMIT.
// Parameter: $incident_id (string), $limit (integer)

MATCH (incident:Incident {id: $incident_id})
MATCH (incident)-[:MAPS_TO]->(concept:BusinessConcept)
MATCH (peer:Incident)-[:MAPS_TO]->(concept)
WHERE peer.id <> incident.id
  AND (peer.market_id IS NULL OR incident.market_id IS NULL OR peer.market_id <> incident.market_id)
OPTIONAL MATCH (peer)-[:AFFECTS]->(affected:Game)
RETURN concept.id AS concept_id,
       peer.id AS peer_incident_id,
       peer.market_id AS peer_market_id,
       peer.severity AS severity,
       collect(DISTINCT affected.id)[..3] AS affected_games
ORDER BY concept_id, peer_incident_id
LIMIT $limit
