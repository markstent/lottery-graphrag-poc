import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { Drawer } from './drawer'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      <Drawer open={open} title="Details" onClose={() => setOpen(false)}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Drawer>
    </>
  )
}

describe('Drawer', () => {
  it('is a modal dialog named by its title', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }))
    const dialog = screen.getByRole('dialog', { name: 'Details' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('traps focus and returns it to the opener', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    await user.click(opener)

    const close = screen.getByRole('button', { name: 'Close' })
    const first = screen.getByRole('button', { name: 'First' })
    const last = screen.getByRole('button', { name: 'Last' })
    expect(close).toHaveFocus()

    await user.tab()
    expect(first).toHaveFocus()
    await user.tab()
    expect(last).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes from its Close button and returns focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open it' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
