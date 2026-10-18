import { parseNativeShapeMetadata } from '@/core/ir/schema/shapes';
import type { Vector3Tuple } from './transforms';

export interface NativeShapeBounds { min: Vector3Tuple; max: Vector3Tuple }

export function nativeShapeBounds(metadata: Record<string, unknown>): NativeShapeBounds | null {
  try {
    const shape = parseNativeShapeMetadata(metadata);
    let size: Vector3Tuple;
    switch (shape.shapeType) {
      case 'box': case 'lBracket': size = [shape.width, shape.height, shape.depth]; break;
      case 'plate': case 'plateWithHole': size = [shape.width, shape.thickness, shape.depth]; break;
      case 'cylinder': size = [shape.radius * 2, shape.height, shape.radius * 2]; break;
      case 'pipe': size = [shape.outerRadius * 2, shape.length, shape.outerRadius * 2]; break;
      case 'channel': size = [shape.length, shape.height, shape.depth]; break;
      case 'frame2d': return { min: [0, 0, 0], max: [shape.spanX, shape.spanY, 0] };
      case 'truss2d': {
        const divisions = Math.max(2, shape.divisions);
        return { min: [0, 0, 0], max: [shape.span, shape.height * (2 * Math.floor(divisions / 2) / divisions), 0] };
      }
    }
    return { min: size.map((value) => -value / 2) as Vector3Tuple, max: size.map((value) => value / 2) as Vector3Tuple };
  } catch { return null; }
}
