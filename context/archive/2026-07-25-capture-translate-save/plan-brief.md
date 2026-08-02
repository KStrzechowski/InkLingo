# Capture, Translate, Save (S-03) — Plan Brief

> Full plan: `context/changes/capture-translate-save/plan.md`
> Research: `context/changes/capture-translate-save/research.md`

## What & Why

Build the PRD's north-star flow: a Firefox extension that lets the user type a word/phrase and get AI-generated translation variants, IPA phonetics, and bilingual example sentences for whichever language(s) their active collection teaches — then pick one variant + sentence and save it. This is the slice that proves "zero-friction capture + AI-native translation" actually works end-to-end.

## Starting Point

Word-collections (S-02) already ships collections/entries/translations/sentences tables and a working web UI to browse them, but with zero language configuration, zero AI integration, and no browser extension. The Anthropic API key is already provisioned in AWS (config.ts reads it at every cold start); nothing calls it yet.

## Desired End State

A user creates a collection with a native + target language pair, installs the extension, logs in independently of the web app, captures a word from any page in either language, reviews AI-generated variants (each with phonetics and its own example sentences paired with a native gloss), picks one, and saves — the entry shows up immediately in the existing web app.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| AI provider | Anthropic Claude Haiku 4.5 | Already decided; Lambda's 15-min timeout was specifically chosen over App Runner's 30s cap for this NFR | Research |
| Language config location | Per-collection, not account-level | User wants different native/target pairs per collection simultaneously (e.g. PL→EN and RUS→EN) | Plan (conversation) |
| Target language count | 1 now, up to 5 later (Phase 5) | ~11 days to hard deadline; schema built as a junction table from Phase 1 so Phase 5 needs no migration | Plan (conversation) |
| Variant/candidate persistence | Ephemeral until save | Matches FR-013's exact wording; no schema needed for in-progress state | Plan (conversation) |
| Sentence shape | Bilingual pairs (target + native gloss), nested under each translation variant | Beginners can't parse an ungloss'd target-language sentence; sentences are variant-specific, not word-generic | Plan (conversation) |
| Extension auth | `launchWebAuthFlow` + PKCE, existing Cognito client | Backend already accepts any valid token for the pool/client; avoids a second Cognito App Client | Plan (conversation) |
| CORS for the extension | Background-script `host_permissions`, not CDK origin allowlisting | Standard WebExtension pattern; avoids pinning a fragile extension-ID origin into infra | Plan (conversation) |
| Rate limiting | Wired in this plan (Phase 2), not deferred | `infrastructure.md`'s own risk register already flags the denial-of-wallet gap; dependency already installed, unused | Research + Plan |
| Retroactive language backfill (FR-018) | Manual, per-entry, deferred to Phase 5 | No automatic bulk regeneration cost; explicit Non-Goal | Plan (conversation) |

## Scope

**In scope:** collection language config (native + 1-5 targets), Anthropic-backed translation/phonetics/sentence generation, save flow, a new Firefox extension with its own auth, rate limiting on the AI route, multi-language expansion (Phase 5).

**Out of scope:** Chrome/other browsers, FR-008 mouse-selection auto-capture, printable export (S-04), pronunciation playback (S-05), editing a collection's language config after creation, a manual language-detection-override UI, Playwright/e2e tooling, a "supported languages" DB table.

## Architecture / Approach

Backend-first (schema → AI route → save route), matching how S-02 sequenced its own rollout, so the riskiest new piece — the extension — is built against an already-verified backend. The extension avoids CORS entirely by routing calls through its background script under `host_permissions`, so the API Gateway's CORS config needs zero changes; the only infra touch is one new Cognito callback URL for the extension's own OAuth flow.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Collection language config | Collections carry a native + 1 target language | Modifies an already-shipped, tested API contract |
| 2. AI translation/generation endpoint | New Anthropic plugin + rate-limited route | First-ever external AI dependency in this codebase |
| 3. Save endpoint & schema | Persists chosen variant+sentence atomically | Multi-table write atomicity needs verifying against the installed Neon driver |
| 4. Extension — scaffold, auth, capture UI | Real end-to-end flow via a new client | Entirely new auth model (launchWebAuthFlow) and client type |
| 5. Multi-language expansion (deferred) | Up to 5 target languages + FR-018 backfill | Partial-failure UX across languages, first time N > 1 |

**Prerequisites:** S-01 (account-auth) and S-02 (word-collections) archived — both done.
**Estimated effort:** ~11 days to the PRD's hard deadline (2026-08-05), after-hours, solo — Phases 1-4 are the realistic target for that window; Phase 5 is an explicit stretch/fast-follow.

## Open Risks & Assumptions

- Anthropic structured-output reliability (tool-use/function-calling) for the variants+sentences shape hasn't been verified against the actual SDK — first real integration risk in Phase 2.
- Multi-table write atomicity (`entries` → `entry_translations`/`entry_sentences`) depends on whatever the installed `@neondatabase/serverless` version actually supports — flagged in the plan as a pre-Phase-3 verification step, not assumed.
- Given the deadline, Phase 5 may not land within the 3-week MVP window at all — it's explicitly the first thing to cut if time runs out, per the PRD's phased framing.

## Success Criteria (Summary)

- A user can go from typing a word in the extension to seeing it saved in the web app, entirely through real AI calls and real auth, with no manual database intervention.
- Two collections with different language pairs behave independently and don't leak into each other.
- A rate-limited or timed-out AI call fails cleanly, never as a hang or a 500.
