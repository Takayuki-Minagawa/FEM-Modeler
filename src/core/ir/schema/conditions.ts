import { z } from 'zod';
import { tuple3NumberSchema, dofMapSchema } from './shared';

const boundaryConditionBase = z.strictObject({
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
  });

const boundaryVariant = <T extends z.infer<typeof boundaryConditionBase>['bc_type']>(type: T) => boundaryConditionBase.extend({ bc_type: z.literal(type) });
export const boundaryConditionSchema = z.discriminatedUnion('bc_type', [
  boundaryVariant('fixed'), boundaryVariant('prescribed_displacement'), boundaryVariant('symmetry'),
  boundaryVariant('temperature'), boundaryVariant('heat_flux'), boundaryVariant('convection'), boundaryVariant('insulation'),
  boundaryVariant('velocity_inlet'), boundaryVariant('pressure_outlet'), boundaryVariant('wall'), boundaryVariant('slip'), boundaryVariant('no_slip'),
]).superRefine((condition, context) => {
  const thermal = ['temperature', 'heat_flux', 'convection', 'insulation'].includes(condition.bc_type);
  const structural = ['fixed', 'prescribed_displacement', 'symmetry'].includes(condition.bc_type);
  const expected = thermal ? 'thermal' : structural ? 'structural' : 'fluid';
  if (condition.physics_domain !== expected) context.addIssue({ code: 'custom', path: ['physics_domain'], message: `${condition.bc_type} requires ${expected} physics.` });
  const permitted = condition.bc_type === 'convection' ? ['heat_transfer_coefficient', 'ambient_temperature', 'scalar', 'vector', 'function_ref']
    : thermal ? ['scalar', 'function_ref']
    : structural ? ['scalar', 'vector', 'dof_map', 'function_ref']
    : condition.bc_type === 'pressure_outlet' ? ['scalar', 'pressure_basis', 'function_ref']
    : ['scalar', 'vector', 'function_ref'];
  for (const key of Object.keys(condition.values)) if (!permitted.includes(key)) {
    context.addIssue({ code: 'custom', path: ['values', key], message: `${key} is not a ${condition.bc_type} parameter.` });
  }
});
export const boundaryConditionsSchema = z.array(boundaryConditionSchema);
export type BoundaryConditionData = z.infer<typeof boundaryConditionSchema>;

const loadBase = z.strictObject({
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
  });
const loadVariant = <T extends z.infer<typeof loadBase>['load_type']>(type: T) => loadBase.extend({ load_type: z.literal(type) });
export const loadSchema = z.discriminatedUnion('load_type', [
  loadVariant('nodal_force'), loadVariant('surface_traction'), loadVariant('body_force'), loadVariant('gravity'),
  loadVariant('line_load'), loadVariant('pressure'), loadVariant('heat_source'), loadVariant('volumetric_heat'), loadVariant('mass_flow_rate'),
]).superRefine((load, context) => {
  if (load.load_type === 'body_force' && load.physics_domain === 'fluid') return;
  const expected = ['heat_source', 'volumetric_heat'].includes(load.load_type) ? 'thermal'
    : load.load_type === 'mass_flow_rate' ? 'fluid' : 'structural';
  if (load.physics_domain !== expected) context.addIssue({ code: 'custom', path: ['physics_domain'], message: `${load.load_type} requires ${expected} physics.` });
});
export const loadsSchema = z.array(loadSchema);
export type LoadData = z.infer<typeof loadSchema>;

export const initialConditionsSchema = z.array(z.strictObject({
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
  }));

export const analysisCasesSchema = z.array(z.strictObject({
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
  }));
