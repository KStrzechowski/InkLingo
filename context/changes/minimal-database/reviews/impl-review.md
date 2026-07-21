<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Minimal Database Schema (F-01) Implementation Plan

- **Plan**: context/changes/minimal-database/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-07-21
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — README's pooled-vs-direct connection-string claim is unverified and likely wrong

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: backend/README.md:40
- **Detail**: The plan's "Key Discoveries" explicitly flagged that `node-pg-migrate` takes session-level advisory locks, which Neon's pooled (PgBouncer transaction-mode) endpoint doesn't reliably preserve, and asked Phase 1 to "verify... and document" which connection-string type is required. The shipped README instead states: "`NEON_DATABASE_URL` can be either Neon's pooled or direct connection string — both were verified to work." Grepping the live `backend/.env` shows `NEON_DATABASE_URL` currently contains `pooler` in its host — i.e. it's the pooled string. `npm run migrate:up` succeeding just now only proves a single, non-concurrent run works; it doesn't validate advisory-lock behavior under the pooled endpoint, which is exactly the failure mode (concurrent migration runs hanging/failing) the plan called out. The documented "resolution" doesn't actually resolve the question the plan asked to close.
- **Fix A ⭐ Recommended**: Point `backend/.env`'s `NEON_DATABASE_URL` at Neon's direct (unpooled) connection string, and update the README line to state plainly that migrations require the direct string.
  - Strength: Matches the plan's own explicitly anticipated resolution path — `@neondatabase/serverless`'s HTTP driver (used by the app) already tolerates either string, so switching only affects which host migrations hit, not app runtime behavior.
  - Tradeoff: Whoever manages `.env` must remember to keep using the direct string specifically, not whichever one Neon's dashboard shows first.
  - Confidence: HIGH — Neon's own docs and node-pg-migrate's session-scoped advisory-lock requirement are unambiguous about transaction-mode PgBouncer not reliably preserving session state.
  - Blind spot: Haven't reproduced an actual concurrent-migration collision against the pooled string to observe the failure firsthand — the risk is well-documented but not empirically triggered in this repo.
- **Fix B**: Introduce a second migration-only env var (e.g. `NEON_DIRECT_DATABASE_URL`) and point `migrate:up`/`migrate:down` at it, leaving `NEON_DATABASE_URL` (pooled) untouched for the app.
  - Strength: Zero risk of ever accidentally using a pooled connection for migrations, regardless of what the app's primary var points to.
  - Tradeoff: Second secret to provision/rotate in `.env` (and eventually CI), contradicting the plan's explicit preference to reuse a single var.
  - Confidence: MEDIUM — technically sound but adds operational surface the plan deliberately tried to avoid.
  - Blind spot: Whether this is worth the extra secret before any concurrent-migration scenario actually exists (currently a single developer running migrations manually).
- **Decision**: FIXED via Fix A — switched backend/.env's NEON_DATABASE_URL to Neon's direct (unpooled) connection string, corrected backend/README.md:40 to state migrations require the direct string, and re-verified `npm run migrate:up` (no-op, connects fine) and `npm test` (11/11 pass) against the new string.

### F2 — Migration files are excluded from TypeScript checking, so "type checking passes" doesn't cover them

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: backend/test/tsconfig.json:16 (and backend/tsconfig.json:13)
- **Detail**: `backend/tsconfig.json`'s `include` is `["src/**/*.ts"]` and `backend/test/tsconfig.json`'s is `["../src/**/*.ts", "**/*.ts"]` (resolved relative to `test/`) — neither covers `backend/migrations/`. Both Phase 1 and Phase 2 list "Type checking passes: `npm run build:ts`" as an Automated Verification bullet, and it does pass, but only because `tsc` never sees `migrations/1784584360698_create-core-schema.ts` at all. It's only ever parsed at runtime by node-pg-migrate's `jiti` transpile-on-import loader, which doesn't type-check. A type error in a future migration (wrong `pgm` API shape, typo'd column type) would surface only when `migrate:up` is actually run against a real database, not in CI/build.
- **Fix**: Add `"../migrations/**/*.ts"` to `backend/test/tsconfig.json`'s `include` array — it already has `noEmit: true` and already reaches outside `test/` via the `"../src/**/*.ts"` entry, so this extends the exact same established pattern rather than introducing a new one.
- **Decision**: FIXED — added the include entry; re-ran `npx tsc -p test/tsconfig.json`, 0 errors with the migration file now covered.

### F3 — `migrate:down` has no guard against targeting the same database as the deployed Lambda

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: backend/migrations/1784584360698_create-core-schema.ts:71-77, backend/package.json (migrate:down script)
- **Detail**: `down` unconditionally drops all 5 tables via cascade, and `npm run migrate:down` runs it against whatever `NEON_DATABASE_URL` is currently in `backend/.env` with no environment check or confirmation. The deployed Lambda resolves its own `NEON_DATABASE_URL` from SSM (`src/plugins/config.ts`), which is a separate value from local `.env` — but if this MVP uses a single Neon project for both local dev and the deployed backend (plausible at `target_scale: small`), a developer could point `.env` at that same connection string and accidentally wipe the tables the deployed app relies on. The plan explicitly deferred CI/CD and environment-tiering ("they run manually via a local npm script for now"), so a heavyweight guard is out of scope, but zero documentation of the risk is a gap given the PRD's "zero utraty zapisanych słówek" guardrail.
- **Fix**: Add a short warning callout to `backend/README.md`'s "Database migrations" section: never point local `.env`'s `NEON_DATABASE_URL` at the same database the deployed Lambda's SSM parameter uses, since `migrate:down` has no environment guard and drops all 5 tables unconditionally.
- **Decision**: FIXED differently — user asked for an actual code guard rather than a docs-only callout, then clarified it should warn rather than block. Added a `premigrate:down` npm script (`backend/package.json`) that prints a console warning automatically before every `migrate:down` run (npm's pre-script lifecycle hook — no code in the migration file itself changed), plus a README note describing it. Verified via `npm run premigrate:down` directly (prints correctly, doesn't touch the database). It warns rather than blocks, matching what was asked; it does not stop an actual accidental run.

### F4 — Plan doesn't document the post-review follow-up changes (commit 797002a)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/minimal-database/plan.md
- **Detail**: A prior `/code-review` pass produced commit `797002a`, which touched `backend/src/app.ts` (added `dotenv/config` loading), `backend/package.json` (moved `dotenv` to `dependencies`), `backend/test/tsconfig.json` (`noEmit: true`), `backend/README.md`, and `CLAUDE.md` — none of which appear in the plan's "Changes Required" for any phase. All five are internally coherent with their commit-message intent and don't cross the plan's "What We're NOT Doing" boundaries (no routes/handlers query the new tables), so this is benign scope creep, not a violation — but the plan as written is no longer a complete as-built record of what shipped.
- **Fix**: Append a short "Addendum" note to `plan.md` (e.g. under Phase 1) listing the four files `797002a` touched beyond the original contract, with a one-line pointer to "Found via `/code-review`."
- **Decision**: FIXED — appended an `## Addendum` section to plan.md documenting both commit 797002a's changes and this review's own F1/F2/F3 fixes (which also touched files outside the original Changes Required), so the plan stays a complete as-built record going forward.

## Verified evidence (not findings — recorded for traceability)

- `npm install`: clean, 0 vulnerabilities in production dependencies (2 high-severity dev-only vulns in `concurrently`'s `shell-quote` transitive dep predate this change — present since the original Fastify-CLI scaffold, not introduced here).
- `npm run build:ts`: passes, 0 errors.
- `npm run migrate:up`: "No migrations to run!" — confirms the live dev database's schema state exactly matches the migration file, no drift.
- `npm test`: run three times consecutively, 11/11 pass every time (9 schema-constraint tests + 2 pre-existing route tests) — independently reconfirms manual check 3.3 (no leftover-data collisions across repeated runs) beyond the recorded commit.
- Schema migration file (`backend/migrations/1784584360698_create-core-schema.ts`) matches the Phase 2 contract exactly: all 5 tables, column types/defaults/NOT NULL, the `(entry_id, language_code)` unique constraint, all three required indexes, full `ON DELETE CASCADE` chain, `pgcrypto` created before use and correctly left in place by `down`.
- `core-schema.test.ts` follows the `build(t)`/`t.after` pattern from `root.test.ts` exactly; all queries use parameterized `$1`/`$2` placeholders (no SQL injection risk).
- No route, handler, or decorator anywhere in `backend/src/routes` references the new tables — the "no application code queries this schema yet" scope guardrail holds.
- ESM migration file loading via node-pg-migrate's `jiti` loader is coherent and non-fragile (confirmed against `node-pg-migrate`'s source) — the plan's flagged ESM-vs-CommonJS migration-loader risk did not materialize as a problem.
- `dotenv/config`'s addition to `app.ts` fails safe: `dotenv` swallows a missing `.env` file internally rather than throwing, and Lambda's `config.ts` path never depends on `.env` existing (it reads SSM whenever `AWS_LAMBDA_FUNCTION_NAME` is set) — confirmed non-issue.
