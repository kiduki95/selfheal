import { defineConfig } from 'vitest/config';

// Integration tests share one isolated Postgres database (ouroboros_test), created/dropped per file.
// Run test files serially so they don't race on DROP/CREATE DATABASE. Pure unit tests are unaffected.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
