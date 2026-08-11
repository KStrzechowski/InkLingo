# Print Output Correctness — Plan Brief

> Full plan: `context/changes/testing-print-output-correctness/plan.md`
> Research: `context/changes/testing-print-output-correctness/research.md`

## What & Why

Rollout Phase 4 of the test plan, covering Risk #2: a CSS or component change
silently breaks the print/A4 export — broken pagination, grey-on-dark under a
dark OS theme, or content pushed outside the printable area. Today nothing
automated touches this surface; the archived print plan said so itself
(*"Verification is entirely manual. With no frontend test runner, nothing
automated will catch a regression in this page."*). Two of the four commits that
built the print surface were post-ship fixes found by printing on paper after
`build` and `lint` had already gone green.

## Starting Point

Four files under `frontend/src/pages/` (~870 lines) own the print document: the
route component with its row model and two-pass pagination, `print.css`, the
pagination packer, and the native-language label table. `frontend/` has a live
Vitest + jsdom suite and a CI step that runs it, both established by
`testing-auth-resilience`. No browser automation exists anywhere in the repo.

## Desired End State

A change that breaks the printout fails a test before a human sees it. `npm test`
covers the row model, language furniture, pagination packer, and the A4 geometry
constants with no browser. `npm run test:print` drives Chromium and Firefox
against a harness that mounts the real print document and stylesheet, asserting
black-on-white under a dark theme, no language-name overflow, and a PDF page
count matching the on-screen sheets. The 12-case manual matrix shrinks to a short
paper-only gate.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Cheapest layer for Risk #2 | Browser-free unit + static checks, not a visual diff | Research disproved the test plan's own assumption — jsdom can't see layout or CSS, but the packer is pure and the A4 constants drift silently, so most of the risk is coverable with no browser. | Research |
| Phase ordering | All layers, cheapest-first | Each layer is independently shippable inside the existing CI gate, so the rollout banks coverage before paying for infrastructure. | Plan |
| Browser engines | Both Chromium and Firefox | `page.pdf()` is Chromium-only while the two worst shipped defects were Firefox-only — neither engine covers Risk #2 alone. | Plan |
| Pixel baselines | None — assertions only | Every assertion gets an independent oracle (ISO 216, the black-and-white requirement, arithmetic) instead of a blessed image; also what makes two engines affordable. | Plan |
| Browser test harness | Dedicated root-level harness page | Renders the real document with committed fixtures, no auth and no network; Vite serves it in dev and excludes it from `dist/` for free. | Plan |
| Harness drift | Extract a shared `PrintDocument` | Route and harness mount the same component, making drift structurally impossible rather than a promise in a comment. | Plan |
| CI placement | Separate parallel job | Needs no AWS credentials or Neon branch, unlike the existing `diff` job, so it runs independently and doesn't extend the critical path. | Plan |
| Row model testing | Extract to `printRows.ts` | Follows the precedent that already created `printPagination.ts`, and keeps `react/only-export-components` quiet. | Plan |
| Manual matrix | Reduce to a paper-only gate | Firefox's own print preview disagreed with its printout, so paper is irreplaceable — but the repetitive cases automation absorbs can go. | Plan |

## Scope

**In scope:** row model and language-furniture unit tests; pagination packer
tests; a static `print.css` geometry-invariant check; a two-engine Playwright
layer over a harness page; a separate CI job in both workflows; test-plan §3/§4/§5/§6.5
updates and a documented manual-gate reduction.

**Out of scope:** pixel baselines; any jsdom assertion about `print.css`; auth or
backend in the browser layer; dependence on the dev database; changes to the
printed design; deleting the manual gate.

## Architecture / Approach

Five layers, cheapest-first. Phases 1–2 are pure additions to the existing Vitest
suite plus two behavior-preserving extractions of shipped code, and land inside
the CI gate that already exists. Phase 3 introduces Playwright and a
`print-harness.html` at the `frontend/` root, which Vite's dev server serves and
`vite build` ignores; both the real route and the harness render a shared
`PrintDocument`. Phase 4 adds the assertions that need a browser — real text
measurement and a real PDF. Phase 5 wires a separate CI job and reconciles the
docs.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Row model + furniture | `printRows.ts` extraction; row-model and `LABELS`↔`SUPPORTED_LANGUAGES` tests | A behavior-changing refactor slipping in as a "move" |
| 2. Packer + static geometry | `packPrintPages` tests; `print.css` A4 invariant check with a parser tripwire | A regex that silently stops matching and passes vacuously |
| 3. Harness + Playwright | `PrintDocument` extraction, fixtures, harness page, both engines, dark-theme assertion | Vitest collecting Playwright specs; the harness leaking into `dist/` |
| 4. Geometry + pagination | Language-column overflow across 8×8 names; PDF page count vs sheet count | Firefox silently skipping the Chromium-only page-count spec |
| 5. CI + reconciliation | `print-tests` job in both workflows; test-plan and manual-gate updates | A new job that isn't a required status check, so it gates nothing |

**Prerequisites:** none — Phases 1–2 need no new tooling; Phase 3 adds
`@playwright/test`.
**Estimated effort:** ~3–4 sessions across 5 phases; Phases 1–2 are short, Phase
3 carries most of the setup cost.

## Open Risks & Assumptions

- The `PrintDocument` extraction touches shipped code that only a manual print
  can fully verify; each refactor phase carries a print-comparison step.
- Two engines double browser download and CI time for a suite that currently runs
  in ~2s. Cached, but real.
- The new CI job needs its own required-status-check rule or it won't gate PRs —
  the same caveat §5 already carries for the existing `diff` job, now in a second
  instance.
- The Language-column floor (17%) is treated as the spec. If a test shows a name
  overflowing today, that is a finding to raise, not a licence to edit `print.css`.
- Reading PDF page count from the page tree's `/Count` is dependency-free but
  format-sensitive; a small PDF library is the fallback if it proves brittle.

## Success Criteria (Summary)

- A deliberate breaking edit to `print.css` — changing `@page`'s margin, or
  restoring `border-collapse: collapse` — fails a named test rather than reaching
  paper.
- Adding a 9th language without a `LABELS` entry fails a test naming that code,
  instead of silently printing English headings.
- Verifying a print change no longer requires walking a 12-case manual matrix;
  what remains is a short paper gate for the Firefox-only failures automation
  provably cannot see.
