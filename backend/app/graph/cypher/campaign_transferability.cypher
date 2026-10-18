// Example 3: campaign transferability across markets via segment concepts.
// Player segments are market-local; a campaign's engaged segment and a peer
// campaign's segment in another market bind (MAPS_TO) to the same canonical
// segment concept. The peers' promoted games are the transferable products.
// Traversal class 4 (ontology-assisted), bounded by LIMIT.
// Parameter: $campaign_id (string), $limit (integer)

MATCH (campaign:Campaign {id: $campaign_id})
MATCH (campaign)-[:TARGETS]->(:PlayerSegment)-[:MAPS_TO]->(concept:BusinessConcept)
MATCH (peer:Campaign)-[:TARGETS]->(:PlayerSegment)-[:MAPS_TO]->(concept)
WHERE peer.market_id <> campaign.market_id
MATCH (peer)-[:PROMOTES]->(game:Game)
RETURN peer.id AS peer_campaign_id,
       peer.market_id AS peer_market_id,
       concept.id AS shared_segment_concept_id,
       collect(DISTINCT game.id)[..3] AS promoted_games
ORDER BY peer_campaign_id
LIMIT $limit
