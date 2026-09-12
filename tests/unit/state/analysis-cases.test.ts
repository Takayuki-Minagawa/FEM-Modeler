import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisCase } from '@/core/ir/types';
import { useAppStore } from '@/state/store';
import { validateReferences } from '@/core/ir/relations';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler';

function analysisCase(id: string): AnalysisCase {
  return {
    id,
    name: id,
    active: true,
    domain_type: 'frame',
    analysis_type: 'static_linear',
    nonlinear: false,
    transient: false,
    participating_material_ids: [],
    participating_section_ids: [],
    participating_bc_ids: [],
    participating_load_ids: [],
    participating_ic_ids: [],
    mesh_policy_ref: '',
    solver_profile_hint: 'openseespy_frame_basic',
    result_requests: ['displacement'],
  };
}

describe('analysis-case store invariants', () => {
  beforeEach(() => useAppStore.getState().createProject('case test', 'frame'));

  it('keeps exactly one newly added case active', () => {
    useAppStore.getState().addAnalysisCase(analysisCase('case_a'));
    useAppStore.getState().addAnalysisCase(analysisCase('case_b'));

    expect(useAppStore.getState().ir.analysis_cases.map((item) => [item.id, item.active])).toEqual([
      ['case_a', false],
      ['case_b', true],
    ]);
  });

  it('activates a selected case atomically and promotes a successor on deletion', () => {
    useAppStore.getState().addAnalysisCase(analysisCase('case_a'));
    useAppStore.getState().addAnalysisCase(analysisCase('case_b'));
    useAppStore.getState().setActiveAnalysisCase('case_a');
    expect(useAppStore.getState().ir.analysis_cases.map((item) => item.active)).toEqual([true, false]);

    useAppStore.getState().removeAnalysisCase('case_a');
    expect(useAppStore.getState().ir.analysis_cases).toEqual([
      expect.objectContaining({ id: 'case_b', active: true }),
    ]);
  });

  it('scopes studies to their case and restores them with a deleted case in one Undo', () => {
    const store = useAppStore.getState();
    store.addAnalysisCase(analysisCase('case_a')); store.addAnalysisCase(analysisCase('case_b'));
    store.mutateArtifact('study', (ir) => { ir.convergence_studies.push({ id: 'study_a', name: 'study', created_at: '', analysis_case_id: 'case_a',
      qoi_definition: 'ux', evaluation_location: 'tip', unit: 'm', provenance: 'manual_unverified', notes: '',
      samples: [{ meshSize: 4, qoi: 16 }, { meshSize: 2, qoi: 4 }, { meshSize: 1, qoi: 1 }] }); });
    expect(scopeProjectForAnalysisCaseValidation(useAppStore.getState().ir, 'case_b').convergence_studies).toEqual([]);
    store.removeAnalysisCase('case_a');
    expect(useAppStore.getState().ir.convergence_studies).toEqual([]);
    store.undo();
    expect(useAppStore.getState().ir.convergence_studies).toHaveLength(1);
    expect(validateReferences(useAppStore.getState().ir)).toEqual([]);
  });
});
