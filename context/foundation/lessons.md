# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## React context + hook pairs split across two files

- **Context**: frontend/src/auth/AuthContext.tsx, frontend/src/auth/useAuth.ts
- **Problem**: A single file exporting both a component (e.g. a context Provider) and a non-component value (a consumer hook, the raw context object) trips oxlint's react/only-export-components warning, since it breaks React Fast Refresh's file-boundary assumption.
- **Rule**: When a React file needs to export both a component (e.g. a context Provider) and a hook/non-component value (the consumer hook, the raw context object), split them into two files — the Provider in `<Name>Context.tsx`, and the context object + hook in `use<Name>.ts`.
- **Applies to**: Any new React context/provider added under `frontend/src/` (or wherever context providers live in future frontend work).

## Check for pre-existing duplicates before adding a uniqueness migration

- **Context**: backend/migrations/1784819058952_add-collections-name-uniqueness.ts
- **Problem**: A `CREATE UNIQUE INDEX` migration fails to apply if any environment already has rows violating the new constraint (e.g. case-insensitive duplicate names for the same user), blocking deploy until manually cleaned up.
- **Rule**: Before writing a migration that adds a uniqueness constraint (unique index/column) on an existing table, check whether any target environment could already have rows that would violate it (e.g. a quick `SELECT ... GROUP BY ... HAVING COUNT(*) > 1` against the columns being constrained) — if data could already exist, note the cleanup/reconciliation step in the migration's plan or notes.
- **Applies to**: Any future migration under `backend/migrations/` that adds a `UNIQUE` constraint or unique index to a table that may already hold data in any deployed environment.

## ts-node/esm plugin files need a forcing import for fastify.d.ts augmentations

- **Context**: Any new file under `backend/src/plugins/` or `backend/src/routes/` that reads a `fastify.d.ts`-augmented property (`fastify.config`, `fastify.sql`, `fastify.jwtVerifier`, `fastify.anthropicClient`, `request.authUser`).
- **Problem**: ts-node/esm's per-file type-checking only follows actual import graphs, unlike a full `tsc` build which scans the whole tsconfig `include` glob upfront. Since nothing directly imports `fastify.d.ts` (it's a pure ambient augmentation), it may not be loaded yet when a given plugin file is checked — causing intermittent "Property 'X' does not exist on type FastifyInstance" test failures depending on which test file's import graph reaches that plugin first. Hit twice: originally in `auth.ts`, and again in `anthropic.ts` (capture-translate-save Phase 2), where it failed 4-5 of 39 tests non-deterministically.
- **Rule**: Add the same defensive type-only import `auth.ts` already uses: `import type { AuthUser as _AuthUser } from '../fastify.d.ts'` (path adjusted per file location) — it's erased at runtime but forces ts-node to load the ambient augmentation before checking that file.
- **Applies to**: implement, impl-review

## Every new backend API route needs a matching api-construct.ts entry

- **Context**: `infra/lib/constructs/api-construct.ts:143-185`, any new route file under `backend/src/routes/api/`
- **Problem**: `api-construct.ts` registers each route as an explicit full path template — there is no `{proxy+}` catch-all — and HTTP API route keys match the *entire* path, so `/api/collections/{id}` does not cover `/api/collections/{id}/translate`. A route added under `backend/src/routes/api/` is picked up automatically by `@fastify/autoload` and passes the whole backend suite, but 404s through the deployed API until a matching `addRoutes` call exists. No test can catch it: `test/helper.ts` builds the Fastify app directly, so nothing under test ever goes through API Gateway. Already hit once — `POST /:id/translate` (Phase 2) and `POST /:id/entries` (Phase 3) were both unreachable in the deployed environment until capture-translate-save Phase 4 registered them.
- **Rule**: When adding a route under `backend/src/routes/api/`, add the matching `this.httpApi.addRoutes({ path, methods, integration })` entry to `infra/lib/constructs/api-construct.ts` in the same change. Sub-resources need their own entry — a parent path template covers nothing below it. Green backend tests are not evidence the route is reachable; confirm with `cd infra && npx cdk synth InkLingo-ApiStack` or a curl against the deployed URL.
- **Applies to**: plan, implement, impl-review — any change that adds or renames a route under `backend/src/routes/`
