---
artifact: 1-territory
source: git history
window: 2026-07-06 .. 2026-08-14 (162 commits)
generated: 2026-08-14
status: draft
---

# Territory map — where the project actually lives

Wide scan of InkLingo's git history: which areas get touched, how that emphasis
moved over time, and what changes together. Input to `context/map/repo-map.md`.

## Window and its limits (read this first)

This is **not** the 12-month scan the method assumes. The repo's first commit is
`2026-07-06`; the whole history is **5 weeks and 4 days, 162 commits, one author**.
Three consequences that constrain every number below:

- **No quarterly view.** Quarters are meaningless here, so the temporal split is
  **weekly**. Trends are over weeks, not seasons.
- **No contributor signal.** All 162 commits are `KStrzechowski`. Artifact 3
  (contributors) will have nothing to distribute; treat "who to ask" as a single
  point of contact by construction, not as a finding.
- **Greenfield, not legacy.** Hotspots here mean "recently built", not "eroded
  under years of edits". A file with 10 touches is a file that was *authored*
  over 10 commits, which is a different signal than 10 maintenance edits.

Noise filtered throughout: lockfiles, `dist/`, `node_modules`, `.env*`,
snapshots, `.gitattributes`/`.gitignore`.

## Activity — where work landed

### Top areas (depth 2)

| Touches | Area | Kind |
| ---: | --- | --- |
| 171 | `context/changes` | process/docs |
| 75 | `frontend/src` | code |
| 58 | `context/archive` | process/docs |
| 52 | `backend/src` | code |
| 46 | `backend/test` | test |
| 41 | `context/foundation` | process/docs |
| 31 | `infra/lib` | code |
| 27 | `frontend/test` | test |
| 27 | `.github/workflows` | CI |
| 23 | `extension/src` | code |

**The single largest area of activity in this repo is its own planning
documentation**, not any application. `context/{changes,archive,foundation}`
together account for 270 file-touches against 181 for all four apps' `src/`
combined. This is a real property of the project, not an artifact of filtering —
the AI-workflow docs are a first-class deliverable here.

### Top code folders (depth 3)

| Touches | Folder |
| ---: | --- |
| 26 | `frontend/src/pages` |
| 26 | `backend/src/routes` |
| 20 | `backend/test/routes` |
| 19 | `infra/lib/constructs` |
| 14 | `frontend/src/api` |
| 14 | `backend/src/plugins` |
| 10 | `frontend/test/pages` |
| 10 | `frontend/src/auth` |
| 9 | `extension/src/popup` |

### Top individual files

| Touches | File | Note |
| ---: | --- | --- |
| 14 | `.github/workflows/deploy.yml` | |
| 13 | `.github/workflows/pr-diff.yml` | |
| 11 | `backend/package.json` | |
| 10 | `infra/lib/constructs/api-construct.ts` | **highest-churn application file** |
| 8 | `frontend/src/api/client.ts` | auth/token handling |
| 7 | `frontend/src/App.tsx` | |
| 7 | `backend/src/routes/api/collections/index.ts` | |
| 7 | `frontend/src/pages/CollectionDetailPage.tsx` | |
| 6 | `infra/lib/constructs/github-oidc-construct.ts` | |
| 5 | `backend/test/route-reachability.test.ts` | |

The two CI workflows top the list, which is expected for a project that stood up
deploy and PR gates during the same weeks it built features. The first file that
is neither CI nor a manifest is **`api-construct.ts`**.

## Emphasis over time (weekly)

| Week | Commits | Dominant areas |
| --- | ---: | --- |
| 07-06 → 07-13 | 1 | repo init only |
| 07-13 → 07-20 | 18 | `infra/lib` (24), `backend/src` (14), `frontend/src` (10) |
| 07-20 → 07-27 | 30 | `context/changes` (37), `frontend/src` (14), `backend/test` (14) |
| 07-27 → 08-03 | 19 | `context/changes` (29), `backend/src` (15), `extension/src` (14) |
| 08-03 → 08-10 | 61 | `context/changes` (67), `frontend/src` (32), `frontend/test` (13) |
| 08-10 → 08-14 | 33 | `context/changes` (35), `context/archive` (17), `frontend/test` (14) |

Three phases, cleanly separated:

1. **Infrastructure first** (week of 07-13) — `infra/lib` leads before any
   sustained feature work. CDK and deploy came before product.
2. **Feature build-out** (07-20 → 08-03) — backend routes, then the extension.
3. **Test hardening** (08-03 onward) — `frontend/test` and `context/archive`
   climb while `src` activity falls off. The last two weeks are dominated by
   testing and by archiving completed changes, matching
   `context/foundation/test-plan.md`'s phased rollout.

## Co-change — what moves together

Measured as: distinct depth-2 directories appearing in the same commit.

| Shared commits | Pair | % of the smaller side |
| ---: | --- | ---: |
| 19 | `backend/test` + `context/changes` | 86% of `backend/test` |
| 18 | `context/changes` + `frontend/src` | 72% of `frontend/src` |
| 13 | `backend/src` + `backend/test` | 81% of `backend/src` |
| 13 | `backend/src` + `context/changes` | 81% of `backend/src` |
| 10 | `backend/package.json` + `backend/test` | 91% of `backend/package.json` |
| 10 | `.github/workflows` + `context/changes` | 67% of `.github/workflows` |
| 7 | `context/changes` + `extension/src` | 100% of `extension/src` |

Top triples: `backend/src + backend/test + context/changes` (10),
`backend/package.json + backend/src + backend/test` (7).

**Conclusions for the top 3:**

1. **`context/changes` is the universal co-changer** — it appears alongside
   every other area, up to 100% of `extension/src` commits. This is *process
   coupling, not code coupling*: the workflow requires a plan/progress edit in
   the same commit as the code. It carries no refactoring signal and must not be
   read as an architectural dependency.
2. **`backend/src` ↔ `backend/test` at 81%** is healthy test discipline —
   backend code essentially never lands without its tests in the same commit.
3. **`backend/package.json` ↔ `backend/test` at 91%** reflects the backend's
   test tooling living in root scripts (`npm test` compiles, then runs
   `node --test`), so test changes routinely drag the manifest along.

### The apps are genuinely decoupled — and that is the risk

Targeted probe of cross-app pairs:

| Pair | Shared commits | Individual totals |
| --- | ---: | --- |
| `frontend/src` + `extension/src` | **2** | 25 / 7 |
| `backend/src` + `extension/src` | **2** | 16 / 7 |
| `backend/src` + `infra/lib` | **3** | 16 / 17 |
| `frontend/src` + `infra/lib` | **2** | 25 / 17 |

`CLAUDE.md`'s claim that the apps are independent holds up in the history — they
are almost never edited together. Two of these near-zeros are load-bearing:

- **`frontend/src` + `extension/src` (2 shared commits).** Both clients declare
  their own copy of the backend's response shapes. `Collection` in
  `frontend/src/api/collections.ts:3` and `extension/src/types.ts:6` is
  currently **byte-identical** (same five fields, same order), yet the two files
  have co-changed twice in 32 relevant commits. Nothing structural keeps them in
  sync; they agree today by luck and attention. Below `Collection` they have
  already diverged in vocabulary — the frontend models `EntrySentence` / `Entry`
  / `CollectionDetail`, the extension models `TranslationSentence` /
  `TranslationResult` / `SavedEntry` — for the same backend data.
- **`backend/src` + `infra/lib` (3 shared commits).** `lessons.md` records that
  a route added under `backend/src/routes/api/` is unreachable in production
  until a matching entry exists in `infra/lib/constructs/api-construct.ts`, and
  that this shipped broken twice. The history confirms the coupling is real but
  almost never honoured in a single commit.

### The common denominator

The method asks whether one file co-changes with many areas at once — a
translations file, a config, something generated. Here the answer is **no such
code file exists**; the cross-cutting files are documentation and CI:

| Distinct areas | Touches | File |
| ---: | ---: | --- |
| 28 | 6 | `AGENTS.md` |
| 23 | 10 | `infra/lib/constructs/api-construct.ts` |
| 22 | 14 | `context/foundation/test-plan.md` |
| 22 | 9 | `CLAUDE.md` |
| 19 | 14 | `.github/workflows/deploy.yml` |
| 19 | 13 | `.github/workflows/pr-diff.yml` |

`api-construct.ts` is the one *application* file behaving like a repo-wide
common denominator: 23 distinct areas, 10 touches, second only to `AGENTS.md`.
That is consistent with it being a manually maintained registry of every backend
route — a shape the dependency graph (artifact 2) will not show, because no
import edge connects `backend/src/routes/` to `infra/lib/`.

## Survival check

Every top-touched application file still exists in the tree — no analysis below
rests on a deleted path.

Two heavily-touched paths first appeared as deleted:
`context/changes/capture-translate-save/{plan,change}.md`. Both are **renames,
not deletions** — `git log --follow` reports `R100` (100% similarity) into
`context/archive/2026-07-25-capture-translate-save/`. This is the archive
workflow, and it inflates apparent churn for every completed change: each one
shows up once where it was written and again where it was archived.

## Open questions for artifacts 2 and 3

- **For artifact 2 (dependency graph):** does `dependency-cruiser` show *any*
  edge between the three apps? Expected: none — four independent npm projects
  with no workspace linking. If so, the `frontend`↔`extension` contract
  duplication and the `backend`↔`infra` route coupling are both `unknown` to the
  tool, not "uncoupled". They must be carried forward from this artifact by hand.
- **For artifact 3 (contributors):** single author, so the question degenerates.
  Record it as a limitation and spend the effort on where knowledge is written
  down instead (`context/foundation/lessons.md` is the de facto handover doc).
- **Unmeasured by this artifact:** `context/changes` dominance may be masking
  code hotspots in the ranking. A re-run excluding all of `context/` would give
  a cleaner code-only view if artifact 2 needs it.
