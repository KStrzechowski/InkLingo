/**
 * dependency-cruiser configuration for InkLingo.
 *
 * This repo has four independent npm projects (frontend/, backend/, extension/,
 * infra/) and deliberately no root package.json — so there is no root
 * node_modules and nothing to install dependency-cruiser into. It runs through
 * npx, from the repo root, over all four apps in one pass:
 *
 *   node scripts/depcruise.mjs
 *
 * Use that wrapper rather than calling npx by hand. `npx dependency-cruiser`
 * on its own looks like it works and reports "0 modules cruised" — npx resolves
 * the TypeScript parser relative to its own temp install, not the cwd, so
 * .ts/.tsx files are not even recognised as source. The wrapper passes
 * `-p dependency-cruiser -p typescript` so both land in the same temp dir, and
 * carries the source-directory list.
 *
 * One pass is what makes the cross-app rules below meaningful: only a cruise
 * that can see all four trees can catch frontend/ reaching into backend/.
 * Dependency resolution still works per app — enhanced-resolve walks up from
 * each source file, so frontend/src/*.tsx finds frontend/node_modules — and
 * `combinedDependencies: false` (the default) means the npm-vs-npm-dev
 * classification uses the *closest* package.json, i.e. each app's own.
 *
 * Graphs:
 *   node scripts/depcruise.mjs --output-type dot | dot -T svg > deps.svg
 *   node scripts/depcruise.mjs --output-type archi | dot -T svg > archi.svg
 *   node scripts/depcruise.mjs --output-type mermaid -f deps.mmd  (no graphviz)
 *   (also: err-html, text, json, flat, d2)
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* ---------------------------------------------------------------- *
     * Cross-app boundaries — the decoupling CLAUDE.md describes         *
     * ---------------------------------------------------------------- */
    {
      name: 'no-cross-app-imports',
      severity: 'error',
      comment:
        'The four apps are independent npm projects with no workspace linking and no ' +
        'shared-types package — they talk over plain HTTP only. Duplicating a response ' +
        'shape per client (frontend/src/api/collections.ts, extension/src/types.ts) is ' +
        'the deliberate cost of that. Reaching across the boundary with a relative ' +
        'import compiles locally and then breaks the moment either app is built or ' +
        'deployed on its own. If you need to share something, either duplicate it or ' +
        'raise extracting a real published package.',
      from: { path: '^(frontend|backend|extension|infra)/' },
      to: {
        path: '^(frontend|backend|extension|infra)/',
        pathNot: '^$1/',
      },
    },

    /* ---------------------------------------------------------------- *
     * Per-app layering                                                  *
     * ---------------------------------------------------------------- */
    {
      name: 'extension-popup-stays-off-the-network',
      severity: 'error',
      comment:
        'Extension contract (CLAUDE.md § Architecture): every backend call runs in the ' +
        'background script so it goes out under host_permissions and skips page-level ' +
        'CORS. The popup reaches the background through browser.runtime.sendMessage ' +
        'with the contract in extension/src/messages.ts. A popup module importing ' +
        'auth.ts, config.ts or background.ts means someone is about to fetch from the ' +
        'popup — route it through a message instead.',
      from: { path: '^extension/src/popup/' },
      to: { path: '^extension/src/(auth|config|background)\\.ts$' },
    },
    {
      name: 'backend-no-cross-route-imports',
      severity: 'error',
      comment:
        'Routes are autoloaded folders and each owns its own slice. One route folder ' +
        'importing another couples two endpoints that @fastify/autoload registers ' +
        'independently. Share through a plugin decorator (src/plugins/) or a module ' +
        'outside src/routes/ instead.',
      from: { path: '^backend/src/routes/api/([^/]+)/' },
      to: {
        path: '^backend/src/routes/api/([^/]+)/',
        pathNot: '^backend/src/routes/api/$1/',
      },
    },
    {
      name: 'backend-plugins-are-below-routes',
      severity: 'error',
      comment:
        'src/plugins/ is for cross-cutting concerns shared by all routes; it must not ' +
        'depend on any single route. Plugins publish decorators, routes consume them.',
      from: { path: '^backend/src/plugins/' },
      to: { path: '^backend/src/routes/' },
    },
    {
      name: 'frontend-api-is-below-pages',
      severity: 'error',
      comment:
        'src/api/ is the transport layer: pages call it, it never calls back up into a ' +
        'page. An import in this direction is a cycle waiting to happen and makes the ' +
        'api modules untestable without React.',
      from: { path: '^frontend/src/api/' },
      to: { path: '^frontend/src/(pages|App)' },
    },
    {
      name: 'observability-stays-a-leaf',
      severity: 'error',
      comment:
        'The observability reporters are imported by the transport layer that reports ' +
        'errors. If they import api/auth/pages back, a failing request can recurse ' +
        'through the reporter that is trying to report it.',
      from: { path: '^(frontend|extension)/src/observability/' },
      to: { path: '^(frontend|extension)/src/(api|auth|pages|popup)/' },
    },
    {
      name: 'no-test-code-in-production-code',
      severity: 'error',
      comment:
        'Shipped source must not import from test/, e2e/ or browser-tests/ — those trees ' +
        'are excluded from every app build and the import would only fail at bundle time.',
      from: { path: '^(frontend|backend|extension|infra)/(src|bin|lib)/' },
      to: { path: '^(frontend|backend|extension|infra)/(test|e2e|browser-tests)/' },
    },

    /* ---------------------------------------------------------------- *
     * General hygiene                                                   *
     * ---------------------------------------------------------------- */
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'This dependency is part of a circular relationship. Circular imports make the ' +
        'modules hard to test in isolation and can produce partially-initialised values ' +
        'at runtime depending on which module the bundler reaches first.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'A module nothing imports and that is not an entry point. Usually dead code left ' +
        'after a refactor. The exceptions below are the real entry points: Vite and ' +
        'fastify-cli entries, @fastify/autoload folders (routes and plugins are loaded ' +
        'from disk, so nothing imports them), the CDK app, test files (the runner is ' +
        'their entry), type declarations and dotfile configs. test/setup.ts is listed ' +
        'because vite.config.ts names it in `setupFiles` as a string — nothing imports ' +
        'it, and dependency-cruiser cannot see a config value.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$', // dotfile configs
          '\\.d\\.ts$',
          '(^|/)tsconfig\\.[^/]+\\.json$',
          '^frontend/src/main\\.tsx$', // Vite entry
          '^extension/src/background\\.ts$', // MV3 event page entry
          '^extension/src/popup/main\\.tsx$', // popup entry
          '^backend/src/(server|app)\\.ts$', // fastify-cli entries
          '^backend/src/(routes|plugins)/', // @fastify/autoload
          '^infra/bin/', // CDK app entry
          '^frontend/browser-tests/harness/main\\.tsx$',
          '\\.(test|spec)\\.[jt]sx?$',
          '^(frontend|extension)/test/setup\\.ts$', // vite.config.ts setupFiles

        ],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment:
        "Points to a module dependency-cruiser could not resolve — a typo, or a package " +
        'that is in the import but not in that app\'s package.json. Note each app ' +
        'installs separately, so `npm install` in the right folder is the first thing to ' +
        'check.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        'Production code depending on a devDependency. It works locally and then fails ' +
        'in the container, because devDependencies are not installed there. Either move ' +
        'the package to dependencies or keep the import inside test code.',
      from: {
        path: '^(frontend|backend|extension|infra)/(src|bin|lib)/',
        // Declaration files emit nothing, so neither their imports nor their
        // `/// <reference types="vite/client" />` directives reach a bundle.
        pathNot: ['\\.(test|spec)\\.[jt]sx?$', '\\.d\\.ts$'],
      },
      to: {
        dependencyTypes: ['npm-dev'],
        // Type-only imports of a devDependency are erased at build time, so they
        // are fine — @types/* and `import type` do not survive into the bundle.
        dependencyTypesNot: ['type-only', 'triple-slash-type-reference'],
        pathNot: ['node_modules/@types/'],
      },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment:
        'Depends on an npm package that is not in the app\'s package.json. That makes the ' +
        'build depend on a transitive dependency someone else can drop at any time — add ' +
        'it explicitly.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'no-duplicate-dep-types',
      severity: 'warn',
      comment:
        'Listed in more than one dependency group in package.json (e.g. both ' +
        'dependencies and devDependencies) — pick one.',
      from: {},
      to: {
        moreThanOneDependencyType: true,
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment:
        'Depends on a deprecated Node core module. Find the modern replacement before it ' +
        'is removed from Node outright.',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: ['^v8/tools/codemap$', '^v8/tools/consarray$', '^v8/tools/csvparser$', '^v8/tools/logreader$', '^v8/tools/profile_view$', '^v8/tools/profile$', '^v8/tools/SourceMap$', '^v8/tools/splaytree$', '^v8/tools/tickprocessor-driver$', '^v8/tools/tickprocessor$', '^node-inspect/lib/_inspect$', '^node-inspect/lib/internal/inspect_client$', '^node-inspect/lib/internal/inspect_repl$', '^async_hooks$', '^punycode$', '^domain$', '^constants$', '^sys$', '^_linklist$', '^_stream_wrap$'],
      },
    },
    {
      name: 'no-deprecated-npm',
      severity: 'warn',
      comment:
        'Depends on a package marked deprecated on npm. Check for a successor, or accept ' +
        'that nobody is fixing its bugs.',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
  ],

  options: {
    /* Never crawl into these — they are either third-party or build output. */
    doNotFollow: {
      path: ['node_modules'],
    },

    /* Drop from the report entirely. node_modules deliberately is NOT in this list:
       excluding it would also hide every npm dependency from the report, which
       silently disables not-to-dev-dep, no-non-package-json and no-deprecated-npm.
       doNotFollow above already stops dependency-cruiser from crawling *into* them. */
    exclude: {
      path: [
        '^(frontend|extension|backend)/dist/',
        '^infra/(cdk\\.out|\\.build)/',
        '/(coverage|test-results|playwright-report)/',
      ],
    },

    /* Type-only imports count as dependencies: they are the ones most likely to
       cross a boundary unnoticed, and the cross-app rule above exists precisely
       because there is no shared-types package. Rules that must NOT fire on them
       (not-to-dev-dep, no-duplicate-dep-types) opt out with dependencyTypesNot. */
    tsPreCompilationDeps: true,

    /* No app uses tsconfig `paths`, so resolution needs no tsconfig — and a single
       cruise cannot point at four of them anyway. If aliases are ever added, cruise
       that app on its own with --ts-config <app>/tsconfig.app.json. */

    enhancedResolveOptions: {
      /* Match each bundler's field preference. Vite/browser code first, then node. */
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.d.ts'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },

    reporterOptions: {
      dot: {
        collapsePattern: [
          '^(frontend|extension)/src/(api|auth|observability|pages|popup)',
          '^backend/src/(plugins|ai)',
          '^backend/src/routes/api/[^/]+',
          '^infra/lib/(constructs|stacks)',
          'node_modules/(@[^/]+/[^/]+|[^/@]+)',
        ],
      },
      archi: {
        collapsePattern: [
          '^(frontend|backend|extension|infra)/(src|bin|lib|test|e2e|browser-tests)/[^/]+',
          'node_modules/(@[^/]+/[^/]+|[^/@]+)',
        ],
      },
    },
  },
}
