---
date: 2026-09-04T15:03:35+02:00
researcher: KStrzechowski
git_commit: 76af3f57369e737cf82917b0df0f93e568d14bb5
branch: feat/m5-code-review-agent
repository: InkLingo
topic: "Packaging this repo's AI toolkit as a distributable npm package via GitHub Packages (Module 5, Lesson 4, Model 1)"
tags: [research, packaging, github-packages, agent-skills, m5l4]
status: complete
last_updated: 2026-09-04
last_updated_by: KStrzechowski
---

# Research: Packaging the AI toolkit for GitHub Packages distribution

**Date**: 2026-09-04T15:03:35+02:00
**Researcher**: KStrzechowski
**Git Commit**: 76af3f57369e737cf82917b0df0f93e568d14bb5
**Branch**: feat/m5-code-review-agent
**Repository**: InkLingo

## Research Question

How to package this repo's Claude Code artifacts as a distributable npm package (`@<org>/ai-toolkit`) published via GitHub Packages, per `.claude/prompts/m5l4-github-packages-spec-pack.md`, `m5l4-github-packages-spec-cicd.md`, `m5l4-shared-spec-skill.md`, and `m5l4-shared-conventions.md`. Are `.claude/skills/pack-init/` and `.claude/skills/setup-cicd/` (built for the AWS CodeArtifact model) reusable/adaptable for GitHub Packages, or does this need to be built from scratch against the GitHub Packages spec files directly?

## Summary

- **`pack-init` is reusable with parameter changes only** — it's genuinely registry-agnostic (never sets `publishConfig.registry`, never touches AWS/CodeArtifact concepts in its generated output). Swap its hardcoded default `@10xdevs/ai-toolkit`/`10xdevs` namespace for the real scope and it produces the right skeleton for either delivery model.
- **`setup-cicd` should be skipped** — its entire workflow is AWS-OIDC-shaped (`id-token: write`, `aws-actions/configure-aws-credentials`, `aws codeartifact login`, verification greps that check for AWS-specific strings). Only its validation-job checklist is reusable, and that's a paragraph, not a skill invocation. The course spec (`m5l4-github-packages-spec-cicd.md`) already hands us a complete, known-good starter workflow — writing `.github/workflows/publish-ai-toolkit.yml` directly against that spec is cleaner than trying to strip AWS assumptions out of `setup-cicd`.
- **The course spec's placeholder scope `@twoj-zespol` must be replaced.** This repo is a personal-account repo (`github.com/KStrzechowski/InkLingo`, no GitHub org) — the real npm scope is `@kstrzechowski`.
- **The new `skills/code-review/SKILL.md` is a wholly new artifact.** Nothing like it exists anywhere in the repo today (distinct from the 30 `.claude/skills/*/SKILL.md` planning skills, and distinct from Claude Code's own built-in `code-review` skill). `.claude/skills/10x-rule-review/SKILL.md` and `.claude/skills/10x-impl-review/SKILL.md` are the closest structural precedents to imitate for its severity-bucketed, single-verdict output contract.
- **The generic course conventions handout should be supplemented, not used verbatim** — this repo already enforces real TypeScript rules (`verbatimModuleSyntax`, `erasableSyntaxOnly`, `strict: true` across all 4 tsconfigs) that the handout doesn't mention, and has two `lessons.md` entries worth folding into the Error Handling category.
- **New package should live at `packages/ai-toolkit/`** (monorepo convention, sibling to `packages/code-reviewer/`), following that package's conventions closely: `"type": "module"`, its own `.env`/`.gitignore`/`README.md`, `tsx`-based scripts, no root `package.json`.

## Detailed Findings

### `pack-init` skill — reusable, registry-agnostic

`.claude/skills/pack-init/SKILL.md` (98 lines, single file, no `references/`) generates a skeleton at `packages/ai-toolkit/`: `package.json`, `pack.yaml`, `install.js`, `uninstall.js`, `bin/cli.js`, `skills/`, `rules/` (lines 46-59). Default package name/namespace are hardcoded to `@10xdevs/ai-toolkit` / `10xdevs` (line 42) but explicitly says to prefer values from spec files if present — trivially overridable.

**No registry coupling found anywhere in the file.** It never sets `publishConfig.registry`, never mentions `.npmrc`, and "CodeArtifact" only appears as destination *context* (lines 3, 18), not as something the skill's `## Workflow` steps (40-97) or `## Verification` block (89-95) act on. Verification is registry-neutral: `npm pack --dry-run`, JSON-parse `package.json`, confirm `pack.yaml` exists. Installer behavior it specifies (74-78): symlink under `npm install`, copy under `npx ... install`, track installed files in a manifest for idempotent uninstall — this matches the GitHub Packages spec's own installer requirements almost exactly (`m5l4-github-packages-spec-pack.md`'s "Installer behavior" section).

**Verdict: reuse with parameter changes** — override the default scope/namespace, and the `## Inputs` list can skip the CodeArtifact/Terraform spec files since they don't exist in this repo's chosen path.

### `setup-cicd` skill — AWS-coupled, not worth adapting

`.claude/skills/setup-cicd/SKILL.md` (82 lines) generates a workflow that is AWS-specific end to end: `id-token: write` permission for OIDC (44-50), `aws-actions/configure-aws-credentials@v4` (59), `aws codeartifact login` (60-61), explicit Security Rules mandating OIDC via `AWS_ROLE_ARN` and forbidding long-lived AWS keys (63-68). Its verification block (74-79) greps the generated workflow for AWS-specific strings (`"id-token: write"`, `"aws codeartifact login"`) — success criteria are defined in AWS terms.

Only the validation-job checklist (52-57 — pack.yaml exists/has required fields, every `skills/*/SKILL.md` has matching frontmatter, `npm pack --dry-run` succeeds) is registry-agnostic and would carry over unchanged. Everything else needs a full rewrite: OIDC role-assumption → `GITHUB_TOKEN`/`NODE_AUTH_TOKEN` via `actions/setup-node`'s `registry-url`, no `id-token: write`, different verification greps.

**Verdict: build the workflow fresh** against `m5l4-github-packages-spec-cicd.md`'s own starter YAML (already a complete, known-good target) rather than editing `setup-cicd`'s AWS assumptions out.

### Real GitHub org/scope (replaces course placeholder)

`git remote -v` → `origin https://github.com/KStrzechowski/InkLingo.git`. Confirmed via `gh repo view --json owner,name` → owner login `KStrzechowski`, repo `InkLingo`. **No GitHub org exists — this is a personal-account repo.** The npm scope to use throughout (`package.json` name, `.npmrc` mapping, workflow `scope:` field) is **`@kstrzechowski`**, not the course spec's Polish placeholder `@twoj-zespol` ("your-team").

### `packages/code-reviewer/` conventions to mirror

- `package.json`: `"type": "module"`, `"private": true`, `main: dist/index.js`. Flat verb/verb:noun script names: `dev` (`tsx --env-file`), `build` (`tsc`), `start` (`node --env-file dist`), `typecheck` (`tsc --noEmit && tsc -p test/tsconfig.json` — separate test tsconfig), `test` (`node --import tsx --test`).
- `tsconfig.json`: `target: esnext`, `module`/`moduleResolution: nodenext`, `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` + `verbatimModuleSyntax` + `erasableSyntaxOnly` (TS7 native-ESM style), `strict: true`.
- Has its own `.env`/`.env.example`, own `README.md` (H1 title, `## Setup`, `## Usage`, `## Exports`), own `.gitignore` (`node_modules/`, `dist/`, `.env`).
- **Root `.gitignore` has no `packages/*` patterns at all** — each package independently gitignores its own build/env artifacts. No root `package.json` exists (confirmed) — matches CLAUDE.md's "independent npm projects with no workspace linking" statement.

### `.github/workflows/*.yml` house style

Three existing workflows, all using **pinned-SHA actions with a trailing `# vX.Y.Z` comment** (not bare version tags):
- `code-review.yml`: `on: pull_request: types: [labeled]`, label-gated (`if: github.event.label.name == 'ai-cr:review'`, deliberately excluded from required-checks), `concurrency` keyed on PR number.
- `deploy.yml`: `on: push: branches: [main]`, `permissions: id-token: write, contents: read` (OIDC to AWS already exists in this repo for CDK deploys — separate from the CodeArtifact-vs-GitHub-Packages question), descriptive job names gated via `needs:`.
- `pr-diff.yml`: same trigger/permission/pinning pattern.

**No `paths:` filtering is used anywhere**, despite this being a monorepo — workflows scope to a package via `working-directory:` inside steps instead. A new `publish-ai-toolkit.yml` introducing `paths: ['packages/ai-toolkit/**']` filtering would be a new pattern for this repo, not matching precedent — worth a deliberate decision in planning rather than silent adoption.

No `.npmrc` exists anywhere in the repo (root or `packages/code-reviewer/`), and no `publishConfig`/`registry-url`/`npm.pkg.github.com` references exist in any tracked file yet.

### The new distributable `skills/code-review/SKILL.md` — wholly new artifact

Confirmed absent everywhere: not under `.claude/skills/` (those are 30 Claude-Code-native planning skills, a different thing), not under `.agents/skills/` (a `10x-cli`-managed, gitignored mirror per root `.gitignore`'s `/.agents` entry), and no `skills/code-review/` directory of any kind exists, tracked or untracked, anywhere in the repo.

**Closest structural precedents** (read in full):
- `.claude/skills/10x-rule-review/SKILL.md` — minimal frontmatter (`name`, `description`, `allowed-tools` list only — no other fields anywhere in this repo's skills). Structured as 5 named checks each ending in an explicit `Verdict: OK/WARN/FAIL` table, with a locked "Output format" section specifying an exact template and the instruction "Print exactly this, in this order."
- `.claude/skills/10x-impl-review/SKILL.md` — the best match for the Critical→Warning→Suggestion + final-verdict shape this new skill needs: per-finding fields (ID, Severity, Impact, Dimension, Location, Detail, Fix), explicit severity-sort rule, dimension verdicts, and a final single-enum Overall verdict (APPROVED/NEEDS ATTENTION/REJECTED) — structurally identical to the target APPROVE/REQUEST CHANGES/NEEDS DISCUSSION requirement.

**Takeaway for planning**: mirror `10x-rule-review`'s frontmatter minimalism and `10x-impl-review`'s severity-bucket + single-verdict output contract, written as a literal "print exactly this" template — this repo's own skills already establish that convention, no need to invent one.

### Conventions handout vs. this repo's actual enforced rules

`m5l4-shared-conventions.md` itself says "adapt to your team before generating" — confirmed generic course material, not repo-specific. Concretely:

- **TypeScript**: the handout's "prefer `interface` over `type`" is enforced nowhere (no lint rule forbids `type`). But all 4 `tsconfig.json`s (backend, frontend, extension, `packages/code-reviewer`) actually enforce real, checkable things the handout is silent on: `strict: true`, `verbatimModuleSyntax: true`, `erasableSyntaxOnly: true` everywhere, plus frontend/extension add `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch`. Worth substituting into the TypeScript category (e.g. "no missing `import type` for type-only imports," "no enum/parameter-property/namespace syntax — forbidden by `erasableSyntaxOnly`") instead of the handout's unenforced `interface`-over-`type` line.
- **Error handling**: two `lessons.md` entries are project-specific rules the generic "try/catch or `.catch()`" line doesn't cover — the await-race lesson (`lessons.md` § "A value read before an await must not be written back after it") and the stubbed-LLM-client lesson (`lessons.md` § "A stubbed AI client cannot tell you the model's output is usable").
- **Naming**: `frontend/.oxlintrc.json` and `extension/.oxlintrc.json` (identical) enforce only `react/rules-of-hooks: error` and `react/only-export-components: warn` — narrow, React-specific, and already documented in `lessons.md`'s React-context-split entry.
- `AGENTS.md` states hard rules (`context/archive/` immutability, the `10x-cli` sentinel-block no-touch rule) — not review-category material, but the new skill's installer must never claim that same marker namespace.

### Installer / sentinel-marker precedent

No `install.js`/`uninstall.js` exists anywhere yet (`packages/` currently only has `code-reviewer/`, which has no installer). The one real, working sentinel-marker instance in this repo is `.claude/CLAUDE.md`'s `<!-- BEGIN @przeprogramowani/10x-cli -->` / `<!-- END @przeprogramowani/10x-cli -->` block, written/regenerated by an external CLI tool and explicitly protected from hand-editing by both `CLAUDE.md` and `AGENTS.md`. This confirms the *pattern* (whole-block replace between two named HTML-comment markers, namespaced by package name) that the new installer should mirror for its own `<!-- BEGIN @kstrzechowski/ai-toolkit --> ... <!-- END @kstrzechowski/ai-toolkit -->` block — but gives only the consumer contract, not generator source, to imitate.

## Code References

- `.claude/skills/pack-init/SKILL.md:22-29,40-97` — package skeleton generation, registry-agnostic
- `.claude/skills/setup-cicd/SKILL.md:44-68,74-79` — AWS-OIDC-coupled workflow generation, not reusable as-is
- `.claude/skills/10x-rule-review/SKILL.md` — frontmatter minimalism + locked output-format precedent
- `.claude/skills/10x-impl-review/SKILL.md` — severity-bucket + single-verdict output contract precedent
- `packages/code-reviewer/package.json`, `packages/code-reviewer/tsconfig.json`, `packages/code-reviewer/README.md`, `packages/code-reviewer/.gitignore` — sibling-package conventions to mirror
- `.github/workflows/code-review.yml`, `.github/workflows/deploy.yml`, `.github/workflows/pr-diff.yml` — house style for a new `publish-ai-toolkit.yml` (pinned-SHA actions, no `paths:` filtering precedent)
- `.claude/CLAUDE.md:1,55` — the one real sentinel-marker pattern in production in this repo
- `context/foundation/lessons.md` § "A value read before an await must not be written back after it", § "A stubbed AI client cannot tell you the model's output is usable" — project-specific error-handling rules to fold in

## Architecture Insights

- This repo's "independent npm projects, no root package.json, no workspace linking" convention (per root `CLAUDE.md`) extends cleanly to a new `packages/ai-toolkit/` — no monorepo tooling (Turborepo, npm workspaces, etc.) needs to be introduced.
- The repo already has a working AWS OIDC pattern (`deploy.yml`, `infra/lib/constructs/github-oidc-construct.ts`) for a *different* purpose (CDK deploys) — this is unrelated to the CodeArtifact-vs-GitHub-Packages decision and should not be confused with or reused for the ai-toolkit publish workflow, which needs no AWS credentials at all per the chosen path.
- This repo's own `.claude/skills/*/SKILL.md` files already establish a house style for review/checklist-shaped skills (minimal frontmatter, explicit severity buckets, locked output-format template) — the new distributable skill should follow that local convention rather than inventing a new shape, even though it will ship inside an npm package rather than live under `.claude/skills/`.

## Historical Context (from prior changes)

- `context/archive/2026-08-30-tool-loop-agent/plan-brief.md` and `context/archive/2026-09-01-code-review-evals/plan-brief.md` — both are the M5L2/M5L3 pipeline work already completed and archived; this research's parent decision (skip AWS/Terraform, go GitHub Packages) rests on that pipeline already satisfying the Module 5 and 10xChampion badges, per course rules relayed by the user this session.
- No prior `context/changes/**` or `context/archive/**` work touches packaging, npm publishing, or GitHub Packages — this is genuinely new ground for the repo's change history.

## Related Research

- `context/archive/2026-09-01-code-review-evals/research.md` — sibling M5L3 research (different topic, same module)

## Open Questions

- **Should `publish-ai-toolkit.yml` use `paths:` filtering** to scope runs to `packages/ai-toolkit/**`, introducing a pattern not used by any existing workflow in this repo, or should it follow the existing house style of triggering unconditionally and scoping via `working-directory:` in steps? Either is defensible; this is a planning decision, not something research settled.
- **Should the six review categories be reworded to reflect this repo's actual enforced TypeScript rules** (`verbatimModuleSyntax`, `erasableSyntaxOnly`) instead of the handout's unenforced `interface`-over-`type` preference, or kept generic since the package is meant to be installed into *other* consumer repos with their own conventions, not just this one? The handout itself says "adapt to your team," but "your team" here might mean the eventual consumers of `@kstrzechowski/ai-toolkit`, not just InkLingo itself — worth deciding explicitly in planning.
- **Bundling scope**: the course spec's "Required files" tree shows exactly one skill (`code-review`). Should the initial package bundle only that, or should it also expose any of this repo's existing 30 `.claude/skills/*` planning skills? Nothing in the spec asks for the latter, and the badge-evidence note (repo/registry, package definition, released versions) doesn't require it either — current lean is "just `code-review`, per spec," but worth confirming before planning locks it in.
