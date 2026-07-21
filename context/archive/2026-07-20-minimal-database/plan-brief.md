# Minimal Database Schema (F-01) — Plan Brief

> Full plan: `context/changes/minimal-database/plan.md`

## What & Why

Add the minimal Postgres schema (users, collections, entries + translations + sentences) that S-01, S-02, and S-03 will need to persist data, plus `node-pg-migrate` as the tool to create and evolve it. This is foundation-only — no routes or business logic consume it yet.

## Starting Point

No tables, no ORM, no migration tool exist in the repo today. `backend/src/plugins/neon.ts` already wraps `@neondatabase/serverless`'s HTTP driver for runtime queries (deliberately not a TCP pool, since the app runs on Lambda), and `backend/src/plugins/config.ts` already resolves `NEON_DATABASE_URL` from SSM (Lambda) or the local shell env.

## Desired End State

`npm run migrate:up` creates 5 tables with full constraints and indexes against a real Neon database; `npm run migrate:down` reverses it cleanly. A schema constraint test suite proves the FK/unique/NOT NULL/cascade rules actually hold.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Migration tool | `node-pg-migrate` | No ORM, minimal deps, mature/popular — matches the stack's existing quality bar without adding a query-builder abstraction. |
| `users` primary key | Internal UUID PK + unique `cognito_sub` column | Decouples data from the IdP — if the Cognito user pool is ever deleted/recreated, recovery is one `UPDATE`, not a foreign-key rewrite across the schema. |
| Translations shape | One `entry_translations` row per `(entry, language)`, multi-sense meanings as a `/`-separated string | Supports multiple target languages per word (e.g. one Polish word → English + Russian translations) without a redesign. |
| Sentences shape | `entry_sentences` tagged with its own `language_code`, siblings of `entry_translations` (not tied to a specific translation) | Which language gets example sentences is a runtime/business-logic decision (made later by S-03), not something the schema should hard-code. |
| Collection deletion | `ON DELETE CASCADE` down through entries → translations/sentences | Matches "a collection owns its contents"; the no-data-loss guardrail is enforced by a confirmation step in the future S-02 UI, not by blocking deletion at the DB level. |
| Migration execution | Manual local `npm run migrate:up`/`down` only | Fastest to ship for a solo 3-week MVP; CI wiring is deferred, not needed for F-01's outcome. |
| Testing | Migration up/down + constraint tests against a real Neon database | Only a real Postgres proves constraint enforcement; matches the existing `node:test` + `build(t)` convention already used in `backend/test/`. |

## Scope

**In scope:**
- `users`, `collections`, `entries`, `entry_translations`, `entry_sentences` tables with constraints and indexes
- `node-pg-migrate` setup, npm scripts, README documentation
- Schema constraint tests (FK, unique, NOT NULL, cascade)

**Out of scope:**
- Any route, handler, or business logic querying these tables
- Auth/token verification (S-01)
- CI/CD migration automation
- Tying a specific example sentence to a specific translation/meaning (additive later if needed)
- Collection-deletion UX/confirmation flow (S-02)

## Architecture / Approach

Five tables: `users` and `collections` are straightforward ownership tables; `entries` is a bare container per saved word; `entry_translations` and `entry_sentences` are siblings under `entries`, each independently taggable by language. This lets one entry carry translations into several languages and example sentences in whichever language(s) matter for that entry — without the schema needing to know *which* language that will be ahead of time (that's decided later, at AI-call time, by S-03).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migration Tooling Setup | `node-pg-migrate` installed, scripted, documented | Neon pooled-vs-direct connection string mismatch; ESM project vs. CJS-default migration loader |
| 2. Schema Migration | All 5 tables, constraints, indexes | None significant — pure DDL, reversible |
| 3. Verification Tests | Automated proof constraints hold | Test cleanup/cascade correctness across repeated runs |

**Prerequisites:** A reachable Neon database and its direct (non-pooled) connection string available locally as `NEON_DATABASE_URL`.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Assumed `NEON_DATABASE_URL` can be pointed at (or swapped for) Neon's direct connection string — if only the pooled string is available, Phase 1 needs to resolve that before migrations will work reliably.
- Assumed `users`/`collections` cascade (deleting a user deletes their collections) is the right default; not explicitly discussed, but consistent with the collections→entries cascade decision and easy to change later since no data exists yet.

## Success Criteria (Summary)

- `npm run migrate:up` / `npm run migrate:down` both succeed against a real Neon database
- Schema constraint tests (`npm test`) pass and are repeatable without leftover-data failures
- S-01/S-02/S-03 have tables ready to build on with no schema changes needed for the multi-language, multi-sentence use cases already discussed
