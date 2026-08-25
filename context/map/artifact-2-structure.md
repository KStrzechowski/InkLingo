---
artifact: 2-structure
source: dependency-cruiser 16.10.4 — 191 modules, 406 dependencies, 0 violations
config: .dependency-cruiser.cjs (repo root, run via scripts/depcruise.mjs)
generated: 2026-08-18
status: draft
companion: artifact-2-dependencies.md (per-area detail, testability, infra graph)
---

# Structure — what the import graph shows, and what it cannot

Session summary: dependency-cruiser was set up over all four apps and used to
probe structure. The headline result is that **the graph is clean everywhere and
blind in exactly the places `artifact-1-territory.md` found real coupling.**
Read the blind spots section before quoting any number from this artifact.

## What was set up

- `.dependency-cruiser.cjs` at the repo root — there is no root `package.json`,
  so nothing is installed; it runs through npx.
- `scripts/depcruise.mjs` — canonical invocation. Needed because
  `npx dependency-cruiser` alone silently cruises **0 modules** of TypeScript:
  npx resolves the parser relative to its own temp install, not the cwd, so
  `.ts`/`.tsx` are not recognised as source. The wrapper passes
  `-p dependency-cruiser -p typescript` and the source-directory list.
- All four apps cruise in **one pass** — that is what makes the cross-app rule
  enforceable. Resolution still works per app (enhanced-resolve walks up to each
  app's own `node_modules`; npm-vs-npm-dev uses the closest `package.json`).
- Rules encode what `CLAUDE.md` already states in prose: no cross-app imports,
  no popup-to-network in the extension, no cross-route imports in the backend,
  plus per-app layering. Each rule was verified against a deliberate violation,
  not trusted because the baseline was green.

## What the graph found

- **Zero cycles, repo-wide.** 191 modules, 406 dependencies, 0 `no-circular`
  violations — including type-only cycles (`tsPreCompilationDeps: true`), which
  is the stricter check. Expected for a 5-week greenfield; a baseline to protect.
- **Frontend layering holds and is enforced by imports.** `pages -> api` is 8
  edges, one-way; `api -> pages`, `auth -> pages` and `auth -> api` are all 0.
  Note `pages -> auth` is also 0 — auth is reached only via `App.tsx`, so the
  real chain is `pages -> api -> auth` with `auth` as a leaf.
- **`frontend/src/api/collections.ts` is the hub**: Ca=10, the highest of any
  production module, at Ce=1.
- **Ce and Ca are inversely distributed.** Nothing in the repo is both hard to
  isolate and widely depended on, so heavy mocking buys little; the high-Ce
  modules are composition roots that want integration tests.

## What the tool could NOT see

This is the load-bearing section. Every item below is a real dependency that
produces **no edge** in the graph, so it is invisible to the rules, to the
metrics, and to any future depcruise check.

### 1. No import edge between the four apps — unknown, not absent

There is no edge between `frontend/`, `backend/`, `extension/` and `infra/` in
any of the 12 ordered pairs, in either direction, including test trees and
type-only imports, out of 166 local edges.

The four are independent npm projects with no workspace linking and no
shared-types package. **The absence of an import relationship is not the absence
of coupling** — dependency-cruiser has nothing to traverse, so it reports
silence, and silence must be read as `unknown`.

Artifact 1 predicted exactly this, and the coupling it identified is still there:

- **`frontend/src/api/collections.ts:3` and `extension/src/types.ts:6` both
  declare `interface Collection`, byte-identical** — same five fields
  (`id`, `name`, `nativeLanguageCode`, `targetLanguageCodes`, `createdAt`), same
  order. Verified 2026-08-18. Nothing structural keeps them in sync; they agree
  by attention. Artifact 1 measured only **2 shared commits** between
  `frontend/src` and `extension/src` in 32 relevant commits, and noted the two
  files have already diverged in vocabulary below `Collection`
  (`EntrySentence`/`Entry`/`CollectionDetail` vs
  `TranslationSentence`/`TranslationResult`/`SavedEntry`) for the same backend
  data.
- Three further cross-app couplings bind through the filesystem, not imports:
  `backend/test/route-reachability.test.ts:16` reads the infra registry;
  `infra/scripts/package-backend.mjs:17-31` copies `backend/dist`;
  `infra/lib/constructs/frontend-construct.ts:43` deploys `frontend/dist`;
  `infra/scripts/write-frontend-env.mjs:47` writes `frontend/.env.production`.

A `no-cross-app-imports` rule now enforces the zero, so an import across the
boundary fails loudly. **Nothing guards the duplication**, which is the form the
coupling actually takes.

### 2. Autoloaded backend routes appear as zero-fan-in orphans

`@fastify/autoload` wires `backend/src/routes/` from disk at runtime. Nothing
imports those files, so the four route entry modules report **Ca=0** and are
excluded from the `no-orphans` rule by an explicit exception. Their real blast
radius is the HTTP contract plus the infra route registry — neither an import.

(Precisely: the `index.ts` entry modules show Ca=0; their siblings do not —
`redact.ts` 0/2, `client-errors/schemas.ts` 1/2, `ownership.ts` 1/1.)

Artifact 1 found the coupling this hides:

- **`backend/src/routes/` and `infra/lib/constructs/api-construct.ts` are paired
  by hand.** `api-construct.ts` registers 8 explicit route paths with no
  `{proxy+}` catch-all, and HTTP API route keys match the entire path, so
  `/api/collections/{id}` does not cover `/api/collections/{id}/translate`. A
  route added under `backend/src/routes/api/` is autoloaded, passes the whole
  backend suite, and 404s in production until a matching `addRoutes` entry
  exists. `lessons.md:26-30` records this shipping broken **twice**.
- Artifact 1 measured **3 shared commits** between `backend/src` and `infra/lib`
  and ranked `api-construct.ts` as the one *application* file behaving like a
  repo-wide common denominator (23 distinct areas, 10 touches). It predicted the
  dependency graph would not show this. It does not.
- Partially guarded since: `backend/test/route-reachability.test.ts` diffs both
  sides as plain text. Blind to non-literal route shapes
  (`fastify.route({ method, url })`), which would be absent from both extractors
  and so report as matching. Note `lessons.md:29` still says "No test can catch
  it" — stale.

### 3. Also invisible (found this session)

- **Backend plugins to routes.** `routes -> plugins` is 0 edges, yet routes make
  **22 decorator calls** into plugin-provided state (`sql` x18,
  `correlationId` x2, `jwtVerifier`, `anthropicClient`), resolved through
  Fastify's registry. The boundary check passes vacuously — there is no import
  traffic to constrain. `backend/src/fastify.d.ts` (Ce=4, Ca=4) is the only
  written record of that contract.
- **Extension popup to background.** No edge, by design — the popup reaches the
  background through `browser.runtime.sendMessage`. Its absence is the
  architecture working, not isolation.
- **`infra/lib/constructs/api-construct.ts` Ce=12 is not local coupling.** Only
  1 of the 12 is a local edge; 10 are `aws-cdk-lib/*`. The fan-out is breadth of
  AWS configuration, so splitting the file would move the risk, not reduce it.
- **`infra/test/infra.test.ts` (Ce=0, Ca=0) is the unmodified CDK scaffold
  stub** — imports commented out, empty test body. `cd infra && npm test` passes
  green while testing nothing, and `checks.mjs:168` excludes infra from pre-push.
- **React context and CSS-in-config.** `AuthContext` reaches pages through React
  context, and `test/setup.ts` is referenced by `vite.config.ts` as a string.

## Coverage of the cruise itself

`infra/scripts/` and `scripts/` were initially outside the source list — a gap
worth noting because `infra/scripts/` holds two of the four filesystem-level
cross-app couplings. **Both were added on 2026-08-18** (191 modules, 406
dependencies, still clean). No finding above changed; the added modules are
build glue with no couplings of their own.

## How to re-run

```
node scripts/depcruise.mjs                        # validate (17s, exits 1 on violation)
node scripts/depcruise.mjs --output-type metrics  # Ca/Ce/instability -> metrics.txt
node scripts/depcruise.mjs --focus "^infra/lib" --exclude "node_modules" --output-type mermaid
```

Sort metrics by Ca, not by the reporter's default instability order — the most
change-sensitive module (`api/collections.ts`, Ca=10, I=9%) sits mid-file:

```
awk 'NR>2 && $1=="module" {printf "%-4s %-4s %-6s %s\n", $4, $5, $6, $2}' \
  context/map/metrics.txt | sort -rn | head -20
```

## Carry into artifact 3 / repo-map

- The `frontend`/`extension` contract duplication has **no guard of any kind**;
  the `backend`/`infra` twin has a partial one. Both must stay hand-carried from
  artifact 1 — this artifact cannot see either.
- Three `languages.ts` copies (frontend/extension/backend) agree today on 8
  codes in three different data shapes, with nothing asserting parity.
- `lessons.md:29` needs correcting against `route-reachability.test.ts`.
