import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { DESTINATIONS } from './app/router'
import { SHELL_API, stubApi } from './test/api-stub'

beforeEach(() => {
  window.localStorage.clear()
  stubApi(SHELL_API)
})

afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('renders the application shell with primary navigation', async () => {
    window.history.replaceState(null, '', '/#/help')
    render(<App />)

    expect(screen.getByText('Semantic Context Lab')).toBeVisible()
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(nav).toBeVisible()
    expect(screen.getByRole('link', { name: 'Live Lab' })).toHaveAttribute(
      'href',
      '#/live-lab',
    )
    expect(screen.getByRole('link', { name: 'Data Model' })).toHaveAttribute(
      'href',
      '#/data-model',
    )
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute(
      'href',
      '#/help',
    )
    await screen.findByTestId('screen')
  })

  describe.each(DESTINATIONS)('$label', ({ name, label, purpose }) => {
    const open = () => {
      window.history.replaceState(null, '', `/#/${name}`)
      return render(<App />)
    }

    it('opens its own screen: the purpose sentence, then its heading', async () => {
      open()
      const frame = await screen.findByTestId('screen')
      expect(frame.firstElementChild).toHaveTextContent(purpose)
      expect(
        screen.getByRole('heading', { level: 1, name: label }),
      ).toBeVisible()
      expect(
        screen.getByRole('link', { name: new RegExp(`^${label}$`) }),
      ).toHaveAttribute('aria-current', 'page')
    })

    it('in presentation mode hides the navigation and raises the type scale', async () => {
      const user = userEvent.setup()
      open()
      await screen.findByTestId('screen')
      expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible()
      expect(document.documentElement).not.toHaveClass('presentation')

      await user.click(
        screen.getByRole('button', { name: 'Presentation mode' }),
      )
      expect(
        screen.queryByRole('navigation', { name: 'Primary' }),
      ).not.toBeInTheDocument()
      expect(document.documentElement).toHaveClass('presentation')
      expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
    })
  })
})
