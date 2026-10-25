# Backend Architecture

Suggested modules:

```text
app/
  api/
  config/
  domain/
  datasets/
  scenarios/
  retrieval/
    standard/
    graph/
  ontology/
  graph/
  models/
  evidence/
  evaluation/
  events/
  persistence/
  observability/
```

Route handlers remain thin.

Domain services own behaviour.

Evaluator must be isolated from retrieval engines.

Truth-ledger code must be in a restricted evaluator namespace.
