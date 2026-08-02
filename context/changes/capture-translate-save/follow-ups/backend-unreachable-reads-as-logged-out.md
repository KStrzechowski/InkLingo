# An unreachable backend renders as a login screen

Found during S-03's manual verification (2026-08-02), while setting up step 6
of `pending-manual-checks.md` — the check that stops the backend and captures a
word. Not a regression in this slice; the behaviour has been there since the
popup was written in Phase 4. Recorded here rather than fixed because it is
cosmetic in production terms and S-03 was already verified.

## Symptom

With the backend down, opening the popup shows the **logged-out** screen with a
**Log in** button, even though valid tokens are sitting in `browser.storage`.
Clicking Log in completes the Cognito round trip successfully — Cognito is a
different host and is perfectly reachable — and then lands back on the same
logged-out screen, because the step that actually failed runs again and fails
again. The user is invited into a loop that cannot terminate.

## Cause

`extension/src/popup/App.tsx:70-84`:

```ts
async function bootstrap () {
  const { authenticated } = await sendMessage({ type: 'auth-status' })
  if (!authenticated) { setStatus('anonymous'); return }
  await loadCollections()          // ← throws when the API is unreachable
  setStatus('ready')
}
bootstrap().catch((err: unknown) => {
  setError(errorText(err))
  setStatus('anonymous')           // ← conflates "no token" with "fetch failed"
})
```

The auth check is not the thing that fails. `auth-status` resolves to
`isAuthenticated()` in the background script (`background.ts:54-55`), which
reads stored tokens and correctly returns `true`. It is `loadCollections()` —
`list-collections` → `apiFetch('/api/collections')` — that rejects, and the one
`.catch` covering the whole bootstrap treats any failure as anonymity.

The error text *is* rendered (`setError` on the line above), so the screen shows
a network error and a Log in button at the same time. The mixed signal is what
makes the login button look like the remedy.

## Why it mattered more than it looks

It blocked a verification step rather than a user. Firefox destroys the popup on
blur, so "stop the backend, then capture" cannot be driven from the toolbar
popup — alt-tabbing to the terminal re-mounts the popup against the dead backend
and lands on this screen. The workaround is to open
`moz-extension://<internal-uuid>/popup.html` as a normal tab while the backend
is still up; a tab does not close on blur, so its state survives the switch.
That is now recorded at the top of `pending-manual-checks.md`.

## Fix when it comes up

Separate the two failures. `status: 'anonymous'` should be reachable only from
`authenticated === false`; a rejection from `loadCollections()` belongs in a
distinct state — `ready` with an error banner and a retry, or an explicit
`unavailable` — that keeps the session and does not offer a login that cannot
help. Roughly:

```ts
bootstrap().catch((err: unknown) => {
  setError(errorText(err))
  setStatus(authenticated ? 'ready' : 'anonymous')
})
```

which needs `authenticated` hoisted out of the inner scope.

Worth folding into whichever slice next touches the popup's shell rather than
opening a change for it alone. S-05 (`pronunciation-playback`) is the likely
candidate, since it adds controls to the same component.
