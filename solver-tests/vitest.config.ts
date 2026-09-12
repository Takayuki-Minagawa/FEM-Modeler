import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { compressedText } from '../build/compressed-text.ts';

export default defineConfig({
  plugins: [compressedText()],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: { include: ['solver-tests/**/*.test.ts'] },
});
