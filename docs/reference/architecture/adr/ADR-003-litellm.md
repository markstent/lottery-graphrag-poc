# ADR-003 — LiteLLM-Compatible Model Gateway

**Decision:** All runtime model calls use a provider abstraction compatible with local Ollama and hosted OpenRouter endpoints.

**Reason:** Makes model location swappable and supports fair comparisons.
