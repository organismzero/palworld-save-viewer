import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) }

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        // Golden tests run the full pipeline over the real (gitignored)
        // data/Level.json. They self-skip when it is absent, so CI stays green.
        test: {
          name: 'golden',
          include: ['test/golden/**/*.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
