# Mom Test Validation Plan

## Input Idea

Candidate from `context/team/opportunity-map.md`: a "project-state agent" merging Signal E (change-history/milestone rollup synthesis) and Signal A (Jira ↔ roadmap/git drift detection), both InkLingo-scoped.

## Hypotheses

- **User/role**: sole builder of InkLingo, also completing 10xDevs certification (Builder + Architect + Champion badges). No separate external customer exists for this internal tool — the builder is the only user.
- **Friction**: (a) manual milestone-rollup synthesis across `context/` docs at each change close; (b) the Jira board (IL-1..IL-23) drifting from the actual roadmap/work state.
- **Current workaround**: (a) ad hoc requests to Claude Code in a chat session (as happened for `context/architect-report.md`); (b) a manually maintained roadmap↔Jira mapping, with no automatic drift detection.
- **Risky assumptions**: that (a) is recurring/costly enough to justify a dedicated agent; that a standing agent beats "just ask Claude Code" for (a); that continuous/automatic generation (rather than on-demand) is what's actually wanted.
- **Evidence already present**: a confirmed real instance of Jira drift (stale statuses, other state out of sync); near-zero prior instances of manual rollup work — `architect-report.md` was close to a first occurrence, not a repeat.

## Critique

Since this is an internal tool for a solo project, there is no separate customer to interview — this is a builder validating their own idea, which carries a specific risk: Module 5's certification requirement ("build a team agent") creates pressure to invent a problem to justify the artifact, rather than the problem existing independently of the requirement. The test applied was whether the pain predates the lesson needing an agent, not whether an agent sounds useful in the abstract.

A second risk: an existing, working alternative was demonstrated in the same conversation — asking Claude Code, ad hoc, to produce `architect-report.md`. Any dedicated agent has to name what it adds over that baseline (determinism, running without a chat session, a fixed output format, scheduling/CI) or the honest conclusion is "don't build it."

## Interview (conducted live, single respondent — the builder)

No separate interview guide or survey was produced — with one respondent who is also the builder, a scripted multi-person guide would be theater. The three questions below were asked directly, live, and are recorded verbatim.

**Q1.** Before today, when's the last time you manually pulled together a project rollup/status like `architect-report.md`?
**A1.** "Not really — did it a lot alone." *(read as: this had not happened much/at all before today)*
→ Weak/no recurring pain for the rollup-synthesis half (Signal E).

**Q2.** Has the Jira↔roadmap mapping actually drifted out of sync at some point — a specific time you caught a mismatch — and what did it cost you?
**A2.** "Yes, e.g. Jira wasn't even updated regarding statuses and also everything else."
→ Confirmed real, concrete drift — not hypothetical.

**Q3.** Today's `architect-report.md` got made by asking Claude Code in a chat. What would a standing agent need to do that asking-in-chat doesn't already give you?
**A3.** "Not sure — I thought I'd have some reports created immediately when I work, and I wouldn't need to ask you to go through all changes, I'd just have them."
→ The differentiator isn't synthesis quality (chat already handles that) — it's automatic/continuous generation vs. on-demand requests.

## Findings

- Signal E (rollup synthesis) does not clear the bar: the pain is not demonstrated as recurring, and the existing workaround (ask Claude Code) already handled it adequately in the same conversation. **Do not build yet.**
- Signal A (Jira/roadmap drift) clears the bar: a concrete, recalled incident of real cost was named, unprompted, without hedging. **Proceed, but narrowed.**
- The actual unmet need (from A3) is not "a smarter synthesizer" but "something that runs without being asked" — an automation/trigger problem (post-commit hook, scheduled check, CI step), not a chat-invoked-agent problem. This reshapes the *solution*, not just the *scope*.

## Decision Criteria

- **Proceed** if: a real, recalled instance of cost exists (not a hypothetical) — met for Jira/roadmap drift (Signal A).
- **Narrow scope** if: only part of the original candidate has real evidence — true; the rollup-synthesis half (Signal E) was dropped.
- **Do not build yet** if: the existing workaround already works and no differentiator exists — true for on-demand rollups (chat already does this).
- **Try existing tool/process first** if: n/a for drift detection — nothing today checks Jira-vs-roadmap-vs-git drift automatically.

## Verdict at time of this test

Narrow scope, then proceed on Signal A (Jira/roadmap drift-detector), reshaped around automatic execution rather than an on-demand chat agent.

## Post-verdict update (2026-08-30) — why the actual build target changed anyway

Before scaffolding the drift-detector, reading the fixed Module 5 curriculum (`m5l2` through `m5l5`) showed the later lessons prescribe a specific deliverable — a code-review agent, wired into CI, then packaged for team distribution — rather than leaving the target open to whatever Signal A validated. This is disclosed plainly rather than silently swapped in: **the code-review agent (Signal F in the opportunity map) was not chosen because it failed on its own merits** — it independently clears the same Mom Test bar applied above (a real existing manual workaround — `/code-review`, invoked only on request today — and the identical "should run automatically, not on-demand" shape that A3 surfaced). It was chosen because Module 5's own requirements fix it as the deliverable, and it happens to satisfy the same validation criteria this test applied, plus a benefit none of the other signals had: transferability to the user's day job, not just to InkLingo.

The Jira/roadmap drift-detector (Signal A) remains a validated, unbuilt opportunity — worth returning to independent of certification, since its evidence (Q2) is as strong as anything found here.
