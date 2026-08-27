---
change_id: invariant-aggregate-refactor
title: Invariant aggregate refactor
status: implementing
created: 2026-08-25
updated: 2026-08-27
archived_at: null
---

## Notes

Implements the design in `context/domain/02-invariant-aggregate-refactor.md`
(written at `f6e3aab`) — the `Entry` aggregate that guards sense integrity.
Tracked as **IL-41** (tasks IL-42 ... IL-45).

`research.md` re-grounds that design against HEAD after the anti-corruption-layer
change landed. Read it first: the design holds, but many of the doc's `file:line`
anchors are stale, and three of them now point at things a test forbids.

**Phase 0 was run during research** (2026-08-25, read-only, dev Neon branch) —
numbers in `research.md` § 4. The migration is safe on today's data; three rows
need a disposition decision before Phase 3, and four rows would violate the
proposed aggregate's constructor invariants on read (§ 5).

**Phase 4 decision (2026-08-27): the frontend web app breaks too, same as the
extension.** Item 7's "client shape copies" line only asked for
`addEntryTranslation`'s return type, but `GET /:id` also went nested in this
phase (item 5) and `frontend/src/api/collections.ts` / `CollectionDetailPage.tsx`
are hand-copied, not derived — so nothing forces them to notice. Fixing either
route without doing Phase 6's real rework meant building a temporary
flatten-to-old-shape adapter, which cuts against decision A3's "no shims" rule.
Decided instead to leave both files untouched: `tsc -b` and `vite build` still
pass (the types are hand-copied and don't fail to compile), but
`CollectionDetailPage`'s rendering of real entries and the backfill button are
broken against a live backend from this phase until Phase 6 lands — the same
window shape as the popup's Phase 2→5 gap, just for the web app and Phase 4→6.
No frontend files were touched in Phase 4 as a result.
