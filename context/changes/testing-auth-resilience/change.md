---
change_id: testing-auth-resilience
title: Testing auth resilience
status: impl_reviewed
created: 2026-08-06
updated: 2026-08-08
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Deferred: pages don't recover the data they failed to load (2026-08-06)

Spotted during Phase 3's manual verification. `clearConnectionIssue()` heals
the banner but not the view it was raised over. `CollectionsListPage` fetches
once on mount and never retries, so the recovery path ends up misleading: the
initial `listCollections()` fails, `collections` stays `[]`, and the first
successful POST appends to that empty array — the user sees one collection
rendered as a complete list while the server holds several.

Deliberately out of scope here: Risk #4 is about the failure being *legible*,
and the banner delivers that. Left as-is by decision, not oversight.

The fix when it's picked up is **not** a `connectionIssue` false-edge
subscription — that would refetch on a signal possibly raised by an unrelated
request, and would make every page depend on auth context. Prefer a "Try
again" action on each page's existing `error` state that re-runs its own
loader: local to the page that knows what it failed to fetch, and it covers
every failed load (500s, timeouts) rather than only this one.

### Next step: transitive high-severity advisories in `frontend/` (2026-08-08)

Surfaced by `npm audit` while verifying this change. **Unrelated to it** — both
predate this phase and none of the four packages added here pull them in.
Recorded so the next person touching frontend dependencies picks them up.

As of 2026-08-08, `cd frontend && npm audit` reports 2 high-severity issues,
both on the single `vite@8.1.3 → postcss@8.5.16 → nanoid@3.3.15` path:

- **postcss ≤8.5.22** — path traversal via attacker-controlled
  `sourceMappingURL` auto-loading, disclosing arbitrary `.map` files
  (GHSA-r28c-9q8g-f849, plus GHSA-fxqj-rqcc-2cmp as the incomplete fix of
  GHSA-6g55-p6wh-862q).
- **nanoid ≤3.3.16** — non-secure generators can loop indefinitely on a
  negative or zero size (GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8).

Both are build-time-only for us: `postcss` runs inside Vite's build, and none
of this ships to the browser or processes untrusted input in our pipeline —
which is why this is a next step and not a blocker.

`npm audit fix` reports a fix is available for both. Worth doing on its own
branch with a full `npm test && npm run build` after, since it moves a
transitive dep underneath Vite.
