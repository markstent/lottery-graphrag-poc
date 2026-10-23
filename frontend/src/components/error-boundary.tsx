/**
 * Catches what a screen throws while it renders or loads (a lazy chunk that
 * fails to fetch), so the shell stays and the reader gets a plain message
 * with a way to try again, not a blank page.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Panel } from './panel'

interface Props {
  /** What failed, as the panel's title ("This page"). */
  title: string
  children: ReactNode
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A screen failed to render', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Panel
        state="error"
        title={this.props.title}
        error={new Error('This page could not be loaded.')}
        action={{
          label: 'Reload page',
          onClick: () => window.location.reload(),
        }}
      />
    )
  }
}
