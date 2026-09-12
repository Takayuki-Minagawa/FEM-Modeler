import { z } from 'zod';
import { unknownRecordSchema, stringRecordSchema } from './shared';
import { SCHEMA_NAME, SCHEMA_VERSION } from '../defaults';

export const metaSchema = z.strictObject({
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
  });

export const unitsSchema = z.strictObject({
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
  });

export const solverTargetsSchema = z.array(z.strictObject({
    target_name: z.enum(['OpenSeesPy', 'DOLFINx', 'OpenFOAM']),
    enabled: z.boolean(),
    export_profile: z.enum(['strict', 'permissive', 'template_based']),
    solver_options: unknownRecordSchema,
    path_preferences: stringRecordSchema,
    packaging: z.enum(['single_file', 'multi_file', 'zip_bundle', 'folder_tree']),
  }));
