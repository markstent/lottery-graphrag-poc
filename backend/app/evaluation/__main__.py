"""CLI entry point: ``uv run python -m app.evaluation``.

``addendum`` rescores a stored run with no model into a directory beside it;
``label-sample`` draws the blind hand-labelling sample from a stored run and
``label-agreement`` measures the answer measures against the returned labels,
both with no model;
``ground`` grounds bank 2.0.0 into one generated world (by default the
active one, from DATASET_DIR and TRUTH_LEDGER_PATH) and writes the hashed
frozen bank; ``bank-doc`` renders a frozen bank as the generated question
bank page. ``dry-run-questions`` prints the four-question dry run's questions;
``diagnose-selection`` counts, with no answer model, what the selection keeps;
``run`` runs a smoke, dev or official benchmark over one or more
world seeds, ``sweep`` runs the multi-hop depth sweep and ``compare`` pairs
two official runs of different generation models (H7). All are
evaluator-only (ADR-008).
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from app.config import REPO_ROOT
from app.evaluation import addendum, diagnostics, labelling, official
from app.evaluation.bank import BANK, NAME_ANCHORED, STRATA, LogicalQuestion
from app.evaluation.checks import TokenCheck
from app.evaluation.grounding import (
    BankInstance,
    FrozenBank,
    freeze_bank,
    load_frozen_bank,
    write_new_bank,
)
from app.evaluation.runner import OFFICIAL_MIN_REPEATS

DOC_COMMAND = "python -m app.evaluation bank-doc"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="app.evaluation", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    ground = commands.add_parser("ground", help="Ground the bank into one world.")
    ground.add_argument(
        "--world", type=Path, default=None, help="World directory (default: $DATASET_DIR)."
    )
    ground.add_argument(
        "--ledger", type=Path, default=None, help="Truth ledger (default: $TRUTH_LEDGER_PATH)."
    )
    ground.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Frozen bank JSON to write (default: the bank named after the world).",
    )
    doc = commands.add_parser("bank-doc", help="Render a frozen bank as Markdown.")
    doc.add_argument("--bank", type=Path, required=True, help="Frozen bank JSON to read.")
    doc.add_argument("--out", type=Path, required=True, help="Markdown page to write.")
    run = commands.add_parser("run", help="Run the benchmark over one or more worlds.")
    run.add_argument("--kind", choices=("smoke", "dev", "official"), required=True)
    _seeds_argument(
        run,
        default=None,
        shown=(
            f"{_joined(official.SEEN_SEEDS)} for smoke, {_joined(official.DEV_SEEDS)} for dev, "
            f"{_joined(official.OFFICIAL_SEEDS)} for official"
        ),
    )
    run.add_argument(
        "--repeats",
        type=_repeats,
        default=None,
        help=(
            f"Repeats per pipeline (default 1 for smoke and dev, "
            f"{OFFICIAL_MIN_REPEATS} for official)."
        ),
    )
    run.add_argument("--strata", type=_names, default=None, help="Strata to run, e.g. H1,H3.")
    run.add_argument(
        "--questions",
        type=_names,
        default=None,
        help="Logical questions to run, e.g. L01,L05 (the bank's ids).",
    )
    _limit_argument(run)
    _out_argument(run)
    run.add_argument(
        "--resume",
        action="store_true",
        help="Continue the failed run in --out: skip its kept worlds (needs --out).",
    )
    commands.add_parser(
        "dry-run-questions",
        help="Print the questions of the four-question dry run, comma-separated.",
    )
    commands.add_parser(
        "diagnose-selection",
        help=(
            "Read-only: what the selection keeps of the claim records each approach "
            "finds (no answer model; the embedding and re-ranking models run)."
        ),
    )
    sweep = commands.add_parser("sweep", help="Run B and C on H1 at each graph depth.")
    _seeds_argument(sweep, default=official.SEEN_SEEDS, shown=_joined(official.SEEN_SEEDS))
    sweep.add_argument(
        "--depths",
        type=_integers,
        default=official.SWEEP_DEPTHS,
        help="Comma-separated graph depths (default 0,1,2,3).",
    )
    sweep.add_argument("--repeats", type=_repeats, default=OFFICIAL_MIN_REPEATS)
    _limit_argument(sweep)
    _out_argument(sweep)
    compare = commands.add_parser("compare", help="Pair two official runs of different models.")
    compare.add_argument("small", type=Path, help="Run directory of the small model.")
    compare.add_argument("large", type=Path, help="Run directory of the large model.")
    compare.add_argument("--out", type=Path, default=None, help="Directory for comparison.json.")
    rescored = commands.add_parser(
        "addendum", help="Model-free: rescore a stored run into an addendum beside it."
    )
    rescored.add_argument("--run", type=Path, required=True, help="Run directory to rescore.")
    rescored.add_argument(
        "--out",
        type=Path,
        default=None,
        help="New addendum directory (default data/evaluation/addenda/<run>-scorer-<version>).",
    )
    sample = commands.add_parser(
        "label-sample", help="Model-free: draw the blind hand-labelling sample from a stored run."
    )
    sample.add_argument("--run", type=Path, required=True, help="Run directory to sample.")
    sample.add_argument(
        "--out",
        type=Path,
        default=None,
        help="New sample directory (default data/evaluation/labels/v0.2.0-sample).",
    )
    agreed = commands.add_parser(
        "label-agreement", help="Model-free: agreement of the answer measures with the labels."
    )
    agreed.add_argument("--run", type=Path, required=True, help="Run directory sampled.")
    agreed.add_argument(
        "--sample",
        type=Path,
        default=None,
        help="Sample directory (default data/evaluation/labels/v0.2.0-sample).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "run" and args.resume and args.out is None:
        parser.error("--resume needs --out, the directory of the run to continue")

    try:
        return _dispatch(args)
    except official.NotDevWorld as error:
        raise SystemExit(str(error)) from None


def _dispatch(args: argparse.Namespace) -> int:
    """Run the chosen command; ``main`` turns a refused world into a plain exit."""
    if args.command == "run":
        repeats = args.repeats
        if repeats is None:
            repeats = OFFICIAL_MIN_REPEATS if args.kind == "official" else 1
        out = _resolved(args.out) or official.run_dir(official.run_id(args.kind))
        official.run_benchmark(
            args.kind,
            args.seeds or official.default_seeds(args.kind),
            repeats=repeats,
            out_dir=out,
            strata=args.strata,
            limit=args.limit,
            resume=args.resume,
            questions=args.questions,
        )
        print(f"wrote {out}")
        return 0
    if args.command == "dry-run-questions":
        print(",".join(official.dry_run_question_ids()))
        return 0
    if args.command == "diagnose-selection":
        print(f"wrote {diagnostics.run_selection_diagnostic()}")
        return 0
    if args.command == "sweep":
        out = _resolved(args.out) or official.run_dir(official.run_id("sweep"))
        official.run_sweep(
            args.seeds, out_dir=out, depths=args.depths, repeats=args.repeats, limit=args.limit
        )
        print(f"wrote {out}")
        return 0
    if args.command == "addendum":
        out = _resolved(args.out) or addendum.addendum_dir(args.run)
        try:
            print(f"wrote {addendum.write_addendum(args.run, out)}")
        except ValueError as error:
            raise SystemExit(str(error)) from None
        return 0
    if args.command == "label-sample":
        out = _resolved(args.out) or labelling.DEFAULT_SAMPLE_DIR
        try:
            labelling.write_sample(args.run, out)
        except ValueError as error:
            raise SystemExit(str(error)) from None
        for line in labelling.shortfall_lines(out):
            print(f"shortfall: {line}")
        print(f"wrote {out}")
        return 0
    if args.command == "label-agreement":
        sample_dir = _resolved(args.sample) or labelling.DEFAULT_SAMPLE_DIR
        try:
            print(f"wrote {labelling.write_agreement(sample_dir, args.run)}")
        except ValueError as error:
            raise SystemExit(str(error)) from None
        return 0
    if args.command == "compare":
        comparison = official.compare_runs(args.small, args.large)
        out = args.out or official.comparison_dir(official.run_id("compare"))
        print(official.render_comparison(comparison))
        print(f"wrote {official.write_comparison(comparison, out)}")
        return 0
    if args.command == "ground":
        active = official.world_paths(official.PRESENTATION_SEED)
        world = args.world or active.world_dir
        out = args.out or official.bank_path_for(world)
        bank = freeze_bank(world, args.ledger or active.ledger_path)
        write_new_bank(bank, out)
        for line in stratum_counts(bank):
            print(line)
        for item in bank.unavailable:
            print(f"unavailable: {item.question_id} ({item.reason})")
        if not bank.unavailable:
            print("unavailable: none")
        print(f"bank hash: {bank.bank_hash}")
        print(f"wrote {out}")
        return 0

    bank = load_frozen_bank(args.bank)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render_bank_doc(bank), encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


def _resolved(path: Path | None) -> Path | None:
    """A relative ``--out`` is relative to the repository root, so the same
    command works from the repository root (``make``) and from ``backend/``."""
    return None if path is None else REPO_ROOT / path


def _repeats(text: str) -> int:
    """A repeat count: a whole number of at least 1."""
    try:
        repeats = int(text)
    except ValueError:
        repeats = 0
    if repeats < 1:
        raise argparse.ArgumentTypeError(
            f"repeats must be a whole number of at least 1, got {text}"
        )
    return repeats


def _integers(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.split(","))


def _names(text: str) -> list[str]:
    return [part.strip() for part in text.split(",")]


def _seeds_argument(
    parser: argparse.ArgumentParser, default: tuple[int, ...] | None, shown: str
) -> None:
    parser.add_argument(
        "--seeds",
        type=_integers,
        default=default,
        help=f"Comma-separated world seeds (default {shown}).",
    )


def _joined(seeds: tuple[int, ...]) -> str:
    return ",".join(str(seed) for seed in seeds)


def _limit_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--limit", type=int, default=None, help="At most N instances per logical question."
    )


def _out_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help=(
            "Run directory; a relative path is from the repository root "
            "(default data/evaluation/runs/<run id>)."
        ),
    )


def stratum_counts(bank: FrozenBank) -> list[str]:
    """One line per stratum, in bank order, with H2 split by sub-stratum."""
    lines = []
    for stratum in _strata():
        instances = [i for i in bank.instances if i.stratum == stratum]
        line = f"{stratum} {STRATA[stratum]}: {len(instances)} instances"
        subs = Counter(i.sub_stratum for i in instances if i.sub_stratum is not None)
        if subs:
            parts = ", ".join(f"{n} {_label(sub)}" for sub, n in sorted(subs.items()))
            line += f" ({parts})"
        lines.append(line)
    return lines


def render_bank_doc(bank: FrozenBank) -> str:
    """The question bank page: one section per stratum, one sentence per line."""
    lines = [
        f"# Question bank {bank.bank_version}",
        "",
        f"Generated by `{DOC_COMMAND}`; do not edit.",
        "",
        f"This page lists the {len(BANK)} logical questions of bank {bank.bank_version}"
        f" and their instances for world seed {bank.world_seed}.",
        "Each logical question is grounded to concrete anchors of one generated world;"
        " the expected answers below are what the deterministic checks score.",
        f"Bank hash: `{bank.bank_hash}`.",
        f"World manifest hash: `{bank.world_manifest_hash}`.",
        f"Ledger hash: `{bank.ledger_hash}`.",
        f"Record serialiser version: `{bank.record_serialiser_version}`.",
        f"Scorer version: `{bank.scorer_version or 'unrecorded'}`.",
        "",
    ]
    unavailable = {u.question_id: u.reason for u in bank.unavailable}
    for stratum in _strata():
        lines += [f"## {stratum}: {STRATA[stratum]}", ""]
        for question in (q for q in BANK if q.stratum == stratum):
            instances = [i for i in bank.instances if i.question_id == question.question_id]
            lines += _question_section(question, instances, unavailable.get(question.question_id))
    return "\n".join(lines).rstrip("\n") + "\n"


def _question_section(
    question: LogicalQuestion, instances: list[BankInstance], unavailable: str | None
) -> list[str]:
    lines = [f"### {question.question_id}", "", f"What it tests: {question.tests}"]
    if question.sub_stratum == "name_anchored":
        lines.append(f"Sub-stratum: {_label(question.sub_stratum)}, {NAME_ANCHORED}.")
    elif question.sub_stratum is not None:
        lines.append(f"Sub-stratum: {_label(question.sub_stratum)}.")
    if question.scenario_id is not None:
        lines.append(f"Planted by scenario {question.scenario_id}.")
    lines += ["", f"Template: `{question.template}`", ""]
    if unavailable is not None:
        return [*lines, f"Not grounded in this world: {unavailable}.", ""]
    for instance in instances:
        lines += [
            f"- Instance `{instance.instance_id}`",
            f"  - Question: {instance.text}",
            f"  - Expected answer: {instance.expected_answer}",
            *(
                f"  - Also accepted: {q.alias} with {' or '.join(q.qualifiers)}"
                + (f", naming none of {', '.join(q.rivals)}." if q.rivals else ".")
                for check in instance.checks
                if isinstance(check, TokenCheck)
                for q in check.qualified
            ),
        ]
    return [*lines, ""]


def _strata() -> list[str]:
    """Strata in the order the bank first lists them."""
    return list(dict.fromkeys(q.stratum for q in BANK))


def _label(sub_stratum: str) -> str:
    return sub_stratum.replace("_", "-")


if __name__ == "__main__":
    raise SystemExit(main())
