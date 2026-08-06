/**
 * The last line of defence against a white screen.
 *
 * A render error anywhere under here — a reference-data shape that changed, a
 * chart handed a value it cannot draw, a view built against a field a game
 * patch removed — unmounts the whole React tree by default and leaves the user
 * staring at nothing. That failure mode is indistinguishable from "the app is
 * broken", which is exactly the impression this project cannot afford to give
 * about a save it could not read.
 *
 * So: one boundary per view, keyed on the view id so switching tabs clears the
 * error, plus one at the root for anything the per-view ones miss.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** What broke, in the user's terms — "the map", "this save". */
  what: string
  /** Rendered instead of the default message. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Nothing is reported anywhere — there is no telemetry in this app and
    // there is not going to be. The console is the whole channel.
    console.error(`[${this.props.what}]`, error, info.componentStack)
  }

  reset = () => this.setState({ error: undefined })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="label">something went wrong in {this.props.what}</div>
        <p className="max-w-xl text-sm text-[var(--color-muted)]">
          This is a bug in the viewer, not a problem with your save. The rest of
          the app still works — try another view, or reload to start over.
        </p>
        <p className="num max-w-xl text-xs break-words text-[var(--color-el-fire)]">
          {error.message}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-[6px] border border-[var(--color-line)] px-3 py-1.5 text-sm transition-colors hover:border-[var(--color-signal)]"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-[6px] border border-[var(--color-line)] px-3 py-1.5 text-sm transition-colors hover:border-[var(--color-signal)]"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
