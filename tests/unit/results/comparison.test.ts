import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import type { ResultIR } from '@/core/ir/types';
import { compareResults, comparisonCsv, comparisonFields, resultSnapshot, type ComparisonRequest } from '@/results/comparison';
import { importResultText } from '@/results/importer';

function result(id: string, positions: [number, number, number][], values: number[], ids = positions.map((_, index) => String(index + 1))): ResultIR {
  return { id, source_file_name: `${id}.csv`, analysis_case_id: `case-${id}`, solver_target: 'DOLFINx', imported_at: '', status: 'complete', checks: [],
    fields: [{ id: `field-${id}`, name: 'temperature', unit: 'K', location: 'node', component_names: ['temperature'], entity_ids: ids, values, minimum: Math.min(...values), maximum: Math.max(...values) }],
    metadata: { csv_coordinates: { unit: 'm', location: 'node', entity_ids: ids, positions } },
  };
}
const request: ComparisonRequest = { name: 'temperature', unit: 'K', tolerance: 1e-8, probe: { kind: 'line', start: [0, 0, 0], end: [2, 0, 0] } };
const project = (results: ResultIR[]) => ({ ...createDefaultProject(), results });

describe('result comparison at explicit physical positions', () => {
  it('aligns shuffled coordinates, verifies repeated IDs against position, and computes candidate minus baseline', () => {
    const a = result('a', [[0, 0, 0], [1, 0, 0]], [100, 200], ['first', 'second']);
    const b = result('b', [[1, 0, 0], [0, 0, 0]], [240, 110], ['first', 'second']);
    const comparison = compareResults(project([a, b]), ['a', 'b'], request);
    expect(comparison.rows.map(row => row.matches[0].difference)).toEqual([10, 40]);
    expect(comparison.rows.map(row => row.matches[0].id)).toEqual(['second', 'first']);
    expect(comparison.summaries[0]).toMatchObject({ matched: 2, missing: 0, idPositionConflicts: 2, differences: { minimum: 10, maximum: 40, mean: 25 } });
    expect(comparison.summaries[0].differences?.rms).toBeCloseTo(Math.sqrt(850));
    expect(comparison.contexts.map(context => context.inputStatus)).toEqual(['unverified', 'unverified']);
    expect(a.metadata.provenance_verified).toBeUndefined();
  });

  it('reports a same-ID different-position node as missing instead of using its value', () => {
    const comparison = compareResults(project([
      result('a', [[0, 0, 0]], [100], ['same-id']), result('b', [[10, 0, 0]], [999], ['same-id']),
    ]), ['a', 'b'], request);
    expect(comparison.rows[0].matches[0]).toEqual({ status: 'missing' });
    expect(comparison.summaries[0]).toMatchObject({ matched: 0, missing: 1, idPositionConflicts: 1, values: null, differences: null });
  });

  it('excludes ambiguous points and prevents reusing one candidate for two baseline nodes', () => {
    const base = result('a', [[0, 0, 0]], [100]);
    const ambiguous = result('b', [[0, 0, 0], [0, 0, 0]], [1, 2]);
    expect(compareResults(project([base, ambiguous]), ['a', 'b'], request).summaries[0].ambiguous).toBe(1);
    const close = result('c', [[0, 0, 0], [1e-9, 0, 0]], [100, 110]);
    expect(compareResults(project([close, base]), ['c', 'a'], request).summaries[0]).toMatchObject({ matched: 0, ambiguous: 2 });
  });

  it('uses finite line segments and coordinate planes without interpolating missing points', () => {
    const positions: [number, number, number][] = [[-1, 0, 0], [0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 0, 1]];
    const ir = project([result('a', positions, [1, 2, 3, 4, 5]), result('b', positions, [2, 4, 6, 8, 10])]);
    expect(compareResults(ir, ['a', 'b'], { ...request, probe: { kind: 'line', start: [0, 0, 0], end: [1, 0, 0] } }).rows.map(row => row.value)).toEqual([2, 3]);
    expect(compareResults(ir, ['a', 'b'], { ...request, probe: { kind: 'plane', axis: 2, offset: 0 } }).rows).toHaveLength(4);
    expect(() => compareResults(ir, ['a', 'b'], { ...request, probe: { kind: 'point', point: [0.5, 0, 0] } })).toThrow('emptyProbe');
  });

  it('requires matching scalar units and explicit coordinates; malformed and oversized requests fail', () => {
    const a = result('a', [[0, 0, 0]], [100]);
    const b = result('b', [[0, 0, 0]], [110]);
    b.fields[0].unit = '°C';
    expect(() => compareResults(project([a, b]), ['a', 'b'], request)).toThrow('fieldMismatch');
    b.fields[0].unit = 'K'; delete b.metadata.csv_coordinates;
    expect(() => compareResults(project([a, b]), ['a', 'b'], request)).toThrow('coordinatesRequired');
    expect(() => compareResults(project([a]), ['a', 'a'], request)).toThrow('selectResults');
    expect(() => compareResults(project([a, b]), ['a', 'b'], { ...request, tolerance: 0 })).toThrow('tolerance');
    const positions: [number, number, number][] = Array.from({ length: 20_001 }, (_, index) => [index, 0, 0]);
    const values = positions.map((_, index) => index);
    expect(() => compareResults(project([result('c', positions, values), result('d', positions, values)]), ['c', 'd'], {
      ...request, probe: { kind: 'plane', axis: 2, offset: 0 },
    })).toThrow('sampleLimit');
  });

  it('compares imported mesh coordinates with mapped CSV coordinates but never treats mesh-only previews as solved fields', () => {
    const a = result('a', [[0, 0, 0]], [100]);
    const b = result('b', [[0, 0, 0]], [110]);
    delete a.metadata.csv_coordinates;
    a.mesh = { length_unit: 'm', nodes: [{ id: '1', position: [0, 0, 0] }], elements: [], quality: [], source: { solver: 'DOLFINx', generator: 'Test solver mesh', input_fingerprint: 'test-input' } };
    expect(compareResults(project([a, b]), ['a', 'b'], request).rows[0].matches[0].difference).toBe(10);
    a.metadata.stage = 'mesh_only';
    expect(comparisonFields(a)).toEqual([]);
    expect(() => compareResults(project([a, b]), ['a', 'b'], request)).toThrow('fieldMismatch');
  });

  it('reports difference overflow and retains stable statistics for large finite values', () => {
    const a = result('a', [[0, 0, 0], [1, 0, 0]], [-1e308, 1e308]);
    const b = result('b', [[0, 0, 0], [1, 0, 0]], [1e308, 1e308]);
    const comparison = compareResults(project([a, b]), ['a', 'b'], request);
    expect(comparison.summaries[0]).toMatchObject({ matched: 1, overflow: 1, differences: { mean: 0, rms: 0 } });
    expect(comparison.baseline?.mean).toBe(0);
    expect(comparison.baseline?.rms).toBe(1e308);
  });

  it('never invents snapshot times and exports provenance, missing points and escaped CSV cells', () => {
    const a = result('a', [[0, 0, 0]], [100], ['=node()']);
    const b = result('b', [[1, 0, 0]], [200]);
    a.source_file_name = '=CMD("payload")';
    expect(resultSnapshot(a)).toEqual({});
    b.metadata = { ...b.metadata, time: 2.5, time_unit: 's', step: 3 };
    expect(resultSnapshot(b)).toEqual({ time: 2.5, timeUnit: 's', step: 3 });
    const csv = comparisonCsv(compareResults(project([a, b]), ['a', 'b'], request));
    expect(csv).toContain('"\'=CMD(""payload"")"');
    expect(csv).toContain("'=node()");
    expect(csv).toContain('unverified');
    expect(csv).toContain(',missing,');
    expect(csv).toContain('2.5,s,3');
  });

  it.each(['csv', 'json'])('retains only actual snapshot metadata through %s import and JSON persistence', format => {
    const metadata = { export_target: 'DOLFINx', analysis_case_id: 'case-a', time: 1, time_unit: 'ms', step: 7, execution_return_code: 0 };
    const source = format === 'json' ? JSON.stringify(metadata) : `# FEM_MODELER_PROVENANCE ${JSON.stringify(metadata)}\nnode_id,temperature[K]\n1,100`;
    const imported = importResultText(source, `snapshot.${format}`, 'case-a', 'DOLFINx');
    expect(imported.success).toBe(true);
    const restored = JSON.parse(JSON.stringify(imported.result)) as ResultIR;
    expect(resultSnapshot(restored)).toEqual({ time: 1, timeUnit: 'ms', step: 7 });
    expect(restored.metadata.provenance_verified).toBe(false);
  });
});
