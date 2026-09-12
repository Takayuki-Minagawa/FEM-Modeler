import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { importSTL } from '@/geometry/import/stl-loader';
import { importResultText } from '@/results/importer';

function binaryGridSTL() {
  const count = Math.floor((10 * 1024 * 1024 - 84) / 50);
  const bytes = new ArrayBuffer(84 + count * 50);
  const view = new DataView(bytes); view.setUint32(80, count, true);
  for (let i = 0; i < count; i++) {
    const x = (i % 512) * 2; const y = Math.floor(i / 512) * 2;
    const values = [0, 0, 1, x, y, 0, x + 1, y, 0, x, y + 1, 0];
    for (let j = 0; j < 12; j++) view.setFloat32(84 + i * 50 + j * 4, values[j], true);
  }
  return bytes;
}

describe.skipIf(process.env.FEM_PERFORMANCE !== '1')('import responsiveness profile', () => {
  it('measures complete STL validation/encoding and CSV parse paths separately from autosave', () => {
    const stl = binaryGridSTL();
    const start = performance.now(); const imported = importSTL(stl, 'grid-10mb.stl'); const stlMs = performance.now() - start;
    expect(imported.success).toBe(true); imported.geometry?.dispose();
    const csv = `node_id,ux,uy,uz\n${Array.from({ length: 100_000 }, (_, i) => `${i},${i * 1e-6},0,0`).join('\n')}`;
    const resultStart = performance.now(); const result = importResultText(csv, 'results.csv', 'case', 'OpenSeesPy'); const csvMs = performance.now() - resultStart;
    expect(result.success).toBe(true);
    writeFileSync('tests/performance/import-results.json', JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model, note: 'One cold Node run, no worker; synthetic 209,713 separate triangles and 100k three-component result rows. Main-thread tasks over 50 ms warrant offloading; transfer/reconstruction overhead is not measured.', stlBytes: stl.byteLength, triangleCount: imported.triangleCount, stlMs, csvBytes: Buffer.byteLength(csv), csvRows: 100_000, csvMs }, null, 2) + '\n');
  }, 60_000);
});
