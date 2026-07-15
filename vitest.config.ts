import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: [
        'src/core/**/*.ts',
        'src/geometry/**/*.ts',
        'src/export/**/*.ts',
        'src/validation/**/*.ts',
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
