import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30_000,
  },
})
