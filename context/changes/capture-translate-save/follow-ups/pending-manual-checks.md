# Pending manual checks — capture-translate-save

Everything here needs a human at a browser. Written as one ordered session
rather than six separate errands — roughly 15 minutes end to end.

## What is already verified, and how

Don't re-do these.

| Verified | Method |
| --- | --- |
| Multi-language tool schema works against the real model | 10/10 five-language captures fully populated via live Anthropic |
| `MAX_TOKENS_PER_LANGUAGE = 2048` is sufficient | Peak 1,721 output tokens vs 10,240 budgeted (~6× headroom) |
| Empty-variants failure mode | Found (~3 in 34 calls), fixed with a retry, 3 regression tests |
| Cost per capture | $0.0063 at five languages, measured |
| Latency | 4.7–10.0s at five languages, 3.7s at one, vs the 20s route timeout |
| Save persists one pair per language | `entries.test.ts` against the real database |
| FR-018 touches only its own entry | `entry-translations.test.ts` → `does not touch sibling entries` |
| API Gateway route registration | `cdk synth` — all 8 route keys present |

What is left is exactly the part that needs a rendered UI.

---

## Setup (once)

```sh
# terminal 1
cd backend && npm run dev            # http://localhost:3000

# terminal 2
cd frontend && npm run dev           # http://localhost:5173

# terminal 3
cd extension && npm run dev          # rebuilds dist/ on change
```

Then `about:debugging` → **This Firefox** → **Load Temporary Add-on…** →
pick `extension/dist/manifest.json`.

---

## Step 1 — Login round trip  (confirms review finding F3)

The OAuth request now sends a `state` parameter and rejects a response whose
`state` doesn't match. Nothing automated covers `launchWebAuthFlow`.

1. Open the popup. If already logged in, click **Log out** first.
2. Click **Log in**, complete the Cognito hosted UI.
3. Reopen the popup.

**Pass**: you land authenticated with collections listed.
**Fail**: *"Login response did not match the request — try again"* means Cognito
isn't echoing `state` back. Revert the `state` block in `extension/src/auth.ts`
and re-open F3.

---

## Step 2 — Create a multi-language collection  (first half of 5.3)

In the web app, create a collection with a native language and **3–5** targets.
The form is now checkboxes, capped at 5, and the native language is excluded
from the options.

**Pass**: creation succeeds; the list shows `pl → en, de, fr`.

---

## Step 3 — Multi-language capture  (rest of 5.3) → ticks 5.3

In the popup, select that collection and capture a word. `zamek` is a good
choice — it's ambiguous in Polish (castle / lock), so variants are meaningful.

**Pass**: one section per target language, each with its own variant radio
list, IPA, and nested sentences. Expect 5–10 seconds at five languages.
**Note**: a language showing *"Nothing came back for this language"* is the
handled path, not a crash — but if it happens on most captures, the retry in
`ai/translate.ts` isn't doing its job; reopen that.

---

## Step 4 — Save across languages  (5.4) → ticks 5.4

Pick a variant **and** a sentence in every language. The Save button stays
disabled until all are chosen; the counter reads "N of M languages chosen".
Save, then open the collection in the web app.

**Pass**: the entry shows one translation and one sentence per target
language, with IPA and the bilingual gloss.

---

## Step 5 — Per-entry language backfill  (5.6) → ticks 5.6

⚠️ **Read this first — the state you need can't be reached through the UI.**
FR-018 is specified as backfilling "a target language added to the collection
after that entry was created", but the plan's *What We're NOT Doing* rules out
editing a collection's languages after creation, so there is no way to add one.
The "Add ⟨lang⟩" button therefore only appears when an entry is missing a
language for the *other* reason — that language returned no variants at
capture time. See the note in `change.md`.

To create the state deliberately, delete one translation row against the dev
database:

```sql
-- swap in the entry id from the web app URL / a SELECT on entries
DELETE FROM entry_translations
WHERE entry_id = '<entry-uuid>' AND language_code = 'de';
```

Reload the collection detail page.

**Pass**: that entry shows *"Missing: [Add de]"*. Click it — the entry gains
exactly one translation + one sentence in German, and **every other entry in
the collection is visibly unchanged**.

---

## Step 6 — Generation failure state  (substitute for 5.5) → ticks 5.5

5.5 as written ("one language errors while others render normally") describes
behaviour the single-call design cannot produce — you chose one Anthropic call
covering all languages, so it succeeds or fails as a unit. See `change.md` →
*Phase 5 adaptations*. Verify the replacement:

1. Stop the backend (Ctrl-C in terminal 1).
2. Capture a word in the popup.

**Pass**: one error line and one working retry covering the whole capture — no
hang, no stuck "Translating…" spinner.
3. Restart the backend.

---

## Step 7 — Rate-limit error state  (4.8) → ticks 4.8

The literal criterion needs 21 real Anthropic calls in a minute. Shrinking the
budget gets the same signal for ~2 calls.

1. `backend/src/routes/api/collections/index.ts:11` — set
   `TRANSLATE_RATE_LIMIT_MAX` from `20` to `2`. `npm run dev` hot-reloads.
2. Hit **Translate** three times.

**Pass**: the third shows *"Too many requests — wait a minute and try again."*
The button re-enables; no unhandled rejection in the background script console.
3. **Revert line 11 to `20`.**

What this asserts is the extension's presentation path (`background.ts:15-17`
maps status 429 to that string). The limiter itself passed as criterion 2.5.

---

## Step 8 — Not a check, a standing action

`change.md` → *Known limitation — the per-user rate limit is per-Lambda-instance*
names the **Anthropic Console spend limit** as the real denial-of-wallet
backstop. It costs nothing, needs no code, and no change in this slice
substitutes for it. Set it on the workspace holding the
`/ink-lingo/anthropic-api-key` value if it isn't already.

---

## When all steps pass

Tick `4.8`, `5.3`, `5.4`, `5.5`, `5.6` in `plan.md`'s `## Progress` section,
set `change.md` → `status: implemented`, commit, then `/10x-archive`.
