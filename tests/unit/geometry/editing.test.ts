import { describe, expect, it } from 'vitest';
import { generateShape } from '@/geometry/primitives/generators';
import { duplicateBodiesLinear } from '@/geometry/editing';

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
