# AI Toolkit Package (GitHub Packages) — Plan Brief

> Full plan: `context/changes/ai-toolkit-package/plan.md`
> Research: `context/changes/ai-toolkit-package/research.md`

## What & Why

Module 5 Lesson 4 ("Zadanie 2"), Model 1 path: package a distributable `code-review` Agent Skill — built from the course's shared engineering-conventions handout — into a new npm package, `@kstrzechowski/ai-toolkit`, published via GitHub Packages. Optional practice ("Innovate" extension) — neither 10xChampion nor the Module 5 badge require it, since both are already satisfied by the archived M5L2/M5L3 pipeline work.

## Starting Point

`packages/` currently has only `code-reviewer/`, an independent npm package with no root workspace linking. No `ai-toolkit` package, no distributable `code-review` skill, and no GitHub Packages workflow exist anywhere yet. `.claude/skills/pack-init/` (registry-agnostic) and `.claude/prompts/m5l4-github-packages-spec-*.md` (concrete, complete specs) give a strong starting point; `.claude/skills/setup-cicd/` is AWS-coupled and unused here.

## Desired End State

`npm install @kstrzechowski/ai-toolkit` in any consumer repo drops a working `code-review` Agent Skill into `.claude/skills/`, injects a short rules pointer into `CLAUDE.md` between sentinel markers, and tracks what it installed — idempotently, never failing the consumer's own `npm install`. `npm uninstall` reverses it cleanly. The package is real and published, verified end-to-end including a live install/uninstall round-trip.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Delivery model | GitHub Packages (Model 1), not AWS CodeArtifact + Terraform | Neither course badge requires this lesson at all; no reason to eat AWS/Terraform setup friction for optional practice | Plan (user decision) |
| npm scope | `@kstrzechowski`, not the spec's `@twoj-zespol` | This repo has no GitHub org — it's a personal-account repo | Research |
| `pack-init` skill | Reused with parameter overrides | Genuinely registry-agnostic; only the default scope/namespace needed changing | Research |
| `setup-cicd` skill | Not used — workflow written fresh | AWS-OIDC-coupled end to end; the course's own GitHub Packages YAML is a cleaner base | Research |
| Install/uninstall mechanism | Lifecycle hooks only (`postinstall`/`preuninstall`), no `bin/cli.js` | Zero extra steps for consumers; matches the spec's own package.json example | Plan (user decision) |
| Review skill content | Generic course handout, unmodified | Ships into other consumer repos too — baking in InkLingo-specific tsconfig flags would make it wrong elsewhere | Plan (user decision) |
| CI trigger scope | `paths: ['packages/ai-toolkit/**']` filtering | This workflow does a real `npm publish` on push — unlike this repo's other workflows, an unrelated push shouldn't trigger it | Plan (user decision) |
| Bundled skills | Just `code-review`, per spec | Matches the lesson's stated deliverable and the badge-evidence requirements exactly | Plan (user decision) |
| Live publish | Included, as an explicitly gated final phase | Mirrors this session's established pattern (code-review-evals, tool-loop-agent) — no surprise credential/registry action | Plan (user decision) |
| Installer test approach | `node:test` against a real temp-directory consumer root | No existing repo pattern to copy; tests the real idempotency/sentinel logic end to end, not a mock | Plan (user decision) |

## Scope

**In scope:** `packages/ai-toolkit/` (package.json, pack.yaml, README, the `code-review` SKILL.md, the rules fragment, install.js/uninstall.js + tests), `.github/workflows/publish-ai-toolkit.yml`, a real gated publish + install/uninstall round-trip, the three badge-evidence artifacts.

**Out of scope:** AWS CodeArtifact/Terraform, a manual CLI, InkLingo-specific review rules baked into the shipped skill, bundling any other `.claude/skills/*`, a root workspace/monorepo tool, multi-consumer/cross-org install testing.

## Architecture / Approach

A plain-JavaScript, ESM npm package (no TypeScript, no build step) sibling to `packages/code-reviewer/`. `install.js`/`uninstall.js` export testable `install(consumerRoot)`/`uninstall(consumerRoot)` functions (mirroring `packages/code-reviewer/src/index.ts`'s direct-run-guard pattern) wired to npm's `postinstall`/`preuninstall` lifecycle hooks. A manifest file (`.claude/.ai-toolkit-manifest.json`) is the single source of truth for what got installed, so uninstall never guesses paths. CI validates on every PR touching the package and publishes on push to `main`, using GitHub's own ephemeral `GITHUB_TOKEN` (no PAT/OIDC needed for same-repo publish).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Package skeleton + skill authoring | Everything verifiable with zero registry interaction: identity files, the `code-review` skill, the rules fragment | Skill content drifting from the spec's exact category/output requirements |
| 2. Installer, uninstaller, tests | Idempotent install/uninstall logic + a real `node:test` suite against temp-directory filesystem state | No existing repo pattern for this kind of script — idempotency bugs would be genuinely novel here |
| 3. GitHub Actions workflow | `publish-ai-toolkit.yml`, validated via a real but non-publishing PR | `paths:` filtering is a new pattern for this repo — worth confirming it actually scopes correctly |
| 4. Live verification | Real publish + real install/uninstall round-trip + badge-evidence screenshots | Real, account-visible action — explicitly gated on your go-ahead |

**Prerequisites:** none blocking Phases 1–3; Phase 4 needs a push to `main` and (for the consumer-side check) a PAT with `read:packages` or `gh auth token`.
**Estimated effort:** Phases 1–3 are one to two focused sessions; Phase 4 is a short live-verification pass, blocked on your explicit go-ahead.

## Open Risks & Assumptions

- `paths:` filtering is unprecedented in this repo — if it doesn't scope as expected, Phase 3's manual PR check is designed specifically to catch that before Phase 4's real publish.
- Same-repo `GITHUB_TOKEN` publish permission (`packages: write`) is documented GitHub behavior but hasn't been exercised in this repo before — Phase 4 confirms it works in practice.
- The generic, unmodified review skill won't catch InkLingo-specific rules (e.g. `erasableSyntaxOnly` violations) if run against this repo's own code — accepted tradeoff per your decision, since the package targets other consumers too.

## Success Criteria (Summary)

- `packages/ai-toolkit/` passes `npm pack --dry-run` and `npm test` locally.
- A PR touching the package triggers CI validation without publishing.
- A real push to `main` publishes the package, and a genuine external install/uninstall round-trip works correctly.
