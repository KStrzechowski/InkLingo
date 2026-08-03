# Printable Export Implementation Plan

## Overview

Roadmap slice **S-04 / FR-014**: let a signed-in user generate a readable, print-ready A4 black-and-white document for one of their collections.

The document is a browser print view, not a generated file: a dedicated route renders the collection as a five-column study table — `Word | Sentence (native) | Lang | Translation | Sentence` — with one row per (entry × target language) and the native word merged down its band. A print stylesheet turns that page into a clean A4 printout via the browser's own print dialog, which also covers "Save as PDF" for anyone who wants a file.

## Current State Analysis

- **The data is already complete.** `GET /api/collections/:id` (`backend/src/routes/api/collections/index.ts:146-211`) returns the collection plus every entry with its `translations` (`languageCode`, `meaningText`, `phoneticTranscription`) and `sentences` (`languageCode`, `sentenceText`, `nativeGlossText`). The frontend client `getCollection` (`frontend/src/api/collections.ts:55`) already types all of it. **No backend or infra work is required.**
- **Exactly one translation and one sentence exist per (entry, language)** — `UNIQUE(entry_id, language_code)` on both tables, enforced again in the route (`backend/src/routes/api/collections/index.ts:280-285`). So "one row per entry × language" is unambiguous; there is no variant to choose at print time.
- **Entries can be missing languages.** FR-018's backfill route (`backend/src/routes/api/collections/index.ts:361`) exists precisely because an entry saved before a language was added to the collection has no rows for it. `CollectionDetailPage.tsx:114-115` already computes this gap. The print view must tolerate it.
- **There is no print-related code anywhere in the repo** — a grep for `print|pdf|@page|A4` across `frontend/src`, `backend/src`, `extension/src` returns nothing. Clean slate.
- **The global stylesheet is hostile to print.** `frontend/src/index.css:65-75` sets `#root { width: 1126px; text-align: center; border-inline: 1px solid var(--border); min-height: 100svh; display: flex }`, and lines 36-53 swap every colour variable under `@media (prefers-color-scheme: dark)`. Left alone, a printout would be centre-aligned, 1126px-clipped, and light-grey-on-dark.
- **App chrome wraps every authenticated route.** `AuthenticatedLayout` (`frontend/src/App.tsx:26-50`) renders `<h1>InkLingo</h1>`, "Signed in as …" and a Log out button around its `<Outlet/>`. The print page needs the auth gate but none of the chrome.
- **No frontend test framework exists.** `frontend/package.json` defines only `lint` (oxlint) and `build` (`tsc -b && vite build`). Automated verification for this change is type-check + build + lint; correctness rests on manual verification.
- **SPA deep links already work in production.** `infra/lib/constructs/frontend-construct.ts:34-37` rewrites CloudFront 403/404 to `/index.html`, so `/collections/:id/print` resolves on a cold load or refresh after deploy. No CDK change needed.

## Desired End State

From a collection's detail page the user follows a **Print** link to `/collections/:id/print`. That page shows only the printable document: a header naming the collection, its language pair and the date, followed by the study table, entries sorted alphabetically. A **Print** button (screen-only) opens the browser print dialog. The resulting A4 sheets are black on white, the column header repeats on every page, no entry's language rows are split across a fold, and IPA, Cyrillic and Polish diacritics all render correctly.

Verified by printing (or print-previewing) a 1-language collection and a 5-language collection, one long enough to span at least three pages, in both light and dark OS theme.

### Key Discoveries:

- `getCollection` returns everything needed — the print page adds no API surface (`frontend/src/api/collections.ts:55`).
- `nativeGlossText` is stored **per target-language sentence**, not per entry (`backend/src/routes/api/collections/index.ts:175-179`). Each language row therefore carries its own native sentence; they legitimately differ.
- Legacy language codes exist in the dev database — `PL`, `EN`, and `ENss`. `ENss` is not a well-formed BCP-47 primary subtag, so `new Intl.Collator('ENss')` throws `RangeError`.
- Firefox prints background colours only when "Print backgrounds" is enabled, which is **off by default** — table rules must be drawn with `border`, never `background-color`.
- CSS Paged Media margin boxes (`@page { @bottom-right { content: counter(page) } }`) are unsupported in Firefox and Chrome. Page numbering has to come from the browser's own print footer.
- `react/only-export-components` is configured as a warning (`frontend/.oxlintrc.json`) — a `.tsx` file must not export non-component values alongside components. See `context/foundation/lessons.md`.

## What We're NOT Doing

- **No backend route, no PDF generation, no new dependency.** No `infra/lib/constructs/api-construct.ts` entry is needed — that rule in `lessons.md` applies only to routes under `backend/src/routes/api/`, and this change adds none.
- **No export of multiple collections at once**, and no collection selection UI on the print page — the print view is always scoped to one collection reached by its id.
- **No alternative print templates, colour schemes or layouts.** PRD Non-Goals: "jeden prosty, czarno-biały układ tabeli"; Cornell method and cut-out templates are v2+.
- **No landscape orientation, no configurable font size, no per-user print settings.** One fixed A4 portrait layout.
- **No CSV / Anki / other export formats.**
- **No change to the collection detail page's own presentation** beyond adding the Print link.
- **No change to how sentences are generated or stored** — in particular, no move to a single shared example sentence across languages (see Open Risks).

## Implementation Approach

Two phases, each independently verifiable.

Phase 1 builds the document as a normal web page: a chrome-free auth-gated layout, the route, the data fetch, and the row model that turns `entries[]` into printable rows. Everything is confirmable on screen before any print CSS exists.

Phase 2 makes that page an A4 document: `@page` sizing, forcing black-on-white over the dark-mode variables, border-drawn rules, page-break control, and neutralising the global `#root` shell.

Splitting this way means a layout bug and a print-CSS bug can never be confused for each other — Phase 1's output is verifiable without a printer.

## Critical Implementation Details

**Page-break control needs a `<tbody>` per entry.** Keeping an entry's language rows together is not achievable with `break-inside: avoid` on `<tr>` alone. The table must emit one `<tbody>` per entry (valid HTML — a table may have many) carrying `break-inside: avoid`, with the `rowspan`'d word cell inside it. This structural choice belongs to Phase 1 even though only Phase 2 exercises it, so Phase 1 must build the markup that way from the start rather than refactoring later.

**Firefox omits background colours from printouts by default.** Any visual structure conveyed by `background-color` — zebra striping, a shaded header row — disappears on paper for a user who hasn't enabled "Print backgrounds". All table structure must be carried by `border`. This also means the dark-mode `--bg` never prints, but `--text` (a foreground colour) *does*, which is exactly the light-grey-on-white failure mode the print stylesheet must override.

**`Intl.Collator` throws on malformed locale tags.** The alphabetical sort keys on the collection's native language, and the dev database holds pre-normalisation codes including `ENss`, which is not a valid BCP-47 primary subtag. Constructing the collator must be guarded so a bad code degrades to the default locale instead of crashing the page.

**Page numbers come from the browser, not the document.** `@page` margin boxes with `counter(page)` are unsupported in current browsers, so the printout relies on Firefox's built-in header/footer (which prints "page N of M" when enabled — the default). The consequence for this plan is a constraint on `@page` margins: they must leave room for that footer rather than bleeding content into it, and the manual verification step must confirm the setting is on.

---

## Phase 1: Print route and document structure

### Overview

Add a chrome-free, auth-gated route that renders the collection as the five-column study table, correct on screen, reachable from the collection detail page.

### Changes Required:

#### 1. Print-page layout and route

**File**: `frontend/src/App.tsx`

**Intent**: The print page needs the same auth gate as the rest of the app but none of its chrome, so the on-screen preview matches what will print. Add a second layout alongside `AuthenticatedLayout` that gates on `useAuth()` and renders only its `<Outlet/>`, then register the print route under it.

**Contract**: A new route `/collections/:id/print` nested under a new `PrintLayout` element, sibling to the existing `AuthenticatedLayout` route group. `PrintLayout` reproduces `AuthenticatedLayout`'s loading and signed-out branches (`frontend/src/App.tsx:27-40`) but renders `<Outlet/>` bare — no `<section id="center">`, no `<h1>`, no log-out control. Both helper components stay local to `App.tsx`, which already holds `CallbackPage` and `AuthenticatedLayout`; keep the file's single default export so `react/only-export-components` stays quiet.

#### 2. The printable document component

**File**: `frontend/src/pages/PrintCollectionPage.tsx` (new)

**Intent**: Fetch the collection and render it as the print document — header block, then the study table. Mirrors `CollectionDetailPage`'s fetch lifecycle (loading / 404 / error / loaded) so the four states behave consistently across the two pages.

**Contract**: Default-exported component reading `useParams<{ id: string }>()` and calling the existing `getCollection` from `../api/collections` — no new API function. Renders:

- A header block: collection name, the `native → targets` language pair rendered with `languageLabel` from `../languages` (already present — it matches case-insensitively and falls back to the uppercased code, so a legacy `EN` / `ENss` still renders), and the current date.
- A screen-only **Print** button calling `window.print()`.
- The study table, or an empty-state message when `entries` is empty (no table, no Print button).

Reuses `extractErrorMessage` from `../api/errors` for the error branch, matching `CollectionDetailPage.tsx:37`.

#### 3. The row model

**File**: `frontend/src/pages/PrintCollectionPage.tsx`

**Intent**: Turn `entries[]` — each holding parallel `translations[]` and `sentences[]` — into the table's row bands. This is the one piece of real logic in the change and the thing manual verification is actually checking.

**Contract**: For each entry, produce one row per target language, in the collection's `targetLanguageCodes` order, restricted to languages the entry actually has. Language matching is **case-insensitive** throughout, for the same reason `CollectionDetailPage.tsx:110-115` and the backend do it: pre-normalisation rows hold codes like `EN` that would otherwise never match a saved `en`.

- A language is included when the entry has a translation **or** a sentence for it — a language with only one of the two renders its row with the other cell empty rather than being dropped.
- Entries are sorted alphabetically by `wordOrPhrase` using an `Intl.Collator` built from the collection's `nativeLanguageCode`. Constructing that collator must not be able to throw: an invalid tag such as the dev database's `ENss` raises `RangeError`, so fall back to the default-locale collator.
- Each entry emits its own `<tbody>`; the `Word` cell carries `rowSpan` equal to that entry's row count. An entry with zero renderable languages still emits one row so the word is not silently dropped from the printout.
- Table columns, in order: `Word` · `Sentence (<native label>)` · `Lang` · `Translation` · `Sentence`. The `Translation` cell shows `meaningText` followed by `phoneticTranscription` when present; the `Sentence (native)` cell shows that row's own `nativeGlossText`.
- Column headers live in a `<thead>` — required for Phase 2's per-page repetition.

#### 4. Entry point from the collection detail page

**File**: `frontend/src/pages/CollectionDetailPage.tsx`

**Intent**: Give the user a way in. A link, not a button — it navigates.

**Contract**: A `<Link to={\`/collections/${id}/print\`}>` in the page header area, near the existing `<h2>`/language-pair line (`CollectionDetailPage.tsx:99-102`). Requires adding `Link` to the existing `react-router` import.

### Success Criteria:

#### Automated Verification:

- Type check and build pass: `cd frontend && npm run build`
- Lint passes with no new warnings: `cd frontend && npm run lint`

#### Manual Verification:

- The Print link on a collection detail page opens `/collections/:id/print` showing only the document — no InkLingo heading, no "Signed in as", no Log out button
- A 5-language collection renders one row per language per entry, with the word cell spanning its band and each row showing that language's own native sentence
- An entry saved before a language was added shows rows only for the languages it has, with no blank filler rows
- Entries appear in alphabetical order, and a collection with Polish or Cyrillic words sorts correctly rather than crashing
- An empty collection shows a "nothing to print" message and no table
- Loading `/collections/:id/print` directly by URL works (auth gate holds, data loads); a bad id shows the not-found state

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Print stylesheet

### Overview

Turn the Phase 1 page into an A4 document: black on white, correct page geometry, repeating header, no split entry bands.

### Changes Required:

#### 1. The print stylesheet

**File**: `frontend/src/pages/print.css` (new), imported by `PrintCollectionPage.tsx`

**Intent**: Everything that makes the page a document rather than a web page. Kept in its own file, imported only by the print page, so no other route can be affected by it and the rules are trivially findable.

**Contract**: Two concerns, deliberately separated:

- **Screen rules** — the on-screen preview must look like the printout, otherwise "review before printing" is meaningless. The page component toggles a class on `document.body` on mount and removes it on unmount; the stylesheet uses that class to neutralise the global shell (`#root`'s fixed 1126px width, `text-align: center`, `border-inline`, flex column — `frontend/src/index.css:65-75`) and to force black text on white regardless of `prefers-color-scheme`. The document body itself is capped at the A4 text width so the on-screen line lengths match the printed ones.
- **`@media print` rules** — `@page { size: A4 portrait; margin: … }` with margins wide enough that Firefox's own header/footer (which carries the page numbering) does not collide with content. Colour forced to black on white, overriding the `@media (prefers-color-scheme: dark)` block in `index.css:36-53`. The Print button and anything else screen-only is hidden.

**Table rules**: all borders, no `background-color` — Firefox omits backgrounds from printouts unless the user has enabled "Print backgrounds", so any structure carried by a fill silently vanishes. `thead { display: table-header-group }` for per-page repetition; `tbody { break-inside: avoid }` so an entry's language rows never split across a fold; `tr`, `td` also protected against internal splitting. Column widths set so the two sentence columns get the bulk of the ~180mm text width and the `Lang` column stays narrow.

#### 2. Body class toggle

**File**: `frontend/src/pages/PrintCollectionPage.tsx`

**Intent**: Apply the print-mode class only while the print page is mounted, so navigating away restores the normal app appearance.

**Contract**: An effect adding the class to `document.body` on mount with a cleanup that removes it. The class name is the single coupling point with `print.css`.

### Success Criteria:

#### Automated Verification:

- Type check and build pass: `cd frontend && npm run build`
- Lint passes with no new warnings: `cd frontend && npm run lint`

#### Manual Verification:

- Print preview shows A4 portrait, black text on white, with no page content colliding with the browser's header/footer
- With the OS in **dark** theme, the printout is still black on white — no grey text, no dark fills
- Column header row repeats at the top of every page of a printout spanning three or more pages
- No entry's language rows are split across a page break; the word cell never orphans from its rows
- With Firefox's "Print backgrounds" **off** (the default), all table rules are still visible
- IPA transcriptions, Cyrillic (ru/uk) and Polish diacritics all render correctly on the printed page
- Page numbering appears via Firefox's print footer with "Print headers and footers" enabled
- A 1-language collection and a 5-language collection are both readable — sentence columns wide enough to hold a full sentence on one or two lines
- Printed to actual paper at least once (not preview alone), for a collection with 3+ pages

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

The frontend has no test runner (`frontend/package.json` defines only `lint` and `build`), and this change is not the place to introduce one — a print stylesheet is not meaningfully unit-testable, and the row model is the only logic present. Verification is therefore type-check + build + lint, plus a deliberate manual matrix.

### Manual Testing Matrix:

The two axes that actually break things are **language count** and **entry count**; the rest are single checks.

1. **1-language collection, few entries** — baseline readability; confirm the `Lang` column doesn't look absurd with one value repeated.
2. **5-language collection, few entries** — confirm column widths hold and sentence columns stay readable; confirm row bands group correctly.
3. **Collection with 3+ printed pages** — confirm the repeating header, page-break behaviour, and no orphaned word cells.
4. **Collection with a backfill gap** — an entry predating one of the collection's languages; confirm no blank filler rows.
5. **Legacy-code collection** — one of the two dev collections holding `PL`/`EN`/`ENss`; confirm the page renders and sorts rather than throwing.
6. **Empty collection** — message, no table, no Print button.
7. **Dark OS theme** — printout still black on white.
8. **"Print backgrounds" off** — table structure still visible.
9. **Cyrillic + Polish diacritics + IPA** — glyphs render on paper.

Steps 1-3 are the ones worth repeating after any later change to the print stylesheet.

## Performance Considerations

None material. The page issues the same single `getCollection` request the detail page already makes, and renders at most a few hundred rows. Target scale in the PRD is `data_volume: small`.

## Migration Notes

None — additive frontend change, no schema change, no API change, no stored data touched.

## References

- Roadmap slice S-04: `context/foundation/roadmap.md` (Open Roadmap Question 1 — print mechanism — is resolved by this plan)
- PRD FR-014, FR-015, FR-017, Non-Goals: `context/foundation/prd.md`
- Recurring rules: `context/foundation/lessons.md`
- Existing page to mirror: `frontend/src/pages/CollectionDetailPage.tsx`
- Data source: `backend/src/routes/api/collections/index.ts:146-211`
- SPA deep-link fallback: `infra/lib/constructs/frontend-construct.ts:34-37`

## Open Risks & Assumptions

- **Print fidelity depends on the user's browser settings.** Margins, scale and the "Print backgrounds" / "Print headers and footers" toggles are the user's, not the document's. The design is built to survive Firefox's defaults; a user who has changed them may see a different result. Accepted — this is the cost of the browser-print approach, chosen deliberately over server-side PDF for its zero-infrastructure footprint and free Unicode font coverage.
- **Page numbering is the browser's, not ours.** If "Print headers and footers" is disabled, the printout has no page numbers and this plan provides no fallback. CSS paged-media counters are unsupported in current browsers, so the alternative would be a real PDF generator.
- **A 5-language collection produces a long document.** Rows scale with entries × languages; a 50-entry, 5-language collection is ~250 rows. Readable, but it is a lot of paper. No pagination or filtering is offered in this change.
- **A single shared example sentence across all target languages is a stated future direction.** The user has flagged wanting one sentence per entry rather than one per language. This plan renders what is stored today — a distinct native gloss per language row. Whenever that model changes, the `Sentence (native)` column collapses to a per-entry cell merged alongside the word, which is a small change to the row model and nothing else. This is a natural companion to the parked EN-pivot / sense-keyed re-architecture (`context/changes/translation-pivot/`, Jira IL-24).
- **Verification is entirely manual.** With no frontend test runner, nothing automated will catch a regression in this page. A later change to `index.css` or `CollectionDetailPage` could silently degrade the printout.
- **S-05 (`pronunciation-playback`) edits the same file.** Assessed 2026-08-03: the two slices share only `CollectionDetailPage.tsx` and have **zero contract coupling** — both are read-only consumers of the existing `getCollection`. This change touches the `react-router` import and the header area (lines 99-102); S-05 touches the import block and the entry rows (lines 121-135). The body edits are ~19 lines apart and auto-merge cleanly; the import block will conflict. **Recommended order: this slice merges first**, since its footprint in the shared file is the smaller of the two, and S-05's web-app phase then lands on top. S-05's extension-only phase is fully independent and can run concurrently with this one.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Print route and document structure

#### Automated

- [ ] 1.1 Type check and build pass: `cd frontend && npm run build`
- [ ] 1.2 Lint passes with no new warnings: `cd frontend && npm run lint`

#### Manual

- [ ] 1.3 Print link opens `/collections/:id/print` showing only the document — no app chrome
- [ ] 1.4 5-language collection renders one row per language per entry, word cell spanning its band, each row showing its own native sentence
- [ ] 1.5 Entry with a backfill gap shows rows only for languages it has, no blank filler rows
- [ ] 1.6 Entries sort alphabetically; Polish/Cyrillic collections sort correctly and do not crash
- [ ] 1.7 Empty collection shows a "nothing to print" message and no table
- [ ] 1.8 Direct URL load works (auth gate holds, data loads); bad id shows not-found state

### Phase 2: Print stylesheet

#### Automated

- [ ] 2.1 Type check and build pass: `cd frontend && npm run build`
- [ ] 2.2 Lint passes with no new warnings: `cd frontend && npm run lint`

#### Manual

- [ ] 2.3 Print preview shows A4 portrait, black on white, no collision with the browser header/footer
- [ ] 2.4 Dark OS theme still prints black on white
- [ ] 2.5 Column header repeats on every page of a 3+ page printout
- [ ] 2.6 No entry's language rows split across a page break; no orphaned word cells
- [ ] 2.7 Table rules visible with Firefox "Print backgrounds" off
- [ ] 2.8 IPA, Cyrillic and Polish diacritics render correctly on the printed page
- [ ] 2.9 Page numbering appears via Firefox's print footer
- [ ] 2.10 1-language and 5-language collections both readable; sentence columns wide enough
- [ ] 2.11 Printed to actual paper at least once for a 3+ page collection
