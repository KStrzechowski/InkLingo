# Manual Verification Guide — testing-auth-resilience

Every automated check in `plan.md`'s Progress section passed and is committed.
These are the rows still open, in the order that costs you the least
setup-teardown. Tick them off in `plan.md`'s `## Progress` as you go.

| Row | What | Where |
|---|---|---|
| 1.4 | `.env.test` dummy values win over a real `.env` | terminal, ~1 min |
| 2.3 | Breaking the renewal dedupe fails its test | terminal, ~2 min |
| 5.2 | Updated `test-plan.md` sections read accurately | reading, ~5 min |
| 3.3 | Backend down → one retry, then the banner | running app, ~10 min |
| 3.4 | Backend back up → banner self-clears | running app, continues 3.3 |
| 4.2 | New CI step runs and passes on an open PR | GitHub, ~10 min |
| 4.3 | A deliberately failing test turns *that* step red | GitHub, continues 4.2 |

All commands assume `cd frontend` unless stated otherwise. This is a Windows
box, so shell-specific steps give both PowerShell and Git Bash forms; `npm`,
`git` and `gh` invocations are identical in either.

---

## 1.4 — `.env.test` beats a real `.env`

This is the one that protects CI: `deploy.yml`/`pr-diff.yml` write a real
`frontend/.env` from deployed stack outputs in the same job that runs the
tests. `test/env.test.ts` asserts the precedence on every run, so what's left
is confirming it holds with a real `.env` actually present.

PowerShell:

```powershell
cd frontend
# -Encoding ascii is load-bearing: Out-File / bare `>` write UTF-16 in
# Windows PowerShell 5.1, which Vite's env parser won't read as intended.
Set-Content -Path .env -Encoding ascii -Value @(
  'VITE_COGNITO_USER_POOL_ID=eu-central-1_REALVALUE',
  'VITE_COGNITO_CLIENT_ID=realclientid'
)
npm test
Remove-Item .env
```

Git Bash / POSIX:

```bash
cd frontend
printf 'VITE_COGNITO_USER_POOL_ID=eu-central-1_REALVALUE\nVITE_COGNITO_CLIENT_ID=realclientid\n' > .env
npm test
rm .env
```

Creating `frontend/.env` by hand in an editor works just as well — the file
content is the point, not how it gets there.

**Pass:** the suite is green — `test/env.test.ts` still sees
`eu-central-1_testplaceholder`. A failure here would name the real value in
the diff.

**Do not leave `.env` behind** — unlike `.env.development` and
`.env.production`, it is not in `frontend/.gitignore`.

*(Already run once during implementation with this exact result; re-run if you
want to see it yourself.)*

---

## 2.3 — The dedupe test actually catches the regression

Proves `test/auth/cognito.test.ts`'s concurrency case isn't vacuous.

```bash
cd frontend
# In src/auth/cognito.ts line ~56, change:
#   renewal ??= userManager.signinSilent()
# to:
#   renewal = userManager.signinSilent()
npm test
```

**Pass:** exactly one failure —
`getFreshUser > dedupes concurrent renewals into a single signinSilent call`,
reporting `expected "vi.fn()" to be called 1 times, but got 3 times`.

Then revert:

```bash
git checkout -- src/auth/cognito.ts
npm test   # back to 28 passed
```

*(Already run once during implementation with this exact result.)*

---

## 5.2 — Read the updated `test-plan.md` sections

Open `context/foundation/test-plan.md` and check these four against what
actually shipped:

- **§3 rollout table** — Phase 3's Status is `complete`.
- **§4 Stack**, "unit + integration (frontend/extension)" row — should name
  Vitest / `@testing-library/react` / jsdom with versions, say tests live in
  `frontend/test/` with no globals, and keep the *extension* half explicitly
  pending Phase 5. Check the versions still match `frontend/package.json`.
- **§5 Quality Gates**, "frontend unit + integration" row — reads `enforced`,
  names both workflows, and states the PR-path caveat honestly: `deploy.yml`
  is auto-gated by `deploy` `needs: diff`, but the PR path still wants a
  required-status-check rule on `pr-diff.yml`'s `diff` job (Settings →
  Branches). That's the same open item the backend row already carries — one
  rule covers both, since both test steps live in that same job.
- **§6.3 cookbook** — this is the section a future test author will actually
  follow. Worth checking the `vi.mock` snippet against a real file
  (`test/auth/cognito.test.ts`) rather than just reading it.
- **§7 negative space** — the `automaticSilentRenew` entry should say the
  config is asserted and the timer behavior is not, and say why (mocking the
  module means testing it would only exercise the fake).

---

## 3.3 / 3.4 — Backend down → banner → backend up → banner clears

The end-to-end check on the only new production code in this change. Two
terminals.

**Setup**

```bash
# terminal 1 — leave the backend STOPPED for now
# terminal 2
cd frontend && npm run dev     # http://localhost:5173
```

`frontend/.env.development` points `VITE_API_BASE_URL` at
`http://localhost:3000`, so with nothing listening there every API call fails
response-less — the same shape a CORS-blocked authorizer rejection has, which
is exactly the case the banner exists for.

**3.3 — one retry, then the banner**

1. Open http://localhost:5173 and sign in through Cognito (the hosted UI
   works with the backend down — it never touches your API).
2. You land on the collections list, which fires `GET /api/collections`.
3. Open DevTools → Network **before** the list loads if you can, or reload
   once with it open.

**Pass, all three:**
- The Network panel shows **exactly two** `/api/collections` attempts, not one
  and not a growing stream. Two is the whole point — the one-shot
  `_connectionRetried` marker on the retried config is what stops axios from
  re-retrying its own retry forever.
- A banner appears above "Signed in as …" reading *"We can't reach the server.
  This is usually a connection problem, but your session may also have ended."*
- Clicking **Sign in again** sends you to the Cognito hosted UI. (You can come
  straight back — this only proves the button is wired to `login()`.)

**Fail signals worth naming:** more than two attempts means the retry marker
isn't sticking; zero banner with two attempts means the signal isn't reaching
`AuthContext`; being logged out means something is forcing a logout, which
this change deliberately does *not* do.

**3.4 — banner self-clears**

1. Start the backend: `cd backend && npm run dev`.
2. Back in the browser, **do not reload** — a reload resets module state and
   proves nothing. Instead trigger a fresh request from the UI: type a name in
   the collection form, pick languages, and hit **Create**.

**Pass:** the banner disappears on its own the moment that request succeeds,
with no dismiss button involved. The success interceptor calls
`clearConnectionIssue()`, which is the whole reason this is a banner and not a
forced logout — ambiguous evidence shouldn't kick a user out of their session
over a wifi blip.

---

## 4.2 / 4.3 — The CI step gates a real PR

`4.1` (the exact command CI runs, `npm ci && npm test`) already passes
locally. What's left needs GitHub.

**4.2 — the step runs and passes**

```bash
git checkout -b verify/frontend-ci-gate
git push -u origin verify/frontend-ci-gate
gh pr create --fill --base main
gh pr checks --watch
```

**Pass:** the `diff` job shows a **Run frontend tests** step, it passes, and it
sits *before* "Write frontend env from deployed stack outputs" — that ordering
is deliberate, so the suite runs before real Cognito values are ever written to
disk.

**4.3 — it goes red for the right reason**

```bash
# break one assertion, e.g. in frontend/test/App.test.tsx change
#   expect(state.login).toHaveBeenCalledTimes(1)
# to
#   expect(state.login).toHaveBeenCalledTimes(2)
git commit -am "temp: prove the CI gate is real" && git push
gh pr checks --watch
```

**Pass:** the `diff` job fails **on the "Run frontend tests" step
specifically** — not on "Build frontend", not on the backend steps. The
distinction matters: a failure on the build step would mean the gate is really
just the typecheck, which is what already existed.

Then revert and confirm green:

```bash
git revert --no-edit HEAD && git push
gh pr checks --watch
```

Close the PR without merging (`gh pr close`), and delete the branch.

**Note on `deploy.yml`:** its copy of the step is in the `diff` job, and
`deploy` declares `needs: diff` — a red frontend test skips the deploy
automatically, no branch-protection setting required. That path is confirmed by
reading the workflow; the first real push to `main` will exercise it.

---

## Known, unrelated

`npm audit` in `frontend/` reports one high-severity advisory in `postcss`.
It arrives transitively through `vite@8.1.3` and predates this change — none
of the four packages added here pull it in (`npm ls postcss` shows the single
`vite → postcss` path). Out of scope; worth its own look when you next touch
frontend dependencies.

dummy commit