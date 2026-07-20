# Minimal Database Schema (F-01) Implementation Plan

## Overview

Add the minimal Postgres schema InkLingo needs to persist users, collections, and saved vocabulary entries — plus a migration tool to create and evolve that schema. This is foundation-only (per roadmap F-01): no routes, no business logic, no auth wiring consume this schema yet. It exists so S-01 (auth), S-02 (collections), and S-03 (capture/translate/save) have somewhere to write.

## Current State Analysis

- `backend/src/plugins/neon.ts` decorates `fastify.sql` with `@neondatabase/serverless`'s HTTP-based `neon()` query function — deliberately not a `pg.Pool`, because the app runs on Lambda where a persistent TCP pool doesn't survive cold starts/reuse well.
- `backend/src/plugins/config.ts` already resolves `neonDatabaseUrl` (from SSM in Lambda, from `process.env.NEON_DATABASE_URL` locally) and requires it to be set — there is no `.env` loading mechanism (no `dotenv`) anywhere in the backend; developers currently export env vars in their shell to run `npm run dev` / `npm test`.
- No tables, no migration files, no ORM exist anywhere in the repo (confirmed via `context/foundation/roadmap.md` baseline and a full scan of `backend/`).
- `backend/test/helper.ts` builds a full Fastify instance per test file via `fastify-cli/helper.js`'s `build(t)`, tearing down in `t.after` — this exposes all decorators, including `fastify.sql`, for direct use in tests (see `backend/test/routes/root.test.ts`).
- Auth identity will come from Cognito (`frontend/src/auth/cognito.ts`, OIDC) once S-01 verifies tokens server-side — the backend doesn't verify tokens yet, but F-01's `users` table needs to be shaped to receive that identity.

## Desired End State

Running `npm run migrate:up` against a Neon database creates 5 tables (`users`, `collections`, `entries`, `entry_translations`, `entry_sentences`) with the constraints and indexes described below. `npm run migrate:down` reverses it cleanly. No application code queries these tables yet — verification is migration-level (schema exists, constraints hold) not feature-level.

**Verification**: `npm run migrate:up` then `npm run migrate:down` both exit 0 against a real Neon database; the new schema constraint tests pass via `npm test`.

### Key Discoveries:

- Neon distinguishes a **pooled** (PgBouncer, transaction-mode) and a **direct/unpooled** connection string. Migration tools that take session-level advisory locks — `node-pg-migrate` does, to prevent concurrent migration runs — need the direct string. If `NEON_DATABASE_URL` currently points at the pooled endpoint, migrations may fail or hang; this needs verifying during Phase 1 and documenting in the README regardless of outcome.
- The backend is ESM (`"type": "module"` in `backend/package.json`), but `node-pg-migrate`'s default migration-file loader expects CommonJS. This is a real gotcha for Phase 1/2: migration files need to be written in whatever module format `node-pg-migrate` actually loads cleanly in this ESM project (verify at implementation time — commonly `.cjs` migration files even in an ESM package, or an explicit language/loader flag) rather than assumed to "just work" as `.ts`/`.js` ESM.

## What We're NOT Doing

- No routes, handlers, or Fastify decorators that query these tables — that's S-01/S-02/S-03's job.
- No auth/token verification — `users.cognito_sub` exists as a column, but nothing populates or checks it yet.
- No CI/CD integration for migrations — they run manually via a local npm script for now.
- No separate test database/Neon branch provisioning — constraint tests run against whatever `NEON_DATABASE_URL` already points to locally (same convention `npm test` already relies on for `config.ts`).
- No support for tying an example sentence to one specific translation/meaning — `entry_sentences` and `entry_translations` are siblings under `entries`, not parent/child of each other. Adding that link later (e.g. a nullable FK) is additive, not a redesign.
- No ON DELETE behavior UI/confirmation flow — the guardrail "zero utraty zapisanych słówek" (no silent data loss) means any future collection-delete UI (S-02) must confirm before triggering the cascade defined here; that UX is out of scope for this change.

## Implementation Approach

Use `node-pg-migrate` (plain SQL/JS migrations over a standard `pg` connection, no ORM) as the migration tool, reusing the existing `NEON_DATABASE_URL` env var rather than introducing a new one. Design the schema so a single entry can carry multiple translations (one row per target language in `entry_translations`, multi-sense meanings via a `/`-separated string) and multiple example sentences tagged by language (`entry_sentences.language_code`) — independent of whether that language is the entry's source language or a translation language, since which language gets examples is a runtime/business-logic decision (S-03), not a schema-level one. `users` decouples the internal primary key from the Cognito `sub` (unique indexed column, not the PK) so a Cognito user pool recreation/disaster-recovery event only requires updating one row's `cognito_sub`, not rewriting foreign keys across the schema.

## Critical Implementation Details

- **Connection string for migrations**: verify whether `NEON_DATABASE_URL` (as currently provisioned) is Neon's pooled or direct connection string before wiring `node-pg-migrate`. If pooled, either switch the app's env var to the direct string (safe — `@neondatabase/serverless`'s HTTP driver works with either) or introduce a second migration-only env var. Document whichever path is taken in `backend/README.md`.
- **ESM vs. migration-file format**: `backend/package.json` sets `"type": "module"`, but `node-pg-migrate`'s default loader expects CommonJS migration files. Confirm the working combination (module format + any required CLI flag) before writing the Phase 2 migration, rather than assuming `.ts`/`.js` ESM migration files load without configuration.
- **UUID generation**: Postgres needs the `pgcrypto` extension enabled for `gen_random_uuid()`; the first migration must run `CREATE EXTENSION IF NOT EXISTS pgcrypto` before any table uses it as a default.

## Phase 1: Migration Tooling Setup

### Overview

Install and wire up `node-pg-migrate` so the project has a working, documented way to create and run schema migrations, before any schema is written.

### Changes Required:

#### 1. Dependencies

**File**: `backend/package.json`

**Intent**: Add `node-pg-migrate` and `pg` (its peer dependency for a standard TCP Postgres connection) as dependencies, plus `@types/pg` as a dev dependency to keep the project typed per its existing conventions.

**Contract**: New `dependencies` entries for `node-pg-migrate` and `pg`; new `devDependencies` entry for `@types/pg`.

#### 2. npm scripts

**File**: `backend/package.json`

**Intent**: Add scripts to run migrations up, down, and to scaffold new migration files, all pointed at the existing `NEON_DATABASE_URL` env var and a `migrations/` directory.

**Contract**: `migrate:up`, `migrate:down`, and `migrate:create` scripts, each invoking the `node-pg-migrate` CLI with `--migrations-dir migrations` and reusing `NEON_DATABASE_URL` (via node-pg-migrate's env-var-name option) rather than requiring a new `DATABASE_URL` variable.

#### 3. Documentation

**File**: `backend/README.md`

**Intent**: Document the migration workflow (how to create, run, and roll back a migration) and record the resolution of the pooled-vs-direct connection string question from "Critical Implementation Details" so future changes don't have to re-derive it.

**Contract**: New section describing `npm run migrate:create <name>`, `npm run migrate:up`, `npm run migrate:down`, and which Neon connection string type `NEON_DATABASE_URL` must be.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `npm install`
- Migration CLI is reachable and reports status with zero migrations applied: `npm run migrate:up -- --dry-run` (or equivalent no-op check)
- Type checking passes: `npm run build:ts`

#### Manual Verification:

- `npm run migrate:create test_migration` scaffolds a file in `backend/migrations/` using the confirmed working module format
- Delete the scaffolded test file before moving to Phase 2 (it was only to confirm the tool works end-to-end)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Schema Migration

### Overview

Write the migration that creates all 5 tables with their constraints and indexes.

### Changes Required:

#### 1. Schema migration file

**File**: `backend/migrations/<timestamp>_create-core-schema.<ext>` (extension per Phase 1's confirmed module format)

**Intent**: Create the full F-01 schema in one migration: `users`, `collections`, `entries`, `entry_translations`, `entry_sentences`, with primary keys, foreign keys, uniqueness constraints, cascade deletes, and indexes on every foreign key column used in a `WHERE`/`JOIN` (collection lookups, entry lookups).

**Contract**:

- `CREATE EXTENSION IF NOT EXISTS pgcrypto;` (required for `gen_random_uuid()` defaults below)
- `users`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `cognito_sub TEXT NOT NULL UNIQUE`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `collections`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, index on `user_id`
- `entries`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE`, `word_or_phrase TEXT NOT NULL`, `source_language_code TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, index on `collection_id`
- `entry_translations`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE`, `language_code TEXT NOT NULL`, `meaning_text TEXT NOT NULL` (may contain multiple `/`-separated senses), `UNIQUE (entry_id, language_code)`
- `entry_sentences`: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE`, `language_code TEXT NOT NULL`, `sentence_text TEXT NOT NULL`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, index on `entry_id`
- Cascade rule: deleting a `collections` row deletes its `entries`, which deletes their `entry_translations` and `entry_sentences`, all via `ON DELETE CASCADE`. Deleting a `users` row cascades to their `collections` for the same referential-integrity reason.
- Corresponding `down` migration drops all 5 tables (and the extension is left in place — dropping `pgcrypto` is not safe to automate if anything else in the database depends on it).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npm run migrate:up`
- Migration reverses cleanly: `npm run migrate:down`
- Re-applying after rollback is idempotent: `npm run migrate:up` again succeeds
- Type checking passes: `npm run build:ts`

#### Manual Verification:

- Inspect the created tables in a Postgres client (or Neon's SQL console) and confirm all 5 tables, their columns, and foreign keys match the contract above

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Verification Tests

### Overview

Add automated tests proving the schema's constraints actually hold, using the existing `node:test` + `build(t)` convention.

### Changes Required:

#### 1. Schema constraint tests

**File**: `backend/test/schema/core-schema.test.ts`

**Intent**: Using the existing `build(t)` helper (which exposes `fastify.sql`), assert that the constraints defined in Phase 2 are enforced by the database: uniqueness (`entry_translations` rejects a duplicate `(entry_id, language_code)`), foreign keys (inserting an `entries` row with a nonexistent `collection_id` fails), NOT NULL columns reject nulls, and cascade delete (deleting a `collections` row removes its `entries`, `entry_translations`, and `entry_sentences`).

**Contract**: A `node:test` file following the pattern in `backend/test/routes/root.test.ts` (`build(t)` + `t.after` teardown), using `fastify.sql` for raw SQL inserts/deletes and `assert.rejects` / `assert.strictEqual` to verify constraint behavior. Tests must clean up any rows they insert (or rely on cascade delete to do so) so repeated runs don't accumulate data or collide on unique constraints.

### Success Criteria:

#### Automated Verification:

- Full test suite passes: `npm test`
- New schema tests specifically pass: `npm run build:ts && tsc -p test/tsconfig.json && FASTIFY_AUTOLOAD_TYPESCRIPT=1 node --test --experimental-test-coverage --loader ts-node/esm test/schema/core-schema.test.ts`

#### Manual Verification:

- Run the test suite twice in a row against the same database and confirm no leftover-data failures (proves cleanup/cascade works, not just that the first run passed)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Not applicable — there is no application logic yet, only schema.

### Integration Tests:

- Phase 3's constraint tests are the integration layer: real SQL against a real Neon database via `fastify.sql`, proving FK/unique/NOT NULL/cascade behavior actually holds at the database level (mocking a database would prove nothing about constraint enforcement).

### Manual Testing Steps:

1. Run `npm run migrate:up`, inspect the resulting tables in a Postgres client.
2. Run `npm run migrate:down`, confirm all 5 tables are gone.
3. Run `npm run migrate:up` again, run `npm test` twice in a row, confirm both runs pass with no leftover-row collisions.

## Performance Considerations

None expected at this stage — no queries are written against this schema yet. The schema itself indexes every foreign key used in the join patterns discussed during planning (`entries.collection_id`, `entry_translations.entry_id`, `entry_sentences.entry_id`), which is what keeps future collection/entry reads (including print export) fast regardless of total table size.

## Migration Notes

No existing data to migrate — this is the first schema InkLingo has ever had.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01: core-data-schema)
- PRD: `context/foundation/prd.md` (Access Control, FR-004, FR-005, FR-013)
- Existing Neon wiring: `backend/src/plugins/neon.ts`, `backend/src/plugins/config.ts`
- Existing test convention: `backend/test/helper.ts`, `backend/test/routes/root.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration Tooling Setup

#### Automated

- [x] 1.1 Dependencies install cleanly: `npm install` — f5b78ee
- [x] 1.2 Migration CLI is reachable and reports status with zero migrations applied — f5b78ee
- [x] 1.3 Type checking passes: `npm run build:ts` — f5b78ee

#### Manual

- [x] 1.4 `npm run migrate:create test_migration` scaffolds a file using the confirmed working module format, then is deleted — f5b78ee

### Phase 2: Schema Migration

#### Automated

- [x] 2.1 Migration applies cleanly: `npm run migrate:up`
- [x] 2.2 Migration reverses cleanly: `npm run migrate:down`
- [x] 2.3 Re-applying after rollback is idempotent
- [x] 2.4 Type checking passes: `npm run build:ts`

#### Manual

- [ ] 2.5 Inspect the created tables and confirm they match the contract

### Phase 3: Verification Tests

#### Automated

- [ ] 3.1 Full test suite passes: `npm test`
- [ ] 3.2 New schema tests specifically pass

#### Manual

- [ ] 3.3 Run the test suite twice in a row against the same database with no leftover-data failures
