---
change_id: testing-auth-resilience
title: Testing auth resilience
status: implementing
created: 2026-08-06
updated: 2026-08-06
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
