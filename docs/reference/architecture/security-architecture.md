# Security Architecture

Although all business data is synthetic:

- never commit secrets
- use environment variables
- parameterise Cypher
- validate user query length/input
- bound graph traversal
- separate truth ledger from retrievable stores
- redact technical stack traces from user-facing errors
- prevent arbitrary file access
- prevent direct evaluator access from retrieval services
