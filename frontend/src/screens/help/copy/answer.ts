import type { ChapterCopy } from '../chapters'

export const answer: ChapterCopy = {
  plain: [
    'The answer model is a language model: it reads text and writes text. It is given the question and the pieces of evidence chosen in chapter 5, numbered, and nothing else.',
    'It is told to answer only from those pieces, to cite each piece it uses by its number, and to give a one-line verdict, or "unknown" when the pieces do not answer the question. It must reply in a fixed form, so that the verdict and the citations can be checked by a fixed rule. A citation of a piece it was not shown does not count.',
    'A, B and C use the same answer model, the same instructions and the same settings.',
    'A second language model, the judge, then marks each answer from 0 to 2 on five points: is it right, is it complete, does it stay with the evidence, do its citations support what they are attached to, and does it say "unknown" only when it should. The judge sees the question, the answer key, the key facts, the evidence the answer model saw and the answer. It does not see which approach wrote the answer.',
    'The judge comes from a different model family than the answer model, that is, another line of models trained by others, because a model can favour answers written the way it writes. Its marks are a second opinion beside the fixed-rule score and do not replace it.',
    'In the official run of 2026-10-26 to 2026-10-27, the judge and the fixed-rule score agreed on whether an answer was right for 53 percent of answers, little better than chance. The two ways of marking an answer often disagree, so neither should be read alone (chapter 7).',
  ],
  technical: [
    'The settings in this chapter, now and in the newest official run:',
    {
      kind: 'settings',
      keys: [
        'generation_model',
        'generation_model_family',
        'generation_temperature',
        'max_tokens',
        'generation_reasoning',
        'prompt_version',
        'prompt_hash',
        'repeats',
        'judge_model',
        'judge_model_family',
        'judge_temperature',
        'judge_reasoning',
        'judge_prompt_version',
        'judge_prompt_hash',
      ],
    },
    'The prompt contract (SYSTEM_PROMPT in backend/app/retrieval/standard/generation.py, version {prompt_version}, D-024). The system prompt asks for exactly one JSON object, {"verdict": ..., "answer": ...}, answered only from the numbered sources with no outside knowledge, every claim cited as [n], and the verdict "unknown" when the sources do not answer. The user message lists the selected items in the re-ranker\'s order, each as "[n] title (market, language)" followed by its text, and then the question; with nothing selected it reads "(no context retrieved)". prompt_hash is the SHA-256 of the system prompt.',
    'Parsing (parse_answer): strict JSON first, then JSON inside a code fence, then the whole text as the answer with an empty verdict. A citation [n] or [n, m] counts only when n is a block the model was shown; a range such as [1-3] cites nothing. A gateway error or an empty output is an error, not an answer: that repeat has no score, is left out of every metric and keeps the message.',
    'The models. The answer model is {generation_model} (family {generation_model_family}) at temperature {generation_temperature}, with at most {max_tokens} output tokens and reasoning {generation_reasoning}. The judge is {judge_model} (family {judge_model_family}) at temperature {judge_temperature} with reasoning {judge_reasoning}; its reply is capped at 300 tokens and the answer it reads at 2,400 characters (JUDGE_MAX_TOKENS and ANSWER_CHAR_CAP in backend/app/evaluation/judge.py). Every model call goes through one gateway (backend/app/models/gateway.py, LiteLLM), so a local model through Ollama and a hosted one through OpenRouter are a configuration choice; tests use deterministic stand-ins. Even at temperature 0 a model can vary between calls, which is why an official run takes at least {repeats} repeats and reports their mean (chapter 7).',
    'Why reasoning is off. Some local models think before they answer, in hidden text that counts against the output cap. The first local pilot (pilot-2026, 2026-10-19; docs/evaluation.md) left reasoning at the default, and both models spent their caps thinking: 159 of 198 answers came back empty, and so did every judge call. With reasoning off, Ollama models are sent think=false and OpenRouter models reasoning.enabled=false; a model that reports reasoning tokens anyway raises an error, and any other provider refuses "off" at start-up (D-076). The second pilot (pilot-2026-nothink, 2026-10-19) kept the JSON contract in 324 of 324 answers (docs/evaluation/official-run-proposal.md). The cost: the official run measures these models without their reasoning, which might have used the evidence better.',
    'The judge (prompt version {judge_prompt_version}; D-031):',
    [
      'five dimensions, each 0 (wrong or absent), 1 (partly) or 2 (fully): correctness against the reference answer, completeness against the key facts, faithfulness to the shown context, citation accuracy, and appropriate abstention;',
      "blinding: it sees the text of each block the answer model was shown, without titles or ids, shuffled by a hash of the instance, the approach and the repeat, and numbered again from 1; the answer's citations are rewritten to the new numbers, any other bracket holding a digit becomes [?], and no word of its prompt names an approach or how the context was found;",
      "family rule: in an official run its model family must differ from the answer model's, or the run refuses to start;",
      'a judge failure is recorded with its reason and has no scores; it is not counted as zero;',
      "agreement: judge correctness of 2 against a deterministic answer score of at least 0.5, reported as a rate and as Cohen's kappa (agreement corrected for chance, where 0 is chance and 1 is perfect), overall and for each approach;",
      "known limitation: a graph node with no record text reaches the judge as '<Label> <id>', which can differ in form from the record text A retrieves for the same row, so blinding is not complete.",
    ],
    'A model judge runs in benchmark runs only; a quick check uses a stand-in judge that measures nothing. In Live Lab a bank question is scored by the deterministic scorer alone, after the run is complete (D-035).',
    'In the official run v0.2.0 (2026-10-26 to 2026-10-27; docs/evaluation.md), judge correctness agreed with the answer score on 53 percent of 1,348 judged answers, kappa 0.07. 2 of 1,350 judge calls failed, both in B, with a server error while the machine slept.',
  ],
}
