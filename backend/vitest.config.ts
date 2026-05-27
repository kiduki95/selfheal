import { defineConfig } from 'vitest/config';

// Integration tests share one isolated Postgres database (ouroboros_test), created/dropped per file.
// Run test files serially so they don't race on DROP/CREATE DATABASE. Pure unit tests are unaffected.
export default defineConfig({
  test: {
    // Backend suite only. frontend/ has its own Playwright specs (frontend/tests/*.spec.ts) which vitest must
    // not collect — they use @playwright/test and throw if run under vitest.
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
  },
});
