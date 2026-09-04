---
change_id: tool-loop-agent
title: Tool loop agent
status: archived
created: 2026-08-30
updated: 2026-09-04
archived_at: 2026-09-04T11:51:41Z
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 3 live verification (2026-09-02)

Ran `npm run dev -- evals/fixtures/react-migration.diff ...` (default model `deepseek/deepseek-v4-flash`)
against `code-review-evals`' fixture diff. Result: `implementationCorrectness: 3/10`,
`testRiskCoverage: 2/10`, `documentation: 4/10`, `recommendation: fail` — correctly caught 2 of the
fixture's 3 injected flaws (stale `useEffect` deps, dropped `defaultProps`), missed the third
(`ReactDOM.render`/`createRoot`), consistent with `code-review-evals`' own live-run findings for this
same model. User confirmed the scores and reasoning are sane, not just schema-valid — the low scores
are appropriate given this is a deliberately-broken fixture with two real regressions the model did
catch, and arguably not harsh enough given a third, crash-causing bug it missed entirely.
