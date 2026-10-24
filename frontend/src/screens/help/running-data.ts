/** What Running it lists. Every `make` command is a Makefile target, and a test checks it. */

export const BRING_UP: readonly [string, string][] = [
  ['make setup', 'Install the Python, frontend and browser dependencies.'],
  [
    'make services-up',
    'Start Neo4j and Qdrant in Docker. Ollama runs on the host.',
  ],
  ['make pull-models', 'Pull the embedding model into Ollama.'],
  ['make generate-dev-data', 'Generate the synthetic world.'],
  ['make ingest-graph', 'Load the world into Neo4j.'],
  ['make index-vector', 'Build the passage index in Qdrant.'],
  ['make ground-bank', 'Fit the question bank to this world.'],
  [
    'make dev',
    'Run the API and the screens together, then open localhost:5173.',
  ],
]

export const RECOVERY: readonly [string, string, string][] = [
  [
    'A service is down',
    'make services-up',
    'The model status in the header names the check that failed.',
  ],
  [
    'The graph is empty or holds another world',
    'make ingest-graph',
    'The graph must hold the presentation world, the dev world for 2026.',
  ],
  [
    'Text search finds nothing',
    'make index-vector',
    'The passage index is missing or was built for another world.',
  ],
  [
    'The embedding model is not listed',
    'make pull-models',
    'Start Ollama first. It must be running on the host.',
  ],
  [
    'The answer model is not listed',
    'ollama pull <model>',
    'Use the model named in GENERATION_MODEL. make pull-models pulls only the embedding model.',
  ],
]

export const MODELS: readonly [string, string, string][] = [
  [
    'Answer model',
    'GENERATION_PROVIDER, GENERATION_MODEL',
    'Set in .env. The recorded Live Lab runs used qwen3.6 through Ollama.',
  ],
  [
    'Embedding model',
    'EMBEDDING_PROVIDER, EMBEDDING_MODEL',
    'bge-m3 through Ollama.',
  ],
  [
    'Re-ordering model',
    'RERANK_PROVIDER, RERANK_MODEL',
    'BAAI/bge-reranker-v2-m3, run in process.',
  ],
  [
    'Judge model',
    'JUDGE_PROVIDER, JUDGE_MODEL',
    'Another model family than the answer model.',
  ],
]
