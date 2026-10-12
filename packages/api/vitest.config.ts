import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Tests never send real mail (email.ts also refuses outside console mode under Vitest)
    env: { EMAIL_PROVIDER: 'console' },
  },
})
