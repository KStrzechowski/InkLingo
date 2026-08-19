---
artifact: 3-contributors
source: git history (163 commits, 2026-07-06 .. 2026-08-17) + documentation inventory
generated: 2026-08-18
status: draft
---

# Contributors — the question that degenerates, and what to ask instead

## Hard limitation: one author

`git log --format="%an" | sort -u` returns exactly one name across the entire
history.

| Metric | Value |
| --- | --- |
| Commits | 163 |
| Distinct authors | **1** — `KStrzechowski <kondi827@gmail.com>` |
| Window | 2026-07-06 .. 2026-08-17 (6 weeks) |
| Distinct committers | 2 — `KStrzechowski` and `GitHub` (the PR merge button, not a person) |

**No contributor map is produced by this artifact, and none should be.** The
prompt's support-line question — who to ask about a given area — has the same
answer for all five areas, so grouping commits by person, filtering bots, or
classifying activity thematically would produce the *appearance* of a finding
with no information in it. `artifact-1-territory.md` predicted this in its
limits section and in its open questions, and recommended spending the effort on
where knowledge is written down instead. That is what follows.

The one real consequence to carry forward: **there is no second person to ask.**
Every fact about this repo either exists in a document, in a code comment, or
nowhere. That makes the documentation inventory below a load-bearing artifact
rather than a nice-to-have.

## Where knowledge is actually written down

Tracked markdown is **12,193 lines against 13,402 lines of tracked code** — near
1:1. This is a repo where prose is a first-class deliverable, which matches
artifact 1's finding that `context/` is the single largest area of activity
(270 file-touches vs 181 for all four apps' `src/` combined).

Four tiers, in descending durability:

### Tier 1 — durable rules (read first, ~10 minutes)

| Doc | Size | What it carries | Tracked? |
| --- | ---: | --- | --- |
| `AGENTS.md` | 70 lines, 10 sections | Hard Rules, layout, commands per app, coding style, testing, observability, quality gates, PR conventions | **yes** |
| `context/foundation/lessons.md` | 66 lines, **9 entries** | Recurring traps, each as Context / Problem / Rule / Applies-to | yes |
| `CLAUDE.md` | ~90 lines | Full workflow, `context/` semantics, E2E rules | **no — gitignored** |

`lessons.md` is the highest-value-per-line document in the repo: 9 entries, each
a bug class that already cost time, and it is re-read at start by six different
skills. Entries include the api-construct route pairing, the expired-token-reads-
as-CORS trap, and the read-before-`await`-written-after rule.

### Tier 2 — the living foundation (`context/foundation/`, 1,163 lines)

| Doc | Lines | Why a newcomer needs it |
| --- | ---: | --- |
| `test-plan.md` | 409 | The risk model — which of the top-7 risks each gate defends |
| `roadmap.md` | 192 | Ordered slices; what is built vs planned |
| `shape-notes.md` | 177 | The original discovery conversation |
| `prd.md` | 142 | Vision, personas, FRs, access control |
| `infrastructure.md` | 133 | Platform decision and risk register |
| `lessons.md` | 66 | See tier 1 |
| `tech-stack.md` | 29 | **Mandated reading** by AGENTS.md Hard Rules before proposing any framework/datastore change |

### Tier 3 — the decision trail (`context/archive/`, 12 changes + 3 open)

Every completed change keeps its own folder with a consistent anatomy:

| File | Present in |
| --- | ---: |
| `change.md` | 12 of 12 |
| `plan-brief.md` | 11 |
| `plan.md` | 11 |
| `reviews/impl-review.md` | 8 |
| `research.md` | 6 |

Plus one-off artefacts where a change earned them —
`manual-verification.md`, `pending-manual-checks.md`, `manual-print-gate.md`,
and a standalone debugging writeup
(`backend-unreachable-reads-as-logged-out.md`). The four largest plans run
300–883 lines. **This is where "why was it built this way" is answered**, and it
is read-only by convention (AGENTS.md Hard Rule #1).

### Tier 4 — code comments (15–30% of source lines)

| Tree | Comment lines / total | Density |
| --- | ---: | ---: |
| `infra/lib` | 206 / 679 | **30%** |
| `frontend/src` | 451 / 2130 | 21% |
| `scripts` | 79 / 372 | 21% |
| `backend/src` | 233 / 1354 | 17% |
| `extension/src` | 240 / 1543 | 15% |

Unusually high, and the comments are explanatory rather than descriptive — they
record *why*, including rejected alternatives. Examples worth knowing about:
`extension/src/observability/reporter.ts` opens by explaining why it cannot share
code with its frontend twin; `backend/test/route-reachability.test.ts` documents
its own blind spots; `scripts/quality/checks.mjs` records the measured timings
behind each gate's placement. Note `infra/lib` has the highest density and the
least test coverage — the prose is carrying the load there.

## Gaps a new developer would hit

Ordered by how quickly they would hit them:

1. **`CLAUDE.md` is gitignored — it is not in a fresh clone.** `.gitignore`
   excludes it along with `/.claude/*` (only `settings.json` and `hooks/` are
   re-included). AGENTS.md's Project Structure section pointed at it with no
   caveat — **a pointer to a file the newcomer does not receive** — and the gap
   is invisible to the author, whose working copy has it.
   *Mitigated 2026-08-18:* that line now states the file is gitignored on
   purpose, tells the reader to ask for a copy, and confirms AGENTS.md plus
   `context/foundation/` carry everything strictly required. The exclusion
   itself is deliberate (the 10x-cli regenerates most of the file), so it was
   left in place — tracking it is a maintainer decision, not a defect to patch.
2. **`docs/reference/contract-surfaces.md` does not exist** — no `docs/`
   directory at all. Lower severity than it first appears: the only thing
   referencing it is `.claude/CLAUDE.md`, which is *also* untracked, so a
   newcomer never sees the dangling reference either. It matters for the
   author's own tooling, not for onboarding.
3. ~~AGENTS.md's frontend description is stale.~~ **Fixed 2026-08-18** — it
   described `frontend/src/` as a stock scaffold with "no routing or data-layer
   library"; it now describes the real `pages/` + `api/` + `auth/` structure.
4. ~~`lessons.md:29` is stale.~~ **Fixed 2026-08-18** — the entry now carries an
   Update noting that `backend/test/route-reachability.test.ts` does catch the
   drift statically, along with the call shapes it cannot see.
5. **The two cross-app couplings are written down in prose only.** Per artifact
   2, no import edge represents either. The byte-identical `Collection` type
   (`frontend/src/api/collections.ts:3`, `extension/src/types.ts:6`) is recorded
   in artifact 1 and in a comment header in `extension/src/types.ts`; the
   `backend/src/routes` to `infra/lib/constructs/api-construct.ts` pairing is
   recorded in `lessons.md:26-30` and in one test file. Neither is discoverable
   from the code alone.

## Reading order for a new developer

Roughly 90 minutes to be productive, in this order:

1. **`AGENTS.md`** — hard rules, per-app commands, quality gates. The only true
   entry point in the repo.
2. **`CLAUDE.md`** — *must be requested from the author; not in the clone.*
   Workflow, `context/` semantics, E2E rules.
3. **`context/foundation/tech-stack.md`** (29 lines) — required by Hard Rules
   before questioning any stack choice.
4. **`context/foundation/prd.md` + `roadmap.md`** — what the product is, and
   what order it is being built in.
5. **`context/foundation/lessons.md`** — 9 entries, ~5 minutes, the best
   time-to-value in the repo.
6. **`context/map/artifact-1-territory.md` + `artifact-2-structure.md`** — where
   work lands, and what the dependency graph cannot see.
7. **`context/foundation/test-plan.md`** — the risk model behind the gates.
8. **One archived change end-to-end** — `2026-08-06-testing-auth-resilience/`
   is a good specimen: `change.md` -> `plan.md` -> `reviews/impl-review.md` ->
   `manual-verification.md` shows the whole workflow in one folder.
9. **The comment headers in whichever tree you are touching** — especially
   `infra/lib`, where the prose is the documentation.

Then: `git config core.hooksPath .githooks` (AGENTS.md, one-time setup after
cloning), and `npm install` separately in each of the four apps.

## Carry forward

- **Open:** decide whether to track `CLAUDE.md` or keep mirroring the essentials
  into `AGENTS.md`. The broken pointer is patched, but a cloned repo still lacks
  the document. Trade-off: the file carries a 10x-cli-regenerated block, so
  tracking it means regeneration churn in every PR.
- **Open:** create `docs/reference/contract-surfaces.md` or drop the reference
  from `.claude/CLAUDE.md`. Author-tooling concern only — both files are
  untracked.
- **Done 2026-08-18:** AGENTS.md frontend paragraph and the `lessons.md` route
  entry, both corrected.
- Single point of contact is structural, not a risk to mitigate — but it means
  every gap above has no human fallback.
