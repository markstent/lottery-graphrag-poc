/**
 * Chapter 12, running it: a note at Plain, and at Technical the commands,
 * the model configuration, the settings, and how to reproduce and resume an
 * official run (docs/operations.md, docs/evaluation.md, the Makefile).
 */

import type { ChapterCopy } from '../chapters'

export const running: ChapterCopy = {
  plain: [
    'This chapter is for operators: the people who install the system, load the made-up company and start the runs.',
  ],
  plainHint:
    'Choose Technical at the top of Help to see the commands, the model settings, and how to repeat or resume an official run.',
  technical: [
    { kind: 'component', name: 'running' },
    'The settings this system runs with now, beside those recorded by the newest official run:',
    {
      kind: 'settings',
      keys: [
        'generation_model',
        'generation_model_family',
        'generation_temperature',
        'max_tokens',
        'generation_reasoning',
        'judge_model',
        'judge_model_family',
        'judge_reasoning',
        'top_k',
        'context_budget_tokens',
        'context.dedupe_threshold',
        'graph_limits.depth',
        'repeats',
        'selection_rule',
        'method_version',
      ],
    },
    'The official run of method v0.3 uses the six unseen worlds, seeds 2029 to 2034, and asks each question once (make run-benchmark; REPEATS=N asks each N times; D-097). It starts from the command line after the owner agrees, and only from a clean checkout; the API and Results do not start it, and no other run may use those worlds (D-091). Development uses world 2026 only, through make dev-run or "Development run" on Results.',
    'To repeat an official run:',
    [
      'check out the commit the run recorded (git_sha in its reproducibility record on Results) with a clean tree; the run records its method_version, and runs of different methods are not compared or resumed together;',
      'bring the system up as above, through make ground-bank; the run generates, indexes and grounds its other worlds itself on first use;',
      'in the root .env, set GENERATION_PROVIDER=litellm and JUDGE_PROVIDER=litellm, and the GENERATION_* and JUDGE_* model, family, temperature and reasoning to the recorded values; the two families must differ;',
      'pull both models into Ollama first if they are local (ollama pull <model>);',
      "run make dry-run: four questions on world 2026 with the official settings, which wipes and restores the graph and needs the owner's approval;",
      'run make run-benchmark OUT=data/evaluation/runs/<name>; the official run v0.2.0 took 15 hours 39 minutes on one machine, about three of them with the machine asleep;',
      'compare the new record with the old on Results: the worlds, retrieval, the evidence scores and the scoring rules are deterministic for the same code, seeds, models and indices, but model answers and judge marks, and so the answer scores, can vary between runs even at temperature 0.',
    ],
    'To resume a failed or cancelled run: each finished world is kept in worlds/<seed>.json in the run directory, and nothing is published until summary.json is written. Run make run-benchmark OUT=data/evaluation/runs/<run id> RESUME=1 with the same models and options. Resume checks every recorded setting against the kept worlds before any world is prepared and names any that differ, and an official run resumes only from a clean checkout at the same commit, so any code change means a new run (D-077, D-078). A job started from Results does not resume; its failure message names this command.',
    'After the last world, or a failed one, the run ingests the seed 2026 graph again so Live Lab and Data Model read the world they expect. If that restore fails, run make ingest-graph.',
  ],
  terms: ['Answer model', 'Model family', 'Official run', 'Reasoning', 'World'],
}
