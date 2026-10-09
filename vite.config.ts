import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * The built page's Content-Security-Policy.
 *
 * "Your save never leaves this machine" is the promise the README leads with,
 * and until this it rested on nobody having written the code that would break
 * it. This makes the browser hold the line too: scripts from this origin only
 * and no `eval`, and requests only to this origin and the two hosts the game
 * data and art are fetched from. A dependency that tried to send a save
 * anywhere else would be refused.
 *
 * As a `<meta>` because GitHub Pages cannot send headers, and at build time
 * only because the dev server injects inline scripts and a websocket of its
 * own.
 *
 * - `'wasm-unsafe-eval'` is the Oodle decompressor, compiled from bytes.
 * - `blob:` workers and images are the tile bake and the map's textures.
 * - `'unsafe-inline'` styles are React `style` attributes; there is no inline
 *   script anywhere, and none is allowed.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://raw.githubusercontent.com",
  "img-src 'self' blob: data: https://cdn.jsdelivr.net https://raw.githubusercontent.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const contentSecurityPolicy: Plugin = {
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
}

// `base` targets GitHub Pages at /palworld-save-viewer/. Override with
// VITE_BASE=/ when serving from a domain root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/palworld-save-viewer/',
  plugins: [react(), tailwindcss(), contentSecurityPolicy],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Guarantees one React instance. Without this, dependency pre-bundling can
    // hand a library (zustand) a different copy than the app uses, which
    // surfaces as "Invalid hook call" and a blank page.
    dedupe: ['react', 'react-dom'],
  },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Pixi is only needed by the map view and is over half the bundle on
        // its own. Splitting it keeps the initial load — drop zone, parser,
        // summary — small, and lets the browser cache the renderer separately
        // from application code that changes far more often.
        manualChunks: {
          pixi: ['pixi.js'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
