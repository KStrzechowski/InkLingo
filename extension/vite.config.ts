import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// manifest.json is kept at the project root rather than in a Vite
// publicDir so the extension's identity sits next to package.json —
// Firefox loads dist/, so copy it there at the end of every build.
function copyManifest (): Plugin {
  return {
    name: 'copy-manifest',
    closeBundle () {
      copyFileSync(
        resolve(import.meta.dirname, 'manifest.json'),
        resolve(import.meta.dirname, 'dist', 'manifest.json')
      )
    }
  }
}

export default defineConfig({
  plugins: [react(), copyManifest()],
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
})
