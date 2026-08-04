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
- Legacy language codes exist in the database, but fewer and tamer than earlier drafts of this plan claimed. Verified 2026-08-03 by querying every code in use: only `PL` (one collection's native code) and `EN` (one target row), both uppercase from before write-time normalization. **There is no `ENss`** — that code appears nowhere in the data, and earlier references to it in this plan were wrong. Both real codes are valid BCP-47 primary subtags, so neither can throw `Intl.Collator`. Case-insensitive matching is still required, so an `EN` target row matches a saved `en`.
- Firefox prints background colours only when "Print backgrounds" is enabled, which is **off by default** — table rules must be drawn with `border`, never `background-color`.
- CSS Paged Media margin boxes (`@page { @bottom-right { content: counter(page) } }`) are unsupported in Firefox and Chrome. Page numbering has to come from the browser's own print footer.
- `react/only-export-components` is configured as a warning (`frontend/.oxlintrc.json`) — a `.tsx` file must not export non-component values alongside components. See `context/foundation/lessons.md`.

## What We're NOT Doing

- **No backend route, no PDF generation, no new dependency.** No `infra/lib/constructs/api-construct.ts` entry is needed — that rule in `lessons.md` applies only to routes under `backend/src/routes/api/`, and this change adds none.
- **No export of multiple collections at once**, and no collection selection UI on the print page — the print view is always scoped to one collection reached by its id.
- **No alternative print templates, colour schemes or layouts.** PRD Non-Goals: "jeden prosty, czarno-biały układ tabeli"; Cornell method and cut-out templates are v2+.
- **No branding or colour on the printed sheet.** Raised and deliberately deferred 2026-08-03, to follow the frontend redesign rather than precede it — a print design derived from a visual identity that doesn't exist yet would only be rebuilt. Three findings worth keeping for whoever picks this up:
  - **There is no InkLingo logo.** Every image asset in the repo is Vite/React starter boilerplate (`frontend/public/favicon.svg`, `frontend/src/assets/{hero.png,react.svg,vite.svg}`), and `frontend/index.html` still carries `<title>frontend</title>`. Branding the printout starts with creating an identity, not with CSS.
  - **A logo on every page is not achievable in Firefox.** CSS `@page` margin boxes are unsupported (the same limitation that pushes page numbering onto Firefox's own footer). The only per-page repeat mechanism is `<thead>`/`table-header-group`, which would consume vertical space on every sheet. First page only is straightforward.
  - **Print colour must live in text and borders, never fills.** Firefox omits `background-color` from printouts unless the user has enabled "Print backgrounds", which is off by default — so a shaded header row or zebra striping would silently vanish for most users.
- **No landscape orientation, no configurable font size, no per-user print settings.** One fixed A4 portrait layout.
- **No CSV / Anki / other export formats.**
- **No change to the collection detail page's own presentation** beyond adding the Print link.
- **No change to how sentences are generated or stored** — in particular, no move to a single shared example sentence across languages (see Open Risks).
- **No rendering of multiple meanings per language.** The sheet prints one meaning and one sentence per (entry, language) because that is all the data model can hold: `entry_translations` carries `UNIQUE (entry_id, language_code)`, so `zamek` is stored only as `lock` — the other senses were discarded at capture time, not by this page. Multi-select capture and the matching rendering are tracked as [IL-41](https://kondi827.atlassian.net/browse/IL-41) (print/detail part: [IL-45](https://kondi827.atlassian.net/browse/IL-45)); when it lands, this page's `.find()` calls become `.filter()` and the row bands gain a level.

## Implementation Approach

Two phases, each independently verifiable.

Phase 1 builds the document as a normal web page: a chrome-free auth-gated layout, the route, the data fetch, and the row model that turns `entries[]` into printable rows. Everything is confirmable on screen before any print CSS exists.

Phase 2 makes that page an A4 document: `@page` sizing, forcing black-on-white over the dark-mode variables, border-drawn rules, page-break control, and neutralising the global `#root` shell.

Splitting this way means a layout bug and a print-CSS bug can never be confused for each other — Phase 1's output is verifiable without a printer.

## Critical Implementation Details

**Page-break control needs a `<tbody>` per entry.** Keeping an entry's language rows together is not achievable with `break-inside: avoid` on `<tr>` alone. The table must emit one `<tbody>` per entry (valid HTML — a table may have many) carrying `break-inside: avoid`, with the `rowspan`'d word cell inside it. This structural choice belongs to Phase 1 even though only Phase 2 exercises it, so Phase 1 must build the markup that way from the start rather than refactoring later.

**Firefox omits background colours from printouts by default.** Any visual structure conveyed by `background-color` — zebra striping, a shaded header row — disappears on paper for a user who hasn't enabled "Print backgrounds". All table structure must be carried by `border`. This also means the dark-mode `--bg` never prints, but `--text` (a foreground colour) *does*, which is exactly the light-grey-on-white failure mode the print stylesheet must override.

**`Intl.Collator` throws on malformed locale tags.** The alphabetical sort keys on the collection's native language, which is user-influenced data. No malformed code exists today (verified 2026-08-03 — only `PL` and `EN`, both valid), so the guard is defensive rather than a fix for observed breakage; it costs a try/catch and removes a whole-page crash as a failure mode.

**The `Language` column is sized by measurement, not by eye.** Observed 2026-08-03: at 10% the column offered 50.9px of text width, and **43 of the 64 native × target language names overflowed it** — plus the English and German column headings. `word-wrap: break-word` (there for the sentence columns) turned every one of them into a mid-word split: `niemieck/i`. Measured by rendering all 64 names at the print font (11pt `system-ui` → Segoe UI) in a headless Chromium: the binding case is Russian `французский` at 90.1px, needing 15.8% of the 180mm text width once cell padding and borders are counted. The column is therefore **17%**, and language cells carry `white-space: nowrap` so a future longer name overflows visibly rather than splitting quietly. Sizing per native language would buy back ~3 characters of sentence width on a Polish sheet (Polish needs 14%) and was rejected as not worth a hand-maintained table of eight numbers.

**Word breaks follow hyphenation rules only if every cell declares its `lang`.** `word-wrap: break-word` breaks wherever the edge falls and prints no hyphen — `niepodległoś` / `ć`, `достопримечательн` / `ость`. Adding `hyphens: auto` *before* it in the same rule fixes that where a dictionary exists, and changes nothing where one doesn't. Verified 2026-08-03 by rendering the same probe in both browsers at the real column widths: **Firefox**, the browser this sheet is printed from, hyphenated `pl`/`de`/`ru`/`uk` correctly from its bundled dictionaries (`niepodle-głość`, `ubezpiecze-nie`, `достопримечатель-ность`, and `odzy-skano` inside a sentence); **Edge** hyphenated nothing, because Chromium fetches dictionaries through the component updater and that profile had none, so it fell through to `break-word` exactly as before. The same probe without `lang` hyphenated nothing in either browser and let the Russian word overflow its cell — the attribute is what selects the dictionary, which is why `lang` is declared on the document (native language) and overridden on the target-language cells. The word cell takes `entry.sourceLanguageCode`, not the native code: an entry can be captured in one of the collection's target languages.

**Hyphenation needs a minimum word length, or short words get hyphenated for no reason.** Line breaking is greedy, so a word is hyphenated whenever that fills the current line better — `limitation de vitesse` printed as `limitation de vi-` / `tesse` even though `limitation de` / `vitesse` was available and reads better. `hyphenate-limit-chars: 12 5 4` restricts hyphenation to words of 12+ characters with no stub shorter than 5 before or 4 after the hyphen, which keeps it exactly where it is load-bearing: `Geschwindigkeitsbe-` / `grenzung` still hyphenates, `vitesse` moves whole. Turning hyphenation off instead (`hyphens: manual`) fixes the short-word case but returns the compound to an arbitrary `break-word` split with no hyphen — verified side by side in Firefox 153, which supports the property (`CSS.supports` → true); browsers without it fall back to plain `hyphens: auto`.

**A space inside a `nowrap` span is not a break opportunity.** Observed 2026-08-03: the `Translation` cell printed `indepen-` / `denc` / `e /ˌɪndɪˈpendəns/` — the meaning shredded across three lines while the transcription sat intact. Cause: the separating space was written *inside* `<span className="print-phonetic">`, which is `white-space: nowrap`, welding meaning and transcription into a single unbreakable run. Measured at the print font: `independence` is 94.0px and `/ˌɪndɪˈpendəns/` is 105.7px against 118.9px of column — **neither overflows alone**, but together they are 203.9px, so the browser had to break inside the word, and because the whole nowrap span must land on the final line, the tail dictated where the earlier breaks fell. That is what makes the output look like it was laid out backwards. Fix: emit the space as `{' '}` outside the span. `CollectionDetailPage.tsx:127` writes the same shape but with no `nowrap`, so its space still breaks normally.

**Two-letter codes (`EN`, `DE`) were considered and rejected.** They look like they would free a lot of width, but the column has a floor the values do not set: the English heading `LANGUAGE` alone measures 64.6px, so the column cannot go below ~12% whatever the cells hold. Codes would therefore save ~2.5% on a Polish sheet — about two characters per sentence line — in exchange for `UK` being read as *United Kingdom* next to `EN`, and for discarding the native-language naming the rest of the sheet is built on.

**A collapsed-border table does not close itself at a page break.** Reported 2026-08-03 from a real Firefox printout: every page except the last ended with no bottom rule — the verticals ran to the fold and stopped, so the table looked cut off rather than continued. Under `border-collapse: collapse` the line between two rows is one shared edge owned by the table, and at a fragmentation boundary the row that would pair with it is on the next page, so nothing paints. The fix is `border-collapse: separate` with `border-spacing: 0` and the grid drawn per cell — right and bottom on every cell, left on the cells that actually sit in column 1, top on `thead th` — so each cell closes itself and never shares an edge with another cell (which would double the line weight). It must be restated inside `@media print`, where the old rules re-declared both `border-collapse: collapse` and a blanket `border: 1px`. Chromium's PDF output was measured before and after — closed in both cases, with no doubled rules and identical geometry, confirming no regression there; **the Firefox side is unverified in-repo**, because headless Firefox cannot print (no `--print` flag, `window.print()` is a no-op) and a multi-column fragmentation proxy misrendered rather than answering the question. Re-print to confirm.

**`:first-child` is not "the left-hand column".** Reported 2026-08-04 from the screen preview: the rule between `Word` and `Language` printed at double weight on most rows. Cause: the separate-border grid drew its left edge with `th:first-child, td:first-child`, which matches the first cell of every *row*, not of every column — and a band's continuation rows begin with the language `<td>`, because the `rowSpan`'d word `<th>` belongs to the band's first row only. Those cells therefore took a left border in **column 2**, landing flush against the word column's right border; the separate model does not merge them, so the two stack into a 2px rule on every row but the first of each band. Confirmed by reading `border-left-width` back off each row's first cell in a headless render: 1px on all five rows of a two-band probe, including the three that start with a `<td>`. Column 1 holds exactly two kinds of cell, so that is what the selector must name: `thead th:first-child` and `tbody th`. Nothing is needed for the continuation rows — the word cell spans its whole band, so its left border already closes them. Restated identically inside `@media print`.

**Print borders must never be sub-pixel.** Observed 2026-08-03: re-declaring the table border as `0.5pt` inside `@media print` (~0.67px at 96dpi) made Firefox round it toward zero, dropping every rule except a stray header underline and printing the sheet as bare text in columns. The screen rule was untouched, so the page looked correct on screen and only the printout broke. Keep the printed border at `1px` or wider.

**Firefox's print preview is not the printout.** The same build that rendered no table in Firefox's preview pane printed a correct, fully-ruled table to paper. Preview is a lower-fidelity renderer; verify this page against actual paper or a PDF, never the preview alone.

**The preview has to be paginated in JavaScript, because CSS cannot paginate on screen.** Reported 2026-08-04: the preview was one continuous column of every entry in the collection, and only became pages at the moment of printing. Fragmentation into pages exists only in the print medium — there is no screen equivalent of `@page`, and `break-before: page` does nothing outside it — so "review before printing" was a review of a document with none of the breaks the printout would have. The fix measures and deals: `frontend/src/pages/printPagination.ts` reads the height of each rendered `<tbody>` off an unpaginated first pass and packs them greedily into pages, and the component re-renders as one `<section class="print-page">` per page, each with its own `<thead>`. Three things make it hold together:

- **The same page elements carry the breaks in both media**, which is what makes the preview honest: on screen each `.print-page` is drawn at 210 × 297mm with the same margins `@page` uses; in print it collapses to a plain block and `.print-page + .print-page { break-before: page }` supplies the breaks. Verified 2026-08-04 against a 20-entry × 3-language fixture: the preview showed 7 sheets and Chromium's PDF output had exactly 7 A4 pages, with no trailing blank.
- **Band heights measured in one shared table are the heights they have in a per-page table**, because `table-layout: fixed` plus the percentage column widths give every page's table identical geometry. Without `table-layout: fixed` the measurement would be worthless.
- **The page height is measured, not computed.** A hidden probe element sized in `mm` is read back in px, so the mm→px mapping is the browser's own rather than a hard-coded 96/25.4. It is deliberately 4mm short of the true 269mm printable height: the packer fills to the millimetre from screen measurements, and print lays text out at a different device resolution, so a band that just fits on screen could just miss on paper.

`thead { display: table-header-group }` and `tbody { break-inside: avoid }` stay, demoted from mechanism to safety net — if a page does overflow on paper they keep that page's spill readable, and the cost is one sparse sheet rather than a cascade, because the next `.print-page` still starts on a fresh sheet regardless. Measurement failing at all (no collection, no table) leaves `pages` null and the document unpaginated, i.e. the old behaviour, rather than blank.

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

- A header block: collection name, the `native → targets` language pair rendered with `printLanguageNamer` from `./printLabels` (native-language names, English `languageLabel` fallback — see the Language column below), and the current date.
- A screen-only **Print** button calling `window.print()`.
- The study table, or an empty-state message when `entries` is empty (no table, no Print button).

Reuses `extractErrorMessage` from `../api/errors` for the error branch, matching `CollectionDetailPage.tsx:37`.

#### 3. The row model

**File**: `frontend/src/pages/PrintCollectionPage.tsx`

**Intent**: Turn `entries[]` — each holding parallel `translations[]` and `sentences[]` — into the table's row bands. This is the one piece of real logic in the change and the thing manual verification is actually checking.

**Contract**: For each entry, produce one row per target language, in the collection's `targetLanguageCodes` order, restricted to languages the entry actually has. Language matching is **case-insensitive** throughout, for the same reason `CollectionDetailPage.tsx:110-115` and the backend do it: pre-normalisation rows hold codes like `EN` that would otherwise never match a saved `en`.

- A language is included when the entry has a translation **or** a sentence for it — a language with only one of the two renders its row with the other cell empty rather than being dropped.
- Entries are sorted alphabetically by `wordOrPhrase` using an `Intl.Collator` built from the collection's `nativeLanguageCode`. Constructing that collator must not be able to throw — a malformed tag raises `RangeError` — so fall back to the default-locale collator. Defensive: no malformed code exists in the data today.
- Each entry emits its own `<tbody>`; the `Word` cell carries `rowSpan` equal to that entry's row count. An entry with zero renderable languages still emits one row so the word is not silently dropped from the printout.
- Table columns, in order: `Word` · `Language` · `Translation` · `Sentence` · `Sentence (translated)`. The `Translation` cell shows `meaningText` followed by `phoneticTranscription` when present, rendered **verbatim** — stored transcriptions already carry their own delimiters, inconsistently (`/ˈfuːd/` for English, `[ɪˈda]` for Russian), so adding a pair prints `food //ˈfuːd//`. The `Sentence` cell shows that row's own `nativeGlossText`; `Sentence (translated)` shows `sentenceText`.
- **Column headings are in the collection's native language**, from `frontend/src/pages/printLabels.ts` (all 8 supported codes, English fallback for any unmapped code). The sheet is a study aid for someone reading *into* the target languages, so its furniture belongs in the language they already read.
- **Language names follow the headings into the native language.** Observed 2026-08-03: a Polish-native sheet headed `Słowo · Język · Tłumaczenie` listed its languages as `English, German` — half-translated. The `Language` column and the header pair therefore render through `printLanguageNamer(nativeLanguageCode)` (same file), built on `Intl.DisplayNames` so all 8 × 8 native/target combinations come from ICU instead of a hand-written 64-entry table, and each name keeps its own orthography (Polish `angielski` lower case, German `Englisch` upper). The namer is built once per render and closed over by every row. It falls back to the shared English `languageLabel` on `RangeError` — thrown by `.of()` for a malformed target code and by the constructor for a malformed native one — which is the same input `printLabels` falls back to English for.
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

**Table rules**: all borders, no `background-color` — Firefox omits backgrounds from printouts unless the user has enabled "Print backgrounds", so any structure carried by a fill silently vanishes. `thead { display: table-header-group }` for per-page repetition; `tbody { break-inside: avoid }` so an entry's language rows never split across a fold; `tr`, `td` also protected against internal splitting. Column widths — `16 / 17 / 20 / 23.5 / 23.5` — give the two sentence columns the bulk of the ~180mm text width, with the `Language` column sized from measured name widths rather than by eye (see Critical Implementation Details) and pinned with `white-space: nowrap` via a `.print-language` class. A class, not `td:nth-child(2)`: the language cell is the second child in a band's first row (after the `rowSpan`'d word `<th>`) and the first child in every row after it.

#### 2. Page splitting

**File**: `frontend/src/pages/printPagination.ts` (new), used by `PrintCollectionPage.tsx`

**Intent**: Give the on-screen preview the same page breaks the printout has, which CSS cannot do on its own (see Critical Implementation Details).

**Contract**: Two pure-ish functions and no React. `measurePrintPages(root)` reads the printable page height off a probe element, the document header's height plus margin, the repeated column header's height, and one height per `<tbody>`, returning `null` when the document is not measurable. `packPrintPages(metrics)` greedily first-fits those bands into pages, keeping document order and never splitting a band, returning one array of band indexes per page. The component holds the result in state, renders every band on one oversized sheet until it exists, and re-renders as one `.print-page` per page once it does — in a `useLayoutEffect`, so the unpaginated pass is never painted. Kept out of the `.tsx` so that file exports only its component (`react/only-export-components`).

The screen-only Print button moves out of the document header and above the sheets: a control that occupies vertical space on screen but not on paper would make page one look fuller than it prints, and would corrupt the measurement taken beneath it.

#### 3. Body class toggle

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
5. **Legacy-code collection** — the collection whose native code is uppercase `PL` (and the `EN` target row); confirm the page renders and sorts, and that the uppercase target still matches its lowercase saved rows. `Intl.DisplayNames` canonicalises case, so `PL` must still name its languages in Polish rather than falling back to English.
6. **Non-English native collection** — confirm headings *and* the `Language` column and header pair are all in the native language, with none left in English, and that no language name is split across two lines or crosses its cell border. Russian-native is the worst case (`французский`); Polish-native the everyday one (`hiszpański`).
7. **Empty collection** — message, no table, no Print button.
8. **Dark OS theme** — printout still black on white.
9. **"Print backgrounds" off** — table structure still visible.
10. **Cyrillic + Polish diacritics + IPA** — glyphs render on paper.
11. **A meaning long enough to sit beside its IPA** — e.g. `independence /ˌɪndɪˈpendəns/`; confirm the meaning stays whole on one line and the transcription drops to the next, rather than the meaning fragmenting around it.
12. **A word too long for its column** — confirm Firefox breaks it with a hyphen at a syllable boundary rather than mid-syllable. Note the dev data does not reach this: longest `word_or_phrase` is 8 characters, longest `meaning_text` 7 (measured 2026-08-03), so this needs a deliberately long fixture.

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

- [x] 1.1 Type check and build pass: `cd frontend && npm run build` — a80df46
- [x] 1.2 Lint passes with no new warnings: `cd frontend && npm run lint` — a80df46

#### Manual

- [ ] 1.3 Print link opens `/collections/:id/print` showing only the document — no app chrome
- [ ] 1.4 5-language collection renders one row per language per entry, word cell spanning its band, each row showing its own native sentence
- [ ] 1.5 Entry with a backfill gap shows rows only for languages it has, no blank filler rows
- [ ] 1.6 Entries sort alphabetically; Polish/Cyrillic collections sort correctly and do not crash
- [ ] 1.7 Empty collection shows a "nothing to print" message and no table
- [ ] 1.8 Direct URL load works (auth gate holds, data loads); bad id shows not-found state

### Phase 2: Print stylesheet

#### Automated

- [x] 2.1 Type check and build pass: `cd frontend && npm run build` — 7ca8fb6
- [x] 2.2 Lint passes with no new warnings: `cd frontend && npm run lint` — 7ca8fb6

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
- [ ] 2.12 On-screen preview is split into A4 sheets, and the printout matches it page for page with no trailing blank page
- [ ] 2.13 Rule between `Word` and `Language` is a single weight on every row, not just the first of each band
