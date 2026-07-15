import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { runValidation } from '@/validation/engine';

describe('case-scoped validation', () => {
  it('does not block a selected case with an unrelated unresolved named selection', () => {
    const project = createDefaultProject();
    project.named_selections.push({
      id: 'unrelated_draft', name: 'Unrelated draft', target_dimension: 2, entity_type: 'face',
      member_refs: ['missing_face'], color: '#fff', description: '', created_by: 'user',
      status: 'unresolved', usages: [],
    });
    project.analysis_cases.push({
      id: 'selected_case', name: 'Selected', active: true, domain_type: 'solid',
      analysis_type: 'static_linear', nonlinear: false, transient: false,
      participating_material_ids: [], participating_section_ids: [], participating_bc_ids: [],
      participating_load_ids: [], participating_ic_ids: [], mesh_policy_ref: '',
      solver_profile_hint: 'dolfinx_linear_elasticity', result_requests: ['displacement'],
    });

    const validation = runValidation(project, 'DOLFINx', 'selected_case');

    expect(validation.items.some((item) => item.target_ref === 'unrelated_draft')).toBe(false);
    expect(validation.items.some((item) => item.code === 'NS_UNRESOLVED')).toBe(false);
  });

  it('does not apply unrelated solid-geometry rules to a selected frame case', () => {
    const project = createDefaultProject();
    project.geometry.bodies.push({
      id: 'unrelated_pipe', name: 'Unrelated invalid pipe', category: 'solid', visible: true, locked: false,
      color: '#fff', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      topology_ref: '', asset_ref: undefined,
      metadata: { shapeType: 'pipe', innerRadius: 2, outerRadius: 1, height: 1 },
    });
    project.analysis_cases.push({
      id: 'frame_case', name: 'Frame', active: true, domain_type: 'frame',
      analysis_type: 'static_linear', nonlinear: false, transient: false,
      participating_material_ids: [], participating_section_ids: [], participating_bc_ids: [],
      participating_load_ids: [], participating_ic_ids: [], mesh_policy_ref: '',
      solver_profile_hint: 'openseespy_frame_basic', result_requests: ['displacement'],
    });

    const validation = runValidation(project, 'OpenSeesPy', 'frame_case');
    expect(validation.items.some((item) => item.code === 'GEOM_PIPE_RADII')).toBe(false);
  });
});
