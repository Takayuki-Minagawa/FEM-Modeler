import { analyticBenchmark } from './benchmarks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DomainType, ProjectIR } from '@/core/ir/types';
import { applyTemplate } from '@/lib/project-templates';
import { useAppStore } from '@/state/store';
import { exportOpenSeesPy } from '@/export/openseespy/exporter';
import { exportDOLFINx } from '@/export/dolfinx/exporter';
import { exportOpenFOAM } from '@/export/openfoam/exporter';
import { openSeesPyPackageFiles } from '@/export/openseespy/package';
import { dolfinxPackageFiles } from '@/export/dolfinx/package';
import { openFoamPackageFiles } from '@/export/openfoam/package';

function filesFor(ir: ProjectIR, domain: DomainType) {
  if (domain === 'frame' || domain === 'truss') {
    const result = exportOpenSeesPy(ir); expect(result.errors).toEqual([]); return openSeesPyPackageFiles(result);
  }
  if (domain === 'fluid') {
    const result = exportOpenFOAM(ir); expect(result.errors).toEqual([]); return openFoamPackageFiles(result);
  }
  const result = exportDOLFINx(ir); expect(result.errors).toEqual([]); return dolfinxPackageFiles(result);
}

describe('real-solver package fixtures', () => {
  it.each(['frame', 'truss', 'solid', 'thermal', 'fluid'] as DomainType[])('packages %s with shared immutable provenance and locked uv runtime', (domain) => {
    useAppStore.getState().createProject(`${domain} runtime`, domain);
    applyTemplate(domain, 'en');
    for (const units of ['SI', 'mm']) {
      if (units === 'mm') useAppStore.getState().setUnitSystem('mm-N-s');
      const files = filesFor(useAppStore.getState().ir, domain);
      const manifest = JSON.parse(files['export_manifest.json']);
      expect(manifest.input_fingerprint).toMatch(/^sha256:/);
      expect(manifest.run_id).toBeTruthy();
      expect(files['uv.lock']).toContain('version = 1');
      const output = process.env.FEM_SOLVER_FIXTURES;
      if (output) {
        const folder = join(output, `${domain}_${units}`);
        for (const [path, content] of Object.entries(files)) {
          mkdirSync(dirname(join(folder, path)), { recursive: true });
          writeFileSync(join(folder, path), content);
        }
        writeFileSync(join(folder, 'input_project.json'), JSON.stringify(useAppStore.getState().ir));
      }
    }
  });
  it.each(['frame', 'truss', 'solid', 'thermal', 'fluid'] as DomainType[])('packages independent %s analytic reference', (domain) => {
    const ir = analyticBenchmark(domain);
    const files = filesFor(ir, domain);
    const output = process.env.FEM_SOLVER_FIXTURES;
    if (output) {
      const folder = join(output, domain + '_benchmark');
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(folder, path)), { recursive: true });
        writeFileSync(join(folder, path), content);
      }
      writeFileSync(join(folder, 'input_project.json'), JSON.stringify(ir));
    }
  });

});
