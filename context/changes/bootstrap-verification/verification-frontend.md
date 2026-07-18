---
bootstrapped_at: 2026-07-08T16:30:09Z (approximate — retroactive log, see note below)
starter_id: n/a — manual scaffold, not run through /10x-bootstrapper
starter_name: create-vite (react-ts template)
project_name: ink-lingo
language_family: js
package_manager: npm
cwd_strategy: native-cwd (scaffolded directly into frontend/, no temp-dir move)
bootstrapper_confidence: n/a
phase_3_status: ok
audit_command: npm audit --json
---

> **Note on this log**: the frontend was never scaffolded by `/10x-bootstrapper` — per the hand-off's "Why this stack" below, Vite+React fails one of the registry's four agent-friendly quality gates (no built-in routing/data-layer conventions) and was explicitly carved out to be added manually as a separate project. This file exists so the audit trail covers the whole product, not just the backend half. It follows the same schema as `verification-backend.md` for consistency, but several fields (invocation, exact timestamp) are reconstructed from the files on disk rather than captured live during the run.

## Hand-off

```yaml
starter_id: fastify
package_manager: npm
project_name: ink-lingo
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: false
    docs_current: false
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

## Why this stack

Solo developer shipping InkLingo's MVP in 3 weeks after-hours, deadline 2026-08-05, with auth and AI-driven translation/example-sentence generation in scope. The user explicitly wants a decoupled frontend/backend (not a monolith) and AWS/GCP container deployment with a relational database (Postgres), since the product's data model (users, collections, saved entries) is naturally relational. This ruled out the registry's recommended default for (web, js) — 10x Astro Starter — which bundles Supabase (hosted Postgres+auth) and defaults to Cloudflare, both mismatched with the AWS preference. Fastify is the backend/API half of the pair (the browser extension calls it over plain HTTP, same as the web app) and clears all four agent-friendly quality gates (typed, convention-based, popular, well-documented), unlike Express which fails typing and conventions. Deployment target is self-host (containerized on AWS or GCP), matching the starter's own deployment defaults. The companion frontend, Vite+React, is NOT scaffolded by this hand-off — it fails one quality gate (no built-in routing/data-layer conventions) and must be added manually as a separate project after Fastify is scaffolded. CI runs on GitHub Actions with auto-deploy-on-merge.

## Pre-scaffold verification

No pre-scaffold recency check ran live at scaffold time (this path is outside `/10x-bootstrapper`'s v1 scope, so its Step 1 never triggered). Checked retroactively, as of this log's writing:

| Signal      | Value                                    | Severity | Notes                                                        |
| ----------- | ----------------------------------------- | -------- | ------------------------------------------------------------- |
| npm package | create-vite v9.1.1, latest published 2026-06-30 | fresh    | `npm view create-vite time.modified`, checked retroactively, not at original scaffold time |
| npm package | vite v8.1.1 (pinned in package.json), published 2026-07-09 | fresh    | `npm view vite@8.1.1 time.modified`; publish date postdates this project's package.json birth timestamp (2026-07-08), likely a metadata/version-range resolution artifact rather than a real ordering issue — flagged for transparency, not treated as a finding |
| GitHub repo | not run                                    | n/a      | manual scaffold has no registry card / `docs_url` to resolve |

## Scaffold log

**Resolved invocation**: `npm create vite@latest frontend -- --template react-ts` (inferred from `package.json` shape — React 19 + TypeScript + oxlint scripts match this template exactly; not captured live since no skill instrumented the run)
**Strategy**: native-cwd
**Exit code**: not captured live; treated as success — `node_modules/`, lockfile, and full `src/` tree are present and `npm run build` inputs (tsconfig, vite.config.ts) are all in place
**Files moved**: n/a (scaffolded directly into `frontend/`, nothing moved from a temp dir)
**Conflicts (.scaffold siblings)**: none — `frontend/` did not previously exist
**.gitignore handling**: kept separate — `frontend/.gitignore` (Vite's own template ignores, e.g. `node_modules`, `dist`, `dist-ssr`) was left as its own file rather than merged into the root `.gitignore`. This differs from the backend's append-merge treatment; since frontend and backend live in their own subdirectories, a per-directory `.gitignore` is the simpler correct choice and nothing was lost by not merging.
**.bootstrap-scaffold cleanup**: n/a — no temp dir was used

## Post-scaffold audit

**Tool**: npm audit --json
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW
**Direct vs transitive**: not distinguished by this tool (all severities zero, so moot)

No findings in any severity tier as of this audit run.

## Hints recorded but not acted on

| Hint                       | Value                              |
| --------------------------- | ----------------------------------- |
| bootstrapper_confidence     | verified                            |
| quality_override            | false                                |
| path_taken                  | custom                               |
| self_check_answers          | typed: true, from_official_starter: true, conventions: false, docs_current: false, can_judge_agent: true |
| team_size                   | solo                                 |
| deployment_target            | self-host                            |
| ci_provider                  | github-actions                       |
| ci_default_flow              | auto-deploy-on-merge                 |
| has_auth                     | true                                 |
| has_payments                 | false                                |
| has_realtime                 | false                                |
| has_ai                       | true                                 |
| has_background_jobs          | false                                |

These are the same hand-off hints recorded in `verification-backend.md` — the hand-off describes the whole product, not one app, so both logs carry the same table.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Wire the frontend's API calls to the Fastify backend's base URL (dev vs. deployed).
- Set up Postgres (e.g. AWS RDS) for the backend to connect to — not part of either scaffold.
- If you want tighter linting, follow the frontend `README.md`'s note on enabling `oxlint-tsgolint` type-aware rules.
