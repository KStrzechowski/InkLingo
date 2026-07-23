# Word Collections (S-02) — Plan Brief

> Full plan: `context/changes/word-collections/plan.md`
> Research: `context/changes/word-collections/research.md`

## What & Why

Implement FR-004 and FR-005: a logged-in user can create a named collection ("folder") and browse the list of their collections plus each one's contents. This is the roadmap's S-02 slice — the last piece needed before S-03 (capture + translate + save, the product's north star) has somewhere to save entries into.

## Starting Point

Auth (S-01) and schema (F-01) are both done and archived. The auth hook already protects any new backend route automatically; the `collections`/`entries` tables already exist with nothing querying them yet. The frontend is a single 73-line `App.tsx` with no router, no API client, and no auth context — this is a from-scratch UI build, not an extension of existing pages.

## Desired End State

A user creates a collection by name (blocked from blank/too-long/duplicate names with a clear error), sees all their collections in a list, and opens one to see its entries — including translations and example sentences once S-03 starts populating them (empty today, and the UI treats that as a normal state).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Collection-contents response shape | Entries + nested translations + sentences | Matches FR-005's "contents" framing and the eventual print-export need (FR-014) — get the contract right once. | Plan (user-confirmed) |
| Frontend navigation | Add `react-router` | Scales to the roadmap's future views (capture window, export, pronunciation) rather than hand-rolling view-state. | Plan (user-confirmed) |
| Frontend HTTP client | `axios` | User's own familiarity outweighs the (here, immaterial) size/fetch-native tradeoffs of lighter alternatives. | Plan (user-confirmed) |
| Duplicate collection names | Disallowed per user, case-insensitive, enforced by a DB unique index | A pure app-level "check then insert" is race-prone; only a real constraint guarantees it. | Plan (user-confirmed) |
| Collection name validation | Trimmed, non-empty, max 100 chars | Covers realistic failure modes (blank submit, pasted essay) with minimal rules. | Plan (user-confirmed) |
| Frontend test strategy | Deferred to `/10x-test-plan`; manual verification for this slice | This repo's own Module 3 workflow has a dedicated, more rigorous process for deciding test strategy — this plan shouldn't preempt it ad hoc. | Plan (user-confirmed) |
| Multi-method route shape | One `routes/api/collections/index.ts` registering `GET /`, `POST /`, `GET /:id` via Fastify's native param syntax | No autoload folder-param convention is enabled in this repo (`routeParams` isn't set in `app.ts`) — avoids touching shared bootstrap config. | Plan (research-grounded) |
| `fastify.sql` calling convention | Tagged-template literal | Matches the one existing production precedent (`autohooks.ts`); `.query()` stays a test-only convention. | Plan (research-grounded) |

## Scope

**In scope:** create collection, list collections, view one collection's contents (entries + translations + sentences), the CDK wiring to expose the 3 new endpoints, a router + axios-based frontend rebuild to support multiple pages.

**Out of scope:** entry creation (S-03), collection rename/delete, collection sharing, pagination, automated frontend tests.

## Architecture / Approach

Backend: one new route file (`routes/api/collections/index.ts`) inheriting auth for free from the existing cascading hook, backed by a small schema migration (case-insensitive uniqueness) and 4 targeted queries per "get contents" call (collection ownership check, entries, batched translations, batched sentences). Infra: two new explicit CDK routes plus a CORS fix, mirroring the `/api/me` precedent exactly. Frontend: `App.tsx` becomes a router shell (react-router) wrapping a new auth context and axios client, with the actual collections UI added only after that plumbing is proven not to have broken the existing login/logout/call-API flow.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend | 3 collections endpoints + migration + tests | IDOR on `GET /:id` if ownership check is skipped |
| 2. Infra | CDK routes + CORS fix | CORS gap is invisible in local dev, only bites once deployed |
| 3. Frontend routing/API infra | Router + auth context + axios client, zero new user-facing behavior | Regressing the existing login/logout/call-API flow during the refactor |
| 4. Frontend collections UI | List + create + detail pages | None major — built on Phase 3's proven plumbing |

**Prerequisites:** S-01 (account-auth) and F-01 (minimal-database), both done.
**Estimated effort:** ~2-3 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes `react-router`'s current stable major integrates cleanly with this Vite+TS setup — no version-specific gotchas surfaced in research since no router exists in the repo today; verify at implementation time.
- Assumes entries/translations/sentences will remain small enough per collection that batched (non-paginated) queries stay fast — revisit if S-03 usage patterns prove otherwise.

## Success Criteria (Summary)

- A user can create a collection, see it in their list, and cannot create a second one with the same name.
- A user can open a collection and see its entries (or a clear empty state); a user cannot see another user's collection contents.
- The existing login/logout/call-API flow works identically after the router migration, verified before the new UI is layered on top.
