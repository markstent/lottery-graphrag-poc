// Example 1b: ontology-assisted cross-market product lookup (Class 4).
// Every market names its game families with local codes, so family edges
// alone never connect markets. Local families that bind (MAPS_TO) to the
// same canonical concept unify, so the ontology path finds the peers.
// Parameter: $game_id (string), $limit (integer)

MATCH (seed:Game {id: $game_id})
MATCH (seed)-[:BELONGS_TO]->(:GameFamily)-[:MAPS_TO]->(concept:BusinessConcept)
MATCH (peer:Game)-[:BELONGS_TO]->(:GameFamily)-[:MAPS_TO]->(concept)
WHERE peer.market_id <> seed.market_id
OPTIONAL MATCH (peer)-[:HAS_MECHANIC]->(mechanic:GameMechanic)
RETURN concept.id AS shared_concept_id,
       peer.id AS peer_game_id,
       peer.name AS peer_name,
       collect(DISTINCT mechanic.mechanic_code)[..3] AS mechanics
ORDER BY shared_concept_id, peer_game_id
LIMIT $limit
