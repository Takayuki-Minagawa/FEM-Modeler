import { describe, expect, it } from 'vitest';
import { createDefaultProject, SCHEMA_VERSION } from '@/core/ir/defaults';
import { parseProjectFile } from '@/export/project/load';

describe('parseProjectFile', () => {
  it('loads a valid current project file', () => {
    const project = createDefaultProject();

    const result = parseProjectFile(JSON.stringify(project));

    expect(result.success).toBe(true);
    expect(result.data?.meta.project_id).toBe(project.meta.project_id);
    expect(result.warning).toBeUndefined();
  });

  it('migrates legacy project files by filling missing sections', () => {
    const legacyProject = createDefaultProject();
    legacyProject.meta.schema_version = '0.0.5';

    const rawLegacy = JSON.parse(JSON.stringify(legacyProject)) as Record<string, unknown>;
    delete rawLegacy.ui_state;
    delete rawLegacy.validation;

    const result = parseProjectFile(JSON.stringify(rawLegacy));

    expect(result.success).toBe(true);
    expect(result.data?.meta.schema_version).toBe(SCHEMA_VERSION);
    expect(result.data?.ui_state.active_panel).toBe('geometry');
    expect(result.data?.validation.summary.error_count).toBe(0);
    expect(result.warning).toContain('0.0.5');
  });

  it('fills missing fields inside array elements during migration', () => {
    const project = createDefaultProject();
    project.meta.schema_version = '0.0.5';

    // Add a body with a missing field (remove 'locked')
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    const geometry = raw.geometry as Record<string, unknown>;
    geometry.bodies = [
      {
        id: 'body_test1',
        name: 'TestBody',
        category: 'solid',
        visible: true,
        // 'locked' is missing — should be filled from defaults
        color: '#cccccc',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        topology_ref: '',
        metadata: {},
      },
    ];

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(true);
    expect(result.data?.geometry.bodies).toHaveLength(1);
    expect(result.data?.geometry.bodies[0].locked).toBe(false);
    expect(result.data?.geometry.bodies[0].name).toBe('TestBody');
  });

  it('rejects malformed structures with a readable error', () => {
    const malformedProject = createDefaultProject();
    const rawMalformed = {
      ...malformedProject,
      geometry: 'invalid-geometry-section',
    };

    const result = parseProjectFile(JSON.stringify(rawMalformed));

    expect(result.success).toBe(false);
    expect(result.error).toContain('geometry');
  });

  it('rejects projects created by a newer schema version', () => {
    const project = createDefaultProject();
    project.meta.schema_version = '99.0.0';

    const result = parseProjectFile(JSON.stringify(project));

    expect(result.success).toBe(false);
    expect(result.error).toContain('newer than supported');
  });

  it('rejects malformed schema versions instead of treating them as legacy', () => {
    const project = createDefaultProject();
    project.meta.schema_version = 'not-a-version';

    const result = parseProjectFile(JSON.stringify(project));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Expected semantic version');
  });

  it('rejects unknown current enum values instead of casting them', () => {
    const project = createDefaultProject();
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    (raw.meta as Record<string, unknown>).domain_type = 'not-a-domain';

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(false);
    expect(result.error).toContain('meta.domain_type');
  });

  it('rejects missing required fields in a current-schema file', () => {
    const raw = JSON.parse(JSON.stringify(createDefaultProject())) as Record<string, unknown>;
    delete raw.ui_state;

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(false);
    expect(result.error).toContain('ui_state');
  });

  it('rejects unknown keys at nested current-schema object boundaries', () => {
    const raw = JSON.parse(JSON.stringify(createDefaultProject())) as Record<string, unknown>;
    (raw.meta as Record<string, unknown>).unexpected_field = 'must not be stripped';

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(false);
    expect(result.error).toContain('meta');
    expect(result.error).toContain('Unrecognized key');
  });

  it('rejects invalid DOF states in current initial-condition payloads', () => {
    const raw = JSON.parse(JSON.stringify(createDefaultProject())) as Record<string, unknown>;
    raw.initial_conditions = [{
      id: 'ic',
      name: 'Initial displacement',
      physics_domain: 'structural',
      ic_type: 'initial_displacement',
      target_named_selection_id: 'selection',
      values: {
        dof_map: { ux: 'invalid', uy: 'free', uz: 'free', rx: 'free', ry: 'free', rz: 'free' },
      },
      status: 'confirmed',
    }];

    const result = parseProjectFile(JSON.stringify(raw));
    expect(result.success).toBe(false);
    expect(result.error).toContain('initial_conditions.0.values.dof_map.ux');
  });

  it('rejects non-degree transforms in current files and migrates explicit legacy radians', () => {
    const current = JSON.parse(JSON.stringify(createDefaultProject())) as Record<string, unknown>;
    (current.units as Record<string, unknown>).angle_unit = 'rad';
    expect(parseProjectFile(JSON.stringify(current)).success).toBe(false);

    const legacy = JSON.parse(JSON.stringify(createDefaultProject())) as Record<string, unknown>;
    (legacy.meta as Record<string, unknown>).schema_version = '0.1.0';
    (legacy.units as Record<string, unknown>).angle_unit = 'rad';
    (legacy.geometry as Record<string, unknown>).bodies = [{
      id: 'body', name: 'body', category: 'solid', visible: true, locked: false, color: '#fff',
      transform: { position: [0, 0, 0], rotation: [0, 0, Math.PI / 2], scale: [1, 1, 1] },
      topology_ref: '', metadata: { shapeType: 'box', width: 1, height: 1, depth: 1 },
    }];
    const migrated = parseProjectFile(JSON.stringify(legacy));
    expect(migrated.success).toBe(true);
    expect(migrated.data?.units.angle_unit).toBe('deg');
    expect(migrated.data?.geometry.bodies[0].transform.rotation[2]).toBeCloseTo(90);
  });

  it('requires exactly one entry for every solver target in current files', () => {
    const missing = createDefaultProject();
    missing.solver_targets = missing.solver_targets.filter((target) => target.target_name !== 'OpenFOAM');
    const missingResult = parseProjectFile(JSON.stringify(missing));
    expect(missingResult.success).toBe(false);
    expect(missingResult.error).toContain('Exactly one OpenFOAM');

    const duplicate = createDefaultProject();
    duplicate.solver_targets.push(structuredClone(duplicate.solver_targets[0]));
    const duplicateResult = parseProjectFile(JSON.stringify(duplicate));
    expect(duplicateResult.success).toBe(false);
    expect(duplicateResult.error).toContain('Exactly one OpenSeesPy');
  });

  it('rejects internally inconsistent persisted result fields', () => {
    const project = createDefaultProject();
    project.results.push({
      id: 'result', analysis_case_id: 'case', solver_target: 'OpenSeesPy', source_file_name: 'results.csv',
      imported_at: new Date(0).toISOString(), status: 'complete', checks: [], metadata: {},
      fields: [{
        id: 'field', name: 'ux', location: 'node', component_names: ['ux'], unit: 'm',
        entity_ids: ['1'], values: [0, 1], minimum: 0, maximum: 99,
      }],
    });

    const result = parseProjectFile(JSON.stringify(project));
    expect(result.success).toBe(false);
    expect(result.error).toContain('entity_ids and values');
  });

  it('preserves unlabeled legacy geometry instead of inferring its basis from the final unit preset', () => {
    const project = createDefaultProject();
    project.meta.schema_version = '0.1.0';
    project.units.system_name = 'mm-N-s';
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    delete (raw.units as Record<string, unknown>).value_basis;
    (raw.geometry as Record<string, unknown>).bodies = [{
      id: 'body_mm', name: 'Millimetre box', category: 'solid', visible: true, locked: false,
      color: '#fff', transform: { position: [1000, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      topology_ref: '', metadata: { shapeType: 'box', width: 1000, height: 500, depth: 250 },
    }];

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(true);
    expect(result.data?.units.value_basis).toBe('SI');
    expect(result.data?.geometry.bodies[0].transform.position[0]).toBe(1000);
    expect(result.data?.geometry.bodies[0].metadata.width).toBe(1000);
    expect(result.data?.audit_trail.at(-1)?.action_type).toBe('unit_conversion');
  });

  it('preserves raw legacy geometry used by bare-coordinate structural exporters', () => {
    const project = createDefaultProject();
    project.meta.schema_version = '0.1.0';
    project.units.system_name = 'mm-N-s';
    project.meta.default_solver_target = 'OpenSeesPy';
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    delete (raw.units as Record<string, unknown>).value_basis;
    (raw.geometry as Record<string, unknown>).bodies = [{
      id: 'body_raw', name: 'Raw structural body', category: 'beam_region', visible: true, locked: false,
      color: '#fff', transform: { position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      topology_ref: '', metadata: { shapeType: 'frame2d', spanX: 6, spanY: 3, columns: 2, floors: 1 },
    }];

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(true);
    expect(result.data?.geometry.bodies[0].transform.position[0]).toBe(2);
    expect(result.data?.geometry.bodies[0].metadata.spanX).toBe(6);
  });

  it('preserves legacy SI library materials while converting manual display-basis fields', () => {
    const project = createDefaultProject();
    project.meta.schema_version = '0.1.0';
    project.units.system_name = 'mm-N-s';
    const parameterSet = (status: 'library' | 'confirmed', density: number, youngModulus: number, conductivity: number) => ({
      density: { value: density, status },
      young_modulus: { value: youngModulus, status },
      poisson_ratio: { value: 0.3, status },
      thermal_conductivity: { value: conductivity, status },
      specific_heat: { value: 486, status },
      dynamic_viscosity: { value: null, status: 'missing' as const },
      kinematic_viscosity: { value: null, status: 'missing' as const },
    });
    project.materials.push(
      {
        id: 'library_steel', name: 'Library steel', class: 'elastic', physical_model: 'isotropic_linear',
        parameter_set: parameterSet('library', 7850, 2.05e11, 50.2), source: 'JIS', notes: '',
      },
      {
        id: 'manual_steel', name: 'Manual steel', class: 'elastic', physical_model: 'isotropic_linear',
        parameter_set: parameterSet('confirmed', 7.85e-6, 205000, 0.0502), source: '', notes: '',
      },
    );
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    delete (raw.units as Record<string, unknown>).value_basis;

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(true);
    expect(result.data?.materials[0].parameter_set.density.value).toBe(7850);
    expect(result.data?.materials[0].parameter_set.young_modulus.value).toBe(2.05e11);
    expect(result.data?.materials[1].parameter_set.density.value).toBeCloseTo(7850);
    expect(result.data?.materials[1].parameter_set.young_modulus.value).toBeCloseTo(2.05e11);
    expect(result.data?.materials[1].parameter_set.thermal_conductivity.value).toBeCloseTo(50.2);
  });

  it('preserves legacy raw solver inputs and only converts the pressure field that was displayed as MPa', () => {
    const project = createDefaultProject();
    project.meta.schema_version = '0.1.0';
    project.units.system_name = 'mm-N-s';
    project.boundary_conditions.push({
      id: 'outlet', name: 'Outlet', physics_domain: 'fluid', bc_type: 'pressure_outlet',
      target_named_selection_id: 'face', coordinate_system: 'global', values: { scalar: 12.5 },
      temporal_profile: 'constant', status: 'confirmed', notes: '',
    });
    project.loads.push(
      {
        id: 'gravity', name: 'Gravity', physics_domain: 'structural', load_type: 'gravity',
        target_named_selection_id: 'body', application_mode: 'total', direction: [0, -1, 0],
        magnitude: 9.81, distribution: 'uniform', temporal_profile: 'constant', load_case: 'default',
        coordinate_system: 'global', status: 'confirmed',
      },
      {
        id: 'traction', name: 'Legacy total traction', physics_domain: 'structural', load_type: 'surface_traction',
        target_named_selection_id: 'face', application_mode: 'total', direction: [1, 0, 0],
        magnitude: 1000, distribution: 'uniform', temporal_profile: 'constant', load_case: 'default',
        coordinate_system: 'global', status: 'confirmed',
      },
      {
        id: 'pressure', name: 'Pressure', physics_domain: 'structural', load_type: 'pressure',
        target_named_selection_id: 'face', application_mode: 'total', direction: [1, 0, 0],
        magnitude: 2, distribution: 'uniform', temporal_profile: 'constant', load_case: 'default',
        coordinate_system: 'global', status: 'confirmed',
      },
    );
    const raw = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
    delete (raw.units as Record<string, unknown>).value_basis;

    const result = parseProjectFile(JSON.stringify(raw));

    expect(result.success).toBe(true);
    expect(result.data?.boundary_conditions[0].values.scalar).toBe(12.5);
    expect(result.data?.boundary_conditions[0].values.pressure_basis).toBe('kinematic');
    expect(result.data?.loads.map((load) => load.magnitude)).toEqual([9.81, 1000, 2_000_000]);
  });
});
