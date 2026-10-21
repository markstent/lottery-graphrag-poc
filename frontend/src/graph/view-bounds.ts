/**
 * Which nodes the current viewport does not fully show. The canvas uses it to
 * say when evidence is out of view, so nothing on an evidence path is cropped
 * without a word.
 */

export interface Placed {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** The ids of `nodes`, in the order given, that are not wholly inside a frame of `size` at `viewport`. */
export function outOfView(
  nodes: readonly Placed[],
  viewport: Viewport,
  size: { width: number; height: number },
): string[] {
  return nodes
    .filter((n) => {
      const left = n.x * viewport.zoom + viewport.x
      const top = n.y * viewport.zoom + viewport.y
      return !(
        left >= 0 &&
        top >= 0 &&
        left + n.width * viewport.zoom <= size.width &&
        top + n.height * viewport.zoom <= size.height
      )
    })
    .map((n) => n.id)
}

/** "2 evidence nodes out of view"; empty when none are. */
export function outOfViewNote(count: number): string {
  if (count === 0) return ''
  return `${count} evidence ${count === 1 ? 'node' : 'nodes'} out of view`
}

/** The next id after `last` in `ids`, wrapping to the first. */
export function nextAfter(
  ids: readonly string[],
  last: string | null,
): string | undefined {
  const at = last === null ? -1 : ids.indexOf(last)
  return ids[(at + 1) % ids.length]
}
