import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import {
  BUILDING,
  DOWN,
  READY,
  SHELL_API,
  failure,
  stubApi,
} from '../test/api-stub'

const DESTINATIONS = [
  [
    'Overview',
    'What we found, how the three approaches work, and questions to try',
  ],
  [
    'Live Lab',
    'Run one question through all three approaches and watch them work',
  ],
  [
    'Results',
    'Every official run, every question, every score, with intervals',
  ],
  [
    'Data Model',
    'What the warehouse, the graph and the ontology look like, with live counts and sample rows',
  ],
  [
    'Architecture',
    'The tech stack: the data platform, the graph and ontology layers on top, and what each part runs on',
  ],
  [
    'Help',
    'How it works, every benchmark question with its answer key, glossary, how to run it',
  ],
] as const

function sidebar() {
  return screen.getByRole('navigation', { name: 'Primary' })
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  window.localStorage.clear()
  stubApi(SHELL_API)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('shell navigation', () => {
  it('has six links in order, each described by its purpose sentence', () => {
    render(<App />)
    const links = within(sidebar()).getAllByRole('link')
    expect(links.map((link) => link.textContent?.trim())).toEqual(
      DESTINATIONS.map(([label]) => label),
    )
    DESTINATIONS.forEach(([label, purpose], index) => {
      expect(links[index]).toHaveAccessibleName(label)
      expect(links[index]).toHaveAccessibleDescription(purpose)
      expect(links[index]).toHaveAttribute('title', purpose)
    })
  })

  it('opens Overview by default and marks it as the current page', () => {
    render(<App />)
    expect(window.location.hash).toBe('#/overview')
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Help' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it.each([
    ['#/lab', '#/live-lab', 'Live Lab'],
    ['#/experiment', '#/overview', 'Overview'],
    ['#/dictionary', '#/data-model', 'Data Model'],
    ['#/semantic', '#/data-model', 'Data Model'],
    ['#/scenarios', '#/data-model', 'Data Model'],
    ['#/benchmark', '#/results', 'Results'],
    ['#/evidence', '#/live-lab', 'Live Lab'],
  ])('redirects the old %s to %s', (from, to, label) => {
    window.history.replaceState(null, '', `/${from}`)
    render(<App />)
    expect(window.location.hash).toBe(to)
    expect(screen.getByRole('link', { name: label })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it.each([
    ['#/live-lab', true],
    ['#/data-model', true],
    ['#/results', false],
    ['#/overview', false],
  ])('gives %s the wide page column: %s', (hash, wide) => {
    window.history.replaceState(null, '', `/${hash}`)
    render(<App />)
    const main = document.getElementById('main')
    expect(main?.classList.contains('max-w-[110rem]')).toBe(wide)
    expect(main?.classList.contains('max-w-7xl')).toBe(!wide)
  })

  it('follows a link to another destination', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Help' }))
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    )
  })

  it('collapses to icons only and remembers it for the browser', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('link', { name: 'Overview' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    expect(window.localStorage.getItem('sidebar-collapsed')).toBe('true')
    unmount()

    render(<App />)
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    // Each link keeps its name and description when only the icon shows.
    expect(
      screen.getByRole('link', { name: 'Live Lab' }),
    ).toHaveAccessibleDescription(DESTINATIONS[1][1])
  })
})

describe('header', () => {
  it('holds the product name, dataset, model status, presentation and Settings', async () => {
    render(<App />)
    const header = screen.getByRole('banner')
    expect(within(header).getByText('Semantic Context Lab')).toBeVisible()
    expect(await within(header).findByText('dev world, 2026')).toBeVisible()
    expect(
      await within(header).findByRole('button', { name: /Models: Ready/ }),
    ).toBeVisible()
    expect(
      within(header).getByRole('button', { name: 'Presentation mode' }),
    ).toBeVisible()
    expect(
      within(header).getByRole('button', { name: 'Settings' }),
    ).toBeVisible()
    expect(header).not.toHaveTextContent(/seed|version|\d+\.\d+\.\d+/i)
    expect(within(header).getAllByRole('button')).toHaveLength(3)
  })

  it('shows presentation mode as on with a filled button and the word On', async () => {
    const user = userEvent.setup()
    render(<App />)
    const toggle = screen.getByRole('button', { name: 'Presentation mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).not.toHaveTextContent('On')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveTextContent('On')
    expect(toggle).toHaveClass('bg-text-primary')
    window.history.replaceState(null, '', '/')
  })

  it('says Starting while the lab builds, and Not ready when a check fails', async () => {
    stubApi({
      ...SHELL_API,
      '/api/v1/health/ready': () => Response.json(BUILDING, { status: 503 }),
    })
    const { unmount } = render(<App />)
    expect(
      await screen.findByRole('button', { name: /Models: Starting/ }),
    ).toBeVisible()
    unmount()

    stubApi({
      ...SHELL_API,
      '/api/v1/health/ready': () => Response.json(DOWN, { status: 503 }),
    })
    render(<App />)
    expect(
      await screen.findByRole('button', { name: /Models: Not ready/ }),
    ).toBeVisible()
  })

  it('says Not ready when the server does not answer', async () => {
    stubApi({
      ...SHELL_API,
      '/api/v1/health/ready': () =>
        failure('The server did not answer.', true, 500),
    })
    render(<App />)
    expect(
      await screen.findByRole('button', { name: /Models: Not ready/ }),
    ).toBeVisible()
  })

  it('lists each check with its detail in a menu', async () => {
    stubApi({
      ...SHELL_API,
      '/api/v1/health/ready': () => Response.json(DOWN, { status: 503 }),
    })
    const user = userEvent.setup()
    render(<App />)
    await user.click(
      await screen.findByRole('button', { name: /Models: Not ready/ }),
    )
    const list = screen.getByRole('list', { name: 'Readiness checks' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    expect(list).toHaveTextContent('qwen3:8b is not listed by the model server')
    expect(list).toHaveTextContent('Answer model')
    await user.keyboard('{Escape}')
    expect(
      screen.queryByRole('list', { name: 'Readiness checks' }),
    ).not.toBeInTheDocument()
  })

  it('polls every 15 s while not ready and every 60 s once ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let ready = false
    const fetchMock = stubApi({
      ...SHELL_API,
      '/api/v1/health/ready': () =>
        ready ? Response.json(READY) : Response.json(DOWN, { status: 503 }),
    })
    const polls = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/health/ready'),
      ).length
    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(polls()).toBe(1)
    await act(() => vi.advanceTimersByTimeAsync(14_000))
    expect(polls()).toBe(1)
    ready = true
    await act(() => vi.advanceTimersByTimeAsync(1_500))
    expect(polls()).toBe(2)
    expect(
      await screen.findByRole('button', { name: /Models: Ready/ }),
    ).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(polls()).toBe(2)
    await act(() => vi.advanceTimersByTimeAsync(31_000))
    expect(polls()).toBe(3)
  })

  it('stops polling while the tab is hidden and checks again when it returns', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fetchMock = stubApi({
      ...SHELL_API,
      '/api/v1/health/ready': () => Response.json(DOWN, { status: 503 }),
    })
    const polls = () =>
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith('/health/ready'),
      ).length
    let hidden = false
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
    render(<App />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(polls()).toBe(1)

    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await act(() => vi.advanceTimersByTimeAsync(120_000))
    expect(polls()).toBe(1)

    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(polls()).toBe(2)
  })

  it('aborts the readiness request when it unmounts', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/health/ready'))
          signal = init?.signal ?? undefined
        return new Promise<Response>(() => undefined)
      }),
    )
    const { unmount } = render(<App />)
    await waitFor(() => expect(signal).toBeDefined())
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})

describe('Settings', () => {
  it('shows the API values as data, with plain labels', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    const value = async (label: string) =>
      (await within(dialog).findByText(label, { selector: 'dt' }))
        .nextElementSibling
    expect(await value('World number')).toHaveTextContent('2026')
    expect(await value('Scenario number')).toHaveTextContent('7')
    expect(await value('Generator version')).toHaveTextContent('0.2.0')
    expect(await value('Ontology version')).toHaveTextContent('2.0.0')
    expect(await value('Answer model')).toHaveTextContent('qwen3:8b')
    expect(await value('Embedding model')).toHaveTextContent('bge-m3')
    // The status never breaks across lines.
    expect(await within(dialog).findByText('Not checked')).toHaveClass(
      'whitespace-nowrap',
    )
    const labels = within(dialog)
      .getAllByRole('term')
      .map((term) => term.textContent)
    expect(labels.join(' ')).not.toMatch(/seed|rerank/i)
  })

  it('shows an error panel with Retry when the values do not load', async () => {
    const user = userEvent.setup()
    // Help's two sections that need data get an empty bank, so only Settings fails.
    window.history.replaceState(null, '', '/#/help')
    let answers = 0
    stubApi({
      ...SHELL_API,
      '/api/v1/benchmarks/questions': [],
      '/api/v1/scenarios': [],
      '/api/v1/models': () =>
        ++answers === 1
          ? failure('The server did not answer.', true)
          : Response.json(SHELL_API['/api/v1/models']),
    })
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server did not answer.',
    )
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/qwen3:8b/)).toBeVisible()
  })

  it('stores reduced motion and the visible-node cap per browser', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('checkbox', { name: 'Reduce motion' }))
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Visible nodes' }),
      {
        target: { value: '40' },
      },
    )
    expect(window.localStorage.getItem('reduced-motion')).toBe('true')
    expect(window.localStorage.getItem('visible-node-cap')).toBe('40')
    unmount()

    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(
      screen.getByRole('checkbox', { name: 'Reduce motion' }),
    ).toBeChecked()
    expect(
      screen.getByRole('spinbutton', { name: 'Visible nodes' }),
    ).toHaveValue(40)
  })

  it('defaults the cap to 24 and keeps it between 12 and 60', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const cap = screen.getByRole('spinbutton', { name: 'Visible nodes' })
    expect(cap).toHaveValue(24)
    expect(cap).toHaveAttribute('min', '12')
    expect(cap).toHaveAttribute('max', '60')
    fireEvent.change(cap, { target: { value: '500' } })
    expect(window.localStorage.getItem('visible-node-cap')).toBe('60')
    fireEvent.change(cap, { target: { value: '2' } })
    expect(window.localStorage.getItem('visible-node-cap')).toBe('12')
  })
})

describe('storage failures', () => {
  it('leave the shell working when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getAllByRole('link')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('checkbox', { name: 'Reduce motion' }))
    expect(
      screen.getByRole('checkbox', { name: 'Reduce motion' }),
    ).toBeChecked()
    expect(
      screen.getByRole('spinbutton', { name: 'Visible nodes' }),
    ).toHaveValue(24)
  })
})

describe('skip link', () => {
  it('keeps the route when the skip link is used, and focuses the main area', async () => {
    const user = userEvent.setup()
    window.history.replaceState(null, '', '/#/help')
    render(<App />)
    await user.click(screen.getByRole('link', { name: 'Skip to content' }))
    expect(window.location.hash).toBe('#/help')
    expect(document.getElementById('main')).toHaveFocus()
  })
})

describe('reduced motion', () => {
  it('applies reduced motion to the whole document, drawers included', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('checkbox', { name: 'Reduce motion' }))
    const root = document.documentElement
    expect(root).toHaveClass('reduced-motion')
    // The portalled drawer sits under the root class, so the stylesheet's
    // `.reduced-motion *` rule reaches it.
    expect(screen.getByRole('dialog').closest('.reduced-motion')).toBe(root)
    await user.click(screen.getByRole('checkbox', { name: 'Reduce motion' }))
    expect(root).not.toHaveClass('reduced-motion')
  })

  it('shows the manual reduce-motion value, and says when the system asks for it', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(
      screen.getByRole('checkbox', { name: 'Reduce motion' }),
    ).not.toBeChecked()
    expect(screen.getByText('Set by your system')).toBeVisible()
    expect(document.documentElement).toHaveClass('reduced-motion')
  })

  it('shows no system note when the system does not ask', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.queryByText(/your system asks/)).toBeNull()
  })
})
