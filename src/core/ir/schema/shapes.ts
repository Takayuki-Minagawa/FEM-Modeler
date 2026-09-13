import { z } from 'zod';

const length = z.number().finite().positive();
const count = z.number().int().min(1).max(1_000);
const segments = z.number().int().min(3).max(1_000);

export const nativeShapeSchema = z.discriminatedUnion('shapeType', [
  z.strictObject({ shapeType: z.literal('box'), width: length, height: length, depth: length }),
  z.strictObject({ shapeType: z.literal('cylinder'), radius: length, height: length, segments }),
  z.strictObject({ shapeType: z.literal('plate'), width: length, depth: length, thickness: length }),
  z.strictObject({ shapeType: z.literal('plateWithHole'), width: length, depth: length, thickness: length, holeRadius: length }),
  z.strictObject({ shapeType: z.literal('pipe'), outerRadius: length, innerRadius: length, length, segments }),
  z.strictObject({ shapeType: z.literal('lBracket'), width: length, height: length, thickness: length, depth: length }),
  z.strictObject({ shapeType: z.literal('frame2d'), spanX: length, spanY: length, columns: count, floors: count }),
  z.strictObject({ shapeType: z.literal('truss2d'), span: length, height: length, divisions: count }),
  z.strictObject({ shapeType: z.literal('channel'), length, height: length, depth: length, dimensionality: z.enum(['2D', '3D']).optional() }),
]).superRefine((shape, context) => {
  if (shape.shapeType === 'pipe' && shape.innerRadius >= shape.outerRadius) {
    context.addIssue({ code: 'custom', path: ['innerRadius'], message: 'Inner radius must be smaller than outer radius.' });
  }
  if (shape.shapeType === 'plateWithHole' && 2 * shape.holeRadius >= Math.min(shape.width, shape.depth)) {
    context.addIssue({ code: 'custom', path: ['holeRadius'], message: 'The hole must fit strictly inside the plate.' });
  }
  if (shape.shapeType === 'lBracket' && shape.thickness >= Math.min(shape.width, shape.height)) {
    context.addIssue({ code: 'custom', path: ['thickness'], message: 'Bracket thickness must be smaller than both legs.' });
  }
  if (shape.shapeType === 'frame2d' && shape.columns < 2) {
    context.addIssue({ code: 'custom', path: ['columns'], message: 'A frame needs at least two columns.' });
  }
});

export type NativeShapeParams = z.infer<typeof nativeShapeSchema>;

export const importedCadShapeSchema = z.strictObject({
  shapeType: z.literal('imported_cad'), importFormat: z.enum(['step', 'iges']),
  fileName: z.string().min(1).max(1024), triangleCount: z.number().int().positive().max(1_000_000),
  contentHash: z.string().min(1), sourceUnit: z.literal('m'), scaleToMeters: z.literal(1),
});
export type ImportedCadShapeParams = z.infer<typeof importedCadShapeSchema>;
export function parseImportedCadShapeMetadata(metadata: Record<string, unknown>): ImportedCadShapeParams {
  return importedCadShapeSchema.parse(Object.fromEntries(Object.keys(importedCadShapeSchema.shape).map((key) => [key, metadata[key]])));
}

/** Metadata also contains solver hints and annotations; extract only generation parameters. */
export function parseNativeShapeMetadata(metadata: Record<string, unknown>): NativeShapeParams {
  const variant = nativeShapeSchema.options.find((item) => item.shape.shapeType.value === metadata.shapeType);
  if (!variant) throw new Error(`Unknown native shape: ${String(metadata.shapeType)}.`);
  const parameters = Object.fromEntries(Object.keys(variant.shape).map((key) => [key, metadata[key]]));
  return nativeShapeSchema.parse(parameters);
}
