---
starter_id: fastify
package_manager: npm
project_name: ink-lingo
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: false
    docs_current: false
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

Solo developer shipping InkLingo's MVP in 3 weeks after-hours, deadline 2026-08-05, with auth and AI-driven translation/example-sentence generation in scope. The user explicitly wants a decoupled frontend/backend (not a monolith) and AWS/GCP container deployment with a relational database (Postgres), since the product's data model (users, collections, saved entries) is naturally relational. This ruled out the registry's recommended default for (web, js) — 10x Astro Starter — which bundles Supabase (hosted Postgres+auth) and defaults to Cloudflare, both mismatched with the AWS preference. Fastify is the backend/API half of the pair (the browser extension calls it over plain HTTP, same as the web app) and clears all four agent-friendly quality gates (typed, convention-based, popular, well-documented), unlike Express which fails typing and conventions. Deployment target is self-host (containerized on AWS or GCP), matching the starter's own deployment defaults. The companion frontend, Vite+React, is NOT scaffolded by this hand-off — it fails one quality gate (no built-in routing/data-layer conventions) and must be added manually as a separate project after Fastify is scaffolded. CI runs on GitHub Actions with auto-deploy-on-merge.
