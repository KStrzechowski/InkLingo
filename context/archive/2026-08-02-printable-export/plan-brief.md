# Printable Export — Plan Brief

> Full plan: `context/changes/printable-export/plan.md`

## What & Why

Roadmap slice **S-04 / PRD FR-014**: a user can generate a readable, print-ready A4 black-and-white document for one of their collections. It's the last MVP slice on the capture chain — the point where saved words leave the screen and become study material. The PRD deliberately left the *mechanism* open (Open Roadmap Question 1); this plan closes it.

## Starting Point

The data is already complete: `GET /api/collections/:id` returns every entry with its per-language translations (incl. IPA) and sentences (incl. native gloss), and the frontend client already types all of it. What's missing is any print-facing surface at all — a grep for `print|pdf|@page|A4` across all three apps returns nothing. The existing collection detail page renders the same data as nested unstyled lists.

## Desired End State

From a collection's detail page the user follows a **Print** link to a chrome-free page showing exactly what will print: a header with the collection name, language pair and date, then a five-column study table sorted alphabetically. A Print button opens the browser's dialog. The resulting A4 sheets are black on white, the column header repeats on every page, and no word's language rows are split across a fold.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Print mechanism | Browser print view (`@media print` + `@page A4`) | Zero backend/infra work, and system fonts cover IPA + Cyrillic + Polish diacritics for free — a server-side PDF would need an embedded Unicode font in the Lambda. Ships inside the 2026-08-05 deadline. |
| Entry point | Dedicated route `/collections/:id/print`, manual print | User reviews before spending paper; keeps print CSS out of the detail page entirely. |
| Table layout | 5 columns, one row per (entry × language) | Languages add **rows**, not columns, so column widths never shrink — a column-per-language grid collapses to ~28mm columns at 5 languages. |
| Columns | `Word \| Language \| Translation \| Sentence \| Sentence (translated)` | Word and its translation lead; the two sentence columns sit side by side, so folding the sheet down the middle is a self-test. |
| Heading language | The collection's native language | The sheet is a study aid for someone reading *into* the target languages — its furniture belongs in the language they already read. |
| Native sentence | One per language row, not shared | `nativeGlossText` is stored per target sentence — each language has its own. Blanking it would leave a target sentence with no counterpart. |
| Language label | Dedicated narrow column | Scannable — you can run a finger down it to find every German row. |
| Entry order | Alphabetical, locale-aware | A printed reference sheet is something you look things up in. |
| Page breaks | Keep each entry's band together | A word's languages always stay side by side; the merged word cell never orphans. |
| Page numbers | Firefox's built-in print footer | CSS `@page` margin-box counters are unsupported in every current browser. |

## Scope

**In scope:** print route + chrome-free auth-gated layout; the row model (grouping, `rowspan`, locale-safe sort); document header; empty state; Print link from the detail page; the print stylesheet (A4 geometry, black-on-white override, break control, repeating header).

**Out of scope:** any backend route, PDF generation, or new dependency (and therefore no `api-construct.ts` entry); multi-collection export; alternative templates or colour schemes (PRD Non-Goals); landscape or configurable font size; CSV/Anki export; any change to how sentences are generated or stored.

## Architecture / Approach

Frontend-only. A new `PrintLayout` in `App.tsx` reuses the `useAuth()` gate but renders a bare `<Outlet/>`, so the print route gets authentication without the app's heading and log-out chrome. `PrintCollectionPage` calls the **existing** `getCollection` — no new API function — and renders one `<tbody>` per entry (the structure that makes `break-inside: avoid` work) with the word cell `rowSpan`'d across its language rows. A page-scoped `print.css` handles both the on-screen preview and `@media print`, neutralising the global `#root` shell and the dark-mode variable block.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Print route and document structure | Reachable, chrome-free page rendering the correct table on screen | Row model edge cases — entries missing languages, legacy language codes that crash `Intl.Collator` |
| 2. Print stylesheet | The page prints as a clean A4 document | Browser print defaults are outside our control — backgrounds off, dark-mode variables leaking into the printout |

**Prerequisites:** S-03 (`capture-translate-save`) — done and archived. At least one collection with saved entries to print; ideally one with 5 target languages and enough entries to span 3 pages.
**Estimated effort:** ~1-2 sessions across 2 phases. No backend, no deploy dependency.

## Open Risks & Assumptions

- Print fidelity depends on the user's browser settings (margins, scale, "Print backgrounds", "Print headers and footers"). The design survives Firefox's defaults; a changed default may look different. Accepted cost of the browser-print approach.
- No page numbers at all if the user has disabled Firefox's print footer — there is no CSS fallback.
- A 50-entry, 5-language collection is ~250 rows. Readable, but a lot of paper; no filtering offered.
- **A single shared example sentence across all target languages is a stated future direction.** This plan renders what's stored today (one gloss per language row). When the model changes, the native-sentence column collapses to a per-entry merged cell — a small row-model change. Natural companion to the parked EN-pivot work (`context/changes/translation-pivot/`, Jira IL-24).
- Verification is entirely manual — the frontend has no test runner, so nothing automated will catch a later regression in this page.
- **S-05 (`pronunciation-playback`) edits the same `CollectionDetailPage.tsx`** — the only overlap between the two slices, with zero contract coupling. This slice should merge first (smaller footprint in that file); S-05's extension phase can run concurrently. See `plan.md` Open Risks for the region-level detail.

## Success Criteria (Summary)

- A user can print an A4 sheet for any of their collections that is legible black-on-white, with correct IPA, Cyrillic and Polish glyphs.
- The sheet works as study material at both 1 and 5 target languages, with each word's languages grouped together and never split across a page.
- Nothing about the collection detail page, the API, or the deployed infrastructure changes.
