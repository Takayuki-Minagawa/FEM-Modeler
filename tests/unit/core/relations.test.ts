import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { deleteMaterialCascade, validateReferences } from '@/core/ir/relations';

describe('ProjectIR relation graph', () => {
  it('cascades material deletion through sections and analysis participation', () => {
    const ir = createDefaultProject();
    ir.materials.push({
      id: 'mat', name: 'm', class: 'elastic', physical_model: 'isotropic_linear',
      parameter_set: {
        density: { value: null, status: 'missing' }, young_modulus: { value: 1, status: 'confirmed' },
        poisson_ratio: { value: null, status: 'missing' }, thermal_conductivity: { value: null, status: 'missing' },
        specific_heat: { value: null, status: 'missing' }, dynamic_viscosity: { value: null, status: 'missing' },
        kinematic_viscosity: { value: null, status: 'missing' },
      }, source: '', notes: '',
    });
    ir.sections.push({ id: 'sec', name: 's', section_type: 'beam_rect', dimensions: { width: 1 }, material_id: 'mat', area: 1, inertia_y: 1, inertia_z: 1, torsion_constant: 1, thickness: null, metadata: {} });
    ir.analysis_cases.push({ id: 'case', name: 'case', active: true, domain_type: 'frame', analysis_type: 'static_linear', nonlinear: false, transient: false, participating_material_ids: ['mat'], participating_section_ids: ['sec'], participating_bc_ids: [], participating_load_ids: [], participating_ic_ids: [], mesh_policy_ref: '', solver_profile_hint: 'openseespy_frame_basic', result_requests: [] });

    deleteMaterialCascade(ir, 'mat');

    expect(ir.materials).toEqual([]);
    expect(ir.sections).toEqual([]);
    expect(ir.analysis_cases[0].participating_material_ids).toEqual([]);
    expect(ir.analysis_cases[0].participating_section_ids).toEqual([]);
    expect(validateReferences(ir)).toEqual([]);
  });

  it('reports duplicate IDs and broken foreign keys', () => {
    const ir = createDefaultProject();
    ir.geometry.bodies.push({ id: 'same', name: 'a', category: 'solid', visible: true, locked: false, color: '#fff', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, topology_ref: '', asset_ref: 'missing', metadata: {} });
    ir.materials.push({
      id: 'same', name: 'm', class: 'elastic', physical_model: 'isotropic_linear',
      parameter_set: {
        density: { value: null, status: 'missing' }, young_modulus: { value: null, status: 'missing' },
        poisson_ratio: { value: null, status: 'missing' }, thermal_conductivity: { value: null, status: 'missing' },
        specific_heat: { value: null, status: 'missing' }, dynamic_viscosity: { value: null, status: 'missing' },
        kinematic_viscosity: { value: null, status: 'missing' },
      }, source: '', notes: '',
    });

    expect(validateReferences(ir).map((issue) => issue.code)).toEqual(expect.arrayContaining(['DUPLICATE_ID', 'BROKEN_REFERENCE']));
  });

  it('reports edge endpoint references to missing vertices', () => {
    const ir = createDefaultProject();
    ir.geometry.bodies.push({ id: 'body', name: 'body', category: 'beam_region', visible: true, locked: false, color: '#fff', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, topology_ref: '', metadata: {} });
    ir.geometry.vertices.push({ id: 'v1', name: 'v1', body_id: 'body', position: [0, 0, 0] });
    ir.geometry.edges.push({ id: 'edge', name: 'edge', body_id: 'body', vertex_ids: ['v1', 'missing'] });

    expect(validateReferences(ir)).toContainEqual({
      code: 'BROKEN_REFERENCE',
      sourceId: 'edge',
      field: 'vertex_ids',
      missingId: 'missing',
    });
  });

  it('checks orientation, attachment, coordinate-system, and function references', () => {
    const ir = createDefaultProject();
    ir.geometry.reference_frames.push({
      id: 'frame', name: 'frame', origin: [0, 0, 0], axis_x: [1, 0, 0], axis_y: [0, 1, 0], axis_z: [0, 0, 1],
      type: 'cartesian', attached_to: 'missing-body',
    });
    ir.sections.push({ id: 'section', name: 'section', section_type: 'beam_rect', dimensions: {}, material_id: '', area: null, inertia_y: null, inertia_z: null, torsion_constant: null, thickness: null, orientation_ref: 'missing-frame', metadata: {} });
    ir.boundary_conditions.push({
      id: 'bc', name: 'bc', physics_domain: 'structural', bc_type: 'fixed', target_named_selection_id: '',
      coordinate_system: 'missing-coordinate-frame', values: { function_ref: 'missing-function' },
      temporal_profile: 'constant', status: 'confirmed', notes: '',
    });

    expect(validateReferences(ir)).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: 'frame', field: 'attached_to', missingId: 'missing-body' }),
      expect.objectContaining({ sourceId: 'section', field: 'orientation_ref', missingId: 'missing-frame' }),
      expect.objectContaining({ sourceId: 'bc', field: 'coordinate_system', missingId: 'missing-coordinate-frame' }),
      expect.objectContaining({ sourceId: 'bc', field: 'values.function_ref', missingId: 'missing-function' }),
    ]));
  });
});
