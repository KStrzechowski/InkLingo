---
change_id: anti-corruption-layer
title: Seal the model provider behind a translator port
status: impl_reviewed
created: 2026-08-23
updated: 2026-08-24
archived_at: null
---

## Notes

Source analysis: `context/domain/03-anti-corruption-layer.md` (written at
`a873099`, re-verified against `e1373f7` during planning). Plan and brief live
alongside this file.

**Structural only.** The tool schema, system prompt and model id move
byte-identical into the adapter, so no live API calls are needed and the
`measure-cost.mjs` baseline stays valid. `strict: true` and a required
`detectedLanguageCode` (D-1/D-2 in the analysis) are deferred to a follow-up
that will carry its own live-verification gate.

**Load-bearing names introduced** (recorded here because
`docs/reference/contract-surfaces.md` does not exist in this repo):
`Translator`, `TranslationDraft`, `TranslationDraft.fromProviderPayload`,
`RequestedLanguages`, `PersistableRendering`, `toWire()` /
`TranslateResponseBody`, `billableCharacters()`, `TranslatorUnavailableError`,
`MalformedDraftError`, `DegenerateDraftError`, `createAnthropicTranslator`,
and the `backend/src/adapters/` directory as an enforced grep boundary.

**Follow-ups this change deliberately leaves open**: D-1/D-2 tool-schema
change; correcting `translation-pivot/research.md:1020-1026`, which names
`generateWithTimeout` as an existing provider-agnostic seam; and the three
smaller leaks in the analysis § 6.4 (Neon `UNIQUE_VIOLATION` in a route,
`axios.isAxiosError` in two frontend pages, duplicated Web Speech wrappers).

## Baseline (Phase 0, measured at `50990fa`)

Read-only; no live API call was made. The plan's grep baseline reproduces
exactly.

| Measure | Value |
| --- | --- |
| Files importing `@anthropic-ai/sdk` under `backend/src` + `backend/test` | 5 — `src/ai/translate.ts`, `src/fastify.d.ts`, `src/plugins/anthropic.ts`, `test/helpers/anthropic.ts`, `test/routes/api/entry-translations.test.ts` |
| `anthropicClient` references across `backend/src` + `backend/test` | 7 |
| `claude-haiku` / `return_translation` hits | 2, both in `src/ai/translate.ts` (`:3`, `:4`) |
| Backend test suite | 94 tests, 94 pass, 0 fail |
