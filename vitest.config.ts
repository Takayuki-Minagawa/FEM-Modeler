import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**', 'solver-tests/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: [
        'src/core/**/*.ts',
        'src/geometry/**/*.ts',
        'src/export/**/*.ts',
        'src/validation/**/*.ts',
        'src/state/**/*.ts',
        'src/hooks/**/*.ts',
        'src/lib/**/*.ts',
        'src/results/**/*.ts',
        'src/mesh/**/*.ts',
      ],
      exclude: ['src/**/index.ts'],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 75,
        lines: 72,
      },
    },
  },
}));
