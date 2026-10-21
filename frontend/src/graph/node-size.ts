/** The size of every node on the canvas, and the type size inside it. */
export interface NodeSize {
  width: number
  height: number
  /** Label type size in px: at least 14, or 20 in presentation mode. */
  font: number
}

export const NODE_SIZE: NodeSize = { width: 260, height: 64, font: 14 }
export const PRESENTATION_NODE_SIZE: NodeSize = {
  width: 340,
  height: 92,
  font: 20,
}
