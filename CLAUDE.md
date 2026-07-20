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
- Single test file: `npm run build:ts && tsc -p test/tsconfig.json && FASTIFY_AUTOLOAD_TYPESCRIPT=1 node --test --experimental-test-coverage --loader ts-node/esm test/routes/root.test.ts`

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

## 10xDevs AI Toolkit - Module 2, Lesson 2

Turn one roadmap item into the first implementation cycle with the **change planning chain**:

```
/10x-roadmap -> /10x-new -> /10x-plan -> /10x-plan-review -> /10x-implement
```

`/10x-new`, `/10x-plan`, `/10x-plan-review`, and `/10x-implement` are the lesson focus. `/10x-frame` and `/10x-research` are not required rituals here; they are escalation paths introduced in the next lesson.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Change setup (lesson focus)** | |
| `/10x-new <change-id>` | You selected a roadmap item and need a stable change folder. Creates `context/changes/<change-id>/change.md` so planning, implementation, progress, commits, and later review all share one identity. Use AFTER roadmap selection, BEFORE `/10x-plan`. |
| **Planning (lesson focus)** | |
| `/10x-plan <change-id>` | You have a change folder and need a reviewable implementation plan. Reads roadmap context, foundation docs, codebase evidence, and any existing change notes; writes `plan.md` and `plan-brief.md` with phases, file contracts, success criteria, and `## Progress`. |
| **Plan readiness (lesson focus)** | |
| `/10x-plan-review <change-id>` | You have `plan.md` and need a light pre-code readiness check. Use it to catch missing end state, weak contracts, malformed progress, scope drift, or blind spots before code changes begin. |
| **Implementation (lesson focus)** | |
| `/10x-implement <change-id> phase <n>` | You have an approved plan and want to execute one phase with verification, manual gate, commit ritual, and SHA write-back to `## Progress`. |
| **Lifecycle closure** | |
| `/10x-archive <change-id>` | A change is merged or intentionally closed. Move it out of active `context/changes/` into archive state. |

### How the chain hands off

- `/10x-new` creates the durable change identity.
- `/10x-plan` turns that identity into an implementation contract.
- `/10x-plan-review` checks the plan before the agent mutates code.
- `/10x-implement` executes one planned phase, verifies, asks for manual confirmation when needed, commits, and records progress.

### Lesson boundaries

- Plan is the default router after roadmap selection. Start with `/10x-plan` unless the problem is unclear or external evidence is blocking.
- Do not run `/10x-frame + /10x-research` as ceremony for every change.
- Do not turn this lesson into a full end-to-end product build. A checkpoint with a planned and partially or fully implemented stream is valid.
- Code review of the implemented diff belongs to Lesson 3 via `/10x-impl-review`.
- Lifecycle closure via `/10x-archive` after a change is merged or intentionally closed.

### Paths used by this lesson

- `context/foundation/roadmap.md` - upstream roadmap
- `context/changes/<change-id>/change.md` - change identity
- `context/changes/<change-id>/plan.md` - implementation contract
- `context/changes/<change-id>/plan-brief.md` - compressed handoff
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
