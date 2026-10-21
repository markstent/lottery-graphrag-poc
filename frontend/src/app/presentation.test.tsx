import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { SHELL_API, stubApi } from '../test/api-stub'
import { useRegisterReplay, type KeyedReplay } from './presentation'
import { SettingsProvider } from './settings'
import { Shell } from './shell'

function fakeReplay(playing = false) {
  const replay = {
    play: vi.fn(),
    pause: vi.fn(),
    step: vi.fn(),
    reset: vi.fn(),
    snapshot: () => ({ playing }),
  }
  return replay satisfies KeyedReplay
}

/** A view that registers its replay, as Live Lab will. */
function View({ replay }: { replay: KeyedReplay }) {
  useRegisterReplay(replay)
  return (
    <>
      <input aria-label="Question" />
      <button type="button">Run</button>
    </>
  )
}

function renderPresenting(replay: KeyedReplay) {
  window.history.replaceState(null, '', '/?present=1#/live-lab')
  return render(
    <SettingsProvider>
      <Shell>
        <View replay={replay} />
      </Shell>
    </SettingsProvider>,
  )
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  window.localStorage.clear()
  document.documentElement.className = ''
  stubApi(SHELL_API)
})

afterEach(() => vi.unstubAllGlobals())

describe('presentation mode', () => {
  it('hides the sidebar, raises the type scale and keeps the header', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Presentation mode' }))
    expect(
      screen.queryByRole('navigation', { name: 'Primary' }),
    ).not.toBeInTheDocument()
    expect(document.documentElement).toHaveClass('presentation')
    expect(screen.getByRole('banner')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Presentation mode' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(window.location.search).toBe('?present=1')

    await user.click(screen.getByRole('button', { name: 'Presentation mode' }))
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    expect(document.documentElement).not.toHaveClass('presentation')
    expect(window.location.search).toBe('')
  })

  it('is kept across a reload by ?present=1', () => {
    window.history.replaceState(null, '', '/?present=1')
    render(<App />)
    expect(
      screen.queryByRole('navigation', { name: 'Primary' }),
    ).not.toBeInTheDocument()
    expect(document.documentElement).toHaveClass('presentation')
  })

  it('sends Space, the right arrow and R to the active replay', () => {
    const replay = fakeReplay(false)
    renderPresenting(replay)
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(replay.play).toHaveBeenCalledOnce()
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(replay.step).toHaveBeenCalledWith(1)
    fireEvent.keyDown(document.body, { key: 'r' })
    expect(replay.reset).toHaveBeenCalledOnce()
  })

  it('pauses with Space while the replay plays', () => {
    const replay = fakeReplay(true)
    renderPresenting(replay)
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(replay.pause).toHaveBeenCalledOnce()
    expect(replay.play).not.toHaveBeenCalled()
  })

  it('takes a held key once, not on every repeat', () => {
    const replay = fakeReplay()
    renderPresenting(replay)
    fireEvent.keyDown(document.body, { key: ' ' })
    fireEvent.keyDown(document.body, { key: ' ', repeat: true })
    fireEvent.keyDown(document.body, { key: ' ', repeat: true })
    fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true })
    expect(replay.play).toHaveBeenCalledOnce()
    expect(replay.step).not.toHaveBeenCalled()
  })

  it('does not take keys typed in an input or pressed on a button', () => {
    const replay = fakeReplay()
    renderPresenting(replay)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Question' }), {
      key: ' ',
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Question' }), {
      key: 'r',
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Question' }), {
      key: 'ArrowRight',
    })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Run' }), { key: ' ' })
    expect(replay.play).not.toHaveBeenCalled()
    expect(replay.reset).not.toHaveBeenCalled()
    expect(replay.step).not.toHaveBeenCalled()
  })

  it('does nothing with these keys when presentation mode is off', () => {
    const replay = fakeReplay()
    window.history.replaceState(null, '', '/#/live-lab')
    render(
      <SettingsProvider>
        <Shell>
          <View replay={replay} />
        </Shell>
      </SettingsProvider>,
    )
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(replay.play).not.toHaveBeenCalled()
  })

  it('stops reaching a replay once its view unmounts', () => {
    const replay = fakeReplay()
    const { unmount } = renderPresenting(replay)
    unmount()
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(replay.play).not.toHaveBeenCalled()
  })
})
