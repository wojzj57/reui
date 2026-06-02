import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@reui\/interface\/protocol$/,
        replacement: resolve(__dirname, '../interface/src/protocol/index.ts'),
      },
      {
        find: /^@reui\/interface$/,
        replacement: resolve(__dirname, '../interface/src/index.ts'),
      },
      {
        find: /^@reui\/cli$/,
        replacement: resolve(__dirname, '../cli/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 90,
        branches: 90,
        functions: 90,
        statements: 90,
      },
    },
  },
});
