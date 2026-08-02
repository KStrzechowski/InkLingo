---
bootstrapped_at: 2026-07-08T01:19:00Z
starter_id: fastify
starter_name: Fastify
project_name: ink-lingo
language_family: js
package_manager: npm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: npm audit --json
---

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

| Signal             | Value                                          | Severity | Notes                                                          |
| ------------------ | ----------------------------------------------- | -------- | ---------------------------------------------------------------- |
| npm package        | fastify-cli v8.0.0 published 2026-03-28         | aged     | resolved from cmd_template (`npx fastify-cli generate ...`)      |
| GitHub repo        | not run                                          | n/a      | card's `docs_url` (https://fastify.dev) is not a GitHub URL      |

## Scaffold log

**Resolved invocation**: `npx fastify-cli generate .bootstrap-scaffold --lang=ts --esm` (attempted twice, see failures below), then `npx fastify-cli generate bootstrap-scaffold-tmp --lang=ts --esm` (succeeded)
**Strategy**: subdir-then-move
**Exit code**: 0 (on the third attempt)
**Files moved**: 15 (`package.json`, `README.md`, `tsconfig.json`, `src/app.ts`, `src/plugins/README.md`, `src/plugins/sensible.ts`, `src/plugins/support.ts`, `src/routes/README.md`, `src/routes/root.ts`, `src/routes/example/index.ts`, `test/helper.ts`, `test/tsconfig.json`, `test/plugins/support.test.ts`, `test/routes/root.test.ts`, `test/routes/example.test.ts`)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: append-merged (cwd's 2 lines kept first, scaffold's ~40 lines appended after a `# from fastify` separator comment)
**.bootstrap-scaffold cleanup**: n/a — two prior failed attempts left no artifacts to clean (see below); the successful attempt used a differently-named temp dir, cleaned up after move

**Attempt 1 — Node version mismatch (HARD-STOP, recovered)**:
Exit code 1. `fastify-cli`'s dependency tree (`chokidar`, `yargs-parser`, `readdirp`) requires Node.js >= 20.19.0; local Node was v20.18.1, causing an `ERR_REQUIRE_ESM` crash before any files were written. Resolved by upgrading Node to v24.18.0 via `winget install OpenJS.NodeJS.LTS` (user-initiated, mid-conversation).

**Attempt 2 — temp directory name rejected by npm (HARD-STOP, recovered)**:
Exit code 1. With Node upgraded, `fastify-cli generate .bootstrap-scaffold` generated most files successfully, then internally shelled out to `npm init -y` to populate `package.json`'s `name` field from the directory's own basename. npm's package-name validator rejects names starting with a dot (`Invalid name: ".bootstrap-scaffold"`), so the internal `npm init -y` failed and the whole generate command exited 1. This is a structural incompatibility between the `subdir-then-move` strategy's dot-prefixed temp directory convention and this specific CLI's naming behavior — not a project or environment misconfiguration.

**Deviation applied to reach success**: re-ran the generator into a non-dot-prefixed temp directory (`bootstrap-scaffold-tmp` instead of `.bootstrap-scaffold`). This is off-spec relative to the documented `subdir-then-move` convention (which always names the temp dir `.bootstrap-scaffold`), applied as a one-off workaround for this CLI's specific bug. The move-up step that followed applied the standard conflict matrix unchanged, so the end state in cwd is identical to what a successful `.bootstrap-scaffold` run would have produced. Flagging this here so a future reader (or a `bootstrapper-config.yaml` maintainer) can consider adding a `fastify: cwd_strategy: native-cwd` or a dot-free-temp-dir override for this starter.

## Post-scaffold audit

**Tool**: npm audit --json
**Status**: failed to run
**Reason**: no lockfile present (`ENOLOCK` — "This command requires an existing lockfile"). `fastify-cli generate` does not run `npm install` itself (it only prints the suggestion to run it), and bootstrapper does not add its own install step per its documented scope, so no `package-lock.json` exists yet.
**Partial output (if any)**:

```
npm error code ENOLOCK
npm error audit This command requires an existing lockfile.
npm error audit Try creating one first with: npm i --package-lock-only
```

Recommended next step: run `npm install` in the project root, then re-run `npm audit` manually (or re-invoke this bootstrap flow's audit step) to get real findings.

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

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Run `npm install` to install dependencies (not run automatically by the scaffold), then `npm audit` to get real dependency-audit findings — the audit above could not run without a lockfile.
- `git init` (if you have not already) to start your own repo history.
- Add the companion frontend (Vite+React) as a separate project/directory — it was not scaffolded by this hand-off (see "Why this stack" above).
- Set up Postgres (e.g. AWS RDS) for the backend to connect to — not part of the Fastify scaffold itself.
- Review the `.gitignore` merge — cwd's original 2 lines are preserved, Fastify's ~40 lines were appended below a `# from fastify` comment.
