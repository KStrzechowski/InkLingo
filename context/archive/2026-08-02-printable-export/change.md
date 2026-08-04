---
change_id: printable-export
title: Printable export
status: archived
created: 2026-08-02
updated: 2026-08-04
archived_at: 2026-08-04T16:39:04Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap slice **S-04**, PRD **FR-014**. Jira epic [IL-5](https://kondi827.atlassian.net/browse/IL-5) (subtasks IL-19, IL-20).
- **Open Roadmap Question 1 is resolved here**: print mechanism is a browser print view (`@media print` + `@page A4`), not a server-generated file. Decided 2026-08-02 during `/10x-plan`. Deciding factors: zero backend/infra footprint (no new route, so no `api-construct.ts` entry), system fonts cover IPA + Cyrillic + Polish diacritics for free where a Lambda-side PDF generator would need an embedded Unicode font, and the 2026-08-05 deadline.
- **Future direction flagged by the user (2026-08-02)**: they expect to want *one shared example sentence per entry across all target languages*, rather than today's one sentence + one native gloss per language. Not in scope here — this change renders what is stored. When that model lands, the `Sentence (native)` column collapses to a per-entry cell merged alongside the word. Natural companion to the parked EN-pivot / sense-keyed re-architecture (`context/changes/translation-pivot/`, Jira [IL-24](https://kondi827.atlassian.net/browse/IL-24)).
- Layout was iterated during planning: a column-per-language grid was rejected because A4 portrait leaves ~28mm per column at 5 target languages. Final shape puts languages on **rows**, so column widths are constant from 1 to 5 languages.
