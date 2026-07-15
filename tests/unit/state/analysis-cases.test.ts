import { beforeEach, describe, expect, it } from 'vitest';
import type { AnalysisCase } from '@/core/ir/types';
import { useAppStore } from '@/state/store';

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
});
