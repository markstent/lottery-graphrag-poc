# Model Layer

## Development

OpenCode may use a hosted open-source coding model through OpenRouter.

## Application runtime

All model calls go through LiteLLM-compatible abstraction.

Supported providers:

- Ollama
- OpenRouter
- future MLX-compatible endpoint

## Fair benchmark mode

A/B/C must use the same model instance and parameters.

## Model roles

Separate configuration for:

- answer generation
- optional query/entity interpretation
- optional reranker/judge

Automated CI must use deterministic fake model adapters.
