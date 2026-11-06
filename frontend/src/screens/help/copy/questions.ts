/**
 * The questions and answers, a page beside the guide (D-110): the question bank with its answer keys and the
 * newest official run's scores (questions.tsx), and how the bank is built.
 */

import type { ChapterCopy } from '../chapters'

export const questions: ChapterCopy = {
  plain: [
    'These are the questions every approach answers, the question bank. For each question the table shows:',
    [
      'its kind of question and what it tests;',
      'each version of it, with its answer key, the correct answer written down in advance;',
      "the newest official run's scores, when that run asked it.",
    ],
    { kind: 'heading', text: 'Questions and their versions' },
    'A question is written once and then filled in for each world with a record it names, its starting record. A world is one copy of the made-up company (chapter 2).',
    'So one question gives up to three versions in each world, and each version is called an instance. The table shows the instances of world 2026, grouped under the question they come from.',
    { kind: 'heading', text: 'Kinds of question' },
    [
      'Single fact: read one fact from one record.',
      'Multi-hop: follow links across several records, such as from an incident to its platform version and on to other incidents.',
      'Ontology-dependent: match things that each country names in its own way, which needs the shared dictionary, the ontology.',
      'Planted pattern: find one of the planted stories of chapter 3.',
    ],
    'Filter the table by kind of question or by planted story.',
    { kind: 'heading', text: 'Reference codes' },
    'The questions name records by their reference codes, as the company’s own systems do. A code starts with the kind of record:',
    [
      'INC_022 is an incident, CMP_002 a campaign and SUP_02015 a support case;',
      'PLV_PAYMENTS_3 is a version of the payments platform and APPV_GR_531 an app release;',
      'MECH_UK_NUMBER_MATCH is a game mechanic and PLAYER_GR_000165 a player account;',
      'PP_BLUEHARBOR is a payment provider and DOC_0262 a document.',
    ],
    'Many codes also carry the country: GAME_AT_04 is a game in Austria, and SEG_CZ_USPORNI a group of players in the Czech Republic. AT is Austria, CZ the Czech Republic, GR Greece and UK the United Kingdom.',
    'Where a question or answer key names a country by its code, the table writes the country’s name.',
    { kind: 'heading', text: 'Scores' },
    'The table shows the scores of the newest official run, the run whose scores count as the result, when that run asked these questions. The official run asked them of six other worlds instead, 2029 to 2034. When that is so, the note above the table says so, and the scores are on Results.',
    { kind: 'component', name: 'questions' },
  ],
  plainHint:
    'Choose Technical at the top of Help to see the id of each question and each question and answer key exactly as the bank holds them.',
  technical: [
    'Bank {question_bank_version} (BANK_VERSION in backend/app/evaluation/bank.py) has 22 logical questions: L01 to L04 single facts (H3), L05 to L08 multi-hop (H1), L09 to L12 ontology-dependent and anchored by id (H2), L13 and L14 ontology-dependent and anchored by a local-language name (H2_name), and L15 to L22 one per planted story (H5). Every question maps to a planted story or a base fact of the world.',
    'Grounding (make ground-bank) fills each structural question with up to three anchors per world, chosen in sha256 order of "bank version:question id:anchor" among anchors whose answer set has 1 to 6 members once the anchor is excluded, with bounds of their own for L06, L11, L13 and L14 (D-030). Each planted question is grounded once per world from the truth ledger. World 2026 gives 50 instances. The official run grounds each of its six worlds when it starts, so its count is known only then; its six worlds gave 300, 50 in each. A frozen bank is written to a file named after the bank version, the scorer and the world, and grounding never replaces a bank file that holds another bank, so the file a run was made with stays as it was (D-095).',
    'The grounded bank is frozen with its hash, the world manifest hash, the ledger hash and the record serialiser version, and a run refuses a bank that is missing, fails its hash or names another version, world, ledger or serialiser. Retrieval code does not see the bank, the claims or the checks. The full text, checks and claims of the seed 2026 instances are in docs/evaluation/question-bank.md, generated from the bank.',
    'The questions, answer keys and scores shown here come from GET /api/v1/benchmarks/questions, which scores the bank from the newest official run of the whole bank. Only the API modules that publish evaluator output may import the evaluation package (D-035).',
  ],
  terms: [
    'Answer key',
    'Instance',
    'Kind of question',
    'Official run',
    'Planted story',
    'Question bank',
    'Starting record',
    'Truth ledger',
    'World',
  ],
}
