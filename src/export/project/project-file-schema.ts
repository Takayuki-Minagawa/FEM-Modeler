import { z } from 'zod';
import type { ProjectIR, SolverTarget } from '@/core/ir/types';
import {
  APP_VERSION,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  createDefaultProject,
} from '@/core/ir/defaults';

const tuple3NumberSchema = z.tuple([z.number(), z.number(), z.number()]);
const unknownRecordSchema = z.record(z.string(), z.unknown());
const stringRecordSchema = z.record(z.string(), z.string());
const booleanRecordSchema = z.record(z.string(), z.boolean());

const projectFileSchema = z.object({
  meta: z.object({
    schema_name: z.string(),
    schema_version: z.string(),
    app_version: z.string(),
    project_id: z.string(),
    project_name: z.string(),
    description: z.string(),
    author: z.string(),
    organization: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
    tags: z.array(z.string()),
    status: z.string(),
    default_solver_target: z.string(),
    domain_type: z.string(),
  }),
  units: z.object({
    system_name: z.string(),
    base_length: z.string(),
    base_mass: z.string(),
    base_time: z.string(),
    base_temperature: z.string(),
    base_force: z.string(),
    angle_unit: z.string(),
    display_precision: z.number(),
    preferred_stress_unit: z.string(),
    preferred_pressure_unit: z.string(),
    preferred_energy_unit: z.string(),
  }),
  geometry: z.object({
    model_type: z.string(),
    source: z.string(),
    bodies: z.array(z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      visible: z.boolean(),
      locked: z.boolean(),
      color: z.string(),
      transform: z.object({
        position: tuple3NumberSchema,
        rotation: tuple3NumberSchema,
        scale: tuple3NumberSchema,
      }),
      topology_ref: z.string(),
      metadata: unknownRecordSchema,
    })),
    faces: z.array(z.object({
      id: z.string(),
      name: z.string(),
      body_id: z.string(),
      normal: tuple3NumberSchema.optional(),
      area: z.number().optional(),
      triangle_indices: z.array(z.number()),
    })),
    edges: z.array(z.object({
      id: z.string(),
      name: z.string(),
      body_id: z.string(),
      vertex_ids: z.tuple([z.string(), z.string()]),
      length: z.number().optional(),
    })),
    vertices: z.array(z.object({
      id: z.string(),
      name: z.string(),
      body_id: z.string(),
      position: tuple3NumberSchema,
    })),
    reference_frames: z.array(z.object({
      id: z.string(),
      name: z.string(),
      origin: tuple3NumberSchema,
      axis_x: tuple3NumberSchema,
      axis_y: tuple3NumberSchema,
      axis_z: tuple3NumberSchema,
      type: z.string(),
      attached_to: z.string().optional(),
    })),
    geometry_parameters: z.array(z.object({
      id: z.string(),
      name: z.string(),
      value: z.number(),
      description: z.string(),
    })),
  }),
  named_selections: z.array(z.object({
    id: z.string(),
    name: z.string(),
    display_name: z.string().optional(),
    target_dimension: z.number(),
    entity_type: z.string(),
    member_refs: z.array(z.string()),
    color: z.string(),
    description: z.string(),
    created_by: z.string(),
    status: z.string(),
    usages: z.array(z.string()),
  })),
  materials: z.array(z.object({
    id: z.string(),
    name: z.string(),
    class: z.string(),
    physical_model: z.string(),
    parameter_set: z.object({
      density: z.object({ value: z.number().nullable(), status: z.string(), source: z.string().optional() }),
      young_modulus: z.object({ value: z.number().nullable(), status: z.string(), source: z.string().optional() }),
      poisson_ratio: z.object({ value: z.number().nullable(), status: z.string(), source: z.string().optional() }),
      thermal_conductivity: z.object({ value: z.number().nullable(), status: z.string(), source: z.string().optional() }),
      specific_heat: z.object({ value: z.number().nullable(), status: z.string(), source: z.string().optional() }),
      dynamic_viscosity: z.object({ value: z.number().nullable(), status: z.string(), source: z.string().optional() }),
      kinematic_viscosity: z.object({ value: z.number().nullable(), status: z.string(), source: z.string().optional() }),
    }),
    source: z.string(),
    notes: z.string(),
  })),
  material_assignments: z.array(z.object({
    id: z.string(),
    material_id: z.string(),
    target_named_selection_id: z.string(),
    override_allowed: z.boolean(),
  })),
  sections: z.array(z.object({
    id: z.string(),
    name: z.string(),
    section_type: z.string(),
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
  section_assignments: z.array(z.object({
    id: z.string(),
    section_id: z.string(),
    target_named_selection_id: z.string(),
  })),
  mesh_controls: z.object({
    global: z.object({
      algorithm_preference: z.string(),
      global_size: z.number().nullable(),
      growth_rate: z.number(),
      element_order: z.number(),
      recombine_preference: z.string(),
      curvature_based_refinement: z.boolean(),
    }),
    local: z.array(z.object({
      id: z.string(),
      target_named_selection_id: z.string(),
      control_type: z.string(),
      size: z.number().nullable(),
      layers: z.number().nullable(),
      bias: z.number().nullable(),
      transfinite_hint: z.boolean(),
      boundary_layer_hint: z.boolean(),
      priority: z.number(),
    })),
    quality_targets: z.object({
      min_jacobian: z.number(),
      max_aspect_ratio: z.number(),
      min_skewness: z.number(),
      preferred_quality_level: z.string(),
    }),
  }),
  boundary_conditions: z.array(z.object({
    id: z.string(),
    name: z.string(),
    physics_domain: z.string(),
    bc_type: z.string(),
    target_named_selection_id: z.string(),
    coordinate_system: z.string(),
    values: z.object({
      scalar: z.number().optional(),
      vector: tuple3NumberSchema.optional(),
      dof_map: z.object({
        ux: z.string(),
        uy: z.string(),
        uz: z.string(),
        rx: z.string(),
        ry: z.string(),
        rz: z.string(),
      }).optional(),
      function_ref: z.string().optional(),
    }),
    temporal_profile: z.string(),
    status: z.string(),
    notes: z.string(),
  })),
  loads: z.array(z.object({
    id: z.string(),
    name: z.string(),
    physics_domain: z.string(),
    load_type: z.string(),
    target_named_selection_id: z.string(),
    application_mode: z.string(),
    direction: tuple3NumberSchema,
    magnitude: z.number(),
    distribution: z.string(),
    temporal_profile: z.string(),
    load_case: z.string(),
    coordinate_system: z.string(),
    status: z.string(),
  })),
  initial_conditions: z.array(z.object({
    id: z.string(),
    name: z.string(),
    physics_domain: z.string(),
    ic_type: z.string(),
    target_named_selection_id: z.string(),
    values: z.object({
      scalar: z.number().optional(),
      vector: tuple3NumberSchema.optional(),
      dof_map: z.object({
        ux: z.string(),
        uy: z.string(),
        uz: z.string(),
        rx: z.string(),
        ry: z.string(),
        rz: z.string(),
      }).optional(),
      function_ref: z.string().optional(),
    }),
    status: z.string(),
  })),
  analysis_cases: z.array(z.object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    domain_type: z.string(),
    analysis_type: z.string(),
    nonlinear: z.boolean(),
    transient: z.boolean(),
    participating_material_ids: z.array(z.string()),
    participating_section_ids: z.array(z.string()),
    participating_bc_ids: z.array(z.string()),
    participating_load_ids: z.array(z.string()),
    participating_ic_ids: z.array(z.string()),
    mesh_policy_ref: z.string(),
    solver_profile_hint: z.string(),
    result_requests: z.array(z.string()),
  })),
  solver_targets: z.array(z.object({
    target_name: z.string(),
    enabled: z.boolean(),
    export_profile: z.string(),
    solver_options: unknownRecordSchema,
    path_preferences: stringRecordSchema,
    packaging: z.string(),
  })),
  validation: z.object({
    last_run_at: z.string(),
    summary: z.object({
      error_count: z.number(),
      warning_count: z.number(),
      info_count: z.number(),
    }),
    items: z.array(z.object({
      id: z.string(),
      severity: z.string(),
      code: z.string(),
      title: z.string(),
      message: z.string(),
      target_ref: z.string(),
      suggested_fix: z.string(),
      dismissible: z.boolean(),
      status: z.string(),
    })),
  }),
  ui_state: z.object({
    active_panel: z.string(),
    camera_state: z.object({
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
    color_mode: z.string(),
    clipping_planes: z.array(z.object({
      normal: tuple3NumberSchema,
      constant: z.number(),
      enabled: z.boolean(),
    })),
    last_opened_tabs: z.array(z.string()),
  }),
  ai_annotations: z.array(z.object({
    id: z.string(),
    source_prompt_summary: z.string(),
    target_ref: z.string(),
    proposal_type: z.string(),
    rationale: z.string(),
    confidence: z.number(),
    status: z.string(),
    applied_changes: unknownRecordSchema,
  })),
  audit_trail: z.array(z.object({
    id: z.string(),
    timestamp: z.string(),
    actor: z.string(),
    action_type: z.string(),
    target_ref: z.string(),
    before_summary: z.string(),
    after_summary: z.string(),
    note: z.string(),
  })),
});

interface NormalizeResult {
  success: boolean;
  data?: ProjectIR;
  error?: string;
  migratedFromVersion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeWithDefaults<T>(defaults: T, value: unknown): T {
  if (Array.isArray(defaults)) {
    if (value === undefined) {
      return defaults;
    }
    return value as T;
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
      result[key] = mergeWithDefaults(
        (defaults as Record<string, unknown>)[key],
        value[key],
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

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      return entry as SolverTarget;
    }

    const targetName = typeof entry.target_name === 'string' ? entry.target_name : undefined;
    const base = defaults.find((target) => target.target_name === targetName)
      ?? defaults[index]
      ?? defaults[0];
    return mergeWithDefaults(base, entry);
  });
}

function formatZodError(error: z.ZodError): string {
  const formatted = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
  return `Invalid project file: ${formatted.join('; ')}`;
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

  const defaults = createDefaultProject();
  const migratedFromVersion =
    typeof raw.meta.schema_version === 'string' && raw.meta.schema_version !== SCHEMA_VERSION
      ? raw.meta.schema_version
      : undefined;

  const merged = mergeWithDefaults(defaults, raw);
  const normalized: ProjectIR = {
    ...merged,
    meta: {
      ...merged.meta,
      schema_name: SCHEMA_NAME,
      schema_version: SCHEMA_VERSION,
      app_version: APP_VERSION,
    },
    solver_targets: mergeSolverTargets(defaults.solver_targets, raw.solver_targets),
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
  };
}
