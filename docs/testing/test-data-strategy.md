# Test Data Strategy

Use three classes:

1. tiny deterministic fixtures for unit tests
2. development profile for integration/E2E
3. demo profile for presentation/live benchmark

CI must not generate the full demo dataset unless explicitly configured.
