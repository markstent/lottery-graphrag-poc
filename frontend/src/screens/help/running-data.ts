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

/** Every Makefile target, by what it is for. A test checks that each target is here and that each command exists. */
export const COMMAND_GROUPS: readonly {
  group: string
  rows: readonly [string, string][]
}[] = [
  {
    group: 'Develop',
    rows: [
      ['make help', 'List the targets.'],
      ['make setup', 'Install the Python, frontend and browser dependencies.'],
      ['make dev', 'Run the API and the screens together.'],
      ['make dev-backend', 'Run the API alone, on port 8000, with reload.'],
      ['make dev-frontend', 'Run the screens alone, on the Vite dev server.'],
      ['make test', 'Backend and frontend unit tests, offline; no live graph.'],
      ['make test-graph', 'The live graph tests. They wipe Neo4j.'],
      ['make lint', 'ruff and oxlint.'],
      ['make typecheck', 'mypy and the TypeScript checks.'],
      ['make format', 'ruff and Prettier formatting.'],
      ['make build', 'Build the frontend for production.'],
      [
        'make api-contract',
        'Export the OpenAPI schema and regenerate the frontend types.',
      ],
      ['make e2e', 'Build the frontend and run the Playwright tests.'],
    ],
  },
  {
    group: 'Data and services',
    rows: [
      ['make services-up', 'Start Neo4j and Qdrant in Docker.'],
      ['make services-down', 'Stop and remove them.'],
      ['make pull-models', 'Pull the embedding model, bge-m3, into Ollama.'],
      [
        'make generate-dev-data',
        'Generate the dev world, seed 2026, and its truth ledger.',
      ],
      ['make ingest-graph', 'Wipe Neo4j and load the dev world into it.'],
      [
        'make index-vector',
        'Build the passage and record-text index in Qdrant.',
      ],
      [
        'make traces',
        'Write docs/evaluation/example-traces.md with the stand-in answer model; needs the dev graph and index.',
      ],
    ],
  },
  {
    group: 'Demo world',
    rows: [
      [
        'make generate-demo-data',
        'Generate the larger demo world (5 million tickets) with its own ledger.',
      ],
      ['make ingest-demo-graph', 'Load the demo world into Neo4j.'],
      ['make index-demo-vector', 'Build the demo index in its own collection.'],
      ['make serve-demo-api', 'Serve the API against the demo world.'],
      [
        'make demo-reset',
        'Load the demo graph and index again; restart the demo API after.',
      ],
      [
        'make ground-demo-bank',
        'Ground the question bank into the demo world.',
      ],
    ],
  },
  {
    group: 'Benchmark',
    rows: [
      [
        'make ground-bank',
        'Ground and freeze the question bank for the active world.',
      ],
      [
        'make run-smoke',
        'Quick check: score three worlds with the stand-in models; needs the services.',
      ],
      [
        'make dry-run',
        'Four questions on world 2026 with the official settings; owner approval first.',
      ],
      [
        'make run-benchmark',
        'Official run: three worlds, 3 repeats. OUT=DIR names it; OUT=DIR RESUME=1 resumes it.',
      ],
      [
        'make run-sweep',
        'Depth sweep: the H1 questions for B and C at depths 0 to 3, on three worlds.',
      ],
      [
        'make diagnose-selection',
        'Read-only: which claims each approach finds and which reach the prompt, on world 2026 with no answer model.',
      ],
    ],
  },
]
