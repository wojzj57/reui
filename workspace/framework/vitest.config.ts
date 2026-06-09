import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/index.ts',
        'src/theme/index.ts',
        'src/vite-env.d.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        // RFC-004 §7.5：覆盖率 > 80%
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
