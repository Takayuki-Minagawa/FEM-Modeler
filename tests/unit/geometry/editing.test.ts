import { describe, expect, it } from 'vitest';
import { generateShape } from '@/geometry/primitives/generators';
import { duplicateBodiesLinear, MAX_PATTERN_COPIES } from '@/geometry/editing';
import { useAppStore } from '@/state/store';
import { importSTL } from '@/geometry/import/stl-loader';

describe('duplicateBodiesLinear', () => {
  it('duplicates topology with new ids and translated body transforms', () => {
    const generated = generateShape(
      { shapeType: 'box', width: 2, height: 3, depth: 4 },
      'SourceBody',
    );
    generated.body.transform.position = [1, 2, 3];

    const result = duplicateBodiesLinear(
      {
        bodies: [generated.body],
        faces: generated.faces,
        edges: generated.edges,
        vertices: generated.vertices,
      },
      [generated.body.id],
      2,
      [5, 0, 0],
    );

    expect(result.createdBodyIds).toHaveLength(2);
    expect(result.bodies).toHaveLength(2);
    expect(result.faces).toHaveLength(generated.faces.length * 2);
    expect(result.edges).toHaveLength(generated.edges.length * 2);
    expect(result.vertices).toHaveLength(generated.vertices.length * 2);

    expect(result.bodies[0].name).toBe('SourceBody Copy 1');
    expect(result.bodies[0].transform.position).toEqual([6, 2, 3]);
    expect(result.bodies[1].transform.position).toEqual([11, 2, 3]);
    expect(result.bodies[0].id).not.toBe(generated.body.id);
    expect(result.bodies[0].metadata).not.toBe(generated.body.metadata);

    const originalVertexIds = new Set(generated.vertices.map((vertex) => vertex.id));
    expect(result.vertices.every((vertex) => !originalVertexIds.has(vertex.id))).toBe(true);
    expect(result.edges.every((edge) => edge.vertex_ids.every((id) => !originalVertexIds.has(id)))).toBe(true);
    expect(result.faces.every((face) => face.body_id !== generated.body.id)).toBe(true);
  });
});

describe('pattern command through the Immer store', () => {
  it.each([1, 2])('duplicates %i sources atomically with independent topology and Undo/Redo', (count) => {
    useAppStore.getState().createProject('pattern');
    for (let index = 0; index < count; index += 1) {
      const shape = generateShape({ shapeType: 'box', width: 2, height: 3, depth: 4 });
      shape.body.metadata.annotation = { nested: ['preserve'] };
      shape.body.transform.position = [index, 0, 0];
      useAppStore.getState().addBodyWithTopology(shape.body, shape);
      shape.threeGeometry.dispose();
    }
    const before = useAppStore.getState().ir.geometry;
    const created = useAppStore.getState().duplicateBodiesLinear(before.bodies.map((body) => body.id), 2, [2.5, 0, 0]);
    const after = useAppStore.getState().ir.geometry;
    expect(created).toHaveLength(count * 2);
    expect(after.bodies.slice(0, count)).toEqual(before.bodies);
    expect(after.bodies.slice(count).map((body) => body.transform.position[0])).toEqual(count === 1 ? [2.5, 5] : [2.5, 3.5, 5, 6]);
    for (const body of after.bodies.slice(count)) {
      expect(body.metadata.annotation).toEqual({ nested: ['preserve'] });
      expect(body.metadata.annotation).not.toBe(before.bodies[0].metadata.annotation);
      const vertices = new Set(after.vertices.filter((vertex) => vertex.body_id === body.id).map((vertex) => vertex.id));
      expect(after.edges.filter((edge) => edge.body_id === body.id).every((edge) => edge.vertex_ids.every((id) => vertices.has(id)))).toBe(true);
    }
    useAppStore.getState().undo();
    expect(useAppStore.getState().ir.geometry).toEqual(before);
    useAppStore.getState().redo();
    expect(useAppStore.getState().ir.geometry).toEqual(after);
  });

  it('shares imported asset references without copying or dropping the original asset', () => {
    useAppStore.getState().createProject('asset pattern');
    const imported = importSTL(new TextEncoder().encode('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t').buffer, 'triangle.stl');
    expect(imported.success).toBe(true);
    useAppStore.getState().addBodyWithTopology(imported.body!, { faces: imported.faces, assets: [imported.asset!] });
    const before = useAppStore.getState().ir;
    useAppStore.getState().duplicateBodiesLinear([imported.body!.id], 2, [1, 0, 0]);
    expect(useAppStore.getState().ir.geometry.bodies.map((body) => body.asset_ref)).toEqual(Array(3).fill(imported.asset!.id));
    expect(useAppStore.getState().ir.assets).toBe(before.assets);
    imported.geometry?.dispose();
  });

  it('rejects incomplete, excessive and overflowing patterns before changing the model', () => {
    useAppStore.getState().createProject('invalid pattern');
    const shape = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 });
    useAppStore.getState().addBodyWithTopology(shape.body, shape);
    shape.threeGeometry.dispose();
    const before = useAppStore.getState().ir;
    for (const copies of [0, -1, 1.5, NaN, Infinity, MAX_PATTERN_COPIES + 1]) {
      expect(() => useAppStore.getState().duplicateBodiesLinear([shape.body.id], copies, [1, 0, 0])).toThrow(/Copies/);
    }
    expect(() => useAppStore.getState().duplicateBodiesLinear([shape.body.id], 1, [NaN, 0, 0])).toThrow(/finite/);
    expect(() => useAppStore.getState().duplicateBodiesLinear([shape.body.id], 2, [Number.MAX_VALUE, 0, 0])).toThrow(/coordinate range/);
    expect(useAppStore.getState().ir).toBe(before);
  });

  it('caps generated topology even when the requested copy count is allowed', () => {
    const frame = generateShape({ shapeType: 'frame2d', spanX: 100, spanY: 30, columns: 100, floors: 10 });
    expect(() => duplicateBodiesLinear({ bodies: [frame.body], faces: frame.faces, edges: frame.edges, vertices: frame.vertices }, [frame.body.id], 100, [1, 0, 0])).toThrow(/100,000 entities/);
    frame.threeGeometry.dispose();
  });

  it('names repeated patterns uniquely against existing suffixes and the new batch', () => {
    useAppStore.getState().createProject('names');
    const source = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 }, 'Source');
    useAppStore.getState().addBodyWithTopology(source.body, source);
    source.threeGeometry.dispose();
    const first = useAppStore.getState().duplicateBodiesLinear([source.body.id], 2, [1, 0, 0]);
    useAppStore.getState().updateBody(first[1], { name: 'Source Copy 1 2' });
    useAppStore.getState().duplicateBodiesLinear([source.body.id], 2, [1, 0, 0]);
    expect(useAppStore.getState().ir.geometry.bodies.map((body) => body.name)).toEqual(['Source', 'Source Copy 1', 'Source Copy 1 2', 'Source Copy 1 3', 'Source Copy 2']);
  });
});
