import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { generateNativeFrameMesh } from '@/mesh/native-frame';
import { parseProjectFile } from '@/export/project/load';
import { resultImportExpectations, resultInputStatus } from '@/core/ir/provenance';
import { resultSolverStatus } from '@/results/import-diagnostics';
import { verifyResultImport } from '@/results/importer';

beforeEach(() => { useAppStore.getState().createProject('Mesh persistence', 'frame'); applyTemplate('frame', 'en'); });

describe('mesh-only persistence contract', () => {
  it.each(['fields', 'checks', 'missing mesh'] as const)('rejects %s through project loading just as result import does', invalid => {
    const project = structuredClone(useAppStore.getState().ir);
    const result = generateNativeFrameMesh(project, project.analysis_cases[0].id);
    if (invalid === 'fields') result.fields = [{
      id: 'invalid-field', name: 'ux', location: 'node', component_names: ['ux'], unit: 'm',
      entity_ids: [result.mesh!.nodes[0].id], values: [1], minimum: 1, maximum: 1,
    }];
    else if (invalid === 'checks') result.checks = [{ kind: 'solver_execution', status: 'pass', value: 0, tolerance: 0, unit: '', message: 'Contradictory solver claim' }];
    else delete result.mesh;
    const imported = verifyResultImport(result, result.analysis_case_id, result.solver_target, resultImportExpectations(project, result.solver_target, result.analysis_case_id));
    expect(imported.success).toBe(false);
    expect(imported.error).toContain('mesh-only artifact');
    project.results.push(result);
    const loaded = parseProjectFile(JSON.stringify(project));
    expect(loaded.success).toBe(false);
    expect(loaded.error).toContain('mesh-only artifact');
    expect(loaded.data).toBeUndefined();
  });

  it('preserves valid mesh-only topology and its unsolved status on save and reload', () => {
    const project = structuredClone(useAppStore.getState().ir);
    const result = generateNativeFrameMesh(project, project.analysis_cases[0].id);
    project.results.push(result);
    const loaded = parseProjectFile(JSON.stringify(project));
    expect(loaded.success).toBe(true);
    expect(loaded.data!.results[0]).toEqual(result);
    expect(resultSolverStatus(loaded.data!.results[0])).toBe('not_run');
    expect(resultInputStatus(loaded.data!, loaded.data!.results[0])).toBe('current');
  });
});
