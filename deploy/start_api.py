"""Start the public API: wait for Neo4j, make sure the right world is loaded into it, then serve.

The graph (Neo4j's volume) and its statistics file (/state, linked from the world folder) both persist,
so restarts and rebuilt containers skip the load. A load runs only when the graph is empty, the statistics
are missing, or the image was built from a different world (its fingerprint changed). No model, no Qdrant.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

from neo4j import GraphDatabase

STATS = Path("/state/_graph_stats.json")
BUILT_WORLD = Path("/repo/deploy/world.sha")
LOADED_WORLD = Path("/state/world.sha")
uri = os.environ.get("NEO4J_URI", "bolt://neo4j:7687")
auth = (os.environ.get("NEO4J_USER", "neo4j"), os.environ["NEO4J_PASSWORD"])


def count_nodes() -> int:
    with GraphDatabase.driver(uri, auth=auth) as driver, driver.session() as session:
        return session.run("MATCH (n) RETURN count(n) AS c").single()["c"]


for attempt in range(90):
    try:
        nodes = count_nodes()
        break
    except Exception as exc:  # Neo4j is still starting
        if attempt == 89:
            sys.exit(f"Neo4j did not become available: {exc}")
        time.sleep(2)

built = BUILT_WORLD.read_text().strip()
loaded = LOADED_WORLD.read_text().strip() if LOADED_WORLD.exists() else ""

if nodes == 0 or not STATS.exists() or built != loaded:
    print(f"Loading the world into Neo4j (graph had {nodes} nodes).", flush=True)
    if nodes:
        # Clear the old graph in small batches, relationships first: one big delete needs more
        # memory than the deliberately small Neo4j heap allows.
        with GraphDatabase.driver(uri, auth=auth) as driver, driver.session() as session:
            session.run("MATCH ()-[r]->() CALL (r) { DELETE r } IN TRANSACTIONS OF 2000 ROWS").consume()
            session.run("MATCH (n) CALL (n) { DELETE n } IN TRANSACTIONS OF 2000 ROWS").consume()
    LOADED_WORLD.unlink(missing_ok=True)
    subprocess.run([sys.executable, "-m", "app.graph", "--wipe"], cwd="/repo/backend", check=True)
    LOADED_WORLD.write_text(built + "\n")
    print("World loaded.", flush=True)
else:
    print(f"Graph already holds this world ({nodes} nodes); skipping the load.", flush=True)

os.chdir("/repo/backend")
os.execv(
    sys.executable,
    [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"],
)
