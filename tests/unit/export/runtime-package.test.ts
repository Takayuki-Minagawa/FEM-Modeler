import { describe, expect, it } from 'vitest';
import type { DomainType } from '@/core/ir/types';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { exportOpenSeesPy } from '@/export/openseespy/exporter';
import { exportDOLFINx } from '@/export/dolfinx/exporter';
import { exportOpenFOAM } from '@/export/openfoam/exporter';
import { openSeesPyPackageFiles } from '@/export/openseespy/package';
import { dolfinxPackageFiles } from '@/export/dolfinx/package';
import { openFoamPackageFiles } from '@/export/openfoam/package';

function exported(domain: DomainType) {
  const ir = useAppStore.getState().ir;
  if (domain === 'frame' || domain === 'truss') return openSeesPyPackageFiles(exportOpenSeesPy(ir));
  if (domain === 'fluid') return openFoamPackageFiles(exportOpenFOAM(ir));
  return dolfinxPackageFiles(exportDOLFINx(ir));
}

function normalizedFiles(files: Record<string, string>) {
  const manifest = JSON.parse(files['export_manifest.json']);
  return Object.fromEntries(Object.entries(files).map(([path, content]) => [path, content
    .replaceAll(manifest.run_id, '<run-id>')
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g, '<timestamp>')]));
}

describe('solver package contracts', () => {
  it.each(['frame', 'truss', 'solid', 'thermal', 'fluid'] as DomainType[])('keeps %s reproducible apart from run identity and timestamps', (domain) => {
    useAppStore.getState().createProject('package contract', domain);
    applyTemplate(domain, 'en');
    const first = exported(domain);
    const second = exported(domain);
    expect(JSON.parse(first['export_manifest.json']).run_id).not.toBe(JSON.parse(second['export_manifest.json']).run_id);
    expect(normalizedFiles(first)).toEqual(normalizedFiles(second));
    expect(first['run.sh']).toContain('uv sync --locked');
    expect(first['uv.lock']).toContain('version = 1');
    expect(first['pyproject.toml']).toContain('requires-python');
    expect(first['run.sh']).not.toContain('pip install');
    const generated = JSON.parse(first['export_manifest.json']).generated_files as string[];
    expect(Object.keys(first).every((path) => generated.includes(path))).toBe(true);
  });
});
