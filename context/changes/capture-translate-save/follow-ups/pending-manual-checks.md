# Pending manual checks — capture-translate-save

Deferred on 2026-07-31 at the user's request. Neither blocks anything already
shipped; both need a human at a browser. Written up here so they can be run
without re-deriving the setup.

---

## 1. Plan criterion 4.8 — rate-limit error state in the popup

**Progress row**: `### Phase 4` → `- [ ] 4.8 A deliberately-triggered rate-limit shows a clean, non-crashing error state in the popup`

**What it asserts**: that a 429 from `POST /api/collections/:id/translate` renders as a readable message in the popup rather than a crash or a stuck "Translating…" spinner. The limiter itself was already verified by criterion 2.5 — this is purely the extension-side presentation path (`extension/src/background.ts:15-17` maps status 429 to a fixed string; `extension/src/popup/App.tsx` renders it through the normal `error` state).

**Cheapest procedure** — the literal check needs 21 real Anthropic calls in a minute; shrinking the budget gets the same signal for ~2 calls, mirroring what the plan already suggests for the timeout check:

1. `backend/src/routes/api/collections/index.ts:11` — change `TRANSLATE_RATE_LIMIT_MAX = 20` to `2`. `npm run dev` hot-reloads it.
2. `cd extension && npm run dev` (builds against `.env.development` → `http://localhost:3000`), then load/reload `dist/manifest.json` via `about:debugging`.
3. Open the popup, pick a collection, hit **Translate** three times.
4. **Expect**: the third attempt shows *"Too many requests — wait a minute and try again."* in the popup's error line. The button re-enables, no unhandled rejection in the background script console, no permanent spinner.
5. Revert line 11 to `20`.

**On pass**: tick 4.8 in `plan.md`'s Progress section.

---

## 2. Re-verify the login round trip after the `state` fix

**Why**: the Phase 4 implementation review (`reviews/impl-review-phase-4.md`, F3) changed the OAuth authorization request — `extension/src/auth.ts` now sends a `state` parameter and rejects the response if the returned value doesn't match. Build and lint pass, but no automated test covers `browser.identity.launchWebAuthFlow`, so the round trip is unproven until someone logs in.

**Procedure**:

1. `cd extension && npm run dev`, reload the add-on in `about:debugging`.
2. In the popup, **Log out** (drops the stored tokens), then **Log in**.
3. **Expect**: the Cognito hosted UI opens, credentials are accepted, and reopening the popup lands in the authenticated state with collections listed.
4. **Failure mode to watch for**: *"Login response did not match the request — try again"* means Cognito didn't echo `state` back as expected — check whether the hosted UI is preserving it, and fall back to reverting the F3 change in `auth.ts` if so.

**On pass**: nothing to tick — F3 is already recorded as FIXED in the review report. This is confirmation only.

---

## 3. Not a check — a standing action

`change.md` → "Known limitation — the per-user rate limit is per-Lambda-instance" names the **Anthropic Console spend limit** as the real denial-of-wallet backstop. It costs nothing, needs no code, and no change in this slice substitutes for it. Set it on the workspace holding the `/ink-lingo/anthropic-api-key` value if it isn't already set.
