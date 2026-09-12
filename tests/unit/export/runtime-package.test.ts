import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
  function withPackage(domain: DomainType, check: (folder: string, bin: string) => void) {
    useAppStore.getState().createProject('runtime failure', domain);
    applyTemplate(domain, 'en');
    const folder = mkdtempSync(join(tmpdir(), 'fem-run-'));
    try {
      for (const [path, content] of Object.entries(exported(domain))) {
        mkdirSync(dirname(join(folder, path)), { recursive: true });
        writeFileSync(join(folder, path), content);
      }
      const bin = join(folder, 'bin');
      mkdirSync(bin);
      check(folder, bin);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  function stub(bin: string, name: string, commands: string) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${commands}\n`, { mode: 0o755 });
  }

  it.each(['frame', 'solid', 'fluid'] as DomainType[])('invalidates previous %s success when environment setup fails', (domain) => {
    withPackage(domain, (folder, bin) => {
      for (const name of ['result_package.json', 'results.csv', 'result.xdmf', 'result.h5']) writeFileSync(join(folder, name), 'old success');
      writeFileSync(join(folder, 'result_manifest.json'), '{"execution_return_code":0}');
      stub(bin, 'uv', 'exit 17');
      stub(bin, 'python3', 'echo /native/bindings');
      const result = spawnSync('bash', ['run.sh'], { cwd: folder, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(17);
      for (const name of ['result_package.json', 'results.csv', 'result.xdmf', 'result.h5']) expect(existsSync(join(folder, name))).toBe(false);
      const failure = JSON.parse(readFileSync(join(folder, 'result_manifest.json'), 'utf8'));
      expect(failure.execution_return_code).toBe(17);
      expect(failure.input_fingerprint).toBe(JSON.parse(readFileSync(join(folder, 'export_manifest.json'), 'utf8')).input_fingerprint);
    });
  });

  it('stops OpenFOAM when checkMesh reports failed checks with a zero exit code', () => {
    withPackage('fluid', (folder, bin) => {
      stub(bin, 'uv', 'exit 0');
      stub(bin, 'blockMesh', 'exit 0');
      stub(bin, 'checkMesh', 'echo "Failed 1 mesh checks."; exit 0');
      stub(bin, 'simpleFoam', 'touch solver-was-run');
      writeFileSync(join(folder, 'result_package.json'), 'old success');
      const result = spawnSync('bash', ['run.sh'], { cwd: folder, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(existsSync(join(folder, 'solver-was-run'))).toBe(false);
      expect(existsSync(join(folder, 'result_package.json'))).toBe(false);
      expect(JSON.parse(readFileSync(join(folder, 'result_manifest.json'), 'utf8')).execution_return_code).toBe(1);
    });
  });

  it('removes partially written success when the final solver command fails', () => {
    withPackage('frame', (folder, bin) => {
      stub(bin, 'uv', 'if [[ "$*" == *"python model.py"* ]]; then echo success > result_package.json; exit 19; fi');
      const result = spawnSync('bash', ['run.sh'], { cwd: folder, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(19);
      expect(existsSync(join(folder, 'result_package.json'))).toBe(false);
      expect(JSON.parse(readFileSync(join(folder, 'result_manifest.json'), 'utf8')).execution_return_code).toBe(19);
    });
  });

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
