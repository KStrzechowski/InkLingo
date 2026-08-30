# Opportunity Map

## Context

- **Project / context**: InkLingo — Module 5 (10xdevs3), scoping the first "team agent" candidate
- **Data constraint**: Mock / local / read-only / non-sensitive (recommended default)
- **Date**: 2026-08-30

## Map

| Signal | Existing / default response | Thin complement | First useful version | Data risk | Direction if valuable |
|---|---|---|---|---|---|
| A. Jira ↔ roadmap/git drift (both work and InkLingo, InkLingo-scoped here) | Manual Jira updates; commit messages sometimes reference ticket keys | Read-only digest joining git/PR history against Jira ticket state, flags drift | Script/agent: given repo + date range, pull commits/PRs, match against Jira keys, output drift report | Real Jira data, read-only against own tickets — low stakes | Team agent (later maybe a Review/CI gate) |
| B. Issues surface late, rework costly | `/10x-plan-review`, `/10x-frame`, `/10x-impl-review`, `lessons.md` already exist for this | Retrospective lesson-miner over `fix:` commits + impl-reviews not yet captured in lessons.md | Local script over this repo's own git history + `context/changes/*/reviews` | Local/non-sensitive | Mostly wait — largely solved already |
| C. Review-prep gathering (Jira + Confluence, work context) | Fully manual copy-paste across Jira and Confluence | One formatted block combining Jira ticket + linked Confluence docs, given a branch/PR | Read-only script/agent using the live Jira+Confluence connection | Real company data, read-only against own assigned tickets | Team agent — but no InkLingo analog (solo project, no review flow) to build/test against here |
| D. Course-progress tracking is scattered | `.10x-cli-manifest.json` (skill-sync state) vs. `context/` artifacts vs. `git log` — no single source of truth | Reconciler comparing manifest "applied" lessons against actual context/ artifacts + commits | Local script/agent producing a completion-state report | Local/non-sensitive | One-off — usefulness expires when the course does |
| E. Change-history/milestone synthesis is manual, repeats every close | Hand-written rollups (e.g. `context/architect-report.md`) across `context/archive/`, `context/domain/`, `context/changes/` | LLM-driven synthesizer reading those local docs and producing a milestone rollup | Agent that reads `context/archive/`, `context/domain/`, `context/changes/` and git log, produces a summary report on demand | Local/non-sensitive | Team agent — durable, useful at every future change close |
| F. Code review only happens on-demand, never automatically, and isn't team-shareable | `/code-review`, `/security-review` skills already exist in this Claude Code setup, but only run when manually invoked per diff/PR | A CI-triggered reviewer using the same review criteria, so it runs on every PR without anyone remembering to ask | GitHub Actions workflow that runs a code-review agent on each PR, posts findings as a comment + pass/fail label | Local (diff/PR content only); no external data | Team agent — and unlike the others, transferable to the user's day job, not just InkLingo |

## Recommended First Candidate

```text
Candidate:
project-state agent

Reads:
- context/archive/, context/domain/, context/changes/ (local docs)
- git log/diff (local)
- Jira issues via the Atlassian connection (read-only)

Returns:
Two modes on one backbone:
  (a) Rollup: synthesize a milestone/change summary (like architect-report.md) from local docs — on demand.
  (b) Drift check: cross-reference context/foundation/roadmap.md + recent git activity against live Jira ticket state, flag mismatches.

Does not do:
- Write/update Jira (no mutation) — natural v2 once this proves useful
- Pull in Confluence or work-context review-prep (Signal C) — different context, not buildable/testable here
- Review chat-produced code diffs — a distinct capability, not this agent's job yet

Data risk:
Local docs: none. Jira: real data, read-only against own project — low stakes.

Direction if it proves valuable:
Team agent now. If it earns regular use, extend to (1) draft — not auto-apply — Jira updates for approval, and (2) a Confluence-reading variant for the work-context review-prep pain (Signal C), as a second, separate tool sharing the same backbone.
```

## Why This Candidate

Signal E (change-history synthesis) and Signal A (Jira/roadmap drift), both InkLingo-scoped, share the same underlying shape — "assemble the true state of the project from scattered sources" — so they merge into one coherent agent rather than two competing candidates. Both are fully local-or-read-only, both have demonstrated manual pain (the hand-written `architect-report.md`, and the manually maintained IL-1..IL-23 roadmap↔Jira mapping), and unlike a deterministic drift-checker alone, the rollup half genuinely needs LLM synthesis across prose documents — a good fit for the Module 5 ai-sdk/tool-loop agent lesson.

Signal C (review-prep gathering) was set aside despite genuine appeal — it surfaces a real work-context pain (Jira + Confluence gathering, plus a "make my Jira reflect reality" and "help me review chat-produced code" instinct) — because it has no InkLingo analog to build and test against (solo project, no review flow), and the write-to-Jira / code-review scope it implies would be a second, larger agent, not a first useful version. It is preserved above as the natural v2 direction once the read-only project-state agent proves itself. Signal B is mostly already solved by existing skills. Signal D's usefulness is tied to the course itself and would not outlive certification.

## Next Direction If Valuable

Validate first via `/10x-mom-test` (pressure-test the "manual synthesis + manual drift-checking is real pain" claim against actual past behavior — the hand-written architect-report.md and the maintained Jira↔roadmap mapping are the concrete instances to interrogate). If it survives, proceed to `/10x-shape` → `/10x-prd` → `/10x-roadmap` to scope the agent properly before any implementation.

## Final Decision (2026-08-30, post-validation)

`/10x-mom-test` (see `context/team/mom-test-validation.md`) narrowed the merged A+E candidate: Signal E (rollup synthesis) lacked demonstrated recurring pain and was dropped; Signal A (Jira/roadmap drift) held up on real evidence and was kept, reshaped around automatic rather than on-demand execution.

Before scaffolding anything, Module 5's own curriculum (m5l2 through m5l5) turned out to prescribe a fixed deliverable — a code-review agent, wired into CI, then packaged for distribution — rather than leaving the target open. Signal F (added above) captures that pain directly, and it independently clears the same bar the Mom Test applied to Signal A: it has a real existing workaround (`/code-review`, invoked manually today), the same "should run automatically, not on request" shape that surfaced as the actual unmet need in the Mom Test interview, and — unlike every other signal here — it is transferable to the user's day job, not just to this solo project.

**The build proceeds on Signal F (code-review agent)** as the concrete Module 5 deliverable. Signals A/D/E/C remain documented above as evidence of the classification method applied honestly to real friction, not retrofitted to justify a predetermined answer — Signal F was reached independently and happens to be reinforced by the same pattern the Mom Test already found.
