// Example 1a — structural similarity across markets (graph relationships only).
// Traversal class 1-2; bounded by LIMIT and the SIMILAR_TO whitelist.
// Parameter: $game_id (string), $limit (integer)

MATCH (seed:Game {id: $game_id})
MATCH (seed)-[similar:SIMILAR_TO]->(other:Game)
RETURN other.id AS game_id,
       other.name AS name,
       other.market_id AS market_id,
       similar.score AS similarity,
       similar.method AS method
ORDER BY similarity DESC, game_id
LIMIT $limit
