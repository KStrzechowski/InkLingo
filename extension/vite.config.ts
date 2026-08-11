import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
// vitest/config's defineConfig is a superset of vite's — same config shape plus
// the `test` field, so it type-checks without a second config file.
import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

interface Manifest {
  host_permissions: string[]
}

// `https://host/*` from a base URL, or null if the value is missing or isn't
// a URL — callers fall back rather than failing the build.
function originPattern (value: string | undefined): string | null {
  if (value === undefined || value.length === 0) {
    return null
  }
  try {
    return `${new URL(value).origin}/*`
  } catch {
    return null
  }
}

// manifest.json is kept at the project root rather than in a Vite publicDir
// so the extension's identity sits next to package.json — Firefox loads
// dist/, so write it there at the end of every build.
//
// host_permissions are narrowed to the two origins this build actually calls,
// taken from the same VITE_* values src/config.ts reads. The checked-in
// manifest holds regional wildcards as placeholders; shipping those would
// grant credentialed access to every AWS account's API Gateway and every
// Cognito hosted UI in the region, which is far more than this extension
// needs and is the kind of thing AMO review weighs.
function writeManifest (env: Record<string, string>): Plugin {
  return {
    name: 'write-manifest',
    // Build-only. Vitest runs a Vite dev server and fires closeBundle on every
    // environment it creates, which without this would rewrite dist/manifest.json
    // with the checked-in wildcard placeholders every time the suite runs —
    // silently widening host_permissions on whatever build is loaded in Firefox.
    // `npm run dev` is `vite build --watch`, so it stays covered.
    apply: 'build',
    closeBundle () {
      const source = resolve(import.meta.dirname, 'manifest.json')
      const manifest = JSON.parse(readFileSync(source, 'utf8')) as Manifest

      const origins = [env.VITE_API_BASE_URL, env.VITE_COGNITO_DOMAIN].map(originPattern)
      if (origins.every((origin) => origin !== null)) {
        manifest.host_permissions = [...new Set(origins as string[])]
      } else {
        // No .env.<mode> file (they're gitignored) or an unparseable value —
        // keep the placeholders so the build still produces a loadable
        // extension, but make it obvious the narrowing didn't happen.
        this.warn(
          'VITE_API_BASE_URL / VITE_COGNITO_DOMAIN missing or invalid — ' +
          'dist/manifest.json keeps the wildcard host_permissions. See README.md.'
        )
      }

      writeFileSync(
        resolve(import.meta.dirname, 'dist', 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`
      )
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_')

  return {
    plugins: [react(), writeManifest(env)],
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      // Narrowed from Vitest's default glob so it never reaches into dist/ or
      // picks up anything but the suite. Mirrors frontend/vite.config.ts.
      include: ['test/**/*.test.{ts,tsx}']
    },
    // The popup is loaded from moz-extension://<uuid>/popup.html, so asset
    // URLs must not assume a server root.
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Manifest V3's default CSP is `script-src 'self'` — Vite's
      // modulePreload polyfill injects an inline <script>, which that CSP
      // blocks.
      modulePreload: false,
      rollupOptions: {
        // Two entry points: the popup page and the background event page.
        // Both are named exactly as manifest.json references them.
        input: {
          popup: resolve(import.meta.dirname, 'popup.html'),
          background: resolve(import.meta.dirname, 'src', 'background.ts')
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]'
        }
      }
    }
  }
})
