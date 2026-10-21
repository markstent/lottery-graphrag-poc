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

describe('Drawer focus', () => {
  it('returns focus to the canvas node when the opener has been removed', async () => {
    const user = userEvent.setup()
    function Page() {
      const [open, setOpen] = useState(false)
      const [opener, setOpener] = useState(true)
      return (
        <>
          <button type="button" data-node-id="N1" tabIndex={0}>
            Node
          </button>
          {opener && (
            <button type="button" onClick={() => setOpen(true)}>
              Open it
            </button>
          )}
          <Drawer open={open} title="Details" onClose={() => setOpen(false)}>
            <button type="button" onClick={() => setOpener(false)}>
              Remove opener
            </button>
          </Drawer>
        </>
      )
    }
    render(<Page />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await user.click(screen.getByRole('button', { name: 'Remove opener' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Node' })).toHaveFocus()
  })

  it('falls back to the main area when there is no node and no opener', async () => {
    const user = userEvent.setup()
    function Page() {
      const [open, setOpen] = useState(false)
      const [opener, setOpener] = useState(true)
      return (
        <>
          <main id="main" tabIndex={-1}>
            {opener && (
              <button type="button" onClick={() => setOpen(true)}>
                Open it
              </button>
            )}
          </main>
          <Drawer open={open} title="Details" onClose={() => setOpen(false)}>
            <button type="button" onClick={() => setOpener(false)}>
              Remove opener
            </button>
          </Drawer>
        </>
      )
    }
    const { container } = render(<Page />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await user.click(screen.getByRole('button', { name: 'Remove opener' }))
    await user.keyboard('{Escape}')
    expect(container.querySelector('main')).toHaveFocus()
  })

  it('still wraps Tab and Shift+Tab after the content changes while open', async () => {
    const user = userEvent.setup()
    function Page() {
      const [open, setOpen] = useState(false)
      const [loaded, setLoaded] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open it
          </button>
          <Drawer open={open} title="Details" onClose={() => setOpen(false)}>
            {loaded ? (
              <button type="button">Ready content</button>
            ) : (
              <button type="button" onClick={() => setLoaded(true)}>
                Retry
              </button>
            )}
          </Drawer>
        </>
      )
    }
    render(<Page />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus()
    await user.keyboard('{Enter}')
    // The focused Retry button is gone; focus has fallen to the page.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Ready content' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Ready content' })).toHaveFocus()
  })
})
