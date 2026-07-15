import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createDefaultProject, createEmptyParameterSet } from '@/core/ir/defaults';
import type {
  AnalysisCase,
  BoundaryCondition,
  Load,
  Material,
  NamedSelection,
  ProjectIR,
} from '@/core/ir/types';
import { generateShape } from '@/geometry/primitives/generators';
import { exportDOLFINx } from '@/export/dolfinx/exporter';

function material(
  id: string,
  values: { youngModulus?: number; poissonRatio?: number; conductivity?: number },
): Material {
  return {
    id,
    name: id,
    class: values.conductivity === undefined ? 'elastic' : 'thermo_elastic',
    physical_model: 'isotropic_linear',
    parameter_set: {
      ...createEmptyParameterSet(),
      young_modulus: { value: values.youngModulus ?? null, status: 'confirmed' },
      poisson_ratio: { value: values.poissonRatio ?? null, status: 'confirmed' },
      thermal_conductivity: { value: values.conductivity ?? null, status: 'confirmed' },
    },
    source: 'test',
    notes: '',
  };
}

function selection(
  id: string,
  name: string,
  entityType: 'body' | 'face',
  memberRefs: string[],
): NamedSelection {
  return {
    id,
    name,
    target_dimension: entityType === 'body' ? 3 : 2,
    entity_type: entityType,
    member_refs: memberRefs,
    color: '#ffffff',
    description: '',
    created_by: 'user',
    status: 'active',
    usages: [],
  };
}

function analysisCase(mode: 'structural' | 'thermal'): AnalysisCase {
  return {
    id: `case_${mode}`,
    name: `${mode} case`,
    active: true,
    domain_type: mode === 'structural' ? 'solid' : 'thermal',
    analysis_type: mode === 'structural' ? 'static_linear' : 'steady_thermal',
    nonlinear: false,
    transient: false,
    participating_material_ids: [],
    participating_section_ids: [],
    participating_bc_ids: [],
    participating_load_ids: [],
    participating_ic_ids: [],
    mesh_policy_ref: '',
    solver_profile_hint: mode === 'structural'
      ? 'dolfinx_linear_elasticity'
      : 'dolfinx_steady_heat',
    result_requests: mode === 'structural' ? ['displacement'] : ['temperature'],
  };
}

function fixedBoundary(id: string, selectionId: string): BoundaryCondition {
  return {
    id,
    name: id,
    physics_domain: 'structural',
    bc_type: 'fixed',
    target_named_selection_id: selectionId,
    coordinate_system: 'global',
    values: {},
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
}

function thermalBoundary(
  id: string,
  type: 'temperature' | 'heat_flux' | 'convection' | 'insulation',
  selectionId: string,
  scalar?: number,
  ambient?: number,
): BoundaryCondition {
  return {
    id,
    name: id,
    physics_domain: 'thermal',
    bc_type: type,
    target_named_selection_id: selectionId,
    coordinate_system: 'global',
    values: {
      ...(type === 'convection'
        ? {
            heat_transfer_coefficient: scalar,
            ambient_temperature: ambient,
          }
        : scalar === undefined ? {} : { scalar }),
    },
    temporal_profile: 'constant',
    status: 'confirmed',
    notes: '',
  };
}

function load(overrides: Partial<Load> & Pick<Load, 'id' | 'load_type' | 'target_named_selection_id'>): Load {
  return {
    id: overrides.id,
    name: overrides.id,
    physics_domain: overrides.physics_domain ?? 'structural',
    load_type: overrides.load_type,
    target_named_selection_id: overrides.target_named_selection_id,
    application_mode: overrides.application_mode ?? 'per_area',
    direction: overrides.direction ?? [1, 0, 0],
    magnitude: overrides.magnitude ?? 1,
    distribution: overrides.distribution ?? 'uniform',
    temporal_profile: overrides.temporal_profile ?? 'constant',
    load_case: 'default',
    coordinate_system: overrides.coordinate_system ?? 'global',
    status: 'confirmed',
  };
}

function boxProject(mode: 'structural' | 'thermal' = 'structural'): {
  project: ProjectIR;
  faces: Record<string, string>;
  bodySelectionId: string;
} {
  const project = createDefaultProject();
  project.meta.domain_type = mode === 'structural' ? 'solid' : 'thermal';
  const shape = generateShape(
    { shapeType: 'box', width: 4, height: 2, depth: 6 },
    'Box',
  );
  project.geometry.bodies.push(shape.body);
  project.geometry.faces.push(...shape.faces);
  const bodySelectionId = 'ns_body';
  project.named_selections.push(selection(bodySelectionId, 'domain_body', 'body', [shape.body.id]));
  const assignedMaterial = mode === 'structural'
    ? material('mat_assigned', { youngModulus: 210e9, poissonRatio: 0.3 })
    : material('mat_assigned', { conductivity: 45 });
  project.materials.push(assignedMaterial);
  project.material_assignments.push({
    id: 'assignment',
    material_id: assignedMaterial.id,
    target_named_selection_id: bodySelectionId,
    override_allowed: false,
  });
  project.analysis_cases.push(analysisCase(mode));
  project.mesh_controls.global.global_size = 0.25;

  return {
    project,
    bodySelectionId,
    faces: Object.fromEntries(shape.faces.map((face) => [face.name, face.id])),
  };
}

function addFaceSelection(
  project: ProjectIR,
  faces: Record<string, string>,
  faceName: string,
  id = `ns_${faceName}`,
): string {
  project.named_selections.push(selection(id, id, 'face', [faces[faceName]]));
  return id;
}

describe('DOLFINx strict exporter contract', () => {
  it('rejects multiple volumes and unsupported shapes instead of silently exporting a box', () => {
    const multiple = boxProject();
    const second = generateShape(
      { shapeType: 'box', width: 1, height: 1, depth: 1 },
      'Second',
    );
    multiple.project.geometry.bodies.push(second.body);

    const multipleResult = exportDOLFINx(multiple.project);
    expect(multipleResult.success).toBe(false);
    expect(multipleResult.errors.join('\n')).toContain('DFX_MULTIPLE_BODIES');
    expect(multipleResult.geoFile).toBe('');

    const extraBody = boxProject();
    const voidBody = generateShape(
      { shapeType: 'box', width: 1, height: 1, depth: 1 },
      'Void',
    ).body;
    voidBody.category = 'void';
    extraBody.project.geometry.bodies.push(voidBody);
    const extraBodyResult = exportDOLFINx(extraBody.project);
    expect(extraBodyResult.success).toBe(false);
    expect(extraBodyResult.errors.join('\n')).toContain('DFX_BODY_SCOPE_UNRESOLVED');

    const unsupported = boxProject();
    unsupported.project.geometry.bodies[0].metadata = {
      shapeType: 'pipe',
      outerRadius: 1,
      innerRadius: 0.5,
      length: 4,
    };
    const unsupportedResult = exportDOLFINx(unsupported.project);
    expect(unsupportedResult.success).toBe(false);
    expect(unsupportedResult.errors.join('\n')).toContain('DFX_UNSUPPORTED_SHAPE');
    expect(unsupportedResult.geoFile).not.toContain('Box(1)');
  });

  it('requires an explicit body material assignment and uses the assigned material, not the first material', () => {
    const { project, faces } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    project.boundary_conditions.push(fixedBoundary('fixed', left));
    project.materials.unshift(material('mat_first', { youngModulus: 1, poissonRatio: 0.1 }));

    const result = exportDOLFINx(project);
    expect(result.success).toBe(true);
    expect(result.script).toContain('default_scalar_type(210000000000)');
    expect(result.script).not.toContain('default_scalar_type(1))');

    project.material_assignments = [];
    const unresolved = exportDOLFINx(project);
    expect(unresolved.success).toBe(false);
    expect(unresolved.errors.join('\n')).toContain('DFX_MATERIAL_ASSIGNMENT_REQUIRED');
    expect(unresolved.script).toBe('');
  });

  it('maps a selected primitive face by geometry and an explicit Physical tag, never by face array order', () => {
    const { project, faces } = boxProject();
    const top = addFaceSelection(project, faces, 'top');
    project.geometry.faces.find((face) => face.id === faces.top)!.name = 'user-renamed-face';
    project.named_selections.find((namedSelection) => namedSelection.id === top)!.name = 'user-renamed-selection';
    project.boundary_conditions.push(fixedBoundary('fixed_top', top));

    const result = exportDOLFINx(project);
    expect(result.success).toBe(true);
    expect(result.geoFile).toContain('domain_boundary() = Boundary');
    expect(result.geoFile).toContain('resolved_face_0() = Closest {0, 1, 0}');
    expect(result.geoFile).toContain('Physical Surface("selection_101", 101) = {resolved_face_0(0)}');
    expect(result.script).toContain('facet_tags.find(101)');
    expect(result.script).toContain('"export_target": "DOLFINx"');
    expect(result.script).toContain('"analysis_case_id": "case_structural"');
    expect(result.script).toContain(`"model_revision": ${project.validation.model_revision}`);
    const manifest = JSON.parse(result.manifest);
    expect(manifest.tag_map_key).toBe('named_selection_id');
    expect(manifest.tag_map.ns_top).toBe(101);
    expect(manifest.consumed_ir_ids).toContain('assignment');
    expect(manifest.consumed_ir_ids).toContain(faces.top);
    expect(manifest.consumed_ir_ids).toContain('result_request:case_structural:displacement');
    expect(manifest.ignored_ir_ids).not.toContain(faces.top);
    expect(manifest.consumed_ir_ids.filter((id: string) => manifest.ignored_ir_ids.includes(id))).toEqual([]);
    expect(manifest.ignored_ir_ids).toBeInstanceOf(Array);
  });

  it('maps plate-with-hole cap faces from explicit normals and preserves the boolean volume', () => {
    const project = createDefaultProject();
    project.meta.domain_type = 'solid';
    const shape = generateShape(
      { shapeType: 'plateWithHole', width: 4, depth: 2, thickness: 0.2, holeRadius: 0.3 },
      'Plate',
    );
    project.geometry.bodies.push(shape.body);
    project.geometry.faces.push(...shape.faces);
    project.materials.push(material('mat_assigned', { youngModulus: 210e9, poissonRatio: 0.3 }));
    project.named_selections.push(
      selection('ns_body', 'body', 'body', [shape.body.id]),
      selection('ns_bottom', 'bottom', 'face', [shape.faces.find((face) => face.name === 'bottom')!.id]),
      selection('ns_top', 'top', 'face', [shape.faces.find((face) => face.name === 'top')!.id]),
    );
    project.material_assignments.push({
      id: 'assignment',
      material_id: 'mat_assigned',
      target_named_selection_id: 'ns_body',
      override_allowed: false,
    });
    project.boundary_conditions.push(fixedBoundary('fixed', 'ns_bottom'));
    project.loads.push(load({
      id: 'pressure',
      load_type: 'pressure',
      target_named_selection_id: 'ns_top',
      application_mode: 'per_area',
      magnitude: 1e6,
    }));
    project.mesh_controls.global.global_size = 0.1;
    project.analysis_cases.push(analysisCase('structural'));

    const result = exportDOLFINx(project);
    expect(result.success).toBe(true);
    expect(result.geoFile).toContain('main_volume() = BooleanDifference');
    expect(result.geoFile).toContain('Physical Volume("domain", 1) = {main_volume()}');
    expect(result.geoFile.match(/resolved_face_\d+\(\) = Closest/g)).toHaveLength(2);
  });

  it('adds body force, surface traction, and pressure to the elasticity weak form', () => {
    const { project, faces, bodySelectionId } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    const top = addFaceSelection(project, faces, 'top');
    const right = addFaceSelection(project, faces, 'right');
    project.boundary_conditions.push(fixedBoundary('fixed', left));
    project.loads.push(
      load({
        id: 'body',
        load_type: 'body_force',
        target_named_selection_id: bodySelectionId,
        application_mode: 'per_volume',
        direction: [0, -2, 0],
        magnitude: 10,
      }),
      load({
        id: 'traction',
        load_type: 'surface_traction',
        target_named_selection_id: top,
        application_mode: 'per_area',
        direction: [1, 0, 0],
        magnitude: 20,
      }),
      load({
        id: 'pressure',
        load_type: 'pressure',
        target_named_selection_id: right,
        application_mode: 'per_area',
        magnitude: 30,
      }),
    );

    const result = exportDOLFINx(project);
    expect(result.success).toBe(true);
    expect(result.script).toContain('np.array([0, -10, 0]');
    expect(result.script).toContain('L += ufl.inner(body_force_0, v) * dx');
    expect(result.script).toContain('np.array([20, 0, 0]');
    expect(result.script).toMatch(/L \+= ufl\.inner\(traction_1, v\) \* ds\(\d+\)/);
    expect(result.script).toMatch(/L \+= ufl\.inner\(-pressure_2 \* n, v\) \* ds\(\d+\)/);
    const manifest = JSON.parse(result.manifest) as {
      consumed_ir_ids: string[];
      ignored_ir_ids: string[];
    };
    expect(manifest.consumed_ir_ids).toContain(bodySelectionId);
    expect(manifest.ignored_ir_ids).not.toContain(bodySelectionId);
  });

  it('accepts the UI scalar contract for selected prescribed-displacement components', () => {
    const { project, faces } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    const right = addFaceSelection(project, faces, 'right');
    project.boundary_conditions.push(
      fixedBoundary('fixed', left),
      {
        ...fixedBoundary('prescribed', right),
        bc_type: 'prescribed_displacement',
        values: {
          scalar: 0.0125,
          dof_map: {
            ux: 'prescribed',
            uy: 'free',
            uz: 'free',
            rx: 'free',
            ry: 'free',
            rz: 'free',
          },
        },
      },
    );

    const result = exportDOLFINx(project);
    expect(result.success).toBe(true);
    expect(result.script).toContain('fem.dirichletbc(default_scalar_type(0.0125)');
    expect(result.script).toContain('V.sub(0)');
  });

  it('rejects a directionless prescribed-displacement scalar', () => {
    const { project, faces } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    const right = addFaceSelection(project, faces, 'right');
    project.boundary_conditions.push(
      fixedBoundary('fixed', left),
      {
        ...fixedBoundary('ambiguous', right),
        bc_type: 'prescribed_displacement',
        values: { scalar: 0.0125 },
      },
    );

    const result = exportDOLFINx(project);

    expect(result.success).toBe(false);
    expect(result.errors.join('\n')).toContain('DFX_AMBIGUOUS_BC_VALUE');
    expect(result.script).toBe('');
  });

  it('adds heat sources, outward flux, Robin convection, temperature, and insulation semantics', () => {
    const { project, faces, bodySelectionId } = boxProject('thermal');
    const left = addFaceSelection(project, faces, 'left');
    const right = addFaceSelection(project, faces, 'right');
    const top = addFaceSelection(project, faces, 'top');
    const bottom = addFaceSelection(project, faces, 'bottom');
    const front = addFaceSelection(project, faces, 'front');
    const convection = thermalBoundary('convection', 'convection', top, 10, 290);
    // Explicit fields are canonical; legacy scalar/vector values must not override them.
    convection.values.scalar = 999;
    convection.values.vector = [999, 0, 0];
    project.boundary_conditions.push(
      thermalBoundary('temperature', 'temperature', left, 300),
      thermalBoundary('flux', 'heat_flux', right, 5),
      convection,
      thermalBoundary('insulation', 'insulation', bottom),
    );
    project.loads.push(
      load({
        id: 'surface_heat',
        physics_domain: 'thermal',
        load_type: 'heat_source',
        target_named_selection_id: front,
        application_mode: 'per_area',
        magnitude: 20,
      }),
      load({
        id: 'volume_heat',
        physics_domain: 'thermal',
        load_type: 'volumetric_heat',
        target_named_selection_id: bodySelectionId,
        application_mode: 'per_volume',
        magnitude: 100,
      }),
    );

    const result = exportDOLFINx(project);
    expect(result.success).toBe(true);
    expect(result.script).toMatch(/L \+= surface_heat_0 \* v \* ds\(\d+\)/);
    expect(result.script).toContain('L += heat_source_1 * v * dx');
    expect(result.script).toMatch(/L \+= -outward_flux_1 \* v \* ds\(\d+\)/);
    expect(result.script).toMatch(/a \+= h_2 \* u \* v \* ds\(\d+\)/);
    expect(result.script).toMatch(/L \+= h_2 \* ambient_temperature_2 \* v \* ds\(\d+\)/);
    expect(result.script).toContain('h_2 = fem.Constant(domain, default_scalar_type(10))');
    expect(result.script).toContain('ambient_temperature_2 = fem.Constant(domain, default_scalar_type(290))');
    expect(result.script).not.toContain('default_scalar_type(999)');
    expect(result.script).toContain('zero outward flux is the natural boundary condition');
    expect(result.script).toContain('default_scalar_type(300)');
  });

  it('rejects unsupported BC/load variants and physically invalid material values', () => {
    const { project, faces, bodySelectionId } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    project.boundary_conditions.push({
      ...fixedBoundary('symmetry', left),
      bc_type: 'symmetry',
    });
    project.loads.push(load({
      id: 'gravity',
      load_type: 'gravity',
      target_named_selection_id: bodySelectionId,
      application_mode: 'per_volume',
    }));
    project.materials.find((candidate) => candidate.id === 'mat_assigned')!
      .parameter_set.poisson_ratio.value = 0.5;

    const result = exportDOLFINx(project);
    expect(result.success).toBe(false);
    expect(result.errors.join('\n')).toContain('DFX_UNSUPPORTED_BC');
    expect(result.errors.join('\n')).toContain('DFX_UNSUPPORTED_LOAD');
    expect(result.errors.join('\n')).toContain('DFX_INVALID_POISSON_RATIO');

    const thermal = boxProject('thermal');
    const thermalLeft = addFaceSelection(thermal.project, thermal.faces, 'left');
    thermal.project.boundary_conditions.push(
      thermalBoundary('temperature', 'temperature', thermalLeft, 300),
    );
    thermal.project.materials.find((candidate) => candidate.id === 'mat_assigned')!
      .parameter_set.thermal_conductivity.value = 0;
    const invalidThermal = exportDOLFINx(thermal.project);
    expect(invalidThermal.success).toBe(false);
    expect(invalidThermal.errors.join('\n')).toContain('DFX_INVALID_THERMAL_CONDUCTIVITY');
  });

  it('uses one consistent DOLFINx 0.10 mesh and solver API contract', () => {
    const { project, faces } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    project.boundary_conditions.push(fixedBoundary('fixed', left));
    project.mesh_controls.global.element_order = 2;

    const result = exportDOLFINx(project);
    expect(result.success).toBe(true);
    expect(result.script).toContain('from dolfinx.io import gmsh as gmshio');
    expect(result.script).toContain('mesh_data = gmshio.read_from_msh');
    expect(result.script).toContain('domain = mesh_data.mesh');
    expect(result.script).toContain('petsc_options_prefix="fem_modeler_"');
    expect(result.script).toContain('domain.comm.allreduce(local_facet_count, op=MPI.SUM)');
    expect(result.script).toContain('("Lagrange", 2, (domain.geometry.dim,))');
    expect(result.geoFile).toContain('Mesh.ElementOrder = 2');
    expect(result.script).not.toContain('io.gmshio');
    expect(result.script).not.toContain('domain, cell_tags, facet_tags =');
    const syntax = spawnSync(
      'python3',
      ['-c', 'import sys; compile(sys.stdin.read(), "solve.py", "exec")'],
      { input: result.script, encoding: 'utf8' },
    );
    expect(syntax.stderr).toBe('');
    expect(syntax.status).toBe(0);
  });

  it('requires an active compatible analysis case and rejects ungenerated result requests', () => {
    const { project, faces } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    project.boundary_conditions.push(fixedBoundary('fixed', left));
    project.analysis_cases = [];

    const missingCase = exportDOLFINx(project);
    expect(missingCase.success).toBe(false);
    expect(missingCase.errors.join('\n')).toContain('DFX_ANALYSIS_CASE_REQUIRED');

    project.analysis_cases.push(analysisCase('structural'));
    project.analysis_cases[0].domain_type = 'thermal';
    project.analysis_cases[0].result_requests = ['stress'];
    const incompatibleCase = exportDOLFINx(project);
    expect(incompatibleCase.success).toBe(false);
    expect(incompatibleCase.errors.join('\n')).toContain('DFX_ANALYSIS_DOMAIN_MISMATCH');
    expect(incompatibleCase.errors.join('\n')).toContain('DFX_UNSUPPORTED_RESULT');
  });

  it('rejects unresolved participating values and unsupported mesh controls', () => {
    const { project, faces } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    const fixed = fixedBoundary('fixed', left);
    fixed.status = 'needs_review';
    project.boundary_conditions.push(fixed);
    project.mesh_controls.local.push({
      id: 'local_size',
      target_named_selection_id: left,
      control_type: 'local_size',
      size: 0.1,
      layers: null,
      bias: null,
      transfinite_hint: false,
      boundary_layer_hint: false,
      priority: 1,
    });
    project.mesh_controls.quality_targets.max_aspect_ratio = 20;

    const result = exportDOLFINx(project);
    expect(result.success).toBe(false);
    expect(result.errors.join('\n')).toContain('DFX_UNRESOLVED_BC');
    expect(result.errors.join('\n')).toContain('DFX_UNSUPPORTED_LOCAL_MESH_CONTROL');
    expect(result.errors.join('\n')).toContain('DFX_UNSUPPORTED_MESH_QUALITY_TARGET');
  });

  it('rejects structural section data that a volumetric model cannot consume', () => {
    const { project, faces, bodySelectionId } = boxProject();
    const left = addFaceSelection(project, faces, 'left');
    project.boundary_conditions.push(fixedBoundary('fixed', left));
    project.section_assignments.push({
      id: 'unused_section_assignment',
      section_id: 'unused_section',
      target_named_selection_id: bodySelectionId,
    });

    const result = exportDOLFINx(project);
    expect(result.success).toBe(false);
    expect(result.errors.join('\n')).toContain('DFX_UNSUPPORTED_SECTION');
  });
});
