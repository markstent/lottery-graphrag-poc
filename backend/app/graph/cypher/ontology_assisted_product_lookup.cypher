// Example 1b — ontology-assisted cross-market product lookup (Class 4).
// Two instant-product families (retail instant, digital instant) unify under
// one canonical concept, so the ontology path finds peers that the family
// edges alone would miss.
// Parameter: $game_id (string), $limit (integer)

MATCH (seed:Game {id: $game_id})
MATCH (seed)-[:INSTANCE_OF]->(concept:BusinessConcept)
MATCH (peer:Game)-[:INSTANCE_OF]->(concept)
WHERE peer.market_id <> seed.market_id
OPTIONAL MATCH (peer)-[:HAS_MECHANIC]->(mechanic:GameMechanic)
RETURN concept.id AS shared_concept_id,
       peer.id AS peer_game_id,
       peer.name AS peer_name,
       collect(DISTINCT mechanic.mechanic_code)[..3] AS mechanics
ORDER BY shared_concept_id, peer_game_id
LIMIT $limit
