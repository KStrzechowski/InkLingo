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

## A stubbed AI client cannot tell you the model's output is usable

- **Context**: `backend/test/routes/api/translate.test.ts`, `backend/test/routes/api/entry-translations.test.ts` — every test stubs `app.anthropicClient`.
- **Problem**: Stubbing the Anthropic client tests *our* handling of a response we wrote ourselves. It says nothing about what the model actually returns. In capture-translate-save Phase 5, 65 green tests coexisted with a live failure on roughly 1 in 11 captures: the model returned a structurally valid result whose `variants` arrays were all empty, and the user saw five "Nothing came back for this language" sections. The tool schema permitted it (no `minItems`), so every stub in the suite was a *valid* response that simply never exercised the degenerate one. The same bug had been sitting in shipped Phase 2 code for two phases, past a manual verification step that happened to get a good roll. Single manual checks are not enough either — a ~9% intermittent failure passes a one-shot test 91% of the time.
- **Rule**: For any feature calling an LLM, run it against the real API before calling the feature done — a dozen calls, varied inputs, counting how many produce a *usable* result, not just a parseable one. Keep the stubbed tests for logic and error paths; add the empirical check as a one-off script (the scratchpad is fine, it needn't be committed). Where the model can legally return something useless, handle it in code — a retry, a fallback, an explicit error — rather than trusting the prompt. Record the measured numbers (failure rate, cost, latency, token headroom) in the change's notes, because estimates for all four were off by 3–6× here.
- **Applies to**: plan, implement, impl-review, test-plan — any change touching `backend/src/ai/` or adding an LLM-calling route

## An expired token reads as a CORS failure, not a 401

- **Context**: `infra/lib/constructs/api-construct.ts:109-127` (`defaultAuthorizer` + `corsPreflight`), `frontend/src/auth/cognito.ts`, `frontend/src/api/client.ts`
- **Problem**: `HttpApi`'s `corsPreflight` governs the automatic OPTIONS preflight and responses returning through the Lambda integration — it does **not** apply to responses the JWT authorizer generates itself. When `defaultAuthorizer` (added in `25299fe`) rejects an expired token, that 401 goes back with no `Access-Control-Allow-Origin`, so the browser blocks it and reports a CORS failure with the status never surfacing. Hit for real on 2026-08-04: reopening the web app the day after logging in rendered the signed-in shell with the correct email while every collections fetch failed as "CORS failed". Two defaults combined to produce it — Cognito ID tokens last 1 hour (`idTokenValidity` is never set in CDK), and oidc-client-ts's `getUser()` returns the stored user without consulting `expires_at`, so the dead token was simultaneously rendered as a valid session and attached to every request. `backend/src/plugins/cors.ts` is irrelevant here; the request never reaches Lambda. HTTP APIs have no REST-API-style `GatewayResponses`, so the masking cannot be fixed at the edge — only avoided by not sending dead tokens.
- **Rule**: Treat an unexplained CORS failure against the *deployed* API as an auth failure until proven otherwise — check the stored token's `expires_at` before touching any CORS config. The same call against `npm run dev` returns a clean 401 with CORS headers, which is the fastest way to tell the two apart. On the client, never attach a stored token without checking `.expired` first: renew via `signinSilent()` (Cognito's code grant returns a refresh token without `offline_access` in the scope, so no hidden iframe or `silent_redirect_uri` is needed), dedupe concurrent renewals so one page load doesn't fire several grants, and drop the session on a 401 that survives a renewal.
- **Applies to**: implement, impl-review — any frontend change calling the deployed API, and any infra change touching `defaultAuthorizer` or `corsPreflight`

## Clearing a failure signal doesn't restore the view it was raised over

- **Context**: Any change adding a global recovery/health signal or an auto-dismissing banner/toast (e.g. `frontend/src/auth/connectionIssue.ts`), together with the fetch-on-mount views under `frontend/src/pages/` that a failure passes through.
- **Problem**: The signal and the data are healed by different mechanisms, and only the signal gets one. In `testing-auth-resilience` Phase 3, `clearConnectionIssue()` removes the banner on the next successful request, but `CollectionsListPage` fetches once in a mount-time `useEffect` and never retries — so after a failed load `collections` stays `[]`, and the first successful POST appends to that empty array. The user sees one collection rendered as a complete list while the server holds several. Recovery made the UI look healthy while showing wrong data, which is strictly worse than leaving the error visible.
- **Rule**: When adding a signal that auto-clears on recovery, decide in the same change what happens to the data the failure interrupted — dismissal is not recovery. Prefer a user-triggered retry on each view's own error state over subscribing pages to the global signal's false-edge: a signal raised by an unrelated request would refetch everything, and it couples every page to that context.
- **Applies to**: plan, plan-review, implement, impl-review
