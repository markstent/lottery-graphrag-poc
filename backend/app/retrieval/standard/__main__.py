"""Standard RAG entry points.

`python -m app.retrieval.standard` builds the vector index.
"""

from __future__ import annotations

from app.retrieval.standard.index import main

if __name__ == "__main__":
    main()
