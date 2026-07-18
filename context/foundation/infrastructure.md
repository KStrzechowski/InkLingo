---
project: ink-lingo
researched_at: 2026-07-18
recommended_platform: AWS (Lambda + API Gateway + Cognito + S3/CloudFront, CDK-managed)
runner_up: Render (free tier) for PaaS simplicity; AWS Fargate+ALB (~$21-27/mo) for more control while staying AWS-native
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Fastify (backend), Vite + React (frontend)
  runtime: Node.js (Lambda, via AWS Lambda Web Adapter)
  ai_provider: Anthropic API (Claude Haiku 4.5) for translation + example-sentence generation
---

## Recommendation

**Deploy on AWS, provisioned entirely via CDK (TypeScript): Lambda (Fastify) behind API Gateway HTTP API with a Cognito JWT authorizer, Neon Postgres, S3+CloudFront for the frontend, and SSM Parameter Store for secrets. AI calls (translation + example sentences) go to the Anthropic API using Claude Haiku 4.5.**

This supersedes an initial shortlist of managed PaaS platforms (Railway, Render, Fly.io) once the actual requirement was clarified mid-research: not an always-on production MVP, but a personal, intermittent-use proof-of-concept that should cost genuinely near-$0/month, stay on AWS (the developer's existing familiarity and CDK preference), and not foreclose a future collaborative/WebSocket feature at the auth layer. Lambda's perpetual (not 12-month) free tier, combined with Neon's free tier for Postgres, is the only path in this research that is genuinely free indefinitely at PoC-scale traffic — every PaaS option researched (Railway, Render's paid tier, Fly.io) has a real recurring cost floor once you go past a trial or accept a free-tier expiry/sleep trade-off. A second, deeper research pass (2026-07-18) specifically compared Lambda against AWS Fargate/ECS and App Runner as the three realistic AWS-native compute options and confirmed Lambda as the strongest fit — see the Compute Comparison below for the full reasoning, including why Neon (not RDS) is the right Postgres choice for this specific compute pick.

## Platform Comparison

The research ran in three phases: (1) a standard PaaS/edge-platform comparison assuming an always-on MVP, (2) a pivot to AWS-native serverless once the actual goal — a near-$0 personal PoC using CDK — was clarified, and (3) a deeper AWS-only compute comparison (Lambda vs. Fargate vs. App Runner) run 2026-07-18 to pressure-test the Phase 2 pick with real pricing, timeout, and networking research. All three are recorded here for auditability.

### Phase 1 — Always-on MVP framing (superseded)

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration | Note |
|---|---|---|---|---|---|---|
| Cloudflare Workers | — | — | — | — | — | **Dropped — hard filter.** Fastify's Node.js runtime model (`fs`-based `@fastify/autoload`, TCP-based `fastify-plugin`) cannot run on Workers' V8-isolate runtime without a full rewrite. |
| Railway | Pass | Pass | Pass (llms.txt) | Pass | Pass | Fastify runs unchanged; first-party co-located Postgres; ~$8-15/mo. No perpetual free tier since 2023 — ruled out once the goal became "genuinely free." |
| Render | Pass | Pass | Partial | Pass | Pass | Fastify runs unchanged; free tier sleeps after 15 min idle, free Postgres expires after 30 days; paid floor ~$13-15/mo. |
| Fly.io | Pass | Partial | Pass | Pass | Partial (experimental) | Best runtime/WebSocket fit; real managed Postgres costs $38+/mo, cheap option is DIY/unsupported. |
| AWS App Runner | Partial | Pass | Fail | Pass | Partial | Cheap, RDS co-located, familiar — but zero WebSocket support, ever (permanently blocks the future coop-groups feature), and a hard unconfigurable 30s request timeout (confirmed in Phase 3). |
| AWS Fargate | Partial | Partial | Fail | Pass | Partial | WebSocket-capable but needs ALB+cluster+task-def; ~$25-30+/mo floor (confirmed and refined to ~$21-27/mo in Phase 3, once the ALB-only/no-NAT public-subnet pattern was priced out). |
| Vercel | Partial | Pass | Fail | Pass | Partial | `@fastify/autoload` bundling is broken (open bug since 2022); Postgres is bolted-on Neon; Hobby tier bans commercial use. |
| Netlify | Partial | Pass | Partial | Partial | Pass | Needs a Lambda-compat adapter (sunsetting 2027); no WebSocket path at all, ever. |

Phase-1 shortlist (superseded): 1. Railway, 2. Render, 3. Fly.io.

### Phase 2 — Near-$0 personal PoC framing

| Option | Fastify compatibility | Free-tier permanence | Setup complexity | Note |
|---|---|---|---|---|
| **AWS Lambda + API Gateway (recommended)** | Solid — `@fastify/autoload` survives in a zip/container package (no forced single-file bundling); AWS Lambda Web Adapter runs `fastify.listen()` near-unmodified | Perpetual (1M req + 400K GB-seconds/month, no 12-month clock) | Highest — no one-click deploy; CDK/IAM/API Gateway wiring is manual, ~an afternoon first time | Chosen: stays on AWS, CDK-native, genuinely free at PoC scale |
| Render (free tier) | Solid — runs unchanged | Free, but free Postgres expires after 30 days (re-provision needed) | Lowest — push to GitHub, done | Runner-up: simplest option if AWS/CDK weren't a stated goal |
| Railway | Solid — runs unchanged | Not free — one-time trial credit only, then billed (~$8-15/mo even at low usage) | Low | Ruled out once "genuinely free" became the requirement |

### Phase 3 — AWS compute deep dive: Lambda vs. Fargate vs. App Runner (2026-07-18)

Once AWS was fixed as the platform, a second research pass compared the three realistic AWS-native compute options in depth, with pricing as the priority.

| Criterion | Lambda | App Runner | Fargate/ECS |
|---|---|---|---|
| Monthly cost (paired with Neon, no VPC) | **~$0** — within the permanent 1M-request/400K-GB-s free tier at this traffic level | ~$5-8 — no scale-to-zero, always-on instance-hour billing | ~$21-27 — ALB is mandatory for a stable HTTPS ingress and is not avoidable, unlike the other two |
| Setup effort | Low — one function via SAM CLI, wraps the existing Fastify app with `@fastify/aws-lambda`, no infra to hand-wire | Very low — point at an ECR image, App Runner owns ingress/TLS/scaling | Highest — cluster, task definition, ALB, target group, security groups, VPC all need wiring (ECS Express Mode, GA Nov 2025, cuts most of this) |
| Timeout risk for AI calls | None — Lambda Function URLs support up to 15 min | **Hard 30s cap, not configurable** — a real risk against the AI-translation NFR if the provider ever has a slow moment | None — ALB idle timeout is adjustable |
| Fastify fit | Needs `@fastify/aws-lambda` adapter (actively maintained, GA, Jan 2026 release) — thin wrapper, not a rewrite | Native — `fastify.listen()` unmodified | Native — `fastify.listen()` unmodified |
| CLI/agent-friendliness | Fully scriptable via SAM CLI; AWS Copilot CLI (older tutorials) is in maintenance mode, full EOL 2026-06-12 — avoid | Fully scriptable, automatic rollback on failed deploy | Fully scriptable via plain `aws-cli`; same Copilot-CLI deprecation applies |

**Why Neon over RDS for this compute pick.** The NAT Gateway/VPC cost story only shows up if the compute needs to reach a *private* database. Lambda's default network is AWS-owned with free outbound internet access — it only gets pulled into a VPC (losing that free path, triggering a NAT Gateway need, ~$32/mo) the moment it needs to reach a private RDS instance. Neon is a publicly-reachable, connection-pooled Postgres provider, so Lambda never needs VPC attachment at all — this is what keeps the total near $0. If AWS-native Postgres is ever wanted specifically, **Aurora Serverless v2 + the RDS Data API** is the one path that keeps this property (HTTPS-based queries, no VPC needed, scales to 0 ACU/near-$0 idle since Nov 2024) — plain RDS + Lambda requires either a NAT Gateway (~$32/mo) or RDS Proxy (~$22/mo flat) on top of the VPC cost, which erases Lambda's cost advantage entirely.

Phase-3 shortlist: 1. **Lambda** (chosen), 2. Fargate/ECS via ECS Express Mode (more control, more cost, no timeout ceiling — the fallback if Lambda's 30s cap or cold starts ever become a real problem), 3. App Runner (simplest container deploy, ruled out specifically for the unconfigurable 30s timeout against the AI-latency NFR).

## Anti-Bias Cross-Check: AWS Lambda + Neon + S3/CloudFront + SSM

Run in two passes: an initial cross-check before the Cognito decision (2026-07-10), and a deeper compute-specific pass (2026-07-18) once Lambda was pressure-tested against Fargate/App Runner with real pricing and security research. Findings are annotated with how the final architecture resolves them.

### Devil's Advocate — Weaknesses

1. Hand-rolled JWT auth would have meant owning token issuance, refresh, and revocation correctness — a real security surface. **Resolved**: the final decision adds Cognito User Pools instead of hand-rolling auth.
2. A bare Lambda Function URL has no request validation, throttling, or WAF integration in front of it, and — confirmed by the 2026-07-18 research — **AWS Shield's free DDoS protection does not cover bare Function URLs at all**, only CloudFront/Route 53/ALB. **Resolved**: the final architecture uses API Gateway HTTP API (required anyway for the Cognito JWT authorizer), which restores throttling; Shield-grade DDoS coverage would additionally require CloudFront in front, not currently in scope for this PoC.
3. Neon's free tier auto-suspends after idle — the first request after a suspend pays a cold-resume penalty stacked on top of Lambda's own cold start, worst-case multi-second, right when demoing to someone. **Open** — see risk register.
4. "Near-zero manual steps" is slightly oversold: ACM certs for CloudFront must be in `us-east-1` regardless of the stack's region, and SSM `SecureString` values still need an out-of-band push (CDK can create the parameter resource but not set a secret value in it). **Open** — see risk register and Getting Started.
5. Skipping Cognito now would have made a later migration to real multi-user auth a rewrite, not an upgrade. **Resolved**: Cognito is in the architecture from day one specifically to avoid this.
6. **(2026-07-18)** Serverless pay-per-invocation billing has no built-in spend ceiling — AWS Budgets/CloudWatch billing alarms only notify after the fact, they don't throttle. A request flood against the `/translate` route is a "denial of wallet" risk on two fronts at once: AWS charges *and* the Anthropic API's own per-call billing, since that route is the one that calls out to a paid LLM. **Partially resolved**: API Gateway throttling plus Lambda reserved concurrency cap the blast radius; full protection needs an application-level per-user rate limit on the AI-calling route specifically (see risk register).

### Pre-Mortem — How This Could Fail

Three months in, the solo developer wants to show InkLingo to a few friends as informal beta testers. In the original (pre-Cognito) plan, the hand-rolled JWT auth would have had no password-reset or email-verification flow, forcing a rushed rewrite exactly when informal testers showed up — this is now avoided by adding Cognito upfront. Separately, nobody set up CloudWatch alarms (reasonably out of scope for a $0 PoC), so if Neon's free tier hits its monthly compute-hour cap during a demo, the database would return errors with no alert — the developer would only find out when a friend reports "the app is broken." In the original bare-Function-URL plan, an unthrottled endpoint scraped by a bot after the URL leaked into a public Discord would have caused a noticeable invocation spike; the switch to API Gateway with throttling now closes this specific path, though the underlying "no monitoring" gap for Neon's own limits remains. **(2026-07-18 addendum)** A separate failure mode: a frontend bug — an unbounded retry loop on the `/translate` endpoint — floods requests that each also call the Anthropic API. AWS-side cost stays bounded by Lambda's concurrency ceiling, but nothing currently caps how many of those requests reach the paid LLM call before someone notices the Anthropic bill; the fix (a per-user rate limit on that route) hasn't been built yet.

### Unknown Unknowns

- Neon's free tier has a monthly compute-hour cap, not unlimited usage — fine for intermittent testing, but light continuous polling (e.g., a forgotten background tab) could exhaust it faster than expected.
- Lambda's execution environment and `/tmp` are ephemeral and reused unpredictably across invocations — a naive singleton `pg` connection pool in the Fastify app will misbehave; use Neon's HTTP-based serverless driver instead, which sidesteps Lambda's classic TCP pool-exhaustion problem entirely.
- CloudFront cache invalidation is not automatic on redeploy — a stale frontend build silently serving old JS after `cdk deploy` is a common first-timer gotcha with S3+CloudFront specifically (a PaaS like Render/Railway handles this invisibly).
- Cognito's hosted-UI custom domain needs a Route53-managed domain + an ACM cert validated in `us-east-1` — CDK-automatable but slow (DNS propagation) and easy to misconfigure across regions on the first attempt.
- CDK's CloudFormation state becomes the sole source of truth — hand-editing any resource in the AWS console causes drift that `cdk deploy` won't cleanly reconcile; there's no console to accidentally click into on a PaaS, so this risk is specific to the AWS-native choice.
- **(2026-07-18)** Lambda's VPC attachment is all-or-nothing for outbound traffic: it's only needed to reach a private resource like RDS, but the moment it's attached, *all* outbound calls — including the Anthropic API call — get routed through the VPC, which then needs a NAT Gateway for internet access. Staying on Neon (public, pooled Postgres) is what avoids this entirely; this is easy to rediscover the hard way if a future "let's move to RDS for X reason" decision doesn't also account for the NAT cost it drags in.
- **(2026-07-18)** The AWS EC2 free tier changed for accounts created after 2025-07-15 — no longer 750 hrs/month for 12 months, now a $100-200 signup credit spent over 6 months. Not relevant to the chosen Lambda path, but worth knowing if EC2 ever gets reconsidered later based on older tutorials/assumptions.

## Operational Story

- **Preview deploys**: no built-in preview-URL concept like Vercel/Netlify. For a solo PoC, "preview" is `cdk diff` reviewed locally before `cdk deploy` against the single environment. If a second environment is ever needed, add a `stage` CDK context parameter (`dev`/`prod`) producing parallel stacks (separate Lambda, API Gateway, CloudFront distribution).
- **Secrets**: Neon connection string, the Anthropic API key, and any other credentials live in SSM Parameter Store as `SecureString` (KMS-encrypted), readable only by the Lambda execution role's narrowly-scoped IAM policy. CDK creates the parameter resource; the actual secret value is set out-of-band via `aws ssm put-parameter --value ...` (or the console) — never committed to source. Rotation is manual: re-run `put-parameter` with a new value.
- **Rollback**: CloudFormation (which CDK drives) keeps changeset history and can roll back a failed stack update automatically. For a fast rollback of just the Lambda code without a full stack update, use Lambda's built-in versioning/aliases — publish a version on each deploy and repoint the alias to the previous version.
- **Approval**: a human must review before: any `cdk deploy` that changes IAM policies or touches Cognito/API Gateway auth config; the one-time Cognito hosted-UI domain/ACM cert setup; rotating SSM secret values. An agent may run `cdk diff`, `cdk synth`, and read-only AWS CLI calls (`describe-*`, `list-*`, `get-*`) unattended, and may run `cdk deploy` for additive, non-destructive frontend/content changes without per-run approval.
- **Logs**: Lambda logs stream to CloudWatch — `aws logs tail /aws/lambda/<function-name> --follow`, or the `awslabs/mcp` Lambda Tool MCP Server once configured (exposes already-deployed functions as agent-callable tools; it does not automate deployment itself). API Gateway execution logging, if enabled, also lands in CloudWatch. CloudFront access logs are opt-in (S3 logging target) and not enabled by default for this PoC.
- **Cost/abuse protection on the AI-calling route (2026-07-18)**: API Gateway HTTP API provides built-in (best-effort) request throttling in front of Lambda at low added cost. Lambda reserved concurrency is a free, precise circuit breaker — capping the function's max concurrent executions bounds both the blast radius and the worst-case AWS bill of an accidental request flood. Neither protects the *Anthropic-side* cost of a flood hitting `/translate` specifically — that needs an application-level per-user rate limit (e.g. `@fastify/rate-limit`) on the AI-calling route, tracked as an open item in the risk register.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Bare Function URL has no throttling/WAF, and Shield Standard doesn't cover it | Devil's advocate, Research finding | — | — | **Mitigated by architecture**: switched to API Gateway HTTP API (required for Cognito authorizer anyway), which restores throttling. Full Shield-grade DDoS coverage would need CloudFront in front too — not in scope for this PoC. |
| Hand-rolled JWT auth security surface / no reset-verification flow | Devil's advocate, Pre-mortem | — | — | **Mitigated by architecture**: Cognito User Pools added from day one instead of hand-rolling auth. |
| Neon free-tier cold-resume stacks with Lambda cold start | Devil's advocate | M | L | Send one warm-up request before a live demo; not worth Provisioned Concurrency at this scale. |
| SSM `SecureString` values can't be set via CDK (only the parameter resource) | Devil's advocate, Research finding | H (certain) | L | Document the one manual `aws ssm put-parameter` step per environment in the runbook; never commit secret values to git. |
| ACM cert for CloudFront must be in `us-east-1` regardless of stack region | Devil's advocate | M | L | Pin the ACM-cert CDK construct/stack to `us-east-1` explicitly at the start; don't discover this mid-deploy. |
| No monitoring on Neon's monthly compute-hour cap | Pre-mortem | M | M | Manually check Neon's usage dashboard periodically during active testing; a CloudWatch-style alarm isn't worth the setup at this scale. |
| Naive singleton Postgres connection pool misbehaves across Lambda invocations | Unknown unknowns | M | M | Use Neon's HTTP-based serverless driver (`@neondatabase/serverless`), not a persistent `pg.Pool`. |
| CloudFront serves stale frontend after redeploy (no auto cache invalidation) | Unknown unknowns | M | L | Add `aws cloudfront create-invalidation` as an explicit post-deploy step (CDK custom resource or a manual command documented in Getting Started). |
| Console drift vs. CDK state | Unknown unknowns | L | M | Treat CDK as the sole source of truth; never hand-edit resources in the AWS console; re-sync via `cdk diff` if drift is suspected. |
| Cognito hosted-UI domain/ACM setup is slow and easy to misconfigure across regions | Unknown unknowns | M | L | Do this step first and in isolation, before wiring the rest of the stack, so DNS propagation delay doesn't block other work. |
| Denial-of-wallet: request flood on `/translate` bills both AWS and the Anthropic API, with no automatic spend ceiling on either | Devil's advocate, Pre-mortem, Research finding | M | M | Lambda reserved concurrency + API Gateway throttling cap the AWS side; add an application-level per-user rate limit on `/translate` specifically (`@fastify/rate-limit`) — not yet implemented, tracked here as an open item. |
| Moving Postgres from Neon to RDS later re-introduces the NAT Gateway/VPC cost (~$32/mo) that Neon was chosen to avoid | Unknown unknowns, Research finding | L | L | If AWS-native Postgres is ever wanted, use Aurora Serverless v2 + RDS Data API (HTTPS-based, no VPC needed, scales to 0 ACU) instead of plain RDS, to preserve the near-$0 property. |

## Getting Started

1. `mkdir infra && cd infra && npx cdk init app --language typescript` — scaffold the CDK app (separate from `backend/` and `frontend/`).
2. `cdk bootstrap aws://<account-id>/<region>` — one-time per AWS account/region.
3. Sign up for Neon's free tier, create a project/database, and note the connection string (prefer the HTTP-based driver connection string for Lambda compatibility, not the raw TCP one).
4. Create an Anthropic API account at console.anthropic.com (separate from any personal claude.ai subscription — the two are not interchangeable) and generate an API key for `claude-haiku-4-5`.
5. Push the secrets into SSM Parameter Store as `SecureString`: `aws ssm put-parameter --name /ink-lingo/neon-url --type SecureString --value "<neon-connection-string>"` and `aws ssm put-parameter --name /ink-lingo/anthropic-api-key --type SecureString --value "<anthropic-api-key>"`.
6. In the CDK app, define: a Cognito `UserPool` + `UserPoolClient`; a Lambda function packaging the built `backend/dist` output with the AWS Lambda Web Adapter layer; an API Gateway HTTP API with a Cognito JWT authorizer in front of the Lambda, with throttling enabled; an S3 bucket + CloudFront distribution (with Origin Access Control) serving the built `frontend/dist` output.
7. In the Fastify app, add `@fastify/rate-limit` on the AI-calling route(s) to cap per-user request rate before wiring it to the Anthropic API — this is the one piece the platform-level protections (API Gateway throttling, Lambda reserved concurrency) don't cover.
8. `cdk deploy` — note the emitted API Gateway URL and CloudFront domain in the output.
9. Point the frontend's API base URL at the deployed API Gateway URL, rebuild (`npm run build` in `frontend/`), and re-run the deploy so `BucketDeployment` picks up the new build; follow with `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"` since cache invalidation is not automatic.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration (Lambda here uses a zip/Lambda-Web-Adapter package, not a general-purpose Dockerfile)
- CI/CD pipeline setup (deploys above are manual `cdk deploy`; wiring GitHub Actions to run it is a follow-up)
- Production-scale architecture (multi-region, HA, DR) — this is intentionally a single-user, single-region PoC
