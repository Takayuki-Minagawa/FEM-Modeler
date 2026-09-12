import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { platform, arch, cpus } from 'node:os';
import { createDefaultProject } from '@/core/ir/defaults';
import { createUndoRedoManager } from './legacy-undo-manager.fixture';
import { useAppStore, getHistoryStats } from '@/state/store';
import { saveProjectDraft, clearProjectDraft, estimateProjectDraftBytes } from '@/lib/project-draft-storage';
import { importSTL } from '@/geometry/import/stl-loader';
import type { ProjectIR } from '@/core/ir/types';

function fixture(name: string): ProjectIR {
  const ir = createDefaultProject();
  if (name === '10MB STL') {
    const bytes = new TextEncoder().encode('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t');
    const imported = importSTL(bytes.buffer, 'triangle.stl');
    ir.assets.push({ ...imported.asset!, data: 'A'.repeat(Math.ceil(10 * 1024 * 1024 * 4 / 3)), byte_length: 10 * 1024 * 1024 });
  }
  if (name === '100k results') ir.results.push({ id: 'result', analysis_case_id: 'case', solver_target: 'OpenSeesPy', source_file_name: 'fixture.csv', imported_at: new Date(0).toISOString(), status: 'partial', checks: [], metadata: {},
    fields: [{ name: 'Displacement', location: 'node', component_names: ['ux'], unit: 'm', entity_ids: Array.from({ length: 100_000 }, (_, i) => `node-${i}`), values: Array.from({ length: 100_000 }, (_, i) => i / 100), minimum: 0, maximum: 999.99 }] });
  return ir;
}
const percentile95 = (times: number[]) => times.sort((a, b) => a - b)[94];

// Explicit opt-in avoids benchmarking the obsolete algorithm on every test run.
describe.skipIf(process.env.FEM_PERFORMANCE !== '1')('history and autosave performance fixtures', () => {
  it('compares 100 scalar edits against the pre-refactor algorithm', async () => {
    const reports = [];
    for (const name of ['small', '10MB STL', '100k results']) {
      const baseline = fixture(name);
      const manager = createUndoRedoManager();
      const beforeTimes = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now(); manager.saveBefore(baseline); baseline.meta.project_name = `Model ${i}`; manager.saveAfter(baseline);
        beforeTimes.push(performance.now() - start);
      }
      const baselineSerializedPatchBytes = manager.serializedPatchBytes();
      useAppStore.getState().loadProject(fixture(name));
      const afterTimes = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now(); useAppStore.getState().setProjectName(`Model ${i}`); afterTimes.push(performance.now() - start);
      }
      const ir = useAppStore.getState().ir;
      const serializationStart = performance.now(); JSON.stringify(ir); const fullJsonMs = performance.now() - serializationStart;
      const estimateStart = performance.now(); for (let i = 0; i < 100; i++) estimateProjectDraftBytes(ir); const estimate100Ms = performance.now() - estimateStart;
      const saveStart = performance.now(); await saveProjectDraft(ir); const initialSaveMs = performance.now() - saveStart;
      const resaveStart = performance.now(); await saveProjectDraft(ir); const warmSaveMs = performance.now() - resaveStart;
      reports.push({ fixture: name, edits: 100, baselineP95Ms: percentile95(beforeTimes), currentP95Ms: percentile95(afterTimes), baselineSerializedPatchBytes, currentEstimatedHistoryBytes: getHistoryStats().estimatedBytes, fullJsonMs, estimate100Ms, initialSaveMs, warmSaveMs });
      await clearProjectDraft();
    }
    writeFileSync('tests/performance/latest-results.json', JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, platform: `${platform()} ${arch()}`, cpu: cpus()[0]?.model, note: 'Node/fake-indexeddb microbenchmark; synthetic STL payload; initial import/freeze is outside edit timings. Byte columns are different conservative proxies, not heap measurements. Save includes hashing, serialization, and IndexedDB transaction; browser measurements may differ.', reports }, null, 2) + '\n');
    expect(reports).toHaveLength(3);
  }, 180_000);
});
