# Lean Engineering Principles

## Objective

Build the smallest codebase that correctly satisfies the product requirements, experimental integrity, UX requirements and test suite.

## Principles

### 1. Minimum sufficient code

Every module, class, abstraction and dependency must have a concrete purpose.

### 2. Cohesion over layering

Organise code around responsibilities rather than conventional enterprise layer counts.

### 3. Directness

Prefer a direct typed call over an additional indirection layer when there is no genuine boundary to protect.

### 4. Real abstractions only

Introduce an abstraction when there are multiple real implementations, an external system must be replaceable, a test seam is necessary, or a domain boundary is being enforced.

### 5. Minimal dependencies

A dependency should remove more complexity than it introduces.

### 6. No speculative framework building

Do not build generic infrastructure for hypothetical future requirements.

### 7. Test behaviour

Tests should verify observable behaviour and critical contracts, not mirror implementation structure.

### 8. Refactor from evidence

Refactor because duplication, coupling, poor cohesion or defects exist, not because a design pattern could be applied.

## Examples

Prefer:

```text
query_service.py
```

containing a cohesive query orchestration service over:

```text
query_manager.py
query_factory.py
query_provider.py
query_repository.py
query_adapter.py
```

when those layers simply pass data through.

Prefer one shared Pydantic model at the API/domain boundary when appropriate rather than creating mechanically duplicated DTO/domain/entity objects with one-to-one mapping.

Prefer a small model gateway interface because Ollama and OpenRouter are real interchangeable implementations.

Prefer a graph repository/query module because Neo4j is a real external dependency and query logic must be centralised.

## Completion check

Before marking a task complete, identify any new abstraction or dependency and state why it is necessary. If it cannot be justified concretely, remove it.
