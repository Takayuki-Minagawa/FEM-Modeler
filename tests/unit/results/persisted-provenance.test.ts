import { beforeEach, describe, expect, it } from 'vitest';
import { applyTemplate } from '@/lib/project-templates';
import { useAppStore } from '@/state/store';
import { createExportProvenance, resultImportExpectations, resultMatchesInput } from '@/core/ir/provenance';
import { importResultText } from '@/results/importer';
import { parseProjectFile } from '@/export/project/load';

function projectWithResult() {
  const ir = structuredClone(useAppStore.getState().ir);
  const caseId = ir.analysis_cases[0].id;
  const manifest = createExportProvenance(ir, 'OpenSeesPy', caseId);
  const mesh = { length_unit: 'm', nodes: [{ id: 'n1', position: [0, 0, 0] }, { id: 'n2', position: [1, 0, 0] }],
    elements: [{ id: 'e1', type: 'line2', node_ids: ['n1', 'n2'], boundary_tags: [] }],
    source: { solver: 'OpenSeesPy', generator: 'test', input_fingerprint: manifest.input_fingerprint }, quality: [] };
  const imported = importResultText(JSON.stringify({ format: 'fem-modeler-result-package-v1', manifest, mesh,
    fields: [{ name: 'ux', unit: 'm', location: 'node', entity_ids: ['n1', 'n2'], values: [0, 0.001] }] }),
  'result_package.json', caseId, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', caseId));
  expect(imported.success).toBe(true);
  ir.results.push(imported.result!);
  return ir;
}

describe('persisted mesh result identity', () => {
  beforeEach(() => { useAppStore.getState().createProject('saved results', 'frame'); applyTemplate('frame'); });

  it('round trips consistent results and retains stale results without labelling them current', () => {
    const ir = projectWithResult();
    expect(resultMatchesInput(ir, ir.results[0])).toBe(true);
    const loaded = parseProjectFile(JSON.stringify(ir));
    expect(loaded.success).toBe(true);
    expect(resultMatchesInput(loaded.data!, loaded.data!.results[0])).toBe(true);
    ir.loads[0].magnitude *= 2;
    const stale = parseProjectFile(JSON.stringify(ir));
    expect(stale.success).toBe(true);
    expect(resultMatchesInput(stale.data!, stale.data!.results[0])).toBe(false);
  });

  it.each(['solver', 'fingerprint', 'case', 'target'] as const)('rejects mismatched %s despite a stored verified flag', (mutation) => {
    const ir = projectWithResult(), result = ir.results[0];
    if (mutation === 'solver') result.mesh!.source.solver = 'DOLFINx';
    if (mutation === 'fingerprint') result.mesh!.source.input_fingerprint = `sha256:${'a'.repeat(64)}`;
    if (mutation === 'case') result.metadata.analysis_case_id = 'another-case';
    if (mutation === 'target') result.metadata.export_target = 'OpenFOAM';
    expect(result.metadata.provenance_verified).toBe(true);
    expect(resultMatchesInput(ir, result)).toBe(false);
    expect(parseProjectFile(JSON.stringify(ir)).error).toContain('provenance');
  });

  it.each(['missing-node', 'missing-cell', 'duplicate-field', 'unsupported-location'] as const)('rejects %s in a saved mesh result', (mutation) => {
    const ir = projectWithResult(), result = ir.results[0], field = result.fields[0];
    if (mutation === 'missing-node') field.entity_ids[0] = 'unknown-node';
    if (mutation === 'missing-cell') field.location = 'cell';
    if (mutation === 'duplicate-field') result.fields.push({ ...field, id: 'different-id' });
    if (mutation === 'unsupported-location') field.location = 'facet';
    expect(parseProjectFile(JSON.stringify(ir)).success).toBe(false);
  });

  it('cannot treat an incomplete persisted run identity as current', () => {
    const ir = projectWithResult();
    ir.results[0].metadata.run_id = '';
    expect(resultMatchesInput(ir, ir.results[0])).toBe(false);
  });
});
