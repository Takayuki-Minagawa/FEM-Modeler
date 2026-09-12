import { z } from 'zod';
import { unknownRecordSchema } from './shared';

export const materialsSchema = z.array(z.strictObject({
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
  }));

export const materialAssignmentsSchema = z.array(z.strictObject({
    id: z.string(),
    material_id: z.string(),
    target_named_selection_id: z.string(),
    override_allowed: z.boolean(),
  }));

export const sectionsSchema = z.array(z.strictObject({
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
  }));

export const sectionAssignmentsSchema = z.array(z.strictObject({
    id: z.string(),
    section_id: z.string(),
    target_named_selection_id: z.string(),
  }));

export const meshControlsSchema = z.strictObject({
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
  });
