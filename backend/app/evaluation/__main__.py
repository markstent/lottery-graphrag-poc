"""CLI entry point for benchmark runs (HITL-09).

    uv run python -m app.evaluation [--generator fake|litellm]
        [--questions Q01,Q25] [--pipelines ABC] [--out DIR]

Writes ``results.json`` and ``report.md`` into the output directory
(default ``data/evaluation/run-<timestamp>``). Requires services up and the
dev world ingested + indexed, like the trace CLI.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path

from app.config import from_env
from app.evaluation.report import render_report
from app.evaluation.runner import BenchmarkRunner
from app.graph.config import from_env as from_graph_env
from app.retrieval.graph.lab import build_generator


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the benchmark harness")
    parser.add_argument(
        "--generator",
        choices=("fake", "litellm"),
        default="fake",
        help="answer generator (fake is deterministic; litellm uses the gateway)",
    )
    parser.add_argument("--questions", default=None, help="comma-separated question ids")
    parser.add_argument("--out", default=None, help="output directory")
    args = parser.parse_args()

    settings = from_env()
    world_dir = Path(settings.dataset_dir)
    runner = BenchmarkRunner(
        settings=settings,
        graph_config=from_graph_env(),
        generator=build_generator(args.generator, settings),
        world_dir=world_dir,
    )
    question_ids = args.questions.split(",") if args.questions else None
    try:
        run = runner.run(question_ids)
    finally:
        runner.close()

    out_dir = (
        Path(args.out)
        if args.out
        else Path("data/evaluation") / f"run-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "results.json").write_text(json.dumps(run.to_payload(), indent=2), encoding="utf-8")
    (out_dir / "report.md").write_text(render_report(run), encoding="utf-8")
    print(f"wrote {out_dir / 'results.json'} and {out_dir / 'report.md'}")


if __name__ == "__main__":
    main()
