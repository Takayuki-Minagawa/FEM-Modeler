import { describe, it, expect } from 'vitest';
import { generateShape, DEFAULT_SHAPE_PARAMS } from '@/geometry/primitives/generators';

describe('Shape generators', () => {
  it('generates all default shape types without error', () => {
    for (const [type, params] of Object.entries(DEFAULT_SHAPE_PARAMS)) {
      const result = generateShape(params, `test_${type}`);
      expect(result.body).toBeDefined();
      expect(result.body.name).toBe(`test_${type}`);
      expect(result.body.id).toBeTruthy();
      expect(result.threeGeometry).toBeDefined();
    }
  });

  it('generates box with 6 faces, 8 vertices, 12 edges', () => {
    const result = generateShape(
      { shapeType: 'box', width: 2, height: 3, depth: 4 },
      'TestBox',
    );
    expect(result.body.category).toBe('solid');
    expect(result.faces).toHaveLength(6);
    expect(result.vertices).toHaveLength(8);
    expect(result.edges).toHaveLength(12);

    const faceNames = result.faces.map((f) => f.name);
    expect(faceNames).toContain('top');
    expect(faceNames).toContain('bottom');
    expect(faceNames).toContain('front');
    expect(faceNames).toContain('back');
    expect(faceNames).toContain('left');
    expect(faceNames).toContain('right');
  });

  it('generates cylinder with top, bottom, side faces', () => {
    const result = generateShape(
      { shapeType: 'cylinder', radius: 1, height: 3, segments: 16 },
    );
    expect(result.body.category).toBe('solid');
    expect(result.faces.length).toBeGreaterThanOrEqual(3);
    const faceNames = result.faces.map((f) => f.name);
    expect(faceNames).toContain('top');
    expect(faceNames).toContain('bottom');
    expect(faceNames).toContain('side');
  });

  it('generates frame with beam_region category', () => {
    const result = generateShape(
      { shapeType: 'frame2d', spanX: 6, spanY: 9, columns: 3, floors: 3 },
    );
    expect(result.body.category).toBe('beam_region');
    expect(result.vertices.length).toBeGreaterThan(0);
  });

  it('generates channel with flow-context face names', () => {
    const result = generateShape(
      { shapeType: 'channel', length: 6, height: 1, depth: 1 },
    );
    expect(result.body.category).toBe('fluid_region');
    const faceNames = result.faces.map((f) => f.name);
    expect(faceNames).toContain('inlet');
    expect(faceNames).toContain('outlet');
    expect(faceNames).toContain('wall_top');
    expect(faceNames).toContain('wall_bottom');
  });

  it('gives unique IDs to all faces', () => {
    const result = generateShape(DEFAULT_SHAPE_PARAMS['box']);
    const ids = result.faces.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
