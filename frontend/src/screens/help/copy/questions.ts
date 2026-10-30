/**
 * Chapter 10, the questions: the question bank with its answer keys and the
 * newest official run's scores (questions.tsx), and how the bank is built.
 */

import type { ChapterCopy } from '../chapters'

export const questions: ChapterCopy = {
  plain: [
    'These are the questions in the question bank, grouped by the question they come from, with what each tests and its answer key. A question is written once and then filled in for each world with a record it names, its starting record, so one question gives up to three per world. Filter by kind of question or by planted story. These are the questions of world 2026. Their scores are those of the newest official run when it asked them; when it asked them of other worlds, as the official run v0.3.0 did with worlds 2029 to 2034, the note above the table says so and its scores are on Results.',
    { kind: 'component', name: 'questions' },
  ],
  technical: [
    'Bank {question_bank_version} (BANK_VERSION in backend/app/evaluation/bank.py) has 22 logical questions: L01 to L04 single facts (H3), L05 to L08 multi-hop (H1), L09 to L12 ontology-dependent and anchored by id (H2), L13 and L14 ontology-dependent and anchored by a local-language name (H2_name), and L15 to L22 one per planted story (H5). Every question maps to a planted story or a base fact of the world.',
    'Grounding (make ground-bank) fills each structural question with up to three anchors per world, chosen in sha256 order of "bank version:question id:anchor" among anchors whose answer set has 1 to 6 members once the anchor is excluded, with bounds of their own for L06, L11, L13 and L14 (D-030). Each planted question is grounded once per world from the truth ledger. World 2026 gives 50 instances, and the three worlds of the official run v0.2.0 gave 150. The official run of method v0.3 grounds each of its six worlds when it starts, so its count is known only then; the six worlds of the official run v0.3.0 gave 300, 50 in each. A frozen bank is written to a file named after the bank version, the scorer and the world, and grounding never replaces a bank file that holds another bank, so the files earlier runs were made with stay as they were (D-095).',
    'The grounded bank is frozen with its hash, the world manifest hash, the ledger hash and the record serialiser version, and a run refuses a bank that is missing, fails its hash or names another version, world, ledger or serialiser. Retrieval code does not see the bank, the claims or the checks. The full text, checks and claims of the seed 2026 instances are in docs/evaluation/question-bank.md, generated from the bank.',
    'The questions, answer keys and scores shown here come from GET /api/v1/benchmarks/questions, which scores the bank from the newest official run of the whole bank. Only the API modules that publish evaluator output may import the evaluation package (D-035).',
  ],
  terms: [
    'Answer key',
    'Kind of question',
    'Planted story',
    'Question bank',
    'Starting record',
    'Truth ledger',
    'World',
  ],
}
