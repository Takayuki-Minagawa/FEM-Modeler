import { metaSchema, unitsSchema, solverTargetsSchema } from '@/core/ir/schema/identity';
import { geometrySchema, assetsSchema, namedSelectionsSchema } from '@/core/ir/schema/geometry';
import { materialsSchema, materialAssignmentsSchema, sectionsSchema, sectionAssignmentsSchema, meshControlsSchema } from '@/core/ir/schema/properties';
import { boundaryConditionsSchema, loadsSchema, initialConditionsSchema, analysisCasesSchema } from '@/core/ir/schema/conditions';
import { resultsSchema, convergenceStudiesSchema, validationSchema, uiStateSchema, aiAnnotationsSchema, auditTrailSchema } from '@/core/ir/schema/artifacts';
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
import { migrateLegacyUnits } from './migrations/v0_1';
import { migrateV02Artifacts } from './migrations/v0_2';
import { validateMeshFieldReferences } from '@/results/package';

const REQUIRED_SOLVER_TARGETS = ['OpenSeesPy', 'DOLFINx', 'OpenFOAM'] as const;

const projectFileSchema = z.strictObject({
  meta: metaSchema,
  units: unitsSchema,
  geometry: geometrySchema,
  assets: assetsSchema,
  named_selections: namedSelectionsSchema,
  materials: materialsSchema,
  material_assignments: materialAssignmentsSchema,
  sections: sectionsSchema,
  section_assignments: sectionAssignmentsSchema,
  mesh_controls: meshControlsSchema,
  boundary_conditions: boundaryConditionsSchema,
  loads: loadsSchema,
  initial_conditions: initialConditionsSchema,
  analysis_cases: analysisCasesSchema,
  results: resultsSchema,
  convergence_studies: convergenceStudiesSchema,
  solver_targets: solverTargetsSchema,
  validation: validationSchema,
  ui_state: uiStateSchema,
  ai_annotations: aiAnnotationsSchema,
  audit_trail: auditTrailSchema,
}).superRefine((project, context) => {
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const bodies = new Map(project.geometry.bodies.map((body) => [body.id, body]));
  if (assets.size !== project.assets.length) context.addIssue({ code: 'custom', path: ['assets'], message: 'Geometry asset IDs must be unique.' });
  project.geometry.bodies.forEach((body, index) => {
    const asset = body.asset_ref ? assets.get(body.asset_ref) : undefined;
    if (body.metadata.shapeType === 'imported_cad') {
      if (!asset?.cad_source || asset.cad_source.format !== body.metadata.importFormat
        || asset.source_unit !== 'm' || asset.scale_to_meters !== 1
        || asset.content_hash !== body.metadata.contentHash || asset.triangle_count !== body.metadata.triangleCount) {
        context.addIssue({ code: 'custom', path: ['geometry', 'bodies', index], message: 'Imported CAD requires its matching original CAD source and SI display mesh.' });
      }
    } else if (asset?.cad_source) {
      context.addIssue({ code: 'custom', path: ['geometry', 'bodies', index, 'metadata'], message: 'An asset with a CAD source requires imported_cad body metadata.' });
    }
  });
  project.geometry.faces.forEach((face, index) => {
    const body = bodies.get(face.body_id);
    if (body?.metadata.shapeType !== 'imported_cad') return;
    const count = body.asset_ref ? assets.get(body.asset_ref)?.triangle_count : undefined;
    if (count !== undefined && face.triangle_indices.some((triangle) => !Number.isInteger(triangle) || triangle < 0 || triangle >= count)) {
      context.addIssue({ code: 'custom', path: ['geometry', 'faces', index, 'triangle_indices'], message: 'CAD face references a missing display triangle.' });
    }
  });
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
    if (result.mesh) {
      if (result.mesh.source.solver !== result.solver_target
        || result.metadata.export_target !== result.solver_target
        || result.mesh.source.input_fingerprint !== result.metadata.input_fingerprint
        || (result.metadata.analysis_case_id !== undefined && result.metadata.analysis_case_id !== result.analysis_case_id)) {
        context.addIssue({ code: 'custom', path: ['results', resultIndex, 'mesh'], message: 'Mesh and stored result provenance do not match.' });
      }
      try { validateMeshFieldReferences(result.mesh, result.fields); }
      catch (error) {
        context.addIssue({ code: 'custom', path: ['results', resultIndex, 'fields'], message: error instanceof Error ? error.message : 'Invalid mesh field references.' });
      }
    }
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
type Assert<T extends true> = T;
export type AssertSchemaCoversProjectIR = Assert<
  [SchemaOutput] extends [ProjectIR] ? [ProjectIR] extends [SchemaOutput] ? true : false : false
>;

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
    return { success: true, data: current.data };
  }

  const sourceVersion = parseVersion(rawVersion)!;
  if (sourceVersion[0] === 0 && sourceVersion[1] === 3) {
    // 0.4 adds optional CAD fields only. Preserve the strict 0.3 contract instead
    // of silently repairing missing data with the much older migration defaults.
    const upgraded = projectFileSchema.safeParse({ ...raw, meta: { ...raw.meta, schema_version: SCHEMA_VERSION, app_version: APP_VERSION } });
    return upgraded.success ? { success: true, data: upgraded.data, migratedFromVersion: rawVersion }
      : { success: false, error: formatZodError(upgraded.error) };
  }

  const defaults = createDefaultProject();
  const migratedFromVersion = rawVersion;

  let migration: ReturnType<typeof migrateLegacyUnits>;
  try {
    const version = parseVersion(rawVersion)!;
    migration = version[0] === 0 && version[1] < 2
      ? migrateLegacyUnits(raw)
      : { data: structuredClone(raw), warnings: [] };
  } catch (error) {
    return { success: false, error: `Invalid project file: ${String(error)}` };
  }
  const version = parseVersion(rawVersion)!;
  // Schema 0.3 already carries verified input identities. The CAD extension is
  // optional and must not downgrade existing results or apply legacy SI conversion.
  const migratedRaw = version[0] === 0 && version[1] < 3 ? migrateV02Artifacts(migration.data) : migration.data;

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
    data: parsed.data,
    migratedFromVersion,
    migrationWarnings: migration.warnings,
  };
}
