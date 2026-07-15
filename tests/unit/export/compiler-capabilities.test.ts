import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import type { AnalysisCase } from '@/core/ir/types';
import { preflightExport, scopeProjectToAnalysisCase } from '@/export/compiler';

function analysisCase(id: string, active: boolean): AnalysisCase {
  return {
    id,
    name: id,
    active,
    domain_type: 'solid',
    analysis_type: 'static_linear',
    nonlinear: false,
    transient: false,
    participating_material_ids: [],
    participating_section_ids: [],
    participating_bc_ids: [],
    participating_load_ids: [],
    participating_ic_ids: [],
    mesh_policy_ref: '',
    solver_profile_hint: 'dolfinx_linear_elasticity',
    result_requests: ['displacement'],
  };
}

describe('analysis-case export scoping', () => {
  it('activates only the explicitly selected case without mutating the project', () => {
    const project = createDefaultProject();
    project.analysis_cases = [analysisCase('case_a', true), analysisCase('case_b', false)];

    const scoped = scopeProjectToAnalysisCase(project, 'case_b');

    expect(scoped.analysis_cases.map((item) => [item.id, item.active])).toEqual([
      ['case_a', false],
      ['case_b', true],
    ]);
    expect(project.analysis_cases.map((item) => item.active)).toEqual([true, false]);
  });

  it('rejects a stale or unknown case selection', () => {
    const project = createDefaultProject();
    expect(() => scopeProjectToAnalysisCase(project, 'missing')).toThrow('does not exist');
  });

  it('keeps DOLFINx preflight aligned with strict section and mesh rejection', () => {
    const project = createDefaultProject();
    project.analysis_cases = [analysisCase('case')];
    project.analysis_cases[0].participating_section_ids = ['section'];
    project.mesh_controls.global.global_size = 0.1;
    project.mesh_controls.quality_targets.max_aspect_ratio = 20;
    project.sections.push({
      id: 'section',
      name: 'section',
      section_type: 'generic_frame_section',
      dimensions: {},
      material_id: '',
      area: 1,
      inertia_y: 1,
      inertia_z: 1,
      torsion_constant: null,
      thickness: null,
      metadata: {},
    });

    const result = preflightExport(project, 'DOLFINx', 'case');
    expect(result.errors.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'SECTION_UNSUPPORTED',
      'MESH_CONTROL_UNSUPPORTED',
    ]));
    expect(result.coverage?.consumedIds).not.toContain('section');
  });

  it('rejects OpenFOAM mesh intent that blockMesh does not consume', () => {
    const project = createDefaultProject();
    const fluidCase = analysisCase('fluid_case');
    fluidCase.domain_type = 'fluid';
    fluidCase.analysis_type = 'incompressible_flow_steady';
    fluidCase.solver_profile_hint = 'openfoam_simpleFoam';
    fluidCase.result_requests = ['velocity', 'pressure'];
    project.analysis_cases = [fluidCase];
    project.mesh_controls.global.global_size = 0.1;
    project.mesh_controls.global.element_order = 2;

    const result = preflightExport(project, 'OpenFOAM', 'fluid_case');
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'MESH_CONTROL_UNSUPPORTED',
      targetRef: 'mesh_controls.global.element_order',
    }));
  });
});
