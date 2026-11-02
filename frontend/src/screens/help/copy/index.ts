/** The copy of every chapter, by chapter id. */

import type { ChapterCopy, ChapterId } from '../chapters'
import { answer } from './answer'
import { approaches } from './approaches'
import { company } from './company'
import { evidence } from './evidence'
import { glossary } from './glossary'
import { lessons } from './lessons'
import { limits } from './limits'
import { questions } from './questions'
import { results } from './results'
import { running } from './running'
import { scoring } from './scoring'
import { stories } from './stories'
import { why } from './why'

export const CHAPTER_COPY: Record<ChapterId, ChapterCopy> = {
  why,
  company,
  stories,
  approaches,
  evidence,
  answer,
  scoring,
  results,
  limits,
  questions,
  glossary,
  running,
  lessons,
}
