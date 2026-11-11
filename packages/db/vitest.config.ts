import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // The migration test creates and drops scratch databases and migrates each one from scratch
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
})
