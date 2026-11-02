import type { ChapterCopy } from '../chapters'

export const company: ChapterCopy = {
  plain: [
    'The company is made up: a lottery operator in four markets, the United Kingdom, Greece, Austria and the Czech Republic. A market is one country the company works in. No player, customer, employee or document in it exists.',
    'It holds what such an operator would hold: players and their tickets, games and draws, shops that sell tickets, campaigns, incidents and support cases. It also holds the release history of its apps and platforms, and documents such as release notes, incident reports and game rules. Documents are in English, Greek, German and Czech.',
    'Each market works like a separate company on its own systems. It has its own codes and its own names for the same kinds of thing. Nothing in the data says that two markets mean the same thing. That is the gap the ontology, the shared dictionary, fills.',
    'Each row in a table, such as one game or one incident, is a record. A record has a reference code, such as INC_022 for an incident.',
    'Why made up. The questions need answers that are known in advance. A story can be planted on purpose only in data we generate (chapter 3). Made-up data also holds nothing private. And it can be built again, identically, from the same settings.',
    'The system can build the company more than once, with different random draws. Each copy is called a world. Every world has the same markets and the same kinds of records, but the details differ. The same settings build the same world again.',
    'Data Model shows the data in four tabs:',
    { kind: 'component', name: 'dataTour' },
  ],
  technical: [
    'The generator is backend/app/datasets/, version 0.2.0 (GENERATOR_VERSION in backend/app/datasets/config.py). It builds a world in memory as named rows, plants the enabled scenarios (chapter 3), validates the whole world, and only then writes Parquet files and a manifest. A world that fails validation is not written.',
    'Volumes of the dev profile, which every official world uses (backend/app/datasets/config.py): 10,000 players, 250,000 tickets, 100,000 sessions, 100,000 campaign exposures, 500 retailers, 12,000 devices, 2,000 support cases, 250 documents, 40 incidents, 4 campaigns per market and 8 experiments. These are targets before planting, and the planted rows come on top. The game catalogue is 20 games in every profile, five families in each market. Business timestamps fall in one window of 365 days from 2025-01-01. The live row counts of the loaded world are on Data Model.',
    'The tables: 39 tables in seven fictional source systems. Their columns, primary keys, 61 foreign keys and id formats are defined once, in the schema registry backend/app/datasets/schema.py, which the validator, the data dictionary and the API all read. Game families, categories and mechanics, incident types, support categories and player segments exist once per market, with local codes and names; channel codes are the one shared taxonomy (D-013). The source layer has no concept table: concepts belong to the ontology.',
    'The data layers each approach reads:',
    [
      'Structured records: the Parquet tables, the authoritative source of every quantity.',
      'Documents: 14 document types. They are split into passages (chunks, in the code) on sentence boundaries, at most 160 words each, with the last sentence repeated at the start of the next (CHUNK_MAX_WORDS and CHUNK_OVERLAP_SENTENCES in backend/app/datasets/distributions.py). Every approach reads the one passage file (D-011).',
      'Record texts: one short English text for each row of 16 tables, plus shared devices, shared payment methods and the players taking part in a share, written by one fixed template per table (backend/app/retrieval/standard/records.py, serialiser 2.1.0). They sit in the same search index as the passages and give A the same access to the tables that B and C get through the graph (D-028).',
      'The graph: 29 node labels and 30 relationship types (backend/app/graph/statements.py) holding the entities, their relationships, the ontology and, on every node, the source table and row it came from. High-volume facts (tickets, prizes, sessions, campaign exposures, daily KPIs) stay in the tables and appear in the graph only as aggregates on a relationship. The graph holds one world at a time.',
    ],
    "Seeds: a world is fixed by its profile, its world seed and its scenario seed, which the world's _manifest.json records with the generator version. The official worlds use the dev profile with world seeds 2029 to 2034, which no one has looked at, each with the scenario seed equal to the world seed (OFFICIAL_SEEDS in backend/app/evaluation/official.py). Live Lab and Data Model show seed 2026.",
    "Determinism: each table generator draws from its own random stream, keyed by the generator version, the world seed and the component name (backend/app/datasets/rng.py), and each scenario from its own stream keyed by the scenario seed and its id, so one component's draws do not shift another's. The same version, seeds and configuration reproduce the same world. backend/tests/test_determinism.py checks this within a process, and test_golden_world.py pins a hash of the written Parquet files and the truth ledger across processes (fixture tests/fixtures/golden/tiny-seed7.json).",
    "Validation (validate_world) checks referential integrity over all 61 foreign keys, that a player's segments come from the player's own market, market and currency consistency, time order (a session runs only an app version its market had released), the volume targets and provenance coverage.",
  ],
  terms: [
    'Concept',
    'Market',
    'Passage',
    'Record',
    'Record text',
    'Truth ledger',
    'World',
  ],
}
