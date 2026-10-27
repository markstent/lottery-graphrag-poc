/**
 * The retrieval method a run or a recording was made under (D-092), as the
 * API reports it (`method_version`), in words, and what it compares.
 */

/** The method v0.3 replaced; its runs and recordings stay readable and labelled. */
export const OLD_METHOD = '0.2.0'

export type EvidenceMetric = 'evidence_f1' | 'evidence_recall'

/** "Method v0.3", or "Method v0.2 (old method)" for a run of the method v0.3 replaced. */
export function methodBadge(version: string): string {
  const short = `Method v${version.split('.').slice(0, 2).join('.')}`
  return version === OLD_METHOD ? `${short} (old method)` : short
}

/** The evidence metric a method compares: F1 under v0.2, recall from v0.3 on (D-087). */
export const evidenceMetric = (version: string): EvidenceMetric =>
  version === OLD_METHOD ? 'evidence_f1' : 'evidence_recall'

/**
 * What each evidence metric is called on screen. A v0.2 run keeps the words
 * it was published with, "Evidence score" (its F1).
 */
export const EVIDENCE_LABELS: Record<EvidenceMetric, string> = {
  evidence_f1: 'Evidence score',
  evidence_recall: 'Evidence recall',
}
