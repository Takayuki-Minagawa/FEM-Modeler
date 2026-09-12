import { describe, expect, it } from 'vitest';
import { parseResultPackage, resultMeshSchema, summarizeMesh } from '@/results/package';
import { deformedNodes, exteriorTriangles } from '@/viewer/result-data';
import { convergenceStudyMarkdown, studyFromResults } from '@/results/studies';
import type { ResultIR } from '@/core/ir/types';

function mesh() {
  return resultMeshSchema.parse({ length_unit: 'm', source: { solver: 'OpenSeesPy', generator: 'test', input_fingerprint: 'hash' }, representative_size: 1,
    nodes: [{ id: '20', position: [0, 0, 0] }, { id: '10', position: [1, 0, 0] }],
    elements: [{ id: 'e1', type: 'line2', node_ids: ['20', '10'], boundary_tags: ['support'] }],
    quality: [{ name: 'length', definition: 'Euclidean length in metres', unit: 'm', element_ids: ['e1'], values: [1], bad_below: 2 }] });
}
function result(h = 1, qoi = 1): ResultIR {
  const m = mesh(); m.representative_size = h;
  m.elements = Array.from({ length: Math.round(1 / h) }, (_, i) => ({ id: `e${i}`, type: 'line2', node_ids: ['20', '10'], boundary_tags: [] }));
  return { id: `r${h}`, analysis_case_id: 'case', solver_target: 'OpenSeesPy', source_file_name: 'results.json', imported_at: '', status: 'complete', checks: [], mesh: m,
    fields: ['ux', 'uy'].map((name) => ({ id: name, name, location: 'node', unit: 'm', component_names: [name], entity_ids: ['10', '20'], values: [qoi, 2 * qoi], minimum: qoi, maximum: 2 * qoi })),
    metadata: { project_id: 'p', provenance_verified: true, comparison_fingerprint: 'comparison', input_fingerprint: `input-${h}`, run_id: `run-${h}` } };
}

describe('mesh packages and explicit node mapping', () => {
  it('parses scalar fields, computes ranges and rejects invented IDs and mismatched mesh provenance', () => {
    const input = { format: 'fem-modeler-result-package-v1', manifest: { export_target: 'OpenSeesPy', input_fingerprint: 'hash' }, mesh: mesh(), fields: [{ name: 'ux', location: 'node', unit: 'm', entity_ids: ['10', '20'], values: [4, 2] }] };
    const parsed = parseResultPackage(input);
    expect(parseResultPackage({ ...input, fields: [{ ...input.fields[0], name: 'ux_m' }] }).fields[0].name).toBe('ux');
    expect(parsed.fields[0].minimum).toBe(2); expect(parsed.fields[0].maximum).toBe(4);
    expect(() => parseResultPackage({ ...input, mesh: { ...input.mesh, source: { ...input.mesh.source, input_fingerprint: 'other' } } })).toThrow(/provenance/);
    expect(() => parseResultPackage({ ...input, fields: [{ ...input.fields[0], entity_ids: ['10', '999'] }] })).toThrow(/IDs/);
    expect(() => parseResultPackage({ ...input, fields: [{ ...input.fields[0], values: [NaN, 0] }] })).toThrow();
  });
  it('rejects duplicate IDs, broken connectivity and unsupported quality references', () => {
    const m = mesh();
    expect(resultMeshSchema.safeParse({ ...m, nodes: [...m.nodes, m.nodes[0]] }).success).toBe(false);
    expect(resultMeshSchema.safeParse({ ...m, elements: [{ ...m.elements[0], node_ids: ['10', 'missing'] }] }).success).toBe(false);
    expect(resultMeshSchema.safeParse({ ...m, quality: [{ ...m.quality[0], element_ids: ['missing'] }] }).success).toBe(false);
  });
  it('reports measured tags, bad element IDs and distribution counts using declared definitions', () => {
    const summary = summarizeMesh(mesh());
    expect(summary.tags).toEqual({ support: 1 }); expect(summary.badElementIds).toEqual(['e1']);
    expect(summary.quality[0].bins).toEqual([1, 0, 0, 0, 0]); expect(summary.quality[0].definition).toContain('Euclidean');
  });
  it('maps displacements by IDs even when field rows have another order and reports missing values', () => {
    const r = result();
    const deformed = deformedNodes(r, 3);
    expect(deformed.positions.get('20')).toEqual([6, 6, 0]); expect(deformed.positions.get('10')).toEqual([4, 3, 0]);
    r.fields[0].entity_ids = ['10']; r.fields[0].values = [1];
    expect(deformedNodes(r, 2).missingIds).toEqual(['20']); expect(deformedNodes(r, 2).positions.get('20')).toEqual([0, 0, 0]);
    r.fields[1].unit = 'mm'; expect(deformedNodes(r, 1).available).toBe(false);
  });
  it('suppresses shared tetra faces without removing exterior tagged boundary faces', () => {
    const m = mesh();
    m.nodes = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, position: [i, 0, 0] }));
    m.elements = [
      { id: 't1', type: 'tetra4', node_ids: ['a', 'b', 'c', 'd'], boundary_tags: [] },
      { id: 't2', type: 'tetra4', node_ids: ['a', 'c', 'b', 'e'], boundary_tags: [] },
      { id: 'boundary', type: 'triangle3', node_ids: ['a', 'b', 'd'], boundary_tags: ['wall'] },
    ];
    expect(exteriorTriangles(m)).toHaveLength(6);
    expect(exteriorTriangles(m, new Set(['t1']))).toHaveLength(4);
  });
});

describe('saved convergence comparisons', () => {
  it('compares the same coordinate across permuted node IDs and writes reproducible report', () => {
    const results = [result(1, 2), result(0.5, 1.25), result(0.25, 1.0625)];
    const study = studyFromResults(results, { fieldName: 'ux', unit: 'm', reduction: 'point', position: [1, 0, 0] });
    expect(study.samples.map((sample) => sample.qoi)).toEqual([2, 1.25, 1.0625]);
    expect(study.provenance).toBe('verified_results');
    const report = convergenceStudyMarkdown(study); expect(report).toContain('Observed order p: 2'); expect(report).toContain('run-0.25');
  });
  it('rejects different inputs, different units, missing evaluation point, and duplicate results', () => {
    const results = [result(1, 2), result(0.5, 1.25), result(0.25, 1.0625)];
    const qoi = { fieldName: 'ux', unit: 'm', reduction: 'point' as const, position: [1, 0, 0] as [number, number, number] };
    results[2].metadata.comparison_fingerprint = 'changed-load'; expect(() => studyFromResults(results, qoi)).toThrow(/identical/);
    results[2].metadata.comparison_fingerprint = 'comparison'; results[2].fields[0].unit = 'mm'; expect(() => studyFromResults(results, qoi)).toThrow(/unit/);
    results[2].fields[0].unit = 'm'; expect(() => studyFromResults(results, { ...qoi, position: [2, 0, 0] })).toThrow(/point/);
    expect(() => studyFromResults([results[0], results[0], results[2]], qoi)).toThrow(/distinct/);
  });
});
