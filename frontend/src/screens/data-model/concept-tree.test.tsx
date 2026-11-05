import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ONTOLOGY, stubOntology } from './ontology.fixtures'
import { OntologyTab } from './ontology-tab'

const names = () =>
  screen.getAllByRole('treeitem').map((item) => item.textContent)

async function open(concept = 'CONCEPT_LOTTERY_PRODUCT') {
  window.history.replaceState(
    null,
    '',
    `/#/data-model?tab=concepts&concept=${concept}`,
  )
  stubOntology()
  render(
    <OntologyTab
      params={new URLSearchParams(`tab=concepts&concept=${concept}`)}
    />,
  )
  await screen.findByRole('tree', { name: 'Concepts' })
}

/** Tab past the search box, which comes first, onto the tree's one tab stop. */
const enterTree = async () => {
  await userEvent.tab()
  await userEvent.tab()
}

beforeEach(() => window.history.replaceState(null, '', '/#/data-model'))
afterEach(() => vi.unstubAllGlobals())

describe('the concept tree', () => {
  it('shows the roots and the path to the selected concept, expanded', async () => {
    await open('CONCEPT_NATIONAL_DRAW')
    const roots = ONTOLOGY.concepts.filter((c) => c.parent_id === null).length
    expect(
      screen
        .getAllByRole('treeitem')
        .filter((item) => item.getAttribute('aria-level') === '1'),
    ).toHaveLength(roots)
    expect(
      screen.getByRole('treeitem', { name: /National Draw/ }),
    ).toHaveAttribute('aria-level', '3')
    expect(screen.getByRole('treeitem', { name: /Draw game/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('has one tab stop, on the selected concept', async () => {
    await open('CONCEPT_NATIONAL_DRAW')
    const stops = screen
      .getAllByRole('treeitem')
      .filter((i) => i.tabIndex === 0)
    expect(stops).toHaveLength(1)
    expect(stops[0]).toHaveTextContent('National Draw')
  })

  it('moves with the arrow keys, Home and End without selecting', async () => {
    await open()
    await enterTree()
    expect(
      screen.getByRole('treeitem', { name: /Lottery product/ }),
    ).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('treeitem')[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(screen.getAllByRole('treeitem')[0]).toHaveFocus()
    await userEvent.keyboard('{End}')
    const items = screen.getAllByRole('treeitem')
    expect(items[items.length - 1]).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(items[0]).toHaveFocus()
    expect(window.location.hash).toBe(
      '#/data-model?tab=concepts&concept=CONCEPT_LOTTERY_PRODUCT',
    )
    expect(items.filter((i) => i.tabIndex === 0)).toEqual([items[0]])
  })

  it('expands with Right, then moves into the first child', async () => {
    await open()
    await enterTree()
    const top = screen.getByRole('treeitem', { name: /Lottery product/ })
    await userEvent.keyboard('{ArrowLeft}')
    expect(top).toHaveAttribute('aria-expanded', 'false')
    expect(names()).not.toContain('Draw game')
    await userEvent.keyboard('{ArrowRight}')
    expect(top).toHaveAttribute('aria-expanded', 'true')
    expect(top).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('treeitem', { name: /Draw game/ })).toHaveFocus()
  })

  it('collapses with Left, and Left on a leaf or collapsed item goes to its parent', async () => {
    await open('CONCEPT_NATIONAL_DRAW')
    await enterTree()
    expect(
      screen.getByRole('treeitem', { name: /National Draw/ }),
    ).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('treeitem', { name: /Draw game/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('treeitem', { name: /Draw game/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(names().some((n) => n?.includes('National Draw'))).toBe(false)
  })

  it('selects with Enter and with Space, which updates the address', async () => {
    await open()
    await enterTree()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{Enter}')
    expect(window.location.hash).toBe(
      '#/data-model?tab=concepts&concept=CONCEPT_DRAW_GAME',
    )
    await userEvent.keyboard('{ArrowDown}{ }')
    expect(window.location.hash).toBe(
      '#/data-model?tab=concepts&concept=CONCEPT_NATIONAL_DRAW',
    )
  })

  it('marks the selected concept for assistive technology, not by colour alone', async () => {
    await open('CONCEPT_NATIONAL_DRAW')
    const selected = screen.getAllByRole('treeitem', { selected: true })
    expect(selected).toHaveLength(1)
    expect(selected[0]).toHaveTextContent('National Draw')
  })
})
