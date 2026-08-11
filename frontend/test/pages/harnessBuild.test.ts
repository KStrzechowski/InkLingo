import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// The browser tests render print-harness.html. Two things must stay true for
// that to be worth trusting, and neither is enforced by anything else:
//
//   1. The harness mounts the production PrintDocument. A hand-copied markup
//      would drift from the real page and quietly stop testing it.
//   2. The harness never ships. It is reachable only because Vite's dev server
//      serves any root-level .html, while `vite build`'s default input is
//      index.html alone — a property that a future build tweak could silently
//      remove.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = path.join(__dirname, '..', '..')

const harnessEntry = fs.readFileSync(
  path.join(FRONTEND_ROOT, 'browser-tests', 'harness', 'main.tsx'),
  'utf8'
)
const viteConfig = fs.readFileSync(path.join(FRONTEND_ROOT, 'vite.config.ts'), 'utf8')

describe('the print harness renders the production component', () => {
  it('imports PrintDocument from src rather than redefining the document', () => {
    expect(
      harnessEntry,
      'browser-tests/harness/main.tsx must mount src/pages/PrintDocument — otherwise the ' +
      'browser tests assert against a copy that can drift from the real print page'
    ).toMatch(/import PrintDocument from ['"]\.\.\/\.\.\/src\/pages\/PrintDocument['"]/)
  })

  it('does not hand-roll the sheet markup', () => {
    // A table in the harness entry means someone reimplemented the document
    // instead of mounting it.
    expect(harnessEntry).not.toMatch(/<table/)
    expect(harnessEntry).not.toMatch(/print-page/)
  })

  it('loads the global stylesheet the print rules override', () => {
    // Without index.css the harness would test print.css against a blank page,
    // and the dark-theme assertions would prove nothing — there would be no
    // prefers-color-scheme block left to override.
    expect(harnessEntry).toMatch(/import ['"]\.\.\/\.\.\/src\/index\.css['"]/)
  })
})

describe('the print harness stays out of the production build', () => {
  it('is not registered as a build input', () => {
    // Vite's default input is index.html alone. Adding rollupOptions.input
    // would be the way to accidentally ship the harness.
    expect(
      viteConfig,
      'vite.config.ts declares a build input — check that print-harness.html is not among them'
    ).not.toMatch(/rollupOptions/)
  })

  it('is not in public/, which is copied verbatim into dist/', () => {
    const publicDir = path.join(FRONTEND_ROOT, 'public')
    const entries = fs.existsSync(publicDir) ? fs.readdirSync(publicDir) : []

    expect(entries).not.toContain('print-harness.html')
  })

  it('is absent from dist/ when a build is present', () => {
    // Opportunistic: CI runs the frontend tests before the build, so dist/ may
    // not exist yet. The two structural checks above are the real guard; this
    // catches the case where a build has already run.
    const distDir = path.join(FRONTEND_ROOT, 'dist')
    if (!fs.existsSync(distDir)) {
      return
    }

    expect(
      fs.readdirSync(distDir),
      'print-harness.html was emitted into dist/ — the test harness would be served in production'
    ).not.toContain('print-harness.html')
  })
})
