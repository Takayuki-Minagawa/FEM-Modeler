import type { GeometryBody } from '@/core/ir/types';
import { nativeShapeBounds } from './native-bounds';
import type { Vector3Tuple } from './transforms';

/**
 * ボディのローカル軸方向の外形寸法(SI)。スケールを反映し、回転・移動は含まない。
 * ネイティブ形状以外(CAD/STL取込など)は null。
 */
export function bodyLocalExtents(body: GeometryBody): Vector3Tuple | null {
  const bounds = nativeShapeBounds(body.metadata);
  if (!bounds) return null;
  const { scale } = body.transform;
  return [0, 1, 2].map((axis) => (bounds.max[axis] - bounds.min[axis]) * Math.abs(scale[axis])) as Vector3Tuple;
}
