// Example 3: campaign transferability across markets via shared segments.
// A campaign's engaged segment maps to the same segment concept in other
// markets; their promoted games are the transferable products.
// Traversal class 3, bounded by LIMIT.
// Parameter: $campaign_id (string), $limit (integer)

MATCH (campaign:Campaign {id: $campaign_id})
MATCH (campaign)-[:TARGETS]->(segment:PlayerSegment)
MATCH (peer:Campaign)-[:TARGETS]->(segment)
WHERE peer.market_id <> campaign.market_id
MATCH (peer)-[:PROMOTES]->(game:Game)
RETURN peer.id AS peer_campaign_id,
       peer.market_id AS peer_market_id,
       segment.id AS shared_segment_id,
       collect(DISTINCT game.id)[..3] AS promoted_games
ORDER BY peer_campaign_id
LIMIT $limit
