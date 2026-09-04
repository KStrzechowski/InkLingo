---
change_id: ai-toolkit-package
title: Package the AI toolkit for GitHub Packages distribution (Module 5, Lesson 4)
status: impl_reviewed
created: 2026-09-04
updated: 2026-09-05
archived_at: null
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
