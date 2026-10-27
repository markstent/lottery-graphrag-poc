import type { ChapterCopy } from '../chapters'

export const running: ChapterCopy = {
  plain: [{ kind: 'component', name: 'running' }],
  technical: [
    'The settings this system runs with now, beside those recorded by the newest official run.',
    {
      kind: 'settings',
      keys: [
        'generation_model',
        'generation_temperature',
        'max_tokens',
        'top_k',
        'context_budget_tokens',
        'context.evidence_slots',
        'context.graph_slots',
        'judge_model',
      ],
    },
  ],
}
