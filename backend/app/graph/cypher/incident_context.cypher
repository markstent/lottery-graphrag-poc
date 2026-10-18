// Example 5: local incident context (Class 2: maximum two hops).
// Used to assemble incident context with provenance; the returned node ids
// are references into the authoritative structured layer for numeric facts.
// Parameter: $incident_id (string), $limit (integer)

MATCH (incident:Incident {id: $incident_id})
OPTIONAL MATCH (incident)-[:RELATED_TO]->(platform:Platform)
OPTIONAL MATCH (incident)-[:RELATED_TO_VERSION]->(version:PlatformVersion)
OPTIONAL MATCH (incident)-[:AFFECTS]->(game:Game)
RETURN incident.id AS incident_id,
       incident.severity AS severity,
       incident.started_at AS started_at,
       incident.source_system AS source_system,
       platform.id AS platform_id,
       version.id AS platform_version_id,
       collect(DISTINCT game.id)[..5] AS affected_games
LIMIT $limit
