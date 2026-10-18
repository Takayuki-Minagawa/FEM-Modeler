import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import type { NamedSelection } from '@/core/ir/types';
import { generateShape } from '@/geometry/primitives/generators';
import { importSTL } from '@/geometry/import/stl-loader';
import { entitySelectionPoint, previewSelectionEdit } from '@/core/selections/query';
import type { NamedSelectionQuery } from '@/core/selections/types';
import { parseProjectFile } from '@/export/project/load';

function fixture() {
  const ir = createDefaultProject();
  const shape = generateShape({ shapeType: 'box', width: 2, height: 4, depth: 6 });
  ir.geometry.bodies.push(shape.body); ir.geometry.faces.push(...shape.faces); ir.geometry.edges.push(...shape.edges); ir.geometry.vertices.push(...shape.vertices);
  shape.threeGeometry.dispose();
  const selection: NamedSelection = { id: 'ns', name: 'Selection', target_dimension: 0, entity_type: 'vertex', member_refs: [shape.vertices[0].id], color: '#123456', description: '', created_by: 'user', status: 'active', usages: [] };
  ir.named_selections.push(selection);
  const query: NamedSelectionQuery = { version: 1, coordinate_frame: 'world', length_unit: 'm', operation: 'replace', base_member_refs: [...selection.member_refs], predicate: { kind: 'coordinate_range', axis: 0, min: 0, max: null } };
  return { ir, shape, selection, query };
}

describe('reproducible selection queries', () => {
  it('evaluates inclusive world coordinates after rotation, scaling and translation', () => {
    const { ir, shape, selection, query } = fixture();
    shape.body.transform = { position: [10, 0, 0], rotation: [0, 0, 90], scale: [2, 3, 1] };
    query.predicate = { kind: 'coordinate_range', axis: 0, min: 15.9, max: 16.1 };
    const expected = shape.vertices.filter((v) => v.position[1] === -2).map((v) => v.id);
    expect(previewSelectionEdit(ir, selection, query).memberRefs).toEqual(expected);
    expect(entitySelectionPoint(ir, 'body', shape.body.id)).toEqual([10, 0, 0]);
    expect(entitySelectionPoint(ir, 'edge', shape.edges[0].id)![0]).toBeCloseTo(16);
    const top = shape.faces.find((face) => face.name === 'top')!;
    expect(entitySelectionPoint(ir, 'face', top.id)![0]).toBeCloseTo(4);
  });

  it('uses inverse-transpose world normals and a signed angular tolerance', () => {
    const { ir, shape, selection, query } = fixture();
    selection.entity_type = 'face';
    shape.body.transform.rotation = [0, 0, 90]; shape.body.transform.scale = [2, 1, 1];
    const right = shape.faces[0]; right.normal = [1, 1, 0];
    query.predicate = { kind: 'face_normal', direction: [-1, 0.5, 0], tolerance_degrees: 0.001 };
    expect(previewSelectionEdit(ir, selection, query).memberRefs).toEqual([right.id]);
    shape.body.transform.scale = [0, 1, 1];
    expect(previewSelectionEdit(ir, selection, query).unavailableRefs).toHaveLength(6);
  });

  it('counts undefined surface normals and centres instead of using owner values', () => {
    const { ir, selection, query } = fixture();
    const cylinder = generateShape({ shapeType: 'cylinder', radius: 1, height: 2, segments: 12 });
    ir.geometry.bodies = [cylinder.body]; ir.geometry.faces = cylinder.faces; cylinder.threeGeometry.dispose(); selection.entity_type = 'face';
    query.predicate = { kind: 'face_normal', direction: [0, 1, 0], tolerance_degrees: 1 };
    const result = previewSelectionEdit(ir, selection, query);
    expect(result.memberRefs).toEqual([cylinder.faces[0].id]); expect(result.unavailableRefs).toEqual([cylinder.faces[2].id]);
    expect(entitySelectionPoint(ir, 'face', cylinder.faces[2].id)).toBeNull();
  });

  it.each(['add', 'remove', 'replace', 'invert'] as const)('previews %s with explicit treatment of stale references', (operation) => {
    const { ir, selection, query, shape } = fixture();
    selection.member_refs.push('missing'); query.base_member_refs = [...selection.member_refs]; query.operation = operation;
    query.predicate = { kind: 'ids', ids: [shape.vertices[1].id, 'wrong_type'] };
    const before = JSON.stringify(ir); const result = previewSelectionEdit(ir, selection, query);
    expect(JSON.stringify(ir)).toBe(before);
    if (operation === 'add' || operation === 'remove') { expect(result.staleRefs).toEqual(['missing']); expect(result.status).toBe('stale'); }
    else { expect(result.staleRefs).toEqual([]); expect(result.removed).toBe(2); }
    if (operation === 'invert') expect(result.memberRefs).toHaveLength(7);
    else expect(result.unavailableRefs).toContain('wrong_type');
  });

  it('keeps an explicitly empty result unresolved and never interprets cells as bodies', () => {
    const { ir, selection, query } = fixture(); query.predicate = { kind: 'ids', ids: [] };
    expect(previewSelectionEdit(ir, selection, query).status).toBe('unresolved');
    selection.entity_type = 'cell'; expect(() => previewSelectionEdit(ir, selection, query)).toThrow('Unsupported');
  });

  it('saves a recipe and evaluated members without automatically re-running it on load', () => {
    const { ir, selection, query, shape } = fixture();
    selection.member_refs = previewSelectionEdit(ir, selection, query).memberRefs; selection.query_definition = query;
    shape.body.transform.position[0] = -100;
    const loaded = parseProjectFile(JSON.stringify(ir)); expect(loaded.success).toBe(true);
    const saved = loaded.data!.named_selections[0]; expect(saved.member_refs).toEqual(selection.member_refs); expect(saved.query_definition).toEqual(query);
    expect(previewSelectionEdit(loaded.data!, saved, saved.query_definition!).memberRefs).toEqual([]);
    const legacy = structuredClone(ir); delete legacy.named_selections[0].query_definition;
    expect(parseProjectFile(JSON.stringify(legacy)).success).toBe(true);
  });

  it('rejects malformed numeric predicates and normals on non-face selections', () => {
    const { ir, selection, query } = fixture();
    query.predicate = { kind: 'coordinate_range', axis: 0, min: 2, max: 1 }; expect(() => previewSelectionEdit(ir, selection, query)).toThrow();
    query.predicate = { kind: 'face_normal', direction: [0, 0, 0], tolerance_degrees: 0 }; expect(() => previewSelectionEdit(ir, selection, query)).toThrow();
    query.predicate = { kind: 'face_normal', direction: [1, 0, 0], tolerance_degrees: 0 }; expect(() => previewSelectionEdit(ir, selection, query)).toThrow('require faces');
  });

  it('uses the imported SI tessellation surface centroid with the body transform', () => {
    const { ir } = fixture();
    const bytes = new TextEncoder().encode('solid s\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 3000 0 0\nvertex 0 3000 0\nendloop\nendfacet\nendsolid s').buffer;
    const imported = importSTL(bytes, 'triangle.stl', 0.001, 'mm'); expect(imported.success).toBe(true);
    imported.body!.transform.position = [10, 0, 0];
    ir.geometry.bodies = [imported.body!]; ir.geometry.faces = imported.faces!; ir.assets = [imported.asset!];
    expect(entitySelectionPoint(ir, 'face', imported.faces![0].id)).toEqual([11, 1, 0]);
    ir.geometry.faces[0].triangle_indices = [500]; expect(entitySelectionPoint(ir, 'face', imported.faces![0].id)).toBeNull();
  });
});
