/** Time as people read it: "840 ms", "12.3 s". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 s'
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}
