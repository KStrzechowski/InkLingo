# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project layout

InkLingo is a decoupled multi-app project — `frontend/`, `backend/`, `extension/` (Firefox add-on) and `infra/` (AWS CDK) are independent npm projects with no workspace linking and no root `package.json`. Install and run each separately.

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

### Extension (`extension/`, Firefox MV3 + Vite + React + TypeScript)

- `npm install`
- `npm run build` — `tsc -b && vite build`, output in `dist/` (load `dist/manifest.json` via `about:debugging`)
- `npm run dev` — `vite build --watch` against `.env.development` (local backend)
- `npm run lint` — oxlint
- See `extension/README.md` for the pinned add-on ID ↔ Cognito callback URL coupling.

## Architecture

- **Backend**: routes and plugins are autoloaded from `src/routes/` and `src/plugins/` via `@fastify/autoload`, wired in `src/app.ts` — add an endpoint by dropping a new file/folder under `src/routes/`, no manual registration needed. `src/plugins/` is for cross-cutting concerns (decorators, hooks) shared across all routes. Tests build a full app instance per file via `test/helper.ts`'s `build(t)` helper (`fastify-cli/helper.js`), tearing it down in `t.after`.
- **Extension**: Vite builds two entry points — `src/background.ts` (event page) and `popup.html` → `src/popup/`. Every backend call runs in the background script so it goes out under `host_permissions` and skips page-level CORS; the popup reaches it via `browser.runtime.sendMessage` with the contract in `extension/src/messages.ts`.
- The apps talk over plain HTTP; there is no shared-types package or RPC layer between them, so response shapes are duplicated per client (`frontend/src/api/collections.ts`, `extension/src/types.ts`).
- Target deployment is containerized, self-hosted on AWS/GCP, with Postgres as the intended datastore — neither is wired up in either app yet.

## The `context/` directory

This repo is driven by the 10xDevs AI Toolkit workflow (see the managed block above). Two things worth knowing without re-reading that whole block:

- `context/foundation/` holds living docs — `prd.md`, `shape-notes.md`, `tech-stack.md` (the stack decision plus rationale; read it before suggesting a different framework or datastore).
- `context/archive/2026-07-18-bootstrap-verification/` holds one audit log per app: `verification-backend.md` (Fastify, scaffolded via `/10x-bootstrapper`) and `verification-frontend.md` (Vite+React, scaffolded manually — the registry-driven bootstrapper explicitly excludes it; see that file's "Why this stack" section for why).
- Don't hand-edit inside the `<!-- BEGIN/END @przeprogramowani/10x-cli -->` markers in this file or in `.claude/CLAUDE.md` — the CLI tool regenerates that block as course lessons progress.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 2, Lesson 5

Scale the single-change cycle into parallel work with **worktrees, goal-directed delegation, and multi-session orchestration**:

```
worktree per change -> /goal or claude -p -> PR -> review -> merge
```

The lesson focus is safe throughput: isolated contexts, choosing the right execution mode, and capping parallelism at review capacity.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code isolation** | |
| `git worktree add` | You need a separate working directory for a parallel change. One change per worktree, one fresh agent context per worktree. |
| **Complex changes** | |
| `/10x-implement <change-id> phase <n>` | The change has multiple phases, needs manual gates, or benefits from interactive decision-making during execution. |
| **Simple changes** | |
| `/goal` | You have a clear, bounded task and want goal-directed delegation. The agent works autonomously toward the stated goal with a stop condition. |
| `claude -p` | You want headless execution for a well-defined task. The Ralph Wiggum loop (run, check, retry) is the universal autonomous pattern. |
| **Multi-session orchestration** | |
| Superset / Conductor / Antigravity / VS Code Agent View | You are running multiple agent sessions in parallel and need visibility, coordination, or session management across them. |

### Parallel work rules

- One change per worktree or isolated workspace. One fresh agent context per change.
- Choose interactive `/10x-implement` for complex changes, `/goal` or `claude -p` for simple ones.
- Parallelism is capped by review capacity. More agents without review means more unreviewed code, not higher throughput.
- The quality pain from faster shipping is intentional — it bridges into Module 3 testing gates.

### Lesson boundaries

- Do not reteach interactive `/10x-implement` or `/10x-impl-review`; those are Lessons 2 and 3.
- Do not introduce testing strategy here. The quality pain is the motivation for Module 3.
- Worktrees are a mechanism for isolation, not the topic of a full git tutorial.

### Paths used by this lesson

- `context/changes/<change-id>/` - active change folder
- `context/changes/<change-id>/plan.md` - implementation input for any execution mode

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
