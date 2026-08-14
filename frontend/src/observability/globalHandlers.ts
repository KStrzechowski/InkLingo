import { report } from './reporter'

// Failures that never pass through axios — a render crash, a rejected promise
// nobody awaited. These are the ones no handler was written for, which is
// exactly why they are worth capturing.

function describe (reason: unknown): { name: string, message: string, stack?: string } {
  if (reason instanceof Error) {
    return { name: reason.name, message: reason.message, stack: reason.stack }
  }
  // A rejection can carry anything — a string, an object, undefined. String()
  // keeps the report honest about what actually happened.
  return { name: 'UnhandledRejection', message: String(reason) }
}

export function installGlobalErrorReporting (target: Window = window): void {
  target.addEventListener('error', (event: ErrorEvent) => {
    const described = event.error instanceof Error
      ? describe(event.error)
      : { name: 'Error', message: event.message }
    report({ ...described, routePath: target.location.pathname })
  })

  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    report({ ...describe(event.reason), routePath: target.location.pathname })
  })
}
