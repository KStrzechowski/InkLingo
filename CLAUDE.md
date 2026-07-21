# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project layout

InkLingo is a decoupled two-app project — `frontend/` and `backend/` are independent npm projects with no workspace linking and no root `package.json`. Install and run each separately.

## Commands

### Backend (`backend/`, Fastify + TypeScript)

- `npm install`
- `npm run dev` — start with hot reload (`fastify start -l info src/app.ts`)
- `npm run build:ts` / `npm run watch:ts` — compile to `dist/`
- `npm start` — build then run the compiled `dist/app.js`
- `npm test` — compiles, then runs `node --test` with coverage over `test/**/*.ts`
- Single test file: `npm run build:ts && tsc -p test/tsconfig.json && cross-env FASTIFY_AUTOLOAD_TYPESCRIPT=1 node --import ./test/register-loader.mjs --test --experimental-test-coverage test/routes/root.test.ts`

### Frontend (`frontend/`, Vite + React + TypeScript)

- `npm install`
- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build`
- `npm run lint` — oxlint (not eslint)
- `npm run preview` — preview the production build

## Architecture

- **Backend**: routes and plugins are autoloaded from `src/routes/` and `src/plugins/` via `@fastify/autoload`, wired in `src/app.ts` — add an endpoint by dropping a new file/folder under `src/routes/`, no manual registration needed. `src/plugins/` is for cross-cutting concerns (decorators, hooks) shared across all routes. Tests build a full app instance per file via `test/helper.ts`'s `build(t)` helper (`fastify-cli/helper.js`), tearing it down in `t.after`.
- The two apps talk over plain HTTP; there is no shared-types package or RPC layer between them.
- Target deployment is containerized, self-hosted on AWS/GCP, with Postgres as the intended datastore — neither is wired up in either app yet.

## The `context/` directory

This repo is driven by the 10xDevs AI Toolkit workflow (see the managed block above). Two things worth knowing without re-reading that whole block:

- `context/foundation/` holds living docs — `prd.md`, `shape-notes.md`, `tech-stack.md` (the stack decision plus rationale; read it before suggesting a different framework or datastore).
- `context/changes/bootstrap-verification/` holds one audit log per app: `verification-backend.md` (Fastify, scaffolded via `/10x-bootstrapper`) and `verification-frontend.md` (Vite+React, scaffolded manually — the registry-driven bootstrapper explicitly excludes it; see that file's "Why this stack" section for why).
- Don't hand-edit inside the `<!-- BEGIN/END @przeprogramowani/10x-cli -->` markers in this file or in `.claude/CLAUDE.md` — the CLI tool regenerates that block as course lessons progress.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
