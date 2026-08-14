import { Component, type ErrorInfo, type ReactNode } from 'react'
import { report } from './reporter'

// A class component on purpose. React offers no hook equivalent of
// componentDidCatch, and react-router 8's declarative <Routes> API (App.tsx)
// gives no errorElement to hang one on — that is a data-router feature. So
// this is the only shape available without migrating the router, which is a
// much larger decision than catching a render crash warrants.
//
// What this changes: React 19's default onUncaughtError already dispatches a
// window 'error' event, so globalHandlers.ts was *reporting* render crashes
// before this existed. What it could not do is stop React unmounting the whole
// root — the user got a blank white page with no message and no way back
// except a manual reload. Evidence without recovery.

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError (): State {
    return { failed: true }
  }

  componentDidCatch (error: Error, info: ErrorInfo): void {
    report({
      name: error.name,
      message: error.message,
      stack: error.stack,
      routePath: window.location.pathname,
      request: {
        // The component stack is the part a stack trace alone does not give —
        // which tree the crash happened in, not just which function threw.
        bodyKeys: info.componentStack
          ?.split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .slice(0, 10)
      }
    })
  }

  render (): ReactNode {
    if (!this.state.failed) {
      return this.props.children
    }

    // Deliberately plain: whatever crashed may well be the styling or a shared
    // component, so this leans on nothing but the reset stylesheet.
    return (
      <div role="alert">
        <h1>Something broke on this page</h1>
        <p>
          The problem has been recorded. Reloading usually clears it — your saved
          collections are unaffected.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload the page
        </button>
      </div>
    )
  }
}
