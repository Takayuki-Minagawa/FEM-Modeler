import { z } from 'zod';
import { tuple3NumberSchema } from './shared';

export const namedSelectionQuerySchema = z.strictObject({
  version: z.literal(1), coordinate_frame: z.literal('world'), length_unit: z.literal('m'),
  operation: z.enum(['add', 'remove', 'replace', 'invert']),
  base_member_refs: z.array(z.string()),
  predicate: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ids'), ids: z.array(z.string()) }),
    z.strictObject({ kind: z.literal('all') }),
    z.strictObject({ kind: z.literal('coordinate_range'), axis: z.union([z.literal(0), z.literal(1), z.literal(2)]), min: z.number().finite().nullable(), max: z.number().finite().nullable() }).refine((v) => v.min === null || v.max === null || v.min <= v.max, 'Range minimum exceeds maximum'),
    z.strictObject({ kind: z.literal('face_normal'), direction: tuple3NumberSchema.refine((v) => v.every(Number.isFinite) && Math.hypot(...v) > 0 && Number.isFinite(Math.hypot(...v)), 'Direction must be finite and nonzero'), tolerance_degrees: z.number().min(0).max(180) }),
  ]),
});
