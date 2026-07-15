import { describe, expect, it } from 'vitest';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import type { Material, NamedSelection, ProjectIR } from '@/core/ir/types';
import { generateShape } from '@/geometry/primitives/generators';
import { buildPhysicsAdvisorReport } from '@/validation/physics-advisor';

describe('physics advisor', () => {
  it('computes governing frame slenderness from assigned members and section data', () => {
    const ir = createDefaultProject();
    ir.meta.domain_type = 'frame';
    ir.geometry.bodies.push({
      id: 'body_frame',
      name: 'Frame',
      category: 'beam_region',
      visible: true,
      locked: false,
      color: '#fff',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      topology_ref: '',
      metadata: { shapeType: 'frame2d' },
    });
    ir.geometry.vertices.push(
      { id: 'v1', name: 'start', body_id: 'body_frame', position: [0, 0, 0] },
      { id: 'v2', name: 'end', body_id: 'body_frame', position: [3, 0, 0] },
    );
    ir.geometry.edges.push({
      id: 'edge_column',
      name: 'Column',
      body_id: 'body_frame',
      vertex_ids: ['v1', 'v2'],
      length: 3,
    });
    ir.named_selections.push(selection('ns_members', 'edge', ['edge_column']));
    ir.sections.push({
      id: 'section',
      name: 'Slender section',
      section_type: 'generic_frame_section',
      dimensions: {},
      material_id: 'material',
      area: 0.01,
      inertia_y: 1e-6,
      inertia_z: 4e-6,
      torsion_constant: null,
      thickness: null,
      metadata: { effective_length_factor: 1 },
    });
    ir.section_assignments.push({
      id: 'section_assignment',
      section_id: 'section',
      target_named_selection_id: 'ns_members',
    });

    const report = buildPhysicsAdvisorReport(ir);
    const metric = report.metrics.find((candidate) => candidate.kind === 'frame_slenderness');

    expect(metric?.value).toBeCloseTo(300, 12);
    expect(metric?.status).toBe('warning');
    expect(metric?.inputs.find((input) => input.name === 'minimum radius of gyration')?.value).toBeCloseTo(0.01);
    expect(report.notices.some((notice) => notice.code === 'FRAME_SLENDERNESS_HIGH')).toBe(true);
  });

  it('derives circular-section inertia when explicit inertias are absent', () => {
    const ir = createSingleMemberProject(2);
    ir.sections.push({
      id: 'round',
      name: 'Round',
      section_type: 'beam_circle',
      dimensions: { diameter: 0.1 },
      material_id: 'material',
      area: null,
      inertia_y: null,
      inertia_z: null,
      torsion_constant: null,
      thickness: null,
      metadata: { effective_length_factor: 1 },
    });
    ir.section_assignments.push({ id: 'assign', section_id: 'round', target_named_selection_id: 'ns_edge' });

    const metric = buildPhysicsAdvisorReport(ir).metrics.find(
      (candidate) => candidate.kind === 'frame_slenderness',
    );

    // For a circular section r=d/4, so lambda=L/r=80.
    expect(metric?.value).toBeCloseTo(80, 12);
    expect(metric?.status).toBe('caution');
  });

  it('computes channel Reynolds number from inlet, assignment, and viscosity', () => {
    const ir = createDefaultProject();
    ir.meta.domain_type = 'fluid';
    const channel = generateShape({ shapeType: 'channel', length: 6, height: 1, depth: 0.5 }, 'Channel');
    addShape(ir, channel);
    const inletFace = channel.faces.find((face) => face.name === 'inlet')!;
    ir.named_selections.push(
      selection('ns_inlet', 'face', [inletFace.id]),
      selection('ns_fluid', 'body', [channel.body.id]),
    );
    const fluid = material('water', {
      density: 1_000,
      dynamic_viscosity: 1e-3,
    });
    ir.materials.push(fluid);
    ir.material_assignments.push({
      id: 'assign_fluid',
      material_id: fluid.id,
      target_named_selection_id: 'ns_fluid',
      override_allowed: false,
    });
    ir.boundary_conditions.push({
      id: 'inlet',
      name: 'Inlet',
      physics_domain: 'fluid',
      bc_type: 'velocity_inlet',
      target_named_selection_id: 'ns_inlet',
      coordinate_system: 'global',
      values: { vector: [2, 0, 0] },
      temporal_profile: 'constant',
      status: 'confirmed',
      notes: '',
    });

    const report = buildPhysicsAdvisorReport(ir);
    const metric = report.metrics.find((candidate) => candidate.kind === 'reynolds_number');

    expect(metric?.value).toBeCloseTo(1_333_333.333333, 4);
    expect(metric?.status).toBe('warning');
    expect(report.notices.some((notice) => notice.code === 'REYNOLDS_TURBULENT_RANGE')).toBe(true);
  });

  it('computes Biot and Fourier numbers only from explicit thermal inputs', () => {
    const ir = createDefaultProject();
    ir.meta.domain_type = 'thermal';
    const cube = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }, 'Thermal cube');
    addShape(ir, cube);
    const topFace = cube.faces.find((face) => face.name === 'top')!;
    ir.named_selections.push(
      selection('ns_top', 'face', [topFace.id]),
      selection('ns_body', 'body', [cube.body.id]),
    );
    const solid = material('steel', {
      density: 7_800,
      thermal_conductivity: 50,
      specific_heat: 500,
    });
    ir.materials.push(solid);
    ir.material_assignments.push({
      id: 'assign_solid',
      material_id: solid.id,
      target_named_selection_id: 'ns_body',
      override_allowed: false,
    });
    ir.boundary_conditions.push({
      id: 'convection',
      name: 'Convection',
      physics_domain: 'thermal',
      bc_type: 'convection',
      target_named_selection_id: 'ns_top',
      coordinate_system: 'global',
      values: { heat_transfer_coefficient: 5, ambient_temperature: 293.15 },
      temporal_profile: 'constant',
      status: 'confirmed',
      notes: '',
    });
    ir.analysis_cases.push({
      id: 'thermal_case',
      name: 'Transient',
      active: true,
      domain_type: 'thermal',
      analysis_type: 'transient_thermal',
      nonlinear: false,
      transient: true,
      participating_material_ids: [solid.id],
      participating_section_ids: [],
      participating_bc_ids: ['convection'],
      participating_load_ids: [],
      participating_ic_ids: [],
      mesh_policy_ref: '',
      solver_profile_hint: 'dolfinx_steady_heat',
      result_requests: ['temperature'],
    });
    ir.solver_targets.find((target) => target.target_name === 'DOLFINx')!.solver_options.duration = 7_800;

    const report = buildPhysicsAdvisorReport(ir);
    const biot = report.metrics.find((metric) => metric.kind === 'biot_number');
    const fourier = report.metrics.find((metric) => metric.kind === 'fourier_number');

    expect(biot?.value).toBeCloseTo(0.1, 12);
    expect(biot?.status).toBe('caution');
    expect(fourier?.value).toBeCloseTo(0.1, 12);
    expect(fourier?.status).toBe('caution');
    expect(report.notices.some((notice) => notice.code === 'BIOT_MODERATE')).toBe(true);
    expect(report.notices.some((notice) => notice.code === 'FOURIER_EARLY_TRANSIENT')).toBe(true);

    delete ir.solver_targets.find((target) => target.target_name === 'DOLFINx')!.solver_options.duration;
    ir.solver_targets.find((target) => target.target_name === 'OpenFOAM')!.solver_options.endTime = 7_800;
    const unrelatedDuration = buildPhysicsAdvisorReport(ir);
    expect(unrelatedDuration.metrics.some((metric) => metric.kind === 'fourier_number')).toBe(false);
    expect(unrelatedDuration.notices.some((notice) => notice.code === 'FOURIER_INPUTS_INCOMPLETE')).toBe(true);

    ir.analysis_cases[0].analysis_type = 'steady_thermal';
    ir.analysis_cases[0].transient = false;
    ir.solver_targets.find((target) => target.target_name === 'DOLFINx')!.solver_options.duration = 7_800;
    const steady = buildPhysicsAdvisorReport(ir);
    expect(steady.metrics.some((metric) => metric.kind === 'fourier_number')).toBe(false);
    expect(steady.notices.some((notice) => notice.code.startsWith('FOURIER_'))).toBe(false);
  });

  it('emits typed missing-input notices instead of fabricated fluid metrics', () => {
    const ir = createDefaultProject();
    ir.meta.domain_type = 'fluid';
    const report = buildPhysicsAdvisorReport(ir);

    expect(report.metrics.filter((metric) => metric.kind === 'reynolds_number')).toHaveLength(0);
    expect(report.notices).toContainEqual(expect.objectContaining({
      severity: 'info',
      code: 'REYNOLDS_INPUTS_INCOMPLETE',
    }));
  });

  it('warns about near-incompressible locking only for explicitly assigned materials', () => {
    const ir = createDefaultProject();
    const solid = material('rubber', {});
    solid.parameter_set.poisson_ratio = { value: 0.495, status: 'confirmed' };
    ir.materials.push(solid);
    ir.named_selections.push(selection('body', 'body', ['solid-body']));
    ir.material_assignments.push({
      id: 'assignment',
      material_id: solid.id,
      target_named_selection_id: 'body',
      override_allowed: false,
    });

    const report = buildPhysicsAdvisorReport(ir);

    expect(report.notices).toContainEqual(expect.objectContaining({
      code: 'NEAR_INCOMPRESSIBLE_LOCKING',
      targetRefs: ['rubber', 'assignment'],
    }));
  });
});

function selection(
  id: string,
  entityType: NamedSelection['entity_type'],
  memberRefs: string[],
): NamedSelection {
  return {
    id,
    name: id,
    target_dimension: entityType === 'body' ? 3 : entityType === 'face' ? 2 : entityType === 'edge' ? 1 : 0,
    entity_type: entityType,
    member_refs: memberRefs,
    color: '#fff',
    description: '',
    created_by: 'user',
    status: 'active',
    usages: [],
  };
}

function material(
  id: string,
  values: Partial<Record<'density' | 'thermal_conductivity' | 'specific_heat' | 'dynamic_viscosity', number>>,
): Material {
  const parameterSet = createEmptyParameterSet();
  for (const [key, value] of Object.entries(values)) {
    parameterSet[key as keyof typeof parameterSet] = { value: value ?? null, status: 'confirmed' };
  }
  return {
    id,
    name: id,
    class: values.dynamic_viscosity ? 'fluid_newtonian' : 'thermo_elastic',
    physical_model: values.dynamic_viscosity ? 'incompressible_newtonian' : 'constant_property',
    parameter_set: parameterSet,
    source: 'test',
    notes: '',
  };
}

function addShape(ir: ProjectIR, shape: ReturnType<typeof generateShape>): void {
  ir.geometry.bodies.push(shape.body);
  ir.geometry.faces.push(...shape.faces);
  ir.geometry.edges.push(...shape.edges);
  ir.geometry.vertices.push(...shape.vertices);
}

function createSingleMemberProject(length: number): ProjectIR {
  const ir = createDefaultProject();
  ir.meta.domain_type = 'frame';
  ir.geometry.bodies.push({
    id: 'body',
    name: 'Member',
    category: 'beam_region',
    visible: true,
    locked: false,
    color: '#fff',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    topology_ref: '',
    metadata: {},
  });
  ir.geometry.vertices.push(
    { id: 'a', name: 'a', body_id: 'body', position: [0, 0, 0] },
    { id: 'b', name: 'b', body_id: 'body', position: [length, 0, 0] },
  );
  ir.geometry.edges.push({ id: 'edge', name: 'edge', body_id: 'body', vertex_ids: ['a', 'b'], length });
  ir.named_selections.push(selection('ns_edge', 'edge', ['edge']));
  return ir;
}
