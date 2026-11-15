import { describe, expect, it } from 'vitest';
import { bodyLocalExtents } from '@/geometry/body-extents';
import { generateShape } from '@/geometry/primitives/generators';

describe('bodyLocalExtents', () => {
  it('returns box dimensions', () => {
    const { body } = generateShape({ shapeType: 'box', width: 2, height: 3, depth: 4 }, 'B');
    expect(bodyLocalExtents(body)).toEqual([2, 3, 4]);
  });
  it('applies absolute scale including negative values', () => {
    const { body } = generateShape({ shapeType: 'box', width: 2, height: 3, depth: 4 }, 'B');
    body.transform.scale = [2, -1, 0.5];
    expect(bodyLocalExtents(body)).toEqual([4, 3, 2]);
  });
  it('returns null for non-native shapes', () => {
    const { body } = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }, 'B');
    body.metadata = { shapeType: 'imported_stl' };
    expect(bodyLocalExtents(body)).toBeNull();
  });
});
