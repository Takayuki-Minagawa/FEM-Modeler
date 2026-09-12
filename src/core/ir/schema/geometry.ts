import { z } from 'zod';
import { tuple3NumberSchema, unknownRecordSchema } from './shared';
import { parseNativeShapeMetadata } from './shapes';

export const geometrySchema = z.strictObject({
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
    }).superRefine((body, context) => {
      if (body.metadata.shapeType === undefined || body.metadata.shapeType === 'imported_stl') return;
      try { parseNativeShapeMetadata(body.metadata); }
      catch (error) { context.addIssue({ code: 'custom', path: ['metadata'], message: String(error) }); }
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
  });

export const assetsSchema = z.array(z.strictObject({
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
  }));

export const namedSelectionsSchema = z.array(z.strictObject({
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
  }));
