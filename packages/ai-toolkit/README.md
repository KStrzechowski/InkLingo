# ai-toolkit

Distributable AI toolkit (a `code-review` Agent Skill plus a short rules fragment) published via GitHub Packages.

## For consumers

Add this to your project's committed `.npmrc` (must contain only the registry mapping — never a token):

```
@kstrzechowski:registry=https://npm.pkg.github.com
```

Then install:

```bash
npm install @kstrzechowski/ai-toolkit
```

Installing adds, into your project root:

- `.claude/skills/code-review/SKILL.md` — the review skill
- a sentinel-marked block in `CLAUDE.md` (`<!-- BEGIN @kstrzechowski/ai-toolkit --> ... <!-- END @kstrzechowski/ai-toolkit -->`) pointing at the skill
- `.claude/.ai-toolkit-manifest.json` — tracks what was installed, for clean removal

Re-running `npm install` updates the managed block and manifest in place rather than duplicating them.

To remove everything the package installed, run the uninstaller **before** removing the dependency — npm v7+ no longer runs `preuninstall`/`postuninstall` for any package, so this step can't be automatic:

```bash
node node_modules/@kstrzechowski/ai-toolkit/uninstall.js
npm uninstall @kstrzechowski/ai-toolkit
```

## For maintainers

Source of truth for this package's design: `context/changes/ai-toolkit-package/`.

Before publishing, validate locally from `packages/ai-toolkit/`:

```bash
npm pack --dry-run
```
