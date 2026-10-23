/**
 * The elements a Tab key press can reach: links, enabled form controls and
 * anything given a tab index other than -1, minus those that are hidden or
 * not displayed, which the browser skips.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isShown(element: HTMLElement): boolean {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (node.hidden || window.getComputedStyle(node).display === 'none')
      return false
  }
  return true
}

/** The focusable elements under `root`, in document order. */
export function focusableIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    isShown,
  )
}
