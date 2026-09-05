---
change_id: ai-toolkit-package
title: Package the AI toolkit for GitHub Packages distribution (Module 5, Lesson 4)
status: archived
created: 2026-09-04
updated: 2026-09-05
archived_at: 2026-09-05T10:13:31Z
---

## Notes

Module 5 Lesson 4 ("Zadanie 2"), Model 1 path: package the team's AI artifacts
(skills, rules, installer logic) into a distributable npm package
(`@twoj-zespol/ai-toolkit`) and publish it via GitHub Packages + a GitHub
Actions workflow — no AWS/Terraform.

Decided against Model 2 (AWS CodeArtifact + Terraform): confirmed via the
10xDevs course's own badge rules that neither 10xChampion nor the Module 5
badge require this lesson at all — both are already satisfied by the
M5L2 (`tool-loop-agent`) + M5L3 (`ci-cd-code-review`, `code-review-evals`)
pipeline work, already archived. Doing L4 is optional practice ("Innovate"
extension), so we're taking the lower-friction path: no new IaC tool, no
AWS re-auth, no IAM role to design from scratch.

Source specs (read fully before planning):
- `.claude/prompts/m5l4-shared-conventions.md` — starter engineering conventions handout
- `.claude/prompts/m5l4-shared-spec-skill.md` — generate the `code-review` Agent Skill from that handout
- `.claude/prompts/m5l4-github-packages-spec-pack.md` — package metadata (`@twoj-zespol/ai-toolkit`, v0.1.0)
- `.claude/prompts/m5l4-github-packages-spec-cicd.md` — publish workflow to GitHub Packages

Local skills that may help scaffold parts of this (originally built for the
AWS/Terraform path, so check applicability before reusing as-is):
`.claude/skills/pack-init/`, `.claude/skills/setup-cicd/`.

### Phase 4 — live verification (2026-09-05)

Merged PR #15 into `main`; the `publish` job on `.github/workflows/publish-ai-toolkit.yml`
ran and succeeded (run `33932720555`). `@kstrzechowski/ai-toolkit@0.1.0` is live at
`https://npm.pkg.github.com` and listed at
`https://github.com/KStrzechowski/InkLingo/pkgs/npm/ai-toolkit`. Version history
confirmed via API: exactly one version, `0.1.0`, published 2026-09-05T00:22:11Z.

Scratch-consumer round-trip (outside this repo): `npm install @kstrzechowski/ai-toolkit`
against a `.npmrc` with the documented registry mapping plus a `gh auth token`
(`read:packages` scope) correctly installed `.claude/skills/code-review/SKILL.md`,
the `CLAUDE.md` sentinel block, and `.claude/.ai-toolkit-manifest.json`. Manual
`node node_modules/@kstrzechowski/ai-toolkit/uninstall.js` followed by
`npm uninstall @kstrzechowski/ai-toolkit` cleanly removed everything, including
deleting `CLAUDE.md` outright once stripping the sentinel block left it empty —
matches `uninstall.js`'s actual behavior, not previously called out in the plan.

Surprise: this machine's default `gh` OAuth token lacked `read:packages`, so both
the scratch install and the after-the-fact package/version API checks needed
`gh auth refresh -h github.com -s read:packages` first (interactive browser
step — not something that can be scripted headlessly).

Badge-evidence artifacts:
1. Publish flow — Actions run `https://github.com/KStrzechowski/InkLingo/actions/runs/33932720555` (validate + publish, both green) and the Packages listing above.
2. Package definition — `packages/ai-toolkit/package.json`, `packages/ai-toolkit/pack.yaml`.
3. Released versions — `0.1.0` (only version to date), confirmed via `gh api user/packages/npm/ai-toolkit/versions`.
