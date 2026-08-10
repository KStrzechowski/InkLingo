# Auth Resilience — Plan Brief

> Full plan: `context/changes/testing-auth-resilience/plan.md`
> Research: `context/changes/testing-auth-resilience/research.md`

## What & Why

Phase 3 of the frozen test-plan rollout, closing Risk #4: "an expired or invalid auth token is sent with a request and the failure surfaces as an opaque CORS error instead of a clean re-authentication prompt." The *expired* half already shipped in commit `3294830` with zero test coverage; the *invalid* half (a token the Gateway authorizer rejects for a non-expiry reason) was never fixed at all. This phase adds the missing coverage and closes the remaining gap.

## Starting Point

`frontend/` has zero test infrastructure — no Vitest, no test script, no `*.test.ts(x)` files anywhere. The shipped expiry fix (`cognito.ts`'s `getFreshUser()`, `AuthContext`'s use of it, `client.ts`'s token attach + 401-drop) works today but is unverified by any automated check. A separate, genuine gap remains: a Gateway-rejected-but-not-locally-expired token still produces an opaque, unreadable CORS-style failure, because browsers deliberately make a CORS block indistinguishable from a real network outage.

## Desired End State

`npm test` in `frontend/` runs and gates CI (same as backend today). The shipped renewal/dedupe/401-drop behavior has regression tests. A token rejected for a non-expiry reason now retries once, then shows the user a dismissible "connection or session problem — sign in again" banner instead of a silent, opaque failure — and the banner self-clears the moment a request succeeds again.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Residual invalid-token gap | Fix now, not backlog | User chose to close Risk #4 fully rather than leave the "or invalid" half unmitigated | Plan |
| Fix mechanism | Retry once, then show a manual banner (no forced logout) | A CORS block and a real network outage look identical to the client — auto-logout on ambiguous evidence risks kicking users out during their own wifi blips | Plan |
| Test file layout | `frontend/test/` mirroring `backend/test/` | Consistent cross-app convention over the more common Vitest colocated-file style | Plan |
| Mocking strategy | Mock the `oidc-client-ts` module | Fully deterministic tests, no real timers/storage/network involved | Plan |
| Component testing | Add React Testing Library + jsdom | Proves the banner actually renders/behaves, not just internal state | Plan |
| Timer-driven renewal path | Assert config only (`automaticSilentRenew: true`), don't test behavior | `oidc-client-ts` owns and tests its own timer mechanics; testing a mocked module's scripted behavior isn't real coverage | Plan |
| CI wiring | In this phase, not a follow-up | Matches `test-plan.md` §5's own stated requirement and the Phase 1 precedent | Plan |
| Extension scope | Out of scope | `test-plan.md` already scopes extension test bootstrapping to Phase 5; its auth mechanism is unrelated | Research |

## Scope

**In scope:**
- Vitest + React Testing Library bootstrap for `frontend/`
- Regression tests for the shipped expiry/renewal/401-drop fix
- Retry-then-banner fix for the invalid-token gap, plus its tests
- CI wiring in `pr-diff.yml` and `deploy.yml`
- `test-plan.md` bookkeeping close-out

**Out of scope:**
- `extension/` test bootstrapping (test-plan.md Phase 5)
- Banner visual polish
- Testing `automaticSilentRenew`'s actual timer mechanics
- A retry delay/backoff (the failure this catches is deterministic, not transient)
- Coverage-threshold enforcement

## Architecture / Approach

A small pub/sub module (`connectionIssue.ts`) bridges the non-React `client.ts` axios interceptor and the React `AuthContext` — the interceptor signals on a retry-confirmed response-less failure, `AuthContext` turns that into a `connectionIssue` boolean, and `App.tsx` renders a banner when it's true. This mirrors the existing `userManager.events` pub/sub pattern `AuthContext` already consumes for `userLoaded`/`userUnloaded`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Bootstrap Vitest + RTL | Test runner, jsdom, `.env.test`, shared fixtures | tsconfig project-reference wiring is fiddly to get right first try |
| 2. Regression tests for shipped fix | Coverage for renewal/dedupe/401-drop, zero production changes | mocking `oidc-client-ts`'s event API faithfully enough to catch real bugs |
| 3. Close invalid-token gap | Retry-once + banner mechanism, new production code | axios retry needs a one-shot marker or it loops forever |
| 4. CI wiring | `npm test` gates both workflows | CI's real `.env` write must not leak into the test run — mitigated by `.env.test`'s precedence |
| 5. test-plan.md close-out | Accurate rollout/gates/cookbook/negative-space docs | — |

**Prerequisites:** None — `frontend/` builds today with no test infra to reconcile.
**Estimated effort:** ~2-3 sessions across 5 phases; Phase 3 (new production code + design) is the largest single unit of work.

## Open Risks & Assumptions

- The retry-then-banner heuristic will misfire (retry succeeds, no banner) if the authorizer rejection is itself intermittent for unrelated reasons — accepted as a strict improvement over today's zero detection.
- `@testing-library/react`'s exact version compatibility with React 19 / Vite 8 isn't pinned in this plan; the implementer installs the latest compatible release at Phase 1 time.

## Success Criteria (Summary)

- A user whose token is silently renewable never sees any change in behavior (still works exactly as today).
- A user whose token is rejected for a non-expiry reason sees one retry, then a clear, actionable banner — never a silent or opaque failure.
- `npm test` in `frontend/` is a real, enforced CI gate, matching backend's existing bar.
