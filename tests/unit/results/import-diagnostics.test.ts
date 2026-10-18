import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { createExportProvenance, resultImportExpectations, resultInputStatus, resultMatchesInput } from '@/core/ir/provenance';
import { importResultText, verifyResultImport } from '@/results/importer';
import { resultImportDiagnostics, resultImportOutcome, resultSolverStatus } from '@/results/import-diagnostics';
import { parseProjectFile } from '@/export/project/load';

beforeEach(() => { useAppStore.getState().createProject('result diagnostics', 'frame'); applyTemplate('frame', 'en'); });
const project = () => structuredClone(useAppStore.getState().ir);
function verifiedResult() {
  const ir = project(), id = ir.analysis_cases[0].id;
  const metadata = createExportProvenance(ir, 'OpenSeesPy', id);
  const result = importResultText(`# FEM_MODELER_PROVENANCE ${JSON.stringify(metadata)}\nnode,ux_m\n1,0`, 'verified.csv', id, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', id)).result!;
  return { ir, result, id };
}

describe('persisted result import diagnostics', () => {
  it('retains every warning and the missing column, line and reason across save/reload', () => {
    const ir = project(), id = ir.analysis_cases[0].id;
    const response = importResultText('node,ux_m,uy_m\n1,0,1\n2,0.001,', 'partial.csv', id, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', id));
    expect(response.success).toBe(true);
    const result = response.result!;
    expect(result.fields.map((field) => field.name)).toEqual(['ux']);
    expect(resultImportOutcome(result)).toBe('partial');
    expect(resultImportDiagnostics(result)).toContainEqual(expect.objectContaining({
      code: 'excluded_column', column: 'uy_m', column_index: 3, source_rows: [3], reason: 'missing_value',
    }));
    expect(response.warnings).toHaveLength(4);
    expect(result.metadata.import_warnings).toEqual(response.warnings);
    expect(resultInputStatus(ir, result)).toBe('unverified');
    ir.results.push(result);
    const loaded = parseProjectFile(JSON.stringify(ir));
    expect(loaded.success).toBe(true);
    expect(loaded.data!.results[0].metadata).toEqual(result.metadata);
    expect(resultInputStatus(loaded.data!, loaded.data!.results[0])).toBe('unverified');
  });

  it('distinguishes missing, nonnumeric and non-finite cells, with source lines including provenance and blank records', () => {
    const ir = project(), id = ir.analysis_cases[0].id;
    const header = `# FEM_MODELER_PROVENANCE ${JSON.stringify(createExportProvenance(ir, 'OpenSeesPy', id))}\n`;
    const result = importResultText(`${header}node,ux_m,uy_m,label\n\n1,0,,"first\nline"\n2,1,NaN,text\n3,2,Infinity,hello\n4,3,1e999,last`, 'mixed.csv', id, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', id)).result!;
    expect(resultImportDiagnostics(result).filter((item) => item.column === 'uy_m')).toEqual([
      expect.objectContaining({ reason: 'missing_value', source_rows: [4] }),
      expect.objectContaining({ reason: 'nonnumeric_value', source_rows: [6] }),
      expect.objectContaining({ reason: 'nonfinite_value', source_rows: [7, 8] }),
    ]);
    expect(result.fields[0].values).toEqual([0, 1, 2, 3]);
    const reverified = verifyResultImport(result, id, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', id));
    expect(reverified.warnings).toEqual(result.metadata.import_warnings);
  });

  it('separates import success, provenance warnings and solver execution/convergence', () => {
    const { ir, result, id } = verifiedResult();
    expect(resultImportOutcome(result)).toBe('success');
    expect(resultSolverStatus(result)).toBe('not_reported');
    expect(result.metadata.solver_status).toBe('not_reported');
    const unchecked = importResultText('node,ux_m\n1,0', 'unverified.csv', id, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', id)).result!;
    expect(resultImportOutcome(unchecked)).toBe('warning');
    expect(resultSolverStatus(unchecked)).toBe('not_reported');
    const execution = importResultText(JSON.stringify({ execution_return_code: 0 }), 'manifest.json', id, 'OpenSeesPy').result!;
    expect(resultSolverStatus(execution)).toBe('execution_succeeded');
    const failure = importResultText(JSON.stringify({ analysis_return_code: 1 }), 'manifest.json', id, 'OpenSeesPy').result!;
    expect(resultSolverStatus(failure)).toBe('failed');
  });
});

describe('result input status evidence', () => {
  it('marks a verified result stale only after inputs change, and current again on restoration', () => {
    const { ir, result } = verifiedResult();
    expect(resultInputStatus(ir, result)).toBe('current');
    expect(resultMatchesInput(ir, result)).toBe(true);
    const magnitude = ir.loads[0].magnitude;
    ir.loads[0].magnitude += 10;
    expect(resultInputStatus(ir, result)).toBe('stale');
    expect(resultMatchesInput(ir, result)).toBe(false);
    ir.loads[0].magnitude = magnitude;
    expect(resultInputStatus(ir, result)).toBe('current');
    delete result.metadata.input_fingerprint;
    expect(resultInputStatus(ir, result)).toBe('unverified');
  });

  it('uses matching comparison evidence for an explicitly imported mesh variant and detects subsequent physics edits', () => {
    const { ir, result, id } = verifiedResult();
    ir.mesh_controls.global.global_size *= 0.5;
    const response = verifyResultImport(result, id, 'OpenSeesPy', { ...resultImportExpectations(ir, 'OpenSeesPy', id), allowMeshVariation: true });
    expect(response.success).toBe(true);
    const variant = response.result!;
    expect(resultInputStatus(ir, variant)).toBe('mesh_variant');
    expect(resultMatchesInput(ir, variant)).toBe(false);
    ir.results.push(variant);
    const loaded = parseProjectFile(JSON.stringify(ir)).data!;
    expect(resultInputStatus(loaded, loaded.results[0])).toBe('mesh_variant');
    ir.loads[0].magnitude += 10;
    expect(resultInputStatus(ir, variant)).toBe('stale');
  });
});
