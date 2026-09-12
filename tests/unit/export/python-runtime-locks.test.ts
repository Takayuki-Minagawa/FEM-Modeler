import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pythonRuntimeFiles } from '@/export/shared/python-runtime';

describe('exported locked environments', () => {
  it.each(['openseespy', 'dolfinx', 'openfoam'] as const)('restores the exact checked-in %s uv files from the bundled representation', (solver) => {
    const files = pythonRuntimeFiles(solver);
    for (const name of ['uv.lock', 'pyproject.toml', '.python-version']) {
      expect(files[name]).toBe(readFileSync(new URL(`../../../solver-tests/${solver}/${name}`, import.meta.url), 'utf8'));
    }
  });
});
