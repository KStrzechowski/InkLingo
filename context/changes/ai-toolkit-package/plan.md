# AI Toolkit Package (GitHub Packages) Implementation Plan

## Overview

Package this repo's Module 5 Lesson 4 deliverable — a distributable `code-review` Agent Skill built from the course's shared engineering-conventions handout — into a new, independent npm package at `packages/ai-toolkit/`, and publish it to GitHub Packages as `@kstrzechowski/ai-toolkit`. On `npm install`, the package installs the skill and a short rules fragment into the consumer repo; on uninstall, it cleanly removes them.

## Current State Analysis

- `packages/` currently contains only `code-reviewer/` — an independent npm package with its own `package.json`/`tsconfig.json`/`.env`/`README.md`, no root `package.json`, matching this repo's documented "independent npm projects, no workspace linking" convention (`context/changes/ai-toolkit-package/research.md`).
- No `skills/code-review/SKILL.md`, no `ai-toolkit` package, no `.github/workflows/publish-ai-toolkit.yml`, and no `.npmrc` exist anywhere in the repo today.
- `.claude/skills/pack-init/SKILL.md` already generates a registry-agnostic package skeleton (`package.json`, `pack.yaml`, `install.js`, `uninstall.js`, `skills/`, `rules/`) — reusable here with two parameter overrides (scope, namespace). `.claude/skills/setup-cicd/SKILL.md` is AWS-OIDC-coupled end to end and is not used by this plan; the workflow is written directly from `.claude/prompts/m5l4-github-packages-spec-cicd.md`'s own starter YAML instead.
- This repo is a personal-account repo (`github.com/KStrzechowski/InkLingo`, no GitHub org) — the real npm scope is `@kstrzechowski`, replacing the course spec's placeholder `@twoj-zespol`.
- `packages/*` is entirely outside this repo's per-edit quality-gate hook (`scripts/quality/checks.mjs`'s `APPS` list only covers `frontend`, `extension`, `backend`, `infra`) — this package is fully self-contained for its own linting/testing, matching `packages/code-reviewer`'s existing pattern.

## Desired End State

`packages/ai-toolkit/` is a complete, plain-JavaScript npm package. `npm pack --dry-run` and `npm test` pass locally. `.github/workflows/publish-ai-toolkit.yml` validates every PR touching the package and publishes to GitHub Packages on push to `main`. When installed into any consumer repo, the package copies `skills/code-review/SKILL.md` into `.claude/skills/code-review/`, injects a rules fragment into `CLAUDE.md` between sentinel markers, and tracks what it installed in a manifest — idempotently, and without ever failing the consumer's `npm install`. Uninstalling reverses this cleanly.

Verified by: the automated checks in Phases 1–3, plus a real, gated live-verification phase (Phase 4) that actually publishes and reinstalls the package.

### Key Discoveries:

- `.claude/skills/pack-init/SKILL.md:40-97` — registry-agnostic skeleton generator; no CodeArtifact/AWS coupling in its actual output, only in its own description/context.
- `.claude/prompts/m5l4-github-packages-spec-pack.md` and `m5l4-github-packages-spec-cicd.md` — complete, concrete specs (exact `package.json` shape, exact starter workflow YAML) requiring only scope/path substitution, not redesign.
- `packages/code-reviewer/src/index.ts`'s `isDirectRun` guard pattern (export the real function, gate automatic execution behind a direct-run check) is the exact shape `install.js`/`uninstall.js` need for testability without child-process spawning.
- `.claude/CLAUDE.md:1,55` — a real, working sentinel-marker pair (`<!-- BEGIN @przeprogramowani/10x-cli --> ... <!-- END -->`) already in production in this repo, confirming the pattern the new installer's `CLAUDE.md` injection should mirror.
- `.github/workflows/{code-review,deploy,pr-diff}.yml` all pin `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0` and `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0` — reused verbatim rather than the course spec's unpinned `@v4` tags.
- GitHub's automatically-provided `GITHUB_TOKEN` can publish npm packages to GitHub Packages for the *same* repository once the workflow declares `permissions: packages: write` — no PAT or OIDC needed for the publish step itself (a PAT/`GH_PKG_TOKEN` is only needed for a separate repo installing the package, per the spec's own "Consumer CI note").

## What We're NOT Doing

- Not building a manual `bin/cli.js` install/uninstall command — lifecycle hooks (`postinstall`/`preuninstall`) only, per your decision.
- Not tailoring the shipped `code-review` skill's six categories to InkLingo's own enforced TypeScript rules — the generic course handout ships unmodified, since this package is meant to be installed into other consumer repos too, per your decision.
- Not bundling any of this repo's other 30 `.claude/skills/*` planning skills — just `code-review`, per the spec's own Required Files list.
- Not using AWS CodeArtifact, Terraform, OIDC, or any of `.claude/skills/{setup-cicd,tf-registry}` — confirmed via the course's own badge rules that neither 10xChampion nor the Module 5 badge require this lesson at all (both already satisfied by the archived M5L2/M5L3 pipeline work), so the lower-friction GitHub Packages path was chosen deliberately.
- Not adding a root `package.json` or any workspace tooling (npm workspaces, Turborepo) — `packages/ai-toolkit/` stays independent, matching this repo's existing convention.
- Not testing multi-consumer or cross-org installation scenarios in depth — Phase 4 verifies exactly one scratch consumer install/uninstall cycle.

## Implementation Approach

Four phases: (1) everything that can be authored and verified with zero registry interaction — the package skeleton and the skill content itself; (2) the installer/uninstaller logic and its own test suite, verified against real temp-directory filesystem state; (3) the CI workflow, verified via a real but non-publishing PR; (4) the actual, gated live publish and round-trip install/uninstall against the real GitHub Packages registry.

## Critical Implementation Details

**`install.js` must read `INIT_CWD`, not `process.cwd()`, to find the consumer's project root.** During a dependency's `postinstall`, npm sets `process.env.INIT_CWD` to the directory where `npm install` was originally invoked (the consumer's project root); `process.cwd()` at that point can be the package's own directory inside `node_modules` depending on npm version. Fall back to `process.cwd()` only if `INIT_CWD` is unset.

**A failed `install.js`/`uninstall.js` run must never fail the consumer's `npm install`/`npm uninstall`.** Both scripts' direct-run guard must wrap the entire installer/uninstaller call in try/catch, log any failure to `stderr`, and always exit `0` — a non-zero exit from a lifecycle script fails the consumer's own npm command.

**`uninstall.js` must be wired to `preuninstall`, not `postuninstall`.** npm runs `preuninstall` while the package's own files — including the manifest `uninstall.js` needs to read — are still present on disk; by `postuninstall`, npm has already removed the package directory.

**Addendum (discovered during Phase 2 manual verification, 2026-09-05): neither hook actually fires.** A real tarball install/uninstall round-trip against npm 11.16 confirmed `postinstall` runs correctly but `npm uninstall` never invokes `preuninstall` at all — the skill directory, `CLAUDE.md` block, and manifest were all left behind. npm's own current docs confirm this is not a local misconfiguration: **npm v7 removed uninstall lifecycle scripts entirely** ("Due to the lack of necessary context, `uninstall` lifecycle scripts are not implemented and will not function"). This applies to every npm version the package will ever run under. `uninstall.js` keeps its `preuninstall` wiring in `package.json` (harmless, and other package managers may still honor it) but consumers on npm must invoke it directly and manually, before running `npm uninstall`: `node node_modules/@kstrzechowski/ai-toolkit/uninstall.js && npm uninstall @kstrzechowski/ai-toolkit`. This doesn't require a `bin/cli.js` (the "What We're NOT Doing" decision against one still stands) — `uninstall.js`'s existing direct-run guard already makes it callable this way with zero new files. The README documents this. Phase 2's manual check 2.3 is revised accordingly.

## Phase 1: Package skeleton and skill authoring

### Overview

Everything that can be built and verified with zero registry interaction: the package identity files, the distributable `code-review` skill itself, and the rules fragment the installer will later inject.

### Changes Required:

#### 1. Package identity

**File**: `packages/ai-toolkit/package.json`

**Intent**: Declare the package's identity, GitHub Packages publish target, and lifecycle hooks.

**Contract**: `name: "@kstrzechowski/ai-toolkit"`, `version: "0.1.0"`, `description`, `license: "UNLICENSED"`, `type: "module"` (no `"private": true` — this package must actually publish), `publishConfig.registry: "https://npm.pkg.github.com"`, `files: ["skills/", "rules/", "install.js", "uninstall.js", "README.md"]`, `scripts: { postinstall: "node install.js", preuninstall: "node uninstall.js", test: "node --test" }`, `engines.node: ">=20"`.

#### 2. Package metadata

**File**: `packages/ai-toolkit/pack.yaml`

**Intent**: Lightweight package-identity metadata per `pack-init`'s own generated-skeleton convention; doubles as one of the "package definition" badge-evidence artifacts.

**Contract**: `name: ai-toolkit`, `version: 0.1.0`, `description`, `namespace: kstrzechowski` (namespace is the scope without the `@`, matching the scope-vs-namespace distinction already established for this course's registry conventions).

#### 3. Documentation

**File**: `packages/ai-toolkit/README.md`

**Intent**: Document the package for maintainers (local validation, how the live-publish gate works) and for consumers (install steps, required `.npmrc` registry mapping), mirroring `packages/code-reviewer/README.md`'s H1 + section structure.

**Contract**: H1 title + one-line description; `## For consumers` section with the install command and the exact `.npmrc` snippet consumers must add (`@kstrzechowski:registry=https://npm.pkg.github.com`, explicitly noting it must never contain a token), plus what installing adds to their repo (`.claude/skills/code-review/`, the `CLAUDE.md` sentinel block, the manifest file) and how to uninstall; `## For maintainers` section pointing at `context/changes/ai-toolkit-package/` and documenting the local `npm pack --dry-run` check.

#### 4. The distributable review skill

**File**: `packages/ai-toolkit/skills/code-review/SKILL.md`

**Intent**: Author the skill exactly per `.claude/prompts/m5l4-shared-spec-skill.md`, sourced from `m5l4-shared-conventions.md`'s six categories, left generic and unmodified — no InkLingo-specific rules folded in, since this ships into other consumer repos too.

**Contract**: Frontmatter limited to `name: code-review`, `description` (verbatim from the spec), `allowed-tools: [Read, Grep, Glob, Bash]` — matching this repo's own minimal-frontmatter convention (no extra fields beyond what `.claude/skills/10x-rule-review/SKILL.md` and `.claude/skills/10x-impl-review/SKILL.md` use). Body: the six categories (Naming, Error Handling, TypeScript, Function Design, Security, Testing) as checklists lifted directly from `m5l4-shared-conventions.md`'s own bullets. Output format section modeled on `10x-impl-review`'s severity-bucket + single-verdict contract: findings grouped Critical → Warning → Suggestion, each with a `file:line` reference when determinable, closing with exactly one of `APPROVE` / `REQUEST CHANGES` / `NEEDS DISCUSSION` — written as a locked "print exactly this" template, matching `10x-rule-review`'s convention for output determinism.

#### 5. Package-local gitignore (addendum, added during implementation)

**File**: `packages/ai-toolkit/.gitignore`

**Intent**: Ignore `node_modules/`, mirroring `packages/code-reviewer/.gitignore`'s existing convention — needed once Phase 2's `npm install`/`npm test` can produce a `node_modules/` directory. Not in the original Phase 1 file list; added per `impl-review-phase-1.md` F2.

**Contract**: Single line, `node_modules/`.

#### 6. The installed rules fragment

**File**: `packages/ai-toolkit/rules/CLAUDE.md`

**Intent**: The content `install.js` injects between sentinel markers into a consumer's `CLAUDE.md` — a short pointer to the skill's existence and trigger phrases, not a restatement of the full conventions (those live in the skill itself).

**Contract**: Plain markdown, no frontmatter (this is an injected fragment, not a skill file), one H2 heading naming the `code-review` skill and its trigger phrases ("review code", "check this PR", "review my changes", "code review"). `install.js` wraps this content with `<!-- BEGIN @kstrzechowski/ai-toolkit -->` / `<!-- END @kstrzechowski/ai-toolkit -->` when injecting it — the markers themselves are not part of this file.

### Success Criteria:

#### Automated Verification:

- `npm pack --dry-run` succeeds in `packages/ai-toolkit/`
- `package.json` parses as valid JSON
- `pack.yaml` exists
- `skills/code-review/SKILL.md` has valid YAML frontmatter containing `name` and `description`, and `name` matches the skill's directory name (`code-review`)

#### Manual Verification:

- `skills/code-review/SKILL.md`'s six categories and output contract faithfully match `m5l4-shared-spec-skill.md` and `m5l4-shared-conventions.md`, with no InkLingo-specific substitutions

---

## Phase 2: Installer, uninstaller, and their tests

### Overview

The installer/uninstaller logic itself — idempotent, manifest-tracked, and never fatal to the consumer's own npm commands — plus a `node:test` suite exercising it against real temp-directory filesystem state (no existing repo precedent for this kind of script, so this phase establishes it).

### Changes Required:

#### 1. Installer

**File**: `packages/ai-toolkit/install.js`

**Intent**: Idempotently copy the skill and inject the rules fragment into a consumer project when this package is added as a dependency, without ever failing the consumer's `npm install`.

**Contract**: Exports a named `install(consumerRoot)` function implementing the documented installer behavior — copy `skills/code-review/` to `<consumerRoot>/.claude/skills/code-review/`; upsert the sentinel-marked block in `<consumerRoot>/CLAUDE.md` (creating the file if absent) using `rules/CLAUDE.md`'s content; write `<consumerRoot>/.claude/.ai-toolkit-manifest.json` with `{ version, installedFiles }` — plus a direct-run guard (mirroring `packages/code-reviewer/src/index.ts`'s `isDirectRun` pattern) that calls `install(process.env.INIT_CWD ?? process.cwd())` inside a try/catch that logs failures to `stderr` and always exits `0` (see Critical Implementation Details). Re-running must update the managed block and manifest in place, never duplicate them.

#### 2. Uninstaller

**File**: `packages/ai-toolkit/uninstall.js`

**Intent**: Reverse `install.js` cleanly using the manifest as the source of truth, not path-guessing.

**Contract**: Exports `uninstall(consumerRoot)` reading `<consumerRoot>/.claude/.ai-toolkit-manifest.json`, removing every path it lists, stripping the sentinel-marked block from `CLAUDE.md` (leaving the rest of the file untouched), and deleting the manifest itself. Same direct-run-guard + try/catch/always-exit-0 contract as `install.js`, wired to the `preuninstall` lifecycle hook (see Critical Implementation Details for why not `postuninstall`).

#### 3. Installer test suite

**File**: `packages/ai-toolkit/test/install.test.js`

**Intent**: Cover the installer/uninstaller's real filesystem behavior end to end, calling the exported functions directly rather than spawning child processes or faking `INIT_CWD`.

**Contract**: `node:test` cases, each using a fresh `node:fs.mkdtempSync` temp directory as the `consumerRoot`: (a) a first `install()` call creates the skill directory, the sentinel block, and the manifest; (b) a second `install()` call on the same root updates the block and manifest in place without duplicating them; (c) `install()` against a `CLAUDE.md` that already has unrelated content leaves that content untouched outside the sentinel markers; (d) `uninstall()` removes exactly what the manifest recorded and leaves `CLAUDE.md` with no trace of the sentinel block; (e) a call that hits a filesystem error (e.g., a read-only target) exits cleanly without throwing.

### Success Criteria:

#### Automated Verification:

- `npm test` passes in `packages/ai-toolkit/` (the full `install.test.js` suite)
- `npm pack --dry-run` still succeeds and its file list excludes `test/`

#### Manual Verification:

- A real `npm pack` tarball, installed into a scratch local directory outside any `node_modules`, actually triggers `postinstall` (skill copied, `CLAUDE.md` sentinel block created, manifest written) when installed — the `node:test` suite exercises the exported functions directly and cannot verify that npm's real lifecycle-hook wiring fires them correctly.
- ~~`npm uninstall` actually triggers `preuninstall`~~ — **superseded**: confirmed via a real round-trip that npm v7+ never invokes uninstall lifecycle scripts at all (see Critical Implementation Details addendum). Verify instead: `node node_modules/@kstrzechowski/ai-toolkit/uninstall.js` run manually, followed by `npm uninstall @kstrzechowski/ai-toolkit`, cleanly removes the skill directory, the `CLAUDE.md` sentinel block, and the manifest.

---

## Phase 3: GitHub Actions workflow

### Overview

The CI workflow that validates every change to the package and publishes it to GitHub Packages on push to `main` — no AWS, no OIDC, no CodeArtifact.

### Changes Required:

#### 1. Publish workflow

**File**: `.github/workflows/publish-ai-toolkit.yml`

**Intent**: Validate the package on every PR/push touching it, and publish on push to `main`, following this repo's existing SHA-pinned-action house style rather than the course spec's unpinned example.

**Contract**: `on: push` and `on: pull_request`, both filtered to `branches: [main]` and `paths: ['packages/ai-toolkit/**']` (a deliberate deviation from this repo's other 3 workflows, which use no path filtering — justified because this workflow does a real `npm publish` on push, unlike the label-gated or whole-app-deploy workflows already in the repo). `permissions: contents: read, packages: write`. Two jobs: `validate` (checkout, `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0` with `registry-url: https://npm.pkg.github.com`, `scope: '@kstrzechowski'`, `node-version: 20`, `working-directory: packages/ai-toolkit` on every `run:` step, then `npm ci`, `npm pack --dry-run`, and the frontmatter/name-match checks from the spec's validation list as an inline script) and `publish` (`needs: validate`, `if: github.event_name == 'push'`, same checkout/setup-node steps, `npm ci`, `npm publish` with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` — no `AWS_ACCOUNT_ID`, `AWS_ROLE_ARN`, or `id-token: write`). Both jobs use `actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0`.

#### 2. Package-lock (addendum, added during implementation)

**File**: `packages/ai-toolkit/package-lock.json`

**Intent**: The `validate`/`publish` jobs both run `npm ci`, which requires a committed lockfile (errors otherwise) — matches this repo's existing convention (`backend/`, `frontend/`, `packages/code-reviewer/` all commit their own `package-lock.json`). Discovered missing when writing Phase 3's workflow.

**Contract**: Generated via `npm install` in `packages/ai-toolkit/`; trivial (zero dependencies), but required for `npm ci` to run at all.

#### 3. Self-install guard (addendum, added during implementation)

**Files**: `packages/ai-toolkit/install.js`, `packages/ai-toolkit/test/install.test.js`, `packages/ai-toolkit/.gitignore`

**Intent**: Discovered while generating the Phase 3 lockfile: running `npm install`/`npm ci` *inside* `packages/ai-toolkit/` itself (exactly what the CI workflow's `validate`/`publish` jobs do, and what a maintainer does for local dev) fires `postinstall` with `consumerRoot` resolving to the package's own directory — self-installing `.claude/skills/code-review/` and `CLAUDE.md` into the package. Reproduced locally: a plain `npm install` in `packages/ai-toolkit/` created both.

**Contract**: `install()` no-ops when `resolve(consumerRoot) === resolve(PACKAGE_ROOT)`. Covered by a new test case. `.gitignore` gets anchored (`/.claude/`, `/CLAUDE.md`) backstop patterns — anchored so they don't also match the tracked `rules/CLAUDE.md`.

### Success Criteria:

#### Automated Verification:

- `npm pack --dry-run` still succeeds in `packages/ai-toolkit/` (no regression from workflow changes)

#### Manual Verification:

- A PR touching `packages/ai-toolkit/**` triggers the `validate` job (confirming the `paths:` filter actually scopes correctly) and it passes, while the `publish` job does not run (event is `pull_request`, not `push`) — this check makes no registry calls and needs no live-publish go-ahead

---

## Phase 4: Live verification

### Overview

The actual, real-money-adjacent step: publishing the package for real and confirming a genuine consumer can install and remove it. Cannot be automated — this is by design a real interaction with GitHub's registry.

### Changes Required:

None — this phase runs what Phases 1–3 built. No new files.

### Success Criteria:

#### Automated Verification:

- None applicable — a real registry publish cannot be automated by this plan.

#### Manual Verification:

- **BLOCKED pending explicit user go-ahead** — this pushes a real commit to `main`, which triggers the `publish` job and publishes a real, account-visible package to GitHub Packages. Do not start until you give the go-ahead.
- Push/merge to `main` with `packages/ai-toolkit/package.json` at `0.1.0`; confirm the `publish` job runs successfully and the package appears in the repo's/account's GitHub Packages listing.
- In a scratch directory outside this repo, configure `.npmrc` per the README's documented snippet, authenticate (a PAT with `read:packages`, or `gh auth token` piped into a local `.npmrc` — same-repo `GITHUB_TOKEN` auth from Phase 3 does not apply to an external consumer), run `npm install @kstrzechowski/ai-toolkit`, and confirm `.claude/skills/code-review/SKILL.md`, the `CLAUDE.md` sentinel block, and `.claude/.ai-toolkit-manifest.json` all appear correctly.
- Run `npm uninstall @kstrzechowski/ai-toolkit` in that same scratch directory and confirm clean removal (no sentinel block, no manifest, no skill directory).
- Capture the three badge-evidence categories named by the course note: (1) the repository/registry showing the publish flow (the Actions run plus the Packages tab listing), (2) the package definition (`package.json`/`pack.yaml`), (3) the list of released versions.
- Record what actually happened (any surprises, the real registry URL, version history) in `change.md`'s Notes.

**Implementation Note**: After Phase 3's automated and manual verification are both confirmed complete, pause here for your explicit go-ahead before pushing to `main` and triggering a real publish.

---

## Testing Strategy

### Unit Tests:

- `install.js`/`uninstall.js`: `node:test` against real temp-directory filesystem state — idempotency, sentinel-block correctness, manifest correctness, and graceful failure handling. See Phase 2.

### Integration Tests:

- None automated — the real npm-lifecycle-hook wiring (Phase 2's manual check) and the real GitHub Packages publish/install round-trip (Phase 4) are this plan's own integration tests, verified manually by design (consistent with this repo's "no automatic real-money/real-registry operations" posture).

### Manual Testing Steps:

1. Install a real `npm pack` tarball into a scratch directory and confirm `postinstall` fires correctly (Phase 2).
2. Uninstall it and confirm `preuninstall` fires correctly (Phase 2).
3. Open a PR touching `packages/ai-toolkit/**` and confirm the `validate` job runs and passes, without triggering `publish` (Phase 3).
4. Push to `main` and confirm the real publish succeeds (Phase 4, gated).
5. Install the real published package into a separate scratch consumer directory and confirm correct behavior, then uninstall (Phase 4, gated).
6. Capture the three badge-evidence artifacts (Phase 4, gated).

## Performance Considerations

None — this is lightweight tooling (file copies, a JSON manifest, a markdown-block upsert) with no runtime performance surface.

## Migration Notes

None — net-new package, net-new workflow, no existing behavior changed.

## References

- Research: `context/changes/ai-toolkit-package/research.md`
- Source specs: `.claude/prompts/m5l4-shared-conventions.md`, `m5l4-shared-spec-skill.md`, `m5l4-github-packages-spec-pack.md`, `m5l4-github-packages-spec-cicd.md`
- Reused skeleton generator: `.claude/skills/pack-init/SKILL.md`
- Skill output-contract precedents: `.claude/skills/10x-rule-review/SKILL.md`, `.claude/skills/10x-impl-review/SKILL.md`
- Sibling-package convention: `packages/code-reviewer/package.json`, `packages/code-reviewer/README.md`, `packages/code-reviewer/src/index.ts` (the `isDirectRun` pattern)
- Sentinel-marker precedent: `.claude/CLAUDE.md:1,55`
- Pinned-action precedent: `.github/workflows/{code-review,deploy,pr-diff}.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Package skeleton and skill authoring

#### Automated

- [x] 1.1 `npm pack --dry-run` succeeds in `packages/ai-toolkit/` — 407386e
- [x] 1.2 `package.json` parses as valid JSON — 407386e
- [x] 1.3 `pack.yaml` exists — 407386e
- [x] 1.4 `skills/code-review/SKILL.md` has valid frontmatter (`name`/`description`) and `name` matches the directory name — 407386e

#### Manual

- [x] 1.5 `skills/code-review/SKILL.md`'s categories and output contract faithfully match the specs, no InkLingo-specific substitutions — 407386e

### Phase 2: Installer, uninstaller, and their tests

#### Automated

- [x] 2.1 `npm test` passes in `packages/ai-toolkit/` — c2a0a3d
- [x] 2.2 `npm pack --dry-run` still succeeds and excludes `test/` — c2a0a3d

#### Manual

- [x] 2.3 A real tarball install triggers `postinstall` correctly outside `node_modules`; manual `node .../uninstall.js` + `npm uninstall` cleanly removes everything (see Critical Implementation Details addendum — `preuninstall` itself never fires under npm v7+) — c2a0a3d

### Phase 3: GitHub Actions workflow

#### Automated

- [x] 3.1 `npm pack --dry-run` still succeeds

#### Manual

- [ ] 3.2 A PR touching `packages/ai-toolkit/**` triggers `validate` (not `publish`) and it passes

### Phase 4: Live verification

#### Manual

- [ ] 4.1 Explicit go-ahead given to push to `main` and trigger a real publish
- [ ] 4.2 Real publish succeeds; package appears in GitHub Packages
- [ ] 4.3 Scratch consumer install/uninstall round-trip verified
- [ ] 4.4 Three badge-evidence artifacts captured
