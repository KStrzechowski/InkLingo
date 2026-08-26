---
change_id: invariant-aggregate-refactor
title: Invariant aggregate refactor
status: implementing
created: 2026-08-25
updated: 2026-08-26
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
