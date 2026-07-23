---
date: 2026-07-23T13:32:06+02:00
researcher: Claude Code
git_commit: cb99ada308fbc40aeb78f175c556cf975ab42e36
branch: main
repository: KStrzechowski/InkLingo
topic: "word-collections (S-02): create + list collections, view collection contents"
tags: [research, codebase, backend, frontend, fastify, neon, collections, auth]
status: complete
last_updated: 2026-07-23
last_updated_by: Claude Code
---

# Research: word-collections (S-02)

**Date**: 2026-07-23T13:32:06+02:00
**Researcher**: Claude Code
**Git Commit**: cb99ada308fbc40aeb78f175c556cf975ab42e36
**Branch**: main
**Repository**: KStrzechowski/InkLingo

## Research Question

What does the current codebase (backend conventions, DB schema as-migrated, frontend structure) look like, so a plan can be written for FR-004/FR-005 — a user manually creating a collection, and browsing the list of their collections plus each collection's contents?

## Summary

Both prerequisites for this slice (S-01 `account-auth`, F-01 `minimal-database`) are done and archived. The auth hook already decorates every request under `routes/api/` with `request.authUser.id` (internal UUID) via cascading autoload hooks, so a new `routes/api/collections/` folder inherits authentication for free — no new auth wiring needed. The schema (`collections`, `entries`, `entry_translations`, `entry_sentences`) already exists via the one shipped migration; nothing has been built against it yet (zero app-code references to "collection"/"entries" anywhere in `backend/src` or `frontend/src`). The frontend has no routing, no pages, no API client, and no data-fetching library — `App.tsx` is a single 73-line file with one inline `fetch()` call and no shared auth-token-attachment helper. This is a from-scratch UI build, not an extension of an existing pattern.

Two structural gaps to resolve in planning, not by further research:
1. **No prior multi-method route-folder convention** exists in this repo (every current route is single-`GET`). `collections/` will be the first folder needing GET (list) + POST (create) — the plan should pick one of the two viable shapes (multiple registrations in one `index.ts`, or per-method files) rather than search for a precedent that doesn't exist.
2. **Entries have no direct `user_id`** — ownership only flows through `entries.collection_id → collections.user_id`. Any "list this collection's entries" query must first verify `collections.user_id = request.authUser.id` (404/403 on mismatch) before querying `entries` by `collection_id`, not filter `entries` directly.

## Detailed Findings

### Backend: auth hook & current-user access

- `backend/src/routes/api/autohooks.ts` is a `@fastify/autoload` special file — autoload registers its `onRequest` hook against everything in and under `routes/api/`, and `cascadeHooks: true` (`backend/src/app.ts:43-44`) means a new `routes/api/collections/` folder inherits it automatically.
- On success it decorates `request.authUser = { id, cognitoSub, email }` (`backend/src/routes/api/autohooks.ts:38`). **`request.authUser.id` is the accessor a new collections route uses** for ownership checks — it is the internal `users.id` UUID (already upserted via JIT provisioning in the same hook), not the Cognito `sub`.
- Type declared centrally in `backend/src/fastify.d.ts:11-15,30-32` (`AuthUser { id: string; cognitoSub: string; email: string | undefined }`), plus `FastifyInstance.sql: NeonQueryFunction<false, false>` (`backend/src/fastify.d.ts:26`).

### Backend: reference route (`/api/me`)

- `backend/src/routes/api/me/index.ts` (10 lines) — bare `fastify.get('/', async (request) => ({ id: request.authUser.id, email: request.authUser.email }))`. No `schema` option, no direct `fastify.sql` call (the DB round-trip already happened in the hook), no explicit unauthorized handling (delegated to the cascading hook). This is a thin reference for "authenticated route reading `request.authUser`" but **not** an example of a route that queries the DB itself or validates a request body — a collections route breaks new ground on both fronts.

### Backend: `fastify.sql` query pattern

- `backend/src/plugins/neon.ts` decorates `fastify.sql = neon(fastify.config.neonDatabaseUrl)` — HTTP-based Neon serverless driver, chosen over `pg.Pool` because Lambda's execution model doesn't tolerate a persistent TCP pool.
- Two calling conventions coexist: **tagged-template** (only production usage: `autohooks.ts:31-36`'s upsert) and **`.query(text, params)`** with positional `$1, $2, ...` (used throughout `backend/test/schema/core-schema.test.ts` and `backend/test/routes/api/me.test.ts:8`). No production route yet demonstrates querying `fastify.sql` from inside a route handler — a collections route is the first.

### Backend: schema as actually migrated

Single migration `backend/migrations/1784584360698_create-core-schema.ts` (78 lines) — confirmed to match the archived F-01 plan with no drift:

- `users(id uuid pk, cognito_sub text not null unique, created_at timestamptz not null default now())`
- `collections(id uuid pk, user_id uuid not null → users.id ON DELETE CASCADE [indexed], name text not null, created_at timestamptz not null default now())`
- `entries(id uuid pk, collection_id uuid not null → collections.id ON DELETE CASCADE [indexed], word_or_phrase text not null, source_language_code text not null, created_at timestamptz not null default now())`
- `entry_translations(id uuid pk, entry_id uuid not null → entries.id ON DELETE CASCADE, language_code text not null, meaning_text text not null, UNIQUE(entry_id, language_code))`
- `entry_sentences(id uuid pk, entry_id uuid not null → entries.id ON DELETE CASCADE [indexed], language_code text not null, sentence_text text not null, created_at timestamptz not null default now())`

**Ownership chain**: `entries` has no `user_id` column — only `entries.collection_id → collections.user_id`. A "collection contents" query must join or pre-check ownership through `collections`, not filter `entries` directly by user.

### Backend: test conventions

- `backend/test/helper.ts`'s `build(t)` exposes all decorators (`skipOverride: true`) for direct use in tests.
- `backend/test/helpers/jwks.ts` exports `jwks` (public JWKS), `signToken(overrides?)` (mints a valid test JWT), and `tamperSignature(token)`. Usage pattern (`backend/test/routes/api/me.test.ts:1-24`): `app.jwtVerifier.cacheJwks(jwks)` then `signToken(...)` then `app.inject({ url, headers: { authorization: 'Bearer ' + token } })`. This is the established pattern a collections test suite reuses as-is — no new auth-test scaffolding needed.

### Backend: no existing collections code

- Zero matches for "collection"/"entries"/"entry" (case-insensitive) anywhere in `backend/src/` or `backend/test/routes|plugins`. The only existing reference is `backend/test/schema/core-schema.test.ts`, which is pure schema/constraint testing (no app code).

### Frontend: current state (`App.tsx` + `cognito.ts`)

- `frontend/src/App.tsx` (73 lines) is the entire UI today: loading state → login button (signed out) or a signed-in panel with email, logout button, one "Call API" button hitting `/api/me` via a raw inline `fetch()` (lines 38-40), manually attaching `Authorization: Bearer <id_token>` (note: **`id_token`**, not `access_token`) from `userManager.getUser()`.
- `frontend/src/auth/cognito.ts` (44 lines) wraps `oidc-client-ts`'s `UserManager`. Exports: `userManager`, `login()`, `handleLoginCallback()`, `getUser()`, `logout()`. **No React context/provider, no `useAuth()` hook** — every consumer calls `getUser()`/`userManager` directly and manages its own state, exactly as `App.tsx` does.
- Cognito `/callback` redirect handling is a manual `window.location.pathname === '/callback'` string check in `App.tsx:16` — not a router.

### Frontend: no routing, no API client, no data-fetching library

- `frontend/package.json` deps: only `oidc-client-ts`, `react`, `react-dom`. **No router** (no react-router/TanStack Router/wouter), **no data-fetching library** (no TanStack Query/SWR), **no form library**. Any collections list/create UI needs plain `useState`/`useEffect` matching existing style, or a new dependency deliberately added in the plan.
- `frontend/src/` tree is flat: `App.tsx`, `App.css`, `main.tsx`, `index.css`, `auth/cognito.ts`, `assets/`. No `components/`, `pages/`, `hooks/`, `api/`, or `types/` folders exist — any of those would be newly introduced conventions, not extensions of existing ones.
- No shared fetch wrapper exists; the one API call in `App.tsx` is a one-off inline `fetch()` that duplicates token retrieval + header construction. A collections feature needs this factored out (at minimum a small `apiFetch` helper) rather than copy-pasting the pattern per call.
- Zero matches for "collection" anywhere in `frontend/src`.

### Frontend: lint/type constraints relevant to new files

- `frontend/.oxlintrc.json`: `react/rules-of-hooks: error`, `react/only-export-components: warn` (co-exporting non-component values from a component file is discouraged; constants are allowed).
- `frontend/tsconfig.app.json`: `verbatimModuleSyntax: true` (type-only imports must use `import type`), `noUnusedLocals`/`noUnusedParameters: true`, `moduleResolution: "bundler"`. No path aliases configured (`vite.config.ts` has none) — new modules use relative imports.

## Code References

- `backend/src/routes/api/autohooks.ts:11-39` — cascading auth hook, JIT upsert, `request.authUser` decoration
- `backend/src/fastify.d.ts:11-15,24-32` — `AuthUser` type, `FastifyInstance.sql`/`config`/`jwtVerifier` augmentations (centralized here to dodge autoload's alphabetical-order `declare module` issue)
- `backend/src/routes/api/me/index.ts:1-10` — thin reference route (auth-only, no DB query, no schema)
- `backend/src/plugins/neon.ts:1-16` — `fastify.sql` decoration, tagged-template vs `.query()` conventions
- `backend/migrations/1784584360698_create-core-schema.ts:14-39` — `collections` and `entries` table definitions (as-migrated, confirmed matches plan)
- `backend/test/helper.ts:24-38` — `build(t)` test app factory
- `backend/test/helpers/jwks.ts:30-56` — `signToken()`/`tamperSignature()` test-token helpers
- `backend/test/routes/api/me.test.ts:1-24` — reference test pattern (cacheJwks + signToken + inject)
- `backend/test/schema/core-schema.test.ts:57-146` — existing constraint tests already locking in FK/cascade/unique behavior for `collections`/`entries`/etc.
- `frontend/src/App.tsx:6,16,28-48` — API base URL, manual `/callback` detection, inline `fetch()` + token attachment
- `frontend/src/auth/cognito.ts:1-44` — `userManager`, `login`/`logout`/`getUser`/`handleLoginCallback`, no context/provider
- `frontend/package.json` — confirmed absence of router/data-fetching/form libraries
- `frontend/.oxlintrc.json`, `frontend/tsconfig.app.json:12-22` — lint/type constraints for new files

## Architecture Insights

- **Auth is fully transparent to new routes.** Because the hook cascades via autoload + `cascadeHooks: true`, a `routes/api/collections/` folder gets `request.authUser` for free with zero new wiring — the plan's backend phase is pure business logic (schema queries + validation), not auth integration.
- **This is the first multi-method route folder** in the repo. The plan needs to explicitly choose a shape (one `index.ts` with `fastify.get`+`fastify.post`, vs. per-method files) since no precedent exists to follow — pick one and document it, since `/10x-test-plan`'s eventual cookbook (§6) will want a settled answer here too.
- **This is the first route to query `fastify.sql` directly from a handler** (not just from the auth hook). Both the tagged-template and `.query(text, params)` forms are already established elsewhere in the codebase (production vs. test respectively) — the plan should pick one calling convention for route code and state why (tagged-template matches the one production precedent in `autohooks.ts`; `.query()` matches all existing test usage and reads more naturally for dynamic parameter lists).
- **Ownership must be checked at the `collections` level, not `entries`.** Since `entries` has no `user_id`, "get collection contents" is necessarily a two-step (or joined) operation: confirm `collections.id = :id AND collections.user_id = :authUserId` exists, then read `entries` by `collection_id`. Getting this wrong (e.g. trusting a client-supplied `collection_id` without the ownership check) would let one user read another's entries — worth flagging explicitly in the plan's success criteria / test cases.
- **Frontend is a genuinely greenfield UI surface.** There's no routing, no context, no data-fetching library, no component folder structure to extend — the plan must decide these (e.g., is a router needed for "list view" vs. "collection detail view", or can it be done with local component state given only two views?) rather than assuming an existing convention.

## Historical Context (from prior changes)

- `context/archive/2026-07-20-minimal-database/plan.md` — the schema design rationale: `users.id` decoupled from `cognito_sub` (survives a Cognito pool recreation without rewriting FKs), `entry_translations`/`entry_sentences` are siblings under `entries` (not linked to each other) so a single entry can carry multiple languages, cascade deletes chosen so deleting a collection or user cleans up everything under it (`context/archive/2026-07-20-minimal-database/plan.md:32-33,36-37,116`).
- `context/archive/2026-07-21-account-auth/change.md` (Notes) — records 8 resolved design questions from account-auth, including JIT provisioning being an accepted-for-now perf tradeoff (see memory note `account-auth-jit-provisioning-perf-note`) and the decision to protect the entire `routes/api/` context with one hook rather than building a per-route opt-out mechanism (see memory note `account-auth-public-route-opt-out-deferred`) — both relevant priors if the collections plan considers any route that should NOT require auth (it shouldn't; every collections endpoint is inherently per-user).
- `context/archive/2026-07-21-account-auth/reviews/impl-review.md` — F1 (log JWT verification failures, not just 401 silently) and F2 (centralize `declare module 'fastify'` augmentations into `fastify.d.ts` to dodge autoload's alphabetical dynamic-import ordering) are already fixed and set the pattern any new plugin/route augmenting `FastifyRequest`/`FastifyInstance` should follow (put the augmentation in `fastify.d.ts`, not locally).

## Related Research

- None yet under `context/changes/**/research.md` or `context/archive/**/research.md` for this specific slice — this is the first research document for `word-collections`.

## Open Questions

1. **Multi-method route-folder shape**: one `index.ts` with `fastify.get` + `fastify.post`, or separate per-method files inside `routes/api/collections/`? No existing precedent; the plan should decide and record the choice (candidate input for `/10x-test-plan`'s §6 cookbook later).
2. **`fastify.sql` calling convention for route code**: tagged-template (matches the one production precedent) vs. `.query(text, params)` (matches all existing test usage, arguably clearer for parameterized list/detail queries). Plan should pick one and apply it consistently across the new routes.
3. **Frontend view structure**: does listing collections + viewing one collection's contents need two distinct "pages" (implying at least a minimal router or hand-rolled view-switch state), or can it work as one view with client-side show/hide state given the small surface? No router is installed today — introducing one is a real decision, not a formality.
4. **Frontend data-fetching approach**: continue the existing raw-`fetch()`-in-component style (consistent with `App.tsx` today, zero new deps), or introduce a small typed API client module now that there will be multiple endpoints (list, create, get-contents)? Worth deciding before the UI has 3x the inline-fetch duplication `App.tsx` already shows signs of.
