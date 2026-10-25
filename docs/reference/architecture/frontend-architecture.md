# Frontend Architecture

## Suggested structure

```text
src/
  app/
  api/
  domain/
  features/
    experiments/
    live-lab/
    evidence/
    scenarios/
    benchmark/
    results/
    semantic-layer/
  components/
  design-system/
  graph/
  state/
  test/
```

## Principles

- TypeScript strict
- API/domain DTO separation
- event-driven live state
- graph rendering isolated from domain logic
- Storybook for major components
- no scoring logic inside presentation components
- presentation mode as view configuration only
