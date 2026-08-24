# Anti-corruption layer: a translator port over the model provider — Plan Brief

> Full plan: `context/changes/anti-corruption-layer/plan.md`
> Source analysis: `context/domain/03-anti-corruption-layer.md`

## What & Why

`translation-pivot/change.md:209-211` records that "the translator is a
provider-agnostic seam", and `research.md:1020-1026` names `generateWithTimeout`
as that seam. It is not one: it isolates a timeout and an exception while the
provider's data shape, model id, retry policy and failure modes pass straight
through. This change builds the seam the record already claims exists — a
one-method `Translator` port and a `TranslationDraft` value object — before the
provider swap that plan depends on gets underway.

## Starting Point

`@anthropic-ai/sdk` is imported in five backend files, and `fastify.d.ts:29`
decorates the client onto `FastifyInstance`, so every route can reach it with no
import. `toolUse.input` is cast unchecked at `ai/translate.ts:148`, returned as
the HTTP body at `collections/index.ts:249` with no response schema, redeclared
verbatim in `extension/src/types.ts:14-36`, and walked field by field in React
state — the model's tool schema *is* the product's wire contract. Alongside it,
the tool schema and system prompt exist a second time byte-for-byte in
`measure-cost.mjs`, and the SDK response envelope is hand-rebuilt in four test
sites. All of this was re-verified against `e1373f7` during planning; the grep
baseline reproduces exactly.

## Desired End State

`backend/src/adapters/anthropicTranslator.ts` is the only file in `backend/src/`
importing the SDK, and one test file is the only place an SDK envelope is built.
Provider payloads enter the domain through exactly one total function that either
returns a valid `TranslationDraft` or raises `MalformedDraftError` — no cast, no
third outcome. Adding an Azure adapter would touch four files and no migration,
route handler, schema, client type, or UI component.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Which dependency | The model provider (L-1) | Only leak crossing the client/server boundary, with a swap already scheduled and a documented seam that does not exist | Analysis |
| All-empty draft | 502 via `DegenerateDraftError` | `lessons.md:37` — a 200 that is useless to the user is invisible to every other layer | Plan |
| Tool schema (D-1/D-2) | Deferred; schema moves byte-identical | Avoids the live-API gate and keeps the cost baseline valid; the follow-up then edits one file | Plan |
| Partial-empty reporting | Server-side log; popup branch deleted | Today's count covers only popups that stayed open long enough to report | Plan |
| Transport policy (D-3) | `maxRetries: 1`, `timeout: 15_000` | A per-client setting, not a prompt change — worst case drops from six upstream calls to four | Analysis + Plan |
| Wire type source of truth | TypeBox schema; `toWire()` typed from it | Drift becomes a compile error instead of a silently stripped field | Plan |
| Domain vocabulary | `senses` inside, `variants` on the wire | Nothing outside the backend changes; doc 02's rename later lands in one function | Analysis |
| Scope | All phases, extension included | The frontend never touches the translate shape, so the client surface is one app | Plan |

## Scope

**In scope:** `backend/src/domain/` (value object, port, error taxonomy);
`backend/src/adapters/anthropicTranslator.ts`; `plugins/translator.ts` replacing
`plugins/anthropic.ts`; the `fastify.d.ts` swap; both AI routes; the full test
migration to a fake plus an enforced boundary test; `schema.response` on both AI
routes; de-forking `measure-cost.mjs`; deleting the popup's degradation counting.

**Out of scope:** any tool-schema or prompt change (`strict: true`,
`detectedLanguageCode`); any live API call; the `variants → senses` wire rename;
`App.tsx`'s regenerate reconciliation (needs doc 02's stable sense key); a shared
types package; the three smaller leaks (Neon, axios, Web Speech).

## Architecture / Approach

```
route ──> fastify.translator: Translator ──> anthropicTranslator ──> @anthropic-ai/sdk
              (one method)                    (the ONLY importer)
                   │                                  │
                   └──────── TranslationDraft <───────┘
                             fromProviderPayload(unknown) — the one crossing point
                                  │
                    toWire() ─────┴───── renderingFor(code)
                    (wire contract)      (persistable rows)
```

Provider-shaped data exists only above `fromProviderPayload`; everything below it
is domain-shaped. The route keeps its own 20 s `AbortController` — an application
deadline set by API Gateway's 29 s ceiling — and stops owning the provider.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 0. Baseline | The three grep counts and test count recorded | None — read-only |
| 1. Domain core | Value object, port, errors, response schema; test-first | `fromProviderPayload` missing a failure mode the model actually produces |
| 2. Adapter | The only SDK importer; transport policy chosen | A single character drifting in the moved schema or prompt silently invalidates the cost baseline |
| 3. Wiring, routes, tests | The swap; greps hit target; all-empty becomes 502 | Largest phase and the only behavior change; cannot be subdivided without a red gate |
| 4. Response schemas | Fastify serializes against a contract we own | Fastify strips undeclared fields — a missed property vanishes silently |
| 5. De-fork measure-cost | The instrument stops redefining the contract | Now needs `npm run build:ts` first |
| 6. Extension cleanup | Popup stops encoding model-behaviour knowledge | Partial-empty reporting must already be live server-side |

**Prerequisites:** none — no new credential, migration, or infra change. Backend
and extension dependencies already installed.
**Estimated effort:** ~3–4 sessions. Phase 3 is roughly half the work; phases 4–6
are one sitting each.

## Open Risks & Assumptions

- **Phase 3 is atomic by necessity.** `test/helpers/anthropic.ts:3` imports from
  `ai/translate.ts` and every translate test assigns `app.anthropicClient`, so the
  wiring and the test migration cannot be separately green. This merges the source
  analysis's phases 3 and 4.
- **Partial-empty degradation moves from `POST /api/client-errors` into pino
  logs.** Whatever counts that number today has to be re-pointed, and there is a
  gap between Phase 3 landing and that happening.
- **The all-empty 502 is a real user-visible change**, and a popup built before
  Phase 6 renders it through a generic error path written for network failures.
  Acceptable and reversible, but it is the one thing a user could notice.
- **Deferring D-1/D-2 leaves `fromProviderPayload` as the only defence** against a
  malformed payload — there is no `strict: true` backstop until the follow-up.
  The source analysis argues this is the load-bearing guard anyway, since strict
  mode does not enforce `minItems`.
- **No live-API evidence was gathered.** Every claim about the model's behaviour
  is quoted from measured comments in the code or `lessons.md`. This plan does not
  change the request, so that is sound — but the deferred schema change will need
  its own live gate.

## Success Criteria (Summary)

- `grep -rl "@anthropic-ai/sdk" backend/src backend/test` returns exactly two
  files, enforced by a committed test that has been verified by making it fail.
- No route handler, plugin, migration, schema, client type or component would
  change if a second provider were added — only a new adapter and one line of
  wiring.
- Capture and backfill behave exactly as before for every usable response; an
  all-empty response now fails loudly instead of returning five empty sections.
