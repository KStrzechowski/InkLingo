<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Capture, Translate, Save (S-03)

- **Plan**: `context/changes/capture-translate-save/plan.md`
- **Scope**: Phase 4 of 5 — Extension — scaffold, auth, capture UI
- **Commit under review**: `8da3a52`
- **Date**: 2026-07-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Automated verification (re-run 2026-07-31)

| Criterion | Command | Result |
|---|---|---|
| 4.1 backend | `cd backend && npm test` | PASS — 48 pass / 0 fail, 96.63% line coverage |
| 4.1 frontend | `cd frontend && npm run build && npm run lint` | PASS — build clean, oxlint clean |
| 4.2 infra | `cd infra && npx cdk synth InkLingo-AuthStack -c stack=AuthStack` | PASS — `CallbackURLs` includes `https://93a911258e4a993c21556e53c55150e3aed6b44e.extensions.allizom.org/`, matching `extension/README.md` |
| (extra) extension | `cd extension && npm run build && npm run lint` | PASS — `dist/background.js` + `dist/popup.js` emitted, oxlint clean |

## Plan adherence detail

| Planned change | File | Verdict |
|---|---|---|
| 1. Extension scaffold | `extension/manifest.json` | MATCH — MV3, pinned `gecko.id`, `host_permissions`, background event page, popup action |
| 2. Extension auth | `extension/src/auth.ts` | MATCH (documented drift) — `launchWebAuthFlow` + authorization-code/PKCE against the existing App Client, tokens in `browser.storage.local`, `exp`-based refresh. Redirect URI adapted from the plan's `moz-extension://<id>/callback` to `https://<sha1(id)>.extensions.allizom.org/`; recorded in `change.md` before landing |
| 3. CDK callback URL | `infra/lib/stacks/auth-stack.ts` | MATCH — recomputes the SHA-1 from the pinned add-on ID rather than hardcoding; verified present in synth |
| 4. Background script API calls | `extension/src/background.ts` | MATCH — `translate` / `save-entry` / `list-collections` (+ auth messages), `Authorization: Bearer <id token>` per `routes/api/autohooks.ts` |
| 5. Popup capture UI | `extension/src/popup/` | MATCH — last-used collection in `storage.local`, capture input, variants + phonetics + nested sentences, meaning-paired regeneration, save |
| (unplanned) API GW routes | `infra/lib/constructs/api-construct.ts` | EXTRA — see F2 |
| (unplanned) docs | `CLAUDE.md`, `AGENTS.md` | EXTRA — benign; correctly reflects the repo becoming four projects |

## Findings

### F1 — Criterion 4.8 unverified, and the rate limiter it exercises is per-Lambda-instance

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria / Safety & Quality
- **Location**: `context/changes/capture-translate-save/plan.md:447`; root cause `backend/src/plugins/rate-limit.ts:13`, `backend/src/routes/api/collections/index.ts:167-173`
- **Detail**: Phase 4 was committed and closed out with `4.8 A deliberately-triggered rate-limit shows a clean, non-crashing error state in the popup` still `- [ ]`. The popup path itself looks correct — `background.ts:15-17` maps HTTP 429 to "Too many requests — wait a minute and try again." and the popup surfaces it through the normal `error` state — so this is very likely a formality. What makes it worth more than a checkbox chase: `@fastify/rate-limit@11` is registered with no `store`, so it falls back to the in-process `LocalStore` (`node_modules/@fastify/rate-limit/index.js:122`). Under Lambda each warm container keeps its own counter, so the deployed ceiling is roughly `containers x 20/min`, not 20/min, and counters reset on every cold start. That is materially weaker than the denial-of-wallet cap `context/foundation/infrastructure.md`'s risk register asked for on the Anthropic-calling route. Residual protection today is API Gateway's stage throttle (`api-construct.ts:132-135`, 5 rps / burst 10) and the account's 10-concurrency limit, both global rather than per-user.
- **Fix A ⭐ Recommended**: Verify 4.8 locally against `npm run dev` (single process, so the 20/min budget is exact), tick it, and record the Lambda-multiplication gap as a known limitation in `change.md` for a later slice.
  - Strength: Unblocks the phase now; the extension-side error path — the thing 4.8 actually asserts — is fully exercised, and the per-container gap is a deployment property that no popup test would have caught anyway.
  - Tradeoff: The deployed denial-of-wallet cap stays looser than the risk register intends until a shared store lands.
  - Confidence: HIGH — the 429 mapping in `background.ts` is unconditional and the local limiter is known-good (criterion 2.5 passed).
  - Blind spot: Not verified whether API Gateway's 429 body reaches the extension in the same JSON shape Fastify emits; a stage-throttle 429 short-circuits before Fastify. `errorMessage()` special-cases status 429 before parsing the body, so both paths render the same string — but that specific path is untested.
- **Fix B**: Give `@fastify/rate-limit` a shared store (Redis/Valkey or a Postgres-backed store) so the per-user budget holds across containers, then verify 4.8 against the deployed API.
  - Strength: Actually closes the risk-register item rather than deferring it.
  - Tradeoff: New infrastructure dependency and cost for a single-user PoC, and it expands Phase 4 well past its stated scope.
  - Confidence: MEDIUM — the plugin supports custom stores cleanly, but nothing in `infra/` provisions a cache today.
  - Blind spot: Whether the ~11-day deadline referenced in the plan's phasing decision leaves room for this at all.
- **Decision**: Fix A — verify 4.8 locally and record the gap. Costed during triage: the Lambda has no VPC (confirmed — no `vpc` prop anywhere in `infra/`), so ElastiCache would pull in a NAT Gateway for the Anthropic/Neon/Cognito egress the function still needs, at roughly $50–130/month. Rejected as disproportionate for a single-user PoC whose exposure requires an authenticated caller. Limitation written up in `change.md` → "Known limitation — the per-user rate limit is per-Lambda-instance", with the Anthropic Console spend limit named as the real backstop and a Neon-backed custom store as the cheap future fix. Progress row 4.8 stays `- [ ]` until the human confirms the local run.

### F2 — Unplanned API Gateway route registration retroactively fixing Phases 2-3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `infra/lib/constructs/api-construct.ts:172-185`
- **Detail**: Phase 4 added `POST /api/collections/{id}/translate` and `POST /api/collections/{id}/entries` to the HTTP API. The plan explicitly said Phase 4's only infra touch was the Cognito callback URL. The addition is correct and necessary — `api-construct.ts` registers full path templates with no `{proxy+}`, so both routes shipped in Phases 2-3 were unreachable through the deployed API — and it is recorded in `change.md`'s Phase 4 adaptations, which is the right handling. The residual risk is forward-looking: this failure mode is silent (the Fastify route exists and its tests pass; only the deployed API 404s), it has already bitten once across two phases, and Phase 5 adds another sub-resource route (`POST /:id/entries/:entryId/translations`) that will hit it again.
- **Fix**: Record the pairing as a rule in `context/foundation/lessons.md` — every new route under `backend/src/routes/api/` needs a matching `httpApi.addRoutes` entry in `infra/lib/constructs/api-construct.ts`, because route keys match a full path template and backend tests cannot catch the omission.
- **Decision**: ACCEPTED-AS-RULE — appended to `context/foundation/lessons.md` as "Every new backend API route needs a matching api-construct.ts entry". The Phase 4 code change itself is correct and stays as-is; the rule exists so Phase 5's `POST /:id/entries/:entryId/translations` doesn't repeat the omission.

### F3 — OAuth authorization request omits the `state` parameter

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `extension/src/auth.ts:102-114`
- **Detail**: The authorize URL sends `client_id`, `response_type`, `scope`, `redirect_uri`, `code_challenge`, `code_challenge_method` — no `state`. OAuth 2.0 recommends `state` for CSRF protection on the authorization response. The realistic attack is largely closed here: `launchWebAuthFlow` returns the redirect URL directly to the initiating call rather than to an ambient redirect endpoint, and the code is exchanged in the same function scope with the verifier created alongside it, so an injected code from another session cannot be smuggled in. Noting it because it is a deviation from the spec's baseline, not because a concrete exploit is in reach.
- **Fix**: Generate a random `state` alongside the PKCE pair, send it, and assert the returned URL's `state` matches before exchanging the code.
- **Decision**: FIXED — `extension/src/auth.ts` now generates a 16-byte `state`, sends it on the authorize request, and rejects the response before the code exchange if it doesn't match. Extension build + lint pass; the login round trip still needs a manual re-check in Firefox (see the outstanding item below).

### F4 — `host_permissions` wildcards cover every AWS API Gateway and Cognito host in the region

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `extension/manifest.json:13-17`
- **Detail**: `https://*.execute-api.eu-central-1.amazonaws.com/*` and `https://*.auth.eu-central-1.amazoncognito.com/*` grant the extension credentialed access to every AWS account's API Gateway and every Cognito hosted UI in `eu-central-1`, not just this project's. The extension only ever fetches `API_BASE_URL` and `COGNITO_DOMAIN`, so nothing today abuses the grant, and the wildcard exists for a real reason — the API ID and hosted-UI prefix are deploy-time values and `manifest.json` is copied verbatim by `vite.config.ts:9-19` rather than templated. Worth tightening before any AMO submission, where reviewers weigh permission breadth.
- **Fix**: Template `manifest.json` through the existing Vite build (the `copyManifest` plugin already writes it) so the concrete API and Cognito origins are substituted from the same `VITE_*` values `src/config.ts` reads.
- **Decision**: FIXED — `copyManifest` replaced by `writeManifest` in `extension/vite.config.ts`, which derives `host_permissions` from `VITE_API_BASE_URL` / `VITE_COGNITO_DOMAIN` via `loadEnv`. Verified across all three paths: production → `https://kai2m0lak1.execute-api.eu-central-1.amazonaws.com/*` + the Cognito origin; development → `http://localhost:3000/*` + the Cognito origin; missing `.env` → warns and keeps the checked-in wildcards so the build still produces a loadable extension. `extension/README.md` updated — it previously described the wildcards as what ships.
