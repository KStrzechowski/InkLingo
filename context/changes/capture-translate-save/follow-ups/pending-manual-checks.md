# Pending manual checks — capture-translate-save

Deferred on 2026-07-31 at the user's request. All of these need a human at a
browser. Written up here so they can be run without re-deriving the setup.

**Nothing in Phase 5 has been exercised against a real Anthropic response** —
every backend test stubs the client, so the multi-language `languages[]` tool
schema is unproven against the actual model. Item 4 below is the one that
matters most.

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

## 3. Plan criteria 5.3 / 5.4 — multi-language capture and save

**Progress rows**: `### Phase 5` → `5.3`, `5.4`

**Setup**: web app → create a collection with a native language and **3–5**
target languages (the create form is now checkboxes, capped at 5, with the
native language excluded from the options). Then `cd extension && npm run dev`
and reload the add-on.

**5.3** — capture a word. Expect one section per target language, each with its
own variant radio list, IPA, and nested sentences. A language the model
returned nothing for shows *"Nothing came back for this language"* rather than
disappearing.

**5.4** — pick a variant + sentence in **every** language (the Save button
stays disabled until all pickable languages are chosen; the counter above it
reads "N of M languages chosen"), then Save. Confirm in the web app's
collection detail page that the entry has one translation and one sentence per
target language.

## 4. Plan criterion 5.5 — substitute check (see change.md)

**Progress row**: `### Phase 5` → `5.5`

5.5 as written — one language erroring while the others render — describes
behaviour the single-call design cannot produce. See `change.md` → "Phase 5
adaptations". Verify the replacement instead:

1. Stop the backend (or point `.env.development` at a dead port) and rebuild.
2. Capture a word.
3. **Expect**: one error line and one working retry covering the whole capture
   — not a hang, not a stuck "Translating…" spinner.

## 5. Plan criterion 5.6 — per-entry language backfill

**Progress row**: `### Phase 5` → `5.6`

1. Save an entry into a collection, then note a target language that entry does
   **not** have. (Easiest setup: create a 2-language collection, save an entry,
   then create a 3-language collection and repeat — or save an entry while one
   language's generation returns nothing.)
2. In the web app's collection detail page, the entry shows
   *"Missing: [Add de]"* buttons for each absent target language.
3. Click one.
4. **Expect**: that entry gains exactly one translation + one sentence in that
   language. **Every other entry in the collection is untouched** — this is the
   whole point of FR-018 being per-entry rather than a bulk pass. The backend
   test `does not touch sibling entries` covers this, but confirm it visually.

## 6. Not a check — a standing action

`change.md` → "Known limitation — the per-user rate limit is per-Lambda-instance" names the **Anthropic Console spend limit** as the real denial-of-wallet backstop. It costs nothing, needs no code, and no change in this slice substitutes for it. Set it on the workspace holding the `/ink-lingo/anthropic-api-key` value if it isn't already set.
