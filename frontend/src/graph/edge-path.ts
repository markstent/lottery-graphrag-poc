/** The path of an orthogonal edge, with its corners rounded. */
import type { Point } from './layout'

const RADIUS = 10

/** An SVG path through `points` with each corner rounded. */
export function roundedPath(points: Point[]): string {
  const [first, ...rest] = points
  let path = `M${first.x},${first.y}`
  rest.forEach((point, i) => {
    const before = points[i]
    const after = rest[i + 1]
    if (!after) return void (path += ` L${point.x},${point.y}`)
    const inLength = Math.hypot(point.x - before.x, point.y - before.y)
    const outLength = Math.hypot(after.x - point.x, after.y - point.y)
    const r = Math.min(RADIUS, inLength / 2, outLength / 2)
    const start = {
      x: point.x - ((point.x - before.x) / inLength) * r,
      y: point.y - ((point.y - before.y) / inLength) * r,
    }
    const end = {
      x: point.x + ((after.x - point.x) / outLength) * r,
      y: point.y + ((after.y - point.y) / outLength) * r,
    }
    path += ` L${start.x},${start.y} Q${point.x},${point.y} ${end.x},${end.y}`
  })
  return path
}
