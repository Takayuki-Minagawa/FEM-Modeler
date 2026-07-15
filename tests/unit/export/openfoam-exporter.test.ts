import { describe, expect, it } from 'vitest';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import type {
  AnalysisCase,
  BoundaryCondition,
  Material,
  NamedSelection,
  ProjectIR,
} from '@/core/ir/types';
import { preflightExport } from '@/export/compiler/capabilities';
import { exportOpenFOAM } from '@/export/openfoam/exporter';
import { generateShape } from '@/geometry/primitives/generators';

const IDS = {
  bodySelection: 'ns_body',
  inletSelection: 'ns_inlet',
  outletSelection: 'ns_outlet',
  topWallSelection: 'ns_wall_top',
  bottomWallSelection: 'ns_wall_bottom',
  material: 'mat_water',
  inletBC: 'bc_inlet',
  outletBC: 'bc_outlet',
  topWallBC: 'bc_wall_top',
  bottomWallBC: 'bc_wall_bottom',
  analysisCase: 'case_fluid',
};

function namedSelection(
  id: string,
  name: string,
  memberRef: string,
  targetDimension: 2 | 3,
): NamedSelection {
  return {
    id,
    name,
    display_name: name,
    target_dimension: targetDimension,
    entity_type: targetDimension === 2 ? 'face' : 'body',
    member_refs: [memberRef],
    color: '#000000',
    description: '',
    created_by: 'user',
    status: 'active',
    usages: [],
  };
}

function waterMaterial(): Material {
  return {
    id: IDS.material,
    name: 'Water',
    class: 'fluid_newtonian',
    physical_model: 'incompressible_newtonian',
    parameter_set: {
      ...createEmptyParameterSet(),
      density: { value: 1000, status: 'confirmed' },
      dynamic_viscosity: { value: 1e-3, status: 'confirmed' },
      kinematic_viscosity: { value: 1e-6, status: 'confirmed' },
    },
    source: 'test',
    notes: '',
  };
}

function fluidAnalysisCase(): AnalysisCase {
  return {
    id: IDS.analysisCase,
    name: 'Steady channel',
    active: true,
    domain_type: 'fluid',
    analysis_type: 'incompressible_flow_steady',
    nonlinear: false,
    transient: false,
    participating_material_ids: [IDS.material],
    participating_section_ids: [],
    participating_bc_ids: [IDS.inletBC, IDS.outletBC, IDS.topWallBC, IDS.bottomWallBC],
    participating_load_ids: [],
    participating_ic_ids: [],
    mesh_policy_ref: '',
    solver_profile_hint: 'openfoam_simpleFoam',
    result_requests: ['velocity', 'pressure'],
  };
}

function validProject(mode: '2D' | '3D' | undefined = '3D'): ProjectIR {
  const project = createDefaultProject();
  project.meta.domain_type = 'fluid';
  project.meta.default_solver_target = 'OpenFOAM';
  const shape = generateShape(
    { shapeType: 'channel', length: 6, height: 1, depth: 1 },
    'Channel',
  );
  project.geometry.bodies.push(shape.body);
  project.geometry.faces.push(...shape.faces);
  project.geometry.vertices.push(...shape.vertices);
  const faceId = (name: string) => shape.faces.find((face) => face.name === name)!.id;
  project.named_selections.push(
    namedSelection(IDS.bodySelection, 'fluid_domain', shape.body.id, 3),
    namedSelection(IDS.inletSelection, 'inlet', faceId('inlet'), 2),
    namedSelection(IDS.outletSelection, 'outlet', faceId('outlet'), 2),
    namedSelection(IDS.topWallSelection, 'wall_top', faceId('wall_top'), 2),
    namedSelection(IDS.bottomWallSelection, 'wall_bottom', faceId('wall_bottom'), 2),
  );
  project.materials.push(waterMaterial());
  project.material_assignments.push({
    id: 'assign_water',
    material_id: IDS.material,
    target_named_selection_id: IDS.bodySelection,
    override_allowed: false,
  });

  const inlet: BoundaryCondition = {
    id: IDS.inletBC,
    name: 'Velocity inlet',
    physics_domain: 'fluid',
    bc_type: 'velocity_inlet',
    target_named_selection_id: IDS.inletSelection,
    coordinate_system: 'global',
    values: { vector: [0.0001, 0, 0] },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
  const outlet: BoundaryCondition = {
    id: IDS.outletBC,
    name: 'Pressure outlet',
    physics_domain: 'fluid',
    bc_type: 'pressure_outlet',
    target_named_selection_id: IDS.outletSelection,
    coordinate_system: 'global',
    values: { scalar: 0, pressure_basis: 'kinematic' },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
  const wall = (
    id: string,
    name: string,
    selectionId: string,
  ): BoundaryCondition => ({
    id,
    name,
    physics_domain: 'fluid',
    bc_type: 'no_slip',
    target_named_selection_id: selectionId,
    coordinate_system: 'global',
    values: {},
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  });
  project.boundary_conditions.push(
    inlet,
    outlet,
    wall(IDS.topWallBC, 'Top wall', IDS.topWallSelection),
    wall(IDS.bottomWallBC, 'Bottom wall', IDS.bottomWallSelection),
  );
  project.analysis_cases.push(fluidAnalysisCase());
  project.mesh_controls.global.global_size = 0.5;

  const target = project.solver_targets.find((candidate) => candidate.target_name === 'OpenFOAM')!;
  target.enabled = true;
  target.export_profile = 'strict';
  target.solver_options = mode === undefined ? {} : { dimensionality: mode };
  return project;
}

function expectBalancedDictionary(content: string): void {
  expect(content.split('{')).toHaveLength(content.split('}').length);
  expect(content.split('(')).toHaveLength(content.split(')').length);
}

describe('OpenFOAM exporter contract', () => {
  it('emits a complete and internally consistent 2D simpleFoam case', () => {
    const result = exportOpenFOAM(validProject('2D'));

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.files).sort()).toEqual([
      '0/U',
      '0/p',
      'constant/transportProperties',
      'constant/turbulenceProperties',
      'system/blockMeshDict',
      'system/controlDict',
      'system/fvSchemes',
      'system/fvSolution',
    ]);

    const blockMesh = result.files['system/blockMeshDict'];
    expect(blockMesh).toContain('hex (0 1 2 3 4 5 6 7) (12 2 1)');
    expect(blockMesh).toMatch(/frontAndBack\s*\{\s*type empty;/);
    expect(result.files['0/U']).toMatch(/frontAndBack\s*\{\s*type\s+empty;/);
    expect(result.files['0/p']).toMatch(/frontAndBack\s*\{\s*type\s+empty;/);
    expect(result.files['system/controlDict']).toContain('application     simpleFoam;');
    expect(result.files['constant/transportProperties']).toContain(
      'nu              [0 2 -1 0 0 0 0] 0.000001;',
    );
    expect(result.files['constant/transportProperties']).toContain('transportModel  Newtonian;');
    expect(result.files['constant/turbulenceProperties']).toContain('simulationType  laminar;');
    for (const content of Object.values(result.files)) expectBalancedDictionary(content);
  });

  it('rejects a turbulent-regime request while only the laminar model is implemented', () => {
    const project = validProject('2D');
    project.boundary_conditions.find((bc) => bc.id === IDS.inletBC)!.values.vector = [0.0012, 0, 0];

    const result = exportOpenFOAM(project);
    const manifest = JSON.parse(result.manifest) as {
      hydraulic_diameter_m: number;
      reynolds_number: number;
    };

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('Reynolds number below 2300'))).toBe(true);
    expect(manifest.hydraulic_diameter_m).toBeCloseTo(2);
    expect(manifest.reynolds_number).toBeCloseTo(2400);
  });

  it('requires inlet velocity to follow the transformed channel axis', () => {
    const aligned = validProject('2D');
    aligned.geometry.bodies[0].transform.rotation = [0, 0, 90];
    aligned.boundary_conditions.find((bc) => bc.id === IDS.inletBC)!.values.vector = [0, 0.0001, 0];
    expect(exportOpenFOAM(aligned).success).toBe(true);

    const misaligned = validProject('2D');
    misaligned.geometry.bodies[0].transform.rotation = [0, 0, 90];
    const result = exportOpenFOAM(misaligned);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('transformed channel inlet-to-outlet axis'))).toBe(true);
  });

  it('maps boundary patches by exact topology face ID, independent of BC order or labels', () => {
    const project = validProject('2D');
    project.named_selections.find((selection) => selection.id === IDS.topWallSelection)!.name = 'ceiling';
    project.named_selections.find((selection) => selection.id === IDS.bottomWallSelection)!.name = 'floor';
    project.boundary_conditions.reverse();

    const result = exportOpenFOAM(project);

    expect(result.success).toBe(true);
    expect(result.files['system/blockMeshDict']).toMatch(/ceiling\s*\{\s*type wall;\s*faces\s*\(\s*\(3 7 6 2\)/);
    expect(result.files['system/blockMeshDict']).toMatch(/floor\s*\{\s*type wall;\s*faces\s*\(\s*\(1 5 4 0\)/);
  });

  it('rejects body, wrong-entity, multi-face, duplicate, and role-mismatched boundary selections', () => {
    const bodyRef = validProject();
    const bodySelection = bodyRef.named_selections.find((selection) => selection.id === IDS.inletSelection)!;
    bodySelection.target_dimension = 3;
    bodySelection.entity_type = 'body';
    bodySelection.member_refs = [bodyRef.geometry.bodies[0].id];
    const bodyResult = exportOpenFOAM(bodyRef);
    expect(bodyResult.errors.some((error) => error.includes('topology face ID is required'))).toBe(true);
    expect(bodyResult.errors.some((error) => error.includes('must be a 2D face selection'))).toBe(true);

    const multiFace = validProject();
    const multiSelection = multiFace.named_selections.find((selection) => selection.id === IDS.inletSelection)!;
    multiSelection.member_refs.push(
      multiFace.named_selections.find((selection) => selection.id === IDS.topWallSelection)!.member_refs[0],
    );
    expect(exportOpenFOAM(multiFace).errors.some((error) => error.includes('exactly one channel face'))).toBe(true);

    const roleMismatch = validProject();
    roleMismatch.named_selections.find(
      (selection) => selection.id === IDS.inletSelection,
    )!.member_refs = [...roleMismatch.named_selections.find(
      (selection) => selection.id === IDS.outletSelection,
    )!.member_refs];
    expect(exportOpenFOAM(roleMismatch).errors.some(
      (error) => error.includes('required topology role is inlet'),
    )).toBe(true);

    const duplicateSelection = validProject();
    duplicateSelection.boundary_conditions.find(
      (condition) => condition.id === IDS.outletBC,
    )!.target_named_selection_id = IDS.inletSelection;
    expect(exportOpenFOAM(duplicateSelection).errors.some(
      (error) => error.includes('assigned to multiple channel boundary conditions'),
    )).toBe(true);

    const duplicateWall = validProject();
    duplicateWall.named_selections.find(
      (selection) => selection.id === IDS.bottomWallSelection,
    )!.member_refs = [...duplicateWall.named_selections.find(
      (selection) => selection.id === IDS.topWallSelection,
    )!.member_refs];
    const duplicateResult = exportOpenFOAM(duplicateWall);
    expect(duplicateResult.errors.some((error) => error.includes('one-to-one to wall_top and wall_bottom'))).toBe(true);
    expect(duplicateResult.errors.some((error) => error.includes('assigned to multiple boundary conditions'))).toBe(true);
  });

  it('requires two confirmed, constant, global top/bottom wall conditions', () => {
    const missingWall = validProject();
    missingWall.boundary_conditions = missingWall.boundary_conditions.filter(
      (condition) => condition.id !== IDS.bottomWallBC,
    );
    missingWall.analysis_cases[0].participating_bc_ids = missingWall.analysis_cases[0].participating_bc_ids.filter(
      (id) => id !== IDS.bottomWallBC,
    );
    expect(exportOpenFOAM(missingWall).errors.some(
      (error) => error.includes('requires exactly two top/bottom wall conditions; found 1'),
    )).toBe(true);

    const invalidWall = validProject();
    const wall = invalidWall.boundary_conditions.find((condition) => condition.id === IDS.topWallBC)!;
    wall.status = 'needs_review';
    wall.temporal_profile = 'ramp';
    wall.coordinate_system = 'local';
    const result = exportOpenFOAM(invalidWall);
    expect(result.errors.some((error) => error.includes('must have confirmed status'))).toBe(true);
    expect(result.errors.some((error) => error.includes('constant temporal profile'))).toBe(true);
    expect(result.errors.some((error) => error.includes('global coordinate system'))).toBe(true);
  });

  it('aligns strict capability checks with the supported fluid boundary types', () => {
    const project = validProject();
    project.boundary_conditions.find((condition) => condition.id === IDS.topWallBC)!.bc_type = 'slip';

    const preflight = preflightExport(project, 'OpenFOAM', IDS.analysisCase);
    const exported = exportOpenFOAM(project);

    expect(preflight.errors.some((error) => error.code === 'BC_UNSUPPORTED')).toBe(true);
    expect(exported.errors.some((error) => error.includes('(slip) is not supported'))).toBe(true);
  });

  it('rejects ambiguous dimensionality instead of silently choosing 3D', () => {
    const project = validProject();
    project.solver_targets.find(
      (candidate) => candidate.target_name === 'OpenFOAM',
    )!.solver_options = {};
    const result = exportOpenFOAM(project);

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('dimensionality must be explicit'))).toBe(true);
  });

  it('keeps an explicitly requested 3D front/back patch consistent across dictionaries', () => {
    const project = validProject('3D');
    project.solver_targets.find(
      (candidate) => candidate.target_name === 'OpenFOAM',
    )!.solver_options.front_back_type = 'patch';

    const result = exportOpenFOAM(project);

    expect(result.success).toBe(true);
    expect(result.files['system/blockMeshDict']).toMatch(/frontAndBack\s*\{\s*type patch;/);
    expect(result.files['0/U']).toMatch(/frontAndBack\s*\{\s*type\s+zeroGradient;/);
    expect(result.files['0/p']).toMatch(/frontAndBack\s*\{\s*type\s+zeroGradient;/);
  });

  it('rejects multiple fluid bodies instead of silently exporting the first one', () => {
    const project = validProject();
    const second = generateShape(
      { shapeType: 'channel', length: 2, height: 1, depth: 1 },
      'Second channel',
    );
    project.geometry.bodies.push(second.body);

    const result = exportOpenFOAM(project);

    expect(result.success).toBe(false);
    expect(result.files).toEqual({});
    expect(result.errors).toContain(
      'OpenFOAM single-region channel export supports exactly one fluid body; found 2.',
    );
  });

  it('rejects non-channel fluid geometry', () => {
    const project = validProject();
    project.geometry.bodies[0].metadata.shapeType = 'pipe';

    const result = exportOpenFOAM(project);

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('only native channel bodies are supported'))).toBe(true);
  });

  it('keeps canonical SI geometry at convertToMeters 1 and sizes cells after body scale', () => {
    const project = validProject('3D');
    project.units.base_length = 'mm';
    project.geometry.bodies[0].transform.scale = [2, 3, 4];

    const result = exportOpenFOAM(project);

    expect(result.success).toBe(true);
    expect(result.files['system/blockMeshDict']).toContain('convertToMeters 1;');
    expect(result.files['system/blockMeshDict']).toContain(
      'hex (0 1 2 3 4 5 6 7) (24 6 8)',
    );
  });

  it('maps legacy base length to blockMesh convertToMeters', () => {
    const project = validProject('2D');
    delete (project.units as unknown as { value_basis?: unknown }).value_basis;
    project.units.base_length = 'mm';

    const result = exportOpenFOAM(project);

    expect(result.success).toBe(true);
    expect(result.files['system/blockMeshDict']).toContain('convertToMeters 0.001;');
    expect(result.warnings.some((warning) => warning.includes('Legacy IR'))).toBe(true);
  });

  it('converts explicit dynamic pressure to OpenFOAM kinematic pressure', () => {
    const project = validProject();
    const outlet = project.boundary_conditions.find((bc) => bc.id === IDS.outletBC)!;
    outlet.values.scalar = 2500;
    outlet.values.pressure_basis = 'dynamic';

    const result = exportOpenFOAM(project);

    expect(result.success).toBe(true);
    expect(result.files['0/p']).toContain('value           uniform 2.5;');
    expect(JSON.parse(result.manifest).pressure).toEqual({
      input_value: 2500,
      input_basis: 'dynamic',
      emitted_kinematic_value: 2.5,
    });
  });

  it('rejects ambiguous non-zero pressure but permits conversion-invariant zero with a warning', () => {
    const ambiguous = validProject();
    const ambiguousOutlet = ambiguous.boundary_conditions.find((bc) => bc.id === IDS.outletBC)!;
    ambiguousOutlet.values.scalar = 10;
    delete ambiguousOutlet.values.pressure_basis;

    const rejected = exportOpenFOAM(ambiguous);
    expect(rejected.success).toBe(false);
    expect(rejected.errors.some((error) => error.includes('no dynamic/kinematic pressure basis'))).toBe(true);
    expect(rejected.files['0/p']).toBeUndefined();

    const zero = validProject();
    const zeroOutlet = zero.boundary_conditions.find((bc) => bc.id === IDS.outletBC)!;
    delete zeroOutlet.values.pressure_basis;
    const accepted = exportOpenFOAM(zero);
    expect(accepted.success).toBe(true);
    expect(accepted.warnings.some((warning) => warning.includes('conversion-invariant'))).toBe(true);
  });

  it('requires an unambiguous body material assignment and never defaults viscosity', () => {
    const noAssignment = validProject();
    noAssignment.material_assignments = [];
    const assignmentResult = exportOpenFOAM(noAssignment);
    expect(assignmentResult.success).toBe(false);
    expect(assignmentResult.errors.some((error) => error.includes('exactly one material assignment'))).toBe(true);

    const noViscosity = validProject();
    const material = noViscosity.materials[0];
    material.parameter_set.dynamic_viscosity = { value: null, status: 'missing' };
    material.parameter_set.kinematic_viscosity = { value: null, status: 'missing' };
    const viscosityResult = exportOpenFOAM(noViscosity);
    expect(viscosityResult.success).toBe(false);
    expect(viscosityResult.errors.some((error) => error.includes('needs a confirmed positive'))).toBe(true);
    expect(viscosityResult.files['constant/transportProperties']).toBeUndefined();
  });

  it('requires an active case and rejects unconsumed initial conditions, loads, and local mesh controls', () => {
    const noCase = validProject();
    noCase.analysis_cases = [];
    expect(exportOpenFOAM(noCase).errors.some((error) => error.includes('requires exactly one active'))).toBe(true);

    const unconsumed = validProject();
    unconsumed.initial_conditions.push({
      id: 'initial', name: 'Initial velocity', physics_domain: 'fluid', ic_type: 'initial_velocity',
      target_named_selection_id: IDS.bodySelection, values: { vector: [0, 0, 0] }, status: 'confirmed',
    });
    unconsumed.loads.push({
      id: 'load', name: 'Body force', physics_domain: 'fluid', load_type: 'body_force',
      target_named_selection_id: IDS.bodySelection, application_mode: 'per_volume', direction: [1, 0, 0],
      magnitude: 1, distribution: 'uniform', temporal_profile: 'constant', load_case: 'default',
      coordinate_system: 'global', status: 'confirmed',
    });
    unconsumed.mesh_controls.local.push({
      id: 'local', target_named_selection_id: IDS.bodySelection, control_type: 'local_size',
      size: 0.1, layers: null, bias: null, transfinite_hint: false,
      boundary_layer_hint: false, priority: 0,
    });
    unconsumed.section_assignments.push({
      id: 'section-assignment',
      section_id: 'section',
      target_named_selection_id: IDS.bodySelection,
    });
    const result = exportOpenFOAM(unconsumed);

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('does not consume initial condition'))).toBe(true);
    expect(result.errors.some((error) => error.includes('does not consume load'))).toBe(true);
    expect(result.errors.some((error) => error.includes('does not consume local mesh control'))).toBe(true);
    expect(result.errors.some((error) => error.includes('does not consume sections or section assignments'))).toBe(true);
  });

  it('rejects material assignments that do not resolve to the channel body', () => {
    const project = validProject();
    project.material_assignments.push({
      id: 'wall-material-assignment',
      material_id: IDS.material,
      target_named_selection_id: IDS.topWallSelection,
      override_allowed: false,
    });

    const result = exportOpenFOAM(project);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('wall-material-assignment'))).toBe(true);
  });

  it('rejects every non-default mesh knob that blockMesh does not consume', () => {
    const secondOrder = validProject();
    secondOrder.mesh_controls.global.element_order = 2;
    expect(exportOpenFOAM(secondOrder).errors.some(
      (error) => error.includes('mesh_controls.global.element_order'),
    )).toBe(true);

    const growth = validProject();
    growth.mesh_controls.global.growth_rate = 1.4;
    expect(exportOpenFOAM(growth).errors.some(
      (error) => error.includes('mesh_controls.global.growth_rate'),
    )).toBe(true);

    const algorithm = validProject();
    algorithm.mesh_controls.global.algorithm_preference = 'frontal';
    expect(exportOpenFOAM(algorithm).errors.some(
      (error) => error.includes('mesh_controls.global.algorithm_preference'),
    )).toBe(true);

    const recombine = validProject();
    recombine.mesh_controls.global.recombine_preference = 'all';
    expect(exportOpenFOAM(recombine).errors.some(
      (error) => error.includes('mesh_controls.global.recombine_preference'),
    )).toBe(true);

    const curvature = validProject();
    curvature.mesh_controls.global.curvature_based_refinement = true;
    expect(exportOpenFOAM(curvature).errors.some(
      (error) => error.includes('mesh_controls.global.curvature_based_refinement'),
    )).toBe(true);

    const quality = validProject();
    quality.mesh_controls.quality_targets.max_aspect_ratio = 20;
    expect(exportOpenFOAM(quality).errors.some(
      (error) => error.includes('mesh_controls.quality_targets.max_aspect_ratio'),
    )).toBe(true);
  });

  it('reports complete consumed and ignored IR coverage in the manifest', () => {
    const project = validProject();
    project.boundary_conditions.push({
      id: 'excluded_structural_bc',
      name: 'Excluded support',
      physics_domain: 'structural',
      bc_type: 'fixed',
      target_named_selection_id: IDS.inletSelection,
      coordinate_system: 'global',
      values: {},
      temporal_profile: 'constant',
      status: 'confirmed',
      notes: '',
    });

    const result = exportOpenFOAM(project);
    const manifest = JSON.parse(result.manifest) as {
      consumed_ir_ids: string[];
      ignored_ir_ids: string[];
      mesh_control_coverage: {
        consumed_fields: string[];
        validated_but_not_consumed_fields: string[];
      };
    };

    expect(result.success).toBe(true);
    expect(manifest.consumed_ir_ids).toEqual(expect.arrayContaining([
      IDS.analysisCase,
      IDS.material,
      'assign_water',
      IDS.bodySelection,
      IDS.inletSelection,
      IDS.outletSelection,
      IDS.topWallSelection,
      IDS.bottomWallSelection,
      IDS.inletBC,
      IDS.outletBC,
      IDS.topWallBC,
      IDS.bottomWallBC,
      'mesh_controls.global',
      `result_request:${IDS.analysisCase}:velocity`,
      `result_request:${IDS.analysisCase}:pressure`,
    ]));
    expect(manifest.ignored_ir_ids).toContain('excluded_structural_bc');
    expect(manifest.consumed_ir_ids.filter((id) => manifest.ignored_ir_ids.includes(id))).toEqual([]);
    expect(manifest.mesh_control_coverage.consumed_fields).toEqual([
      'mesh_controls.global.global_size',
    ]);
    expect(manifest.mesh_control_coverage.validated_but_not_consumed_fields).toContain(
      'mesh_controls.quality_targets.max_aspect_ratio',
    );
  });

  it('derives kinematic viscosity from confirmed dynamic viscosity and density', () => {
    const project = validProject();
    project.materials[0].parameter_set.kinematic_viscosity = { value: null, status: 'missing' };

    const result = exportOpenFOAM(project);

    expect(result.success).toBe(true);
    expect(result.files['constant/transportProperties']).toContain(
      'nu              [0 2 -1 0 0 0 0] 0.000001;',
    );
  });

  it('rejects an extra participating material that the channel body does not consume', () => {
    const project = validProject();
    const extra = waterMaterial();
    extra.id = 'unused-water';
    extra.name = 'Unused water';
    project.materials.push(extra);
    project.analysis_cases[0].participating_material_ids.push(extra.id);

    const result = exportOpenFOAM(project);
    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.includes('not consumed by the exported channel body'))).toBe(true);
  });

  it('sanitizes patch identifiers and rejects collisions after sanitization', () => {
    const safe = validProject();
    safe.named_selections.find((selection) => selection.id === IDS.inletSelection)!.name =
      '9 inlet\n{ injected; }';
    const safeResult = exportOpenFOAM(safe);
    expect(safeResult.success).toBe(true);
    expect(safeResult.files['system/blockMeshDict']).toContain('patch_9_inlet_injected');
    expect(safeResult.files['system/blockMeshDict']).not.toContain('{ injected; }');

    const collision = validProject();
    collision.named_selections.find((selection) => selection.id === IDS.inletSelection)!.name = 'same-name';
    collision.named_selections.find((selection) => selection.id === IDS.outletSelection)!.name = 'same name';
    const collisionResult = exportOpenFOAM(collision);
    expect(collisionResult.success).toBe(false);
    expect(collisionResult.files).toEqual({});
    expect(collisionResult.errors.some((error) => error.includes('Duplicate OpenFOAM patch name'))).toBe(true);
  });

  it('rejects unsupported analysis and solver profile hints', () => {
    const caseMismatch = validProject();
    caseMismatch.analysis_cases[0].solver_profile_hint = 'openfoam_pisoFoam';
    caseMismatch.analysis_cases[0].analysis_type = 'incompressible_flow_transient';
    caseMismatch.analysis_cases[0].transient = true;
    const caseResult = exportOpenFOAM(caseMismatch);
    expect(caseResult.success).toBe(false);
    expect(caseResult.errors.some((error) => error.includes('only openfoam_simpleFoam is supported'))).toBe(true);

    const optionMismatch = validProject();
    const target = optionMismatch.solver_targets.find(
      (candidate) => candidate.target_name === 'OpenFOAM',
    )!;
    target.solver_options = { ...target.solver_options, solver: 'pisoFoam' };
    const optionResult = exportOpenFOAM(optionMismatch);
    expect(optionResult.success).toBe(false);
    expect(optionResult.errors.some((error) => error.includes('supports simpleFoam only'))).toBe(true);
  });
});
