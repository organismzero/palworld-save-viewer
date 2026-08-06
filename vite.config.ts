import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// `base` targets GitHub Pages at /palworld-save-viewer/. Override with
// VITE_BASE=/ when serving from a domain root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/palworld-save-viewer/',
  plugins: [react(), tailwindcss()],
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
