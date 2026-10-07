# Existing Data Layer Integration

The synthetic source layer models how graph augmentation can be added to an existing enterprise data platform.

## Source categories

- relational/analytical facts
- documents
- telemetry
- support
- campaigns
- operational events

## Graph mapping

Source entities are mapped to graph entities with stable provenance.

Example:

```text
source games row
 -> Game node

source incident row
 -> Incident node

release note chunk
 -> DocumentChunk node
 -> REFERENCES Incident
```

The agent may use graph traversal to discover what source records should be queried next.
