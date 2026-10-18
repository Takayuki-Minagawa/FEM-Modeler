import type { GeometryBody } from '@/core/ir/types';
import type { TupleInput } from './tuple-inputs';

export function estimatePatternOffset(body: GeometryBody | null): TupleInput {
  if (!body) {
    return ['2', '0', '0'];
  }

  const meta = body.metadata;
  const scaleX = Math.max(Math.abs(body.transform.scale[0]), 0.01);
  const shapeType = meta.shapeType as string | undefined;
  let stepX = 2;

  switch (shapeType) {
    case 'box':
    case 'plate':
    case 'plateWithHole':
    case 'lBracket':
      stepX = Number(meta.width ?? 2) * scaleX;
      break;
    case 'cylinder':
      stepX = Number(meta.radius ?? 1) * 2 * scaleX;
      break;
    case 'pipe':
      stepX = Number(meta.outerRadius ?? 1) * 2 * scaleX;
      break;
    case 'frame2d':
      stepX = Number(meta.spanX ?? 6) * scaleX;
      break;
    case 'truss2d':
      stepX = Number(meta.span ?? 10) * scaleX;
      break;
    case 'channel':
      stepX = Number(meta.length ?? 6) * scaleX;
      break;
    default:
      stepX = 2;
      break;
  }

  return [String(stepX + 0.5), '0', '0'];
}

export function bodyEditorKey(body: GeometryBody): string {
  const { position, rotation, scale } = body.transform;
  return `${body.id}:${body.name}:${body.visible}:${position}:${rotation}:${scale}`;
}
