import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    exclude: ['tests/**/*.build.spec.ts'],
    restoreMocks: true,
  },
})
