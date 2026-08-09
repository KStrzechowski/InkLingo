// The axios interceptor in api/client.ts runs outside React; AuthContext
// lives inside it. Neither should reach into the other, so they meet here —
// the same shape as userManager.events, which AuthProvider already consumes.
//
// "Connection issue" is deliberately vague: a CORS-blocked authorizer
// rejection and a real network outage are indistinguishable to the client by
// design of the browser's security boundary, so the signal covers both and
// the UI offers the one action that fixes the auth half.

let active = false
const listeners = new Set<(active: boolean) => void>()

function setActive (next: boolean): void {
  if (active === next) {
    return
  }
  active = next
  for (const listener of listeners) {
    listener(next)
  }
}

export function signalConnectionIssue (): void {
  setActive(true)
}

export function clearConnectionIssue (): void {
  setActive(false)
}

export function onConnectionIssueChange (listener: (active: boolean) => void): () => void {
  listeners.add(listener)
  // Hand over the current value immediately, not just subsequent changes:
  // setActive only notifies on a transition, so a subscriber arriving while a
  // signal already stands would otherwise sit at its own default until the
  // next one. Today AuthProvider is the root and mounts before any request
  // fires, which hides this — a second subscriber, or a provider that
  // remounts, would not be so lucky.
  listener(active)
  return () => {
    listeners.delete(listener)
  }
}
