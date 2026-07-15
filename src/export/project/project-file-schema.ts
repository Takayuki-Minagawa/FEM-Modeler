/**
 * Zod validation schema for .fem.json project files.
 *
 * This schema mirrors the ProjectIR type hierarchy in @/core/ir/types.
 * Legacy input is normalized first; the current schema then rejects unknown
 * enum values and invalid numeric ranges instead of casting them into the IR.
 *
 * A compile-time type check at the bottom of this file ensures that
 * every top-level key in ProjectIR has a matching key in the schema.
 * If you add a field to ProjectIR, TypeScript will error here until the
 * schema is updated to match.
 */
import { z } from 'zod';
import type { ProjectIR, SolverTarget } from '@/core/ir/types';
import {
  APP_VERSION,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  createDefaultProject,
} from '@/core/ir/defaults';
import { toSI, type QuantityKind } from '@/core/units';

const tuple3NumberSchema = z.tuple([z.number(), z.number(), z.number()]);
const unknownRecordSchema = z.record(z.string(), z.unknown());
const stringRecordSchema = z.record(z.string(), z.string());
const booleanRecordSchema = z.record(z.string(), z.boolean());
const dofMapSchema = z.strictObject({
  ux: z.enum(['fixed', 'free', 'prescribed']),
  uy: z.enum(['fixed', 'free', 'prescribed']),
  uz: z.enum(['fixed', 'free', 'prescribed']),
  rx: z.enum(['fixed', 'free', 'prescribed']),
  ry: z.enum(['fixed', 'free', 'prescribed']),
  rz: z.enum(['fixed', 'free', 'prescribed']),
});
const REQUIRED_SOLVER_TARGETS = ['OpenSeesPy', 'DOLFINx', 'OpenFOAM'] as const;

const projectFileSchema = z.strictObject({
  meta: z.strictObject({
    schema_name: z.literal(SCHEMA_NAME),
    schema_version: z.literal(SCHEMA_VERSION),
    app_version: z.string(),
    project_id: z.string(),
    project_name: z.string(),
    description: z.string(),
    author: z.string(),
    organization: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    tags: z.array(z.string()),
    status: z.enum(['draft', 'review', 'approved', 'archived']),
    default_solver_target: z.string(),
    domain_type: z.enum(['frame', 'truss', 'solid', 'thermal', 'fluid', 'coupled']),
  }),
  units: z.strictObject({
    value_basis: z.literal('SI'),
    system_name: z.enum(['SI', 'mm-N-s', 'mm-t-s', 'custom']),
    base_length: z.string(),
    base_mass: z.string(),
    base_time: z.string(),
    base_temperature: z.string(),
    base_force: z.string(),
    angle_unit: z.literal('deg'),
    display_precision: z.number().int().min(0).max(15),
    preferred_stress_unit: z.string(),
    preferred_pressure_unit: z.string(),
    preferred_energy_unit: z.string(),
  }),
  geometry: z.strictObject({
    model_type: z.enum(['cad_brep', 'mesh_only', 'frame_graph', 'hybrid']),
    source: z.enum(['native', 'imported_step', 'imported_stl', 'imported_obj', 'imported_msh', 'generated_by_ai']),
    bodies: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      category: z.enum(['solid', 'shell', 'beam_region', 'fluid_region', 'void']),
      visible: z.boolean(),
      locked: z.boolean(),
      color: z.string(),
      transform: z.strictObject({
        position: tuple3NumberSchema,
        rotation: tuple3NumberSchema,
        scale: tuple3NumberSchema,
      }),
      topology_ref: z.string(),
      asset_ref: z.string().optional(),
      metadata: unknownRecordSchema,
    })),
    faces: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      body_id: z.string(),
      normal: tuple3NumberSchema.optional(),
      area: z.number().optional(),
      triangle_indices: z.array(z.number()),
    })),
    edges: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      body_id: z.string(),
      vertex_ids: z.tuple([z.string(), z.string()]),
      length: z.number().optional(),
    })),
    vertices: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      body_id: z.string(),
      position: tuple3NumberSchema,
    })),
    reference_frames: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      origin: tuple3NumberSchema,
      axis_x: tuple3NumberSchema,
      axis_y: tuple3NumberSchema,
      axis_z: tuple3NumberSchema,
      type: z.enum(['cartesian', 'cylindrical', 'local_beam']),
      attached_to: z.string().optional(),
    })),
    geometry_parameters: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      value: z.number(),
      description: z.string(),
    })),
  }),
  assets: z.array(z.strictObject({
    id: z.string().min(1),
    kind: z.literal('stl_mesh'),
    file_name: z.string(),
    media_type: z.literal('model/stl'),
    encoding: z.literal('base64'),
    data: z.string(),
    content_hash: z.string().min(1),
    byte_length: z.number().int().nonnegative(),
    source_unit: z.enum(['m', 'mm', 'cm', 'in', 'ft']),
    scale_to_meters: z.number().finite().positive(),
    triangle_count: z.number().int().positive(),
    bounds: z.strictObject({ min: tuple3NumberSchema, max: tuple3NumberSchema }),
    diagnostics: z.strictObject({
      degenerate_triangles: z.number().int().nonnegative(),
      finite_coordinates: z.boolean(),
      watertight: z.boolean().nullable(),
      manifold: z.boolean().nullable(),
    }),
  })),
  named_selections: z.array(z.strictObject({
    id: z.string(),
    name: z.string(),
    display_name: z.string().optional(),
    target_dimension: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    entity_type: z.enum(['vertex', 'edge', 'face', 'body', 'node', 'element', 'cell', 'patch']),
    member_refs: z.array(z.string()),
    color: z.string(),
    description: z.string(),
    created_by: z.enum(['user', 'import', 'ai']),
    status: z.enum(['active', 'stale', 'unresolved']),
    usages: z.array(z.enum(['material_assignment', 'section_assignment', 'boundary_condition', 'load', 'initial_condition', 'mesh_control', 'export_tag'])),
  })),
  materials: z.array(z.strictObject({
    id: z.string(),
    name: z.string(),
    class: z.enum(['elastic', 'thermo_elastic', 'fluid_newtonian', 'user_defined']),
    physical_model: z.enum(['isotropic_linear', 'orthotropic_linear', 'incompressible_newtonian', 'constant_property']),
    parameter_set: z.strictObject({
      density: z.strictObject({ value: z.number().finite().nullable(), status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']), source: z.string().optional() }),
      young_modulus: z.strictObject({ value: z.number().finite().nullable(), status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']), source: z.string().optional() }),
      poisson_ratio: z.strictObject({ value: z.number().finite().nullable(), status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']), source: z.string().optional() }),
      thermal_conductivity: z.strictObject({ value: z.number().finite().nullable(), status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']), source: z.string().optional() }),
      specific_heat: z.strictObject({ value: z.number().finite().nullable(), status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']), source: z.string().optional() }),
      dynamic_viscosity: z.strictObject({ value: z.number().finite().nullable(), status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']), source: z.string().optional() }),
      kinematic_viscosity: z.strictObject({ value: z.number().finite().nullable(), status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']), source: z.string().optional() }),
    }),
    source: z.string(),
    notes: z.string(),
  })),
  material_assignments: z.array(z.strictObject({
    id: z.string(),
    material_id: z.string(),
    target_named_selection_id: z.string(),
    override_allowed: z.boolean(),
  })),
  sections: z.array(z.strictObject({
    id: z.string(),
    name: z.string(),
    section_type: z.enum(['beam_rect', 'beam_circle', 'beam_h', 'shell_thickness', 'generic_frame_section']),
    dimensions: z.record(z.string(), z.number()),
    material_id: z.string(),
    orientation_ref: z.string().optional(),
    area: z.number().nullable(),
    inertia_y: z.number().nullable(),
    inertia_z: z.number().nullable(),
    torsion_constant: z.number().nullable(),
    thickness: z.number().nullable(),
    metadata: unknownRecordSchema,
  })),
  section_assignments: z.array(z.strictObject({
    id: z.string(),
    section_id: z.string(),
    target_named_selection_id: z.string(),
  })),
  mesh_controls: z.strictObject({
    global: z.strictObject({
      algorithm_preference: z.enum(['auto', 'delaunay', 'frontal', 'structured']),
      global_size: z.number().nullable(),
      growth_rate: z.number(),
      element_order: z.union([z.literal(1), z.literal(2)]),
      recombine_preference: z.enum(['none', 'all', 'structured_only']),
      curvature_based_refinement: z.boolean(),
    }),
    local: z.array(z.strictObject({
      id: z.string(),
      target_named_selection_id: z.string(),
      control_type: z.enum(['local_size', 'edge_division', 'face_refinement', 'boundary_layer', 'structured_hint']),
      size: z.number().nullable(),
      layers: z.number().nullable(),
      bias: z.number().nullable(),
      transfinite_hint: z.boolean(),
      boundary_layer_hint: z.boolean(),
      priority: z.number(),
    })),
    quality_targets: z.strictObject({
      min_jacobian: z.number(),
      max_aspect_ratio: z.number(),
      min_skewness: z.number(),
      preferred_quality_level: z.enum(['preview', 'balanced', 'high_quality']),
    }),
  }),
  boundary_conditions: z.array(z.strictObject({
    id: z.string(),
    name: z.string(),
    physics_domain: z.enum(['structural', 'thermal', 'fluid']),
    bc_type: z.enum(['fixed', 'prescribed_displacement', 'symmetry', 'temperature', 'heat_flux', 'convection', 'insulation', 'velocity_inlet', 'pressure_outlet', 'wall', 'slip', 'no_slip']),
    target_named_selection_id: z.string(),
    coordinate_system: z.string(),
    values: z.strictObject({
      scalar: z.number().optional(),
      vector: tuple3NumberSchema.optional(),
      dof_map: dofMapSchema.optional(),
      function_ref: z.string().optional(),
      pressure_basis: z.enum(['dynamic', 'kinematic']).optional(),
      heat_transfer_coefficient: z.number().finite().positive().optional(),
      ambient_temperature: z.number().finite().optional(),
    }),
    temporal_profile: z.enum(['constant', 'ramp', 'table', 'expression', 'time_series_ref']),
    status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']),
    notes: z.string(),
  })),
  loads: z.array(z.strictObject({
    id: z.string(),
    name: z.string(),
    physics_domain: z.enum(['structural', 'thermal', 'fluid']),
    load_type: z.enum(['nodal_force', 'surface_traction', 'body_force', 'gravity', 'line_load', 'pressure', 'heat_source', 'volumetric_heat', 'mass_flow_rate']),
    target_named_selection_id: z.string(),
    application_mode: z.enum(['total', 'per_area', 'per_length', 'per_volume']),
    direction: tuple3NumberSchema,
    magnitude: z.number(),
    distribution: z.enum(['uniform', 'linear', 'table', 'field_ref']),
    temporal_profile: z.enum(['constant', 'ramp', 'table', 'expression', 'time_series_ref']),
    load_case: z.string(),
    coordinate_system: z.string(),
    status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']),
  })),
  initial_conditions: z.array(z.strictObject({
    id: z.string(),
    name: z.string(),
    physics_domain: z.enum(['structural', 'thermal', 'fluid']),
    ic_type: z.enum(['initial_temperature', 'initial_velocity', 'initial_pressure', 'initial_displacement']),
    target_named_selection_id: z.string(),
    values: z.strictObject({
      scalar: z.number().optional(),
      vector: tuple3NumberSchema.optional(),
      dof_map: dofMapSchema.optional(),
      function_ref: z.string().optional(),
      pressure_basis: z.enum(['dynamic', 'kinematic']).optional(),
      heat_transfer_coefficient: z.number().finite().positive().optional(),
      ambient_temperature: z.number().finite().optional(),
    }),
    status: z.enum(['confirmed', 'inferred', 'imported', 'library', 'missing', 'needs_review']),
  })),
  analysis_cases: z.array(z.strictObject({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    domain_type: z.enum(['frame', 'truss', 'solid', 'thermal', 'fluid', 'coupled']),
    analysis_type: z.enum(['static_linear', 'static_nonlinear', 'modal', 'transient_structural', 'steady_thermal', 'transient_thermal', 'incompressible_flow_steady', 'incompressible_flow_transient']),
    nonlinear: z.boolean(),
    transient: z.boolean(),
    participating_material_ids: z.array(z.string()),
    participating_section_ids: z.array(z.string()),
    participating_bc_ids: z.array(z.string()),
    participating_load_ids: z.array(z.string()),
    participating_ic_ids: z.array(z.string()),
    mesh_policy_ref: z.string(),
    solver_profile_hint: z.enum(['openseespy_frame_basic', 'dolfinx_linear_elasticity', 'dolfinx_poisson', 'dolfinx_steady_heat', 'openfoam_simpleFoam', 'openfoam_pisoFoam', 'openfoam_laplacianFoam']),
    result_requests: z.array(z.enum(['displacement', 'stress', 'temperature', 'velocity', 'pressure', 'reaction_force'])),
  })),
  results: z.array(z.strictObject({
    id: z.string(),
    analysis_case_id: z.string(),
    solver_target: z.enum(['OpenSeesPy', 'DOLFINx', 'OpenFOAM']),
    source_file_name: z.string(),
    imported_at: z.string(),
    status: z.enum(['complete', 'partial', 'failed']),
    fields: z.array(z.strictObject({
      id: z.string(),
      name: z.string(),
      location: z.enum(['node', 'element', 'facet', 'cell', 'global']),
      component_names: z.array(z.string()),
      unit: z.string(),
      entity_ids: z.array(z.string()),
      values: z.array(z.number().finite()),
      minimum: z.number().finite(),
      maximum: z.number().finite(),
    })),
    checks: z.array(z.strictObject({
      kind: z.enum(['force_balance', 'heat_balance', 'mass_balance', 'solver_convergence', 'solver_execution']),
      status: z.enum(['pass', 'warning', 'fail', 'not_available']),
      value: z.number().finite().nullable(),
      tolerance: z.number().finite().nonnegative().nullable(),
      unit: z.string(),
      message: z.string(),
    })),
    metadata: unknownRecordSchema,
  })),
  solver_targets: z.array(z.strictObject({
    target_name: z.enum(['OpenSeesPy', 'DOLFINx', 'OpenFOAM']),
    enabled: z.boolean(),
    export_profile: z.enum(['strict', 'permissive', 'template_based']),
    solver_options: unknownRecordSchema,
    path_preferences: stringRecordSchema,
    packaging: z.enum(['single_file', 'multi_file', 'zip_bundle', 'folder_tree']),
  })),
  validation: z.strictObject({
    last_run_at: z.string(),
    model_revision: z.number().int().nonnegative(),
    validated_revision: z.number().int().min(-1),
    summary: z.strictObject({
      error_count: z.number(),
      warning_count: z.number(),
      info_count: z.number(),
    }),
    items: z.array(z.strictObject({
      id: z.string(),
      severity: z.enum(['error', 'warning', 'info']),
      code: z.string(),
      title: z.string(),
      message: z.string(),
      target_ref: z.string(),
      suggested_fix: z.string(),
      dismissible: z.boolean(),
      status: z.enum(['open', 'dismissed', 'resolved']),
    })),
  }),
  ui_state: z.strictObject({
    active_panel: z.string(),
    camera_state: z.strictObject({
      position: tuple3NumberSchema,
      target: tuple3NumberSchema,
      up: tuple3NumberSchema,
      zoom: z.number(),
      orthographic: z.boolean(),
    }),
    visibility_map: booleanRecordSchema,
    isolate_targets: z.array(z.string()),
    selection_state: z.array(z.string()),
    expanded_tree_nodes: z.array(z.string()),
    color_mode: z.enum(['default', 'by_material', 'by_selection', 'by_condition']),
    clipping_planes: z.array(z.strictObject({
      normal: tuple3NumberSchema,
      constant: z.number(),
      enabled: z.boolean(),
    })),
    last_opened_tabs: z.array(z.string()),
  }),
  ai_annotations: z.array(z.strictObject({
    id: z.string(),
    source_prompt_summary: z.string(),
    target_ref: z.string(),
    proposal_type: z.enum(['naming', 'material_suggestion', 'mesh_hint', 'missing_bc_warning', 'export_gap_notice']),
    rationale: z.string(),
    confidence: z.number(),
    status: z.enum(['proposed', 'accepted', 'rejected', 'expired']),
    applied_changes: unknownRecordSchema,
  })),
  audit_trail: z.array(z.strictObject({
    id: z.string(),
    timestamp: z.string(),
    actor: z.enum(['user', 'ai', 'import', 'migration']),
    action_type: z.enum(['create', 'update', 'delete', 'assign', 'import', 'export', 'validate', 'unit_conversion', 'ai_proposal_accepted', 'ai_proposal_rejected']),
    target_ref: z.string(),
    before_summary: z.string(),
    after_summary: z.string(),
    note: z.string(),
  })),
}).superRefine((project, context) => {
  for (const targetName of REQUIRED_SOLVER_TARGETS) {
    const count = project.solver_targets.filter((target) => target.target_name === targetName).length;
    if (count !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['solver_targets'],
        message: `Exactly one ${targetName} solver target is required; found ${count}.`,
      });
    }
  }
  project.results.forEach((result, resultIndex) => {
    result.fields.forEach((field, fieldIndex) => {
      const path = ['results', resultIndex, 'fields', fieldIndex];
      if (field.values.length === 0 || field.entity_ids.length !== field.values.length) {
        context.addIssue({
          code: 'custom',
          path,
          message: 'Result field entity_ids and values must have the same non-zero length.',
        });
        return;
      }
      if (new Set(field.entity_ids).size !== field.entity_ids.length) {
        context.addIssue({ code: 'custom', path: [...path, 'entity_ids'], message: 'Result field entity IDs must be unique.' });
      }
      let actualMinimum = field.values[0];
      let actualMaximum = field.values[0];
      for (const value of field.values.slice(1)) {
        if (value < actualMinimum) actualMinimum = value;
        if (value > actualMaximum) actualMaximum = value;
      }
      const tolerance = 1e-12 * Math.max(1, Math.abs(actualMinimum), Math.abs(actualMaximum));
      if (Math.abs(field.minimum - actualMinimum) > tolerance
          || Math.abs(field.maximum - actualMaximum) > tolerance) {
        context.addIssue({ code: 'custom', path, message: 'Result field minimum/maximum do not match its values.' });
      }
    });
  });
});

// Compile-time check: every key in ProjectIR must exist in the schema output.
// If a new field is added to ProjectIR but not the Zod schema, this line will
// produce a TypeScript error listing the missing key(s).
type SchemaOutput = z.infer<typeof projectFileSchema>;
export type AssertSchemaCoversProjectIR = {
  [K in keyof ProjectIR]: K extends keyof SchemaOutput ? true : never;
};

interface NormalizeResult {
  success: boolean;
  data?: ProjectIR;
  error?: string;
  migratedFromVersion?: string;
  migrationWarnings?: string[];
}

// Default templates for array elements — used when the defaults project has
// empty arrays so mergeWithDefaults has something to fill missing fields from.
const arrayElementTemplates: Record<string, Record<string, unknown>> = {
  'geometry.bodies': {
    id: '', name: '', category: 'solid', visible: true, locked: false,
    color: '#888888', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    topology_ref: '', metadata: {},
  },
  'geometry.faces': {
    id: '', name: '', body_id: '', triangle_indices: [],
  },
  'geometry.edges': {
    id: '', name: '', body_id: '', vertex_ids: ['', ''],
  },
  'geometry.vertices': {
    id: '', name: '', body_id: '', position: [0, 0, 0],
  },
  'geometry.reference_frames': {
    id: '', name: '', origin: [0, 0, 0], axis_x: [1, 0, 0], axis_y: [0, 1, 0],
    axis_z: [0, 0, 1], type: 'cartesian',
  },
  'geometry.geometry_parameters': {
    id: '', name: '', value: 0, description: '',
  },
  'assets': {
    id: '', kind: 'stl_mesh', file_name: '', media_type: 'model/stl', encoding: 'base64',
    data: '', content_hash: '', byte_length: 0, source_unit: 'm', scale_to_meters: 1, triangle_count: 1,
    bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    diagnostics: { degenerate_triangles: 0, finite_coordinates: true, watertight: null, manifold: null },
  },
  'named_selections': {
    id: '', name: '', target_dimension: 0, entity_type: 'body',
    member_refs: [], color: '#888888', description: '', created_by: 'user',
    status: 'active', usages: [],
  },
  'materials': {
    id: '', name: '', class: 'elastic', physical_model: 'isotropic_linear',
    parameter_set: {
      density: { value: null, status: 'missing' },
      young_modulus: { value: null, status: 'missing' },
      poisson_ratio: { value: null, status: 'missing' },
      thermal_conductivity: { value: null, status: 'missing' },
      specific_heat: { value: null, status: 'missing' },
      dynamic_viscosity: { value: null, status: 'missing' },
      kinematic_viscosity: { value: null, status: 'missing' },
    },
    source: '', notes: '',
  },
  'material_assignments': {
    id: '', material_id: '', target_named_selection_id: '', override_allowed: false,
  },
  'sections': {
    id: '', name: '', section_type: 'beam_rect', dimensions: {},
    material_id: '', area: null, inertia_y: null, inertia_z: null,
    torsion_constant: null, thickness: null, metadata: {},
  },
  'section_assignments': {
    id: '', section_id: '', target_named_selection_id: '',
  },
  'mesh_controls.local': {
    id: '', target_named_selection_id: '', control_type: 'local_size',
    size: null, layers: null, bias: null, transfinite_hint: false,
    boundary_layer_hint: false, priority: 0,
  },
  'boundary_conditions': {
    id: '', name: '', physics_domain: 'structural', bc_type: 'fixed',
    target_named_selection_id: '', coordinate_system: 'global',
    values: {}, temporal_profile: 'constant', status: 'confirmed', notes: '',
  },
  'loads': {
    id: '', name: '', physics_domain: 'structural', load_type: 'nodal_force',
    target_named_selection_id: '', application_mode: 'total',
    direction: [0, 0, 0], magnitude: 0, distribution: 'uniform',
    temporal_profile: 'constant', load_case: '', coordinate_system: 'global',
    status: 'confirmed',
  },
  'initial_conditions': {
    id: '', name: '', physics_domain: 'structural', ic_type: 'initial_displacement',
    target_named_selection_id: '', values: {}, status: 'confirmed',
  },
  'analysis_cases': {
    id: '', name: '', active: true, domain_type: 'frame',
    analysis_type: 'static_linear', nonlinear: false, transient: false,
    participating_material_ids: [], participating_section_ids: [],
    participating_bc_ids: [], participating_load_ids: [],
    participating_ic_ids: [], mesh_policy_ref: '', solver_profile_hint: '',
    result_requests: [],
  },
  'results': {
    id: '', analysis_case_id: '', solver_target: 'OpenSeesPy', source_file_name: '',
    imported_at: '', status: 'partial', fields: [], checks: [], metadata: {},
  },
  'validation.items': {
    id: '', severity: 'info', code: '', title: '', message: '',
    target_ref: '', suggested_fix: '', dismissible: true, status: 'open',
  },
  'ui_state.clipping_planes': {
    normal: [0, 1, 0], constant: 0, enabled: false,
  },
  'ai_annotations': {
    id: '', source_prompt_summary: '', target_ref: '', proposal_type: 'naming',
    rationale: '', confidence: 0, status: 'proposed', applied_changes: {},
  },
  'audit_trail': {
    id: '', timestamp: '', actor: 'user', action_type: 'create',
    target_ref: '', before_summary: '', after_summary: '', note: '',
  },
};

function getElementTemplate(path: string): Record<string, unknown> | undefined {
  return arrayElementTemplates[path];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeWithDefaults<T>(
  defaults: T,
  value: unknown,
  path = '',
): T {
  if (Array.isArray(defaults)) {
    if (value === undefined) {
      return defaults;
    }
    if (!Array.isArray(value)) {
      return value as T;
    }
    const template = getElementTemplate(path)
      ?? (defaults.length > 0 && isRecord(defaults[0]) ? defaults[0] : null);
    if (!template) {
      return value as T;
    }
    return value.map((element) =>
      isRecord(element) ? mergeWithDefaults(template, element) : element,
    ) as T;
  }

  if (isRecord(defaults)) {
    if (value === undefined) {
      return defaults;
    }
    if (!isRecord(value)) {
      return value as T;
    }

    const result: Record<string, unknown> = { ...defaults };
    for (const key of Object.keys(defaults)) {
      const childPath = path ? `${path}.${key}` : key;
      result[key] = mergeWithDefaults(
        (defaults as Record<string, unknown>)[key],
        value[key],
        childPath,
      );
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!(key in result)) {
        result[key] = entry;
      }
    }
    return result as T;
  }

  return (value === undefined ? defaults : value) as T;
}

function mergeSolverTargets(
  defaults: SolverTarget[],
  value: unknown,
): SolverTarget[] {
  if (!Array.isArray(value)) {
    return defaults;
  }
  const records = value.filter(isRecord);
  const names = records
    .map((entry) => entry.target_name)
    .filter((name): name is string => typeof name === 'string');
  const recognized = new Set(defaults.map((target) => target.target_name));
  if (names.some((name) => !recognized.has(name as SolverTarget['target_name']))
      || new Set(names).size !== names.length
      || records.length !== value.length) {
    return value as SolverTarget[];
  }

  return defaults.map((base, index) => {
    const named = records.find((entry) => entry.target_name === base.target_name);
    const positional = records[index];
    const candidate = named ?? (positional?.target_name === undefined ? positional : undefined);
    return candidate ? mergeWithDefaults(base, candidate) : base;
  });
}

function formatZodError(error: z.ZodError): string {
  const formatted = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
  return `Invalid project file: ${formatted.join('; ')}`;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isFutureVersion(version: string): boolean {
  const candidate = parseVersion(version);
  const current = parseVersion(SCHEMA_VERSION);
  if (!candidate || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (candidate[index] !== current[index]) return candidate[index] > current[index];
  }
  return false;
}

function scaleNumber(record: Record<string, unknown>, key: string, factor: number): void {
  if (typeof record[key] === 'number') record[key] *= factor;
}

function scaleTuple(record: Record<string, unknown>, key: string, factor: number): void {
  const tuple = record[key];
  if (Array.isArray(tuple)) record[key] = tuple.map((value) => typeof value === 'number' ? value * factor : value);
}

function factorFor(kind: QuantityKind, system: 'SI' | 'mm-N-s' | 'mm-t-s'): number {
  return toSI(1, kind, system);
}

/**
 * Convert pre-0.2 files to canonical SI using the actual 0.1 UI provenance.
 * The legacy UI mixed display-basis geometry/section values with SI-valued
 * library materials and raw solver inputs, so a blanket dimensional scaling
 * would corrupt valid projects.
 */
function migrateLegacyUnits(raw: Record<string, unknown>): {
  data: Record<string, unknown>;
  warnings: string[];
} {
  const migrated = structuredClone(raw);
  const warnings: string[] = [];
  const units = isRecord(migrated.units) ? migrated.units : {};
  const geometry = isRecord(migrated.geometry) ? migrated.geometry : {};
  if (units.angle_unit === 'rad') {
    for (const body of Array.isArray(geometry.bodies) ? geometry.bodies : []) {
      if (!isRecord(body) || !isRecord(body.transform)) continue;
      const rotation = body.transform.rotation;
      if (Array.isArray(rotation)) {
        body.transform.rotation = rotation.map((value) => (
          typeof value === 'number' ? value * 180 / Math.PI : value
        ));
      }
    }
  } else if (units.angle_unit !== undefined && units.angle_unit !== 'deg') {
    throw new Error(`Legacy angle unit "${String(units.angle_unit)}" is unsupported.`);
  }
  units.angle_unit = 'deg';
  migrated.units = units;
  if (units.value_basis === 'SI') return { data: migrated, warnings };

  const systemName = units.system_name;
  if (systemName === 'custom') {
    throw new Error('Legacy custom unit projects have no canonical value basis and cannot be migrated safely.');
  }
  const system = systemName === 'mm-N-s' || systemName === 'mm-t-s' ? systemName : 'SI';
  const length = factorFor('length', system);
  // Geometry inputs in 0.1 had no unit label or conversion, and every exporter
  // emitted raw coordinates (including OpenFOAM convertToMeters 1). Preserve
  // those historical solver semantics instead of inferring from the final UI
  // preset, which users could change without converting existing values.
  const legacyGeometryFactor = 1;

  for (const body of Array.isArray(geometry.bodies) ? geometry.bodies : []) {
    if (!isRecord(body)) continue;
    const transform = isRecord(body.transform) ? body.transform : {};
    scaleTuple(transform, 'position', legacyGeometryFactor);
    const metadata = isRecord(body.metadata) ? body.metadata : {};
    for (const key of ['width', 'height', 'depth', 'radius', 'thickness', 'holeRadius', 'outerRadius', 'innerRadius', 'length', 'span', 'spanX', 'spanY']) {
      scaleNumber(metadata, key, legacyGeometryFactor);
    }
  }
  for (const face of Array.isArray(geometry.faces) ? geometry.faces : []) if (isRecord(face)) scaleNumber(face, 'area', legacyGeometryFactor ** 2);
  for (const edge of Array.isArray(geometry.edges) ? geometry.edges : []) if (isRecord(edge)) scaleNumber(edge, 'length', legacyGeometryFactor);
  for (const vertex of Array.isArray(geometry.vertices) ? geometry.vertices : []) if (isRecord(vertex)) scaleTuple(vertex, 'position', legacyGeometryFactor);
  for (const frame of Array.isArray(geometry.reference_frames) ? geometry.reference_frames : []) if (isRecord(frame)) scaleTuple(frame, 'origin', legacyGeometryFactor);
  for (const parameter of Array.isArray(geometry.geometry_parameters) ? geometry.geometry_parameters : []) if (isRecord(parameter)) scaleNumber(parameter, 'value', legacyGeometryFactor);

  for (const material of Array.isArray(migrated.materials) ? migrated.materials : []) {
    if (!isRecord(material) || !isRecord(material.parameter_set)) continue;
    const manuallyDisplayedFactors: Record<string, number> = {
      // The 0.1 Material form used kg/mm3 for both mm presets, MPa, and
      // W/(mm K). These labels intentionally differ from the 0.2 registry.
      density: system === 'SI' ? 1 : 1e9,
      young_modulus: system === 'SI' ? 1 : 1e6,
      thermal_conductivity: system === 'SI' ? 1 : 1e3,
    };
    for (const [key, factor] of Object.entries(manuallyDisplayedFactors)) {
      const tracked = material.parameter_set[key];
      if (!isRecord(tracked) || typeof tracked.value !== 'number') continue;
      // Library/imported/inferred values were already stored in SI in 0.1.
      if (tracked.status === 'library' || tracked.status === 'imported' || tracked.status === 'inferred') continue;
      if (tracked.status === 'confirmed') {
        scaleNumber(tracked, 'value', factor);
        continue;
      }
      if (system !== 'SI') {
        const reference = `${String(material.id ?? material.name ?? '')}.${key}`;
        const originalStatus = String(tracked.status);
        scaleNumber(tracked, 'value', factor);
        tracked.status = 'needs_review';
        warnings.push(
          `Legacy material ${reference} had ambiguous unit provenance (status: ${originalStatus}); its value was interpreted using ${system} display units and marked needs_review.`,
        );
      }
    }
  }

  for (const section of Array.isArray(migrated.sections) ? migrated.sections : []) {
    if (!isRecord(section)) continue;
    if (isRecord(section.dimensions)) for (const key of Object.keys(section.dimensions)) scaleNumber(section.dimensions, key, length);
    scaleNumber(section, 'area', factorFor('area', system));
    for (const key of ['inertia_y', 'inertia_z', 'torsion_constant']) scaleNumber(section, key, factorFor('fourth_moment', system));
    scaleNumber(section, 'thickness', length);
  }

  if (isRecord(migrated.mesh_controls)) {
    if (isRecord(migrated.mesh_controls.global)) scaleNumber(migrated.mesh_controls.global, 'global_size', length);
    for (const control of Array.isArray(migrated.mesh_controls.local) ? migrated.mesh_controls.local : []) if (isRecord(control)) scaleNumber(control, 'size', length);
  }

  // 0.1 BC inputs had no displayed units. Preserve their historical raw solver
  // values. OpenFOAM wrote outlet pressure directly to p, so mark it kinematic.
  for (const bc of Array.isArray(migrated.boundary_conditions) ? migrated.boundary_conditions : []) {
    if (!isRecord(bc) || !isRecord(bc.values)) continue;
    if (bc.bc_type === 'pressure_outlet' && bc.values.pressure_basis === undefined) {
      bc.values.pressure_basis = 'kinematic';
    }
    if (bc.values.heat_transfer_coefficient !== undefined || bc.values.ambient_temperature !== undefined) {
      throw new Error('Legacy convection named fields have ambiguous unit provenance and require an explicit current-schema conversion.');
    }
  }

  // The 0.1 Load form displayed MPa only for pressure and N for every other
  // load type, irrespective of application_mode. Preserve that exact contract.
  for (const load of Array.isArray(migrated.loads) ? migrated.loads : []) {
    if (!isRecord(load)) continue;
    const kind: QuantityKind = load.load_type === 'pressure' ? 'pressure' : 'force';
    scaleNumber(load, 'magnitude', factorFor(kind, system));
  }
  // Initial-condition editing was not exposed by the 0.1 UI; preserve imported
  // raw values instead of guessing a display basis.

  units.value_basis = 'SI';
  migrated.units = units;
  const auditTrail = Array.isArray(migrated.audit_trail) ? migrated.audit_trail : [];
  auditTrail.push({
    id: `audit_unit_migration_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'migration',
    action_type: 'unit_conversion',
    target_ref: 'units',
    before_summary: `${String(systemName ?? 'SI')} mixed legacy values`,
    after_summary: 'canonical SI values',
    note: 'Field-aware migration: unlabeled raw geometry, SI library materials, and raw solver inputs were preserved; explicitly labelled display-basis fields were converted.',
  });
  migrated.audit_trail = auditTrail;
  return { data: migrated, warnings };
}

export function normalizeAndValidateProjectData(raw: unknown): NormalizeResult {
  if (!isRecord(raw)) {
    return { success: false, error: 'Invalid project file: root must be an object' };
  }

  if (!isRecord(raw.meta)) {
    return { success: false, error: 'Invalid project file: missing meta section' };
  }

  if (typeof raw.meta.schema_name !== 'string') {
    return { success: false, error: 'Invalid project file: meta.schema_name must be a string' };
  }

  if (raw.meta.schema_name !== SCHEMA_NAME) {
    return {
      success: false,
      error: `Unknown schema: ${raw.meta.schema_name}. Expected: ${SCHEMA_NAME}`,
    };
  }

  const rawVersion = typeof raw.meta.schema_version === 'string' ? raw.meta.schema_version : '0.0.0';
  if (!parseVersion(rawVersion)) {
    return {
      success: false,
      error: `Invalid project schema version: ${rawVersion}. Expected semantic version x.y.z.`,
    };
  }
  if (isFutureVersion(rawVersion)) {
    return {
      success: false,
      error: `Project schema ${rawVersion} is newer than supported schema ${SCHEMA_VERSION}. Update FEM Modeler before opening it.`,
    };
  }

  // Current files are a lossless contract: no default insertion and no
  // unknown-key stripping. Every required field must be present and every
  // nested object is strict.
  if (rawVersion === SCHEMA_VERSION) {
    const current = projectFileSchema.safeParse(raw);
    if (!current.success) {
      return { success: false, error: formatZodError(current.error) };
    }
    return { success: true, data: current.data as ProjectIR };
  }

  const defaults = createDefaultProject();
  const migratedFromVersion = rawVersion;

  let migration: ReturnType<typeof migrateLegacyUnits>;
  try {
    migration = migrateLegacyUnits(raw);
  } catch (error) {
    return { success: false, error: `Invalid project file: ${String(error)}` };
  }
  const migratedRaw = migration.data;

  const merged = mergeWithDefaults(defaults, migratedRaw);
  const normalized: ProjectIR = {
    ...merged,
    meta: {
      ...merged.meta,
      schema_name: SCHEMA_NAME,
      schema_version: SCHEMA_VERSION,
      app_version: APP_VERSION,
    },
    solver_targets: mergeSolverTargets(defaults.solver_targets, migratedRaw.solver_targets),
  };

  const parsed = projectFileSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      success: false,
      error: formatZodError(parsed.error),
    };
  }

  return {
    success: true,
    data: parsed.data as ProjectIR,
    migratedFromVersion,
    migrationWarnings: migration.warnings,
  };
}
