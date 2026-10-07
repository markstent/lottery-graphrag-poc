# Provenance Model

Every graph entity/evidence object must support:

```text
source_system
source_table_or_collection
source_record_id
source_timestamp
ingestion_version
```

Derived evidence additionally supports:

```text
derivation_method
derivation_version
confidence
```

Document-derived evidence supports:

```text
document_id
chunk_id
language
valid_from
valid_to
```
