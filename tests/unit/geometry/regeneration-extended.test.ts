import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import type { NamedSelection } from '@/core/ir/types';
import { nativeShapeParameters } from '@/core/ir/schema/shapes';
import { generateShape, DEFAULT_SHAPE_PARAMS } from '@/geometry/primitives/generators';
import { regeneratePrimitive } from '@/geometry/regeneration';
import { useAppStore } from '@/state/store';

function fixture(shapeType: string) {
  const shape = generateShape(DEFAULT_SHAPE_PARAMS[shapeType]);
  const ir = createDefaultProject();
  shape.body.transform = { position: [1.234567890123, 0, 3], rotation: [5, 10, 15], scale: [2, 3, 4] };
  shape.body.metadata.annotation = 'preserve';
  ir.geometry.bodies.push(shape.body); ir.geometry.faces.push(...shape.faces); ir.geometry.edges.push(...shape.edges); ir.geometry.vertices.push(...shape.vertices);
  const base: NamedSelection = { id: 'body-selection', name: 'Body', target_dimension: 3, entity_type: 'body', member_refs: [shape.body.id], color: '#fff', description: '', created_by: 'user', status: 'active', usages: ['material_assignment'] };
  ir.named_selections.push(base, { ...base, id: 'sub-selection', name: 'Subentities', entity_type: shape.faces.length ? 'face' : 'vertex', target_dimension: shape.faces.length ? 2 : 0, member_refs: (shape.faces.length ? shape.faces : shape.vertices).map((item) => item.id) });
  ir.material_assignments.push({ id: 'material-assignment', material_id: 'material', target_named_selection_id: base.id, override_allowed: false });
  ir.section_assignments.push({ id: 'section-assignment', section_id: 'section', target_named_selection_id: base.id });
  shape.threeGeometry.dispose();
  return ir;
}

const edits = [ ['pipe', 'length'], ['plateWithHole', 'width'], ['lBracket', 'height'], ['frame2d', 'spanX'], ['truss2d', 'span'], ['channel', 'length'] ] as const;
describe('all native dimension editors', () => {
  it.each(edits)('preserves %s identity, transforms, references and assignments for %s edits', (shapeType, parameter) => {
    const ir = fixture(shapeType); const before = structuredClone(ir); const body = ir.geometry.bodies[0];
    regeneratePrimitive(ir, body.id, { [parameter]: Number(body.metadata[parameter]) * 1.5 });
    expect(body.id).toBe(before.geometry.bodies[0].id);
    expect(body.transform).toEqual(before.geometry.bodies[0].transform);
    expect(body.metadata.annotation).toBe('preserve');
    expect(body.metadata[parameter]).toBe(Number(before.geometry.bodies[0].metadata[parameter]) * 1.5);
    for (const type of ['faces', 'edges', 'vertices'] as const) expect(ir.geometry[type].map((entity) => entity.id)).toEqual(before.geometry[type].map((entity) => entity.id));
    expect(ir.named_selections).toEqual(before.named_selections);
    expect(ir.material_assignments).toEqual(before.material_assignments); expect(ir.section_assignments).toEqual(before.section_assignments);
    const ids = new Set(ir.geometry.vertices.map((entity) => entity.id));
    expect(ir.geometry.edges.every((edge) => edge.vertex_ids.every((id) => ids.has(id)))).toBe(true);
  });

  it.each([['frame2d', 'columns', 4], ['frame2d', 'floors', 4], ['truss2d', 'divisions', 8], ['channel', 'dimensionality', '2D']] as const)('invalidates %s subentities when %s changes, including matching role names', (shapeType, parameter, value) => {
    const ir = fixture(shapeType); const before = structuredClone(ir); const body = ir.geometry.bodies[0];
    const oldIds = new Set([...ir.geometry.faces, ...ir.geometry.edges, ...ir.geometry.vertices].map((entity) => entity.id));
    ir.ui_state.selection_state = [body.id, ...oldIds];
    regeneratePrimitive(ir, body.id, { [parameter]: value });
    expect([...ir.geometry.faces, ...ir.geometry.edges, ...ir.geometry.vertices].every((entity) => !oldIds.has(entity.id))).toBe(true);
    expect(ir.named_selections[1]).toMatchObject({ member_refs: [], status: 'stale' });
    expect(ir.named_selections[0]).toEqual(before.named_selections[0]);
    expect(ir.material_assignments).toEqual(before.material_assignments); expect(ir.section_assignments).toEqual(before.section_assignments);
    expect(ir.ui_state.selection_state).toEqual([body.id]);
  });

  it('preserves stable pipe faces when only rendering segments change', () => {
    const ir = fixture('pipe'); const before = structuredClone(ir.named_selections);
    regeneratePrimitive(ir, ir.geometry.bodies[0].id, { segments: 64 });
    expect(ir.named_selections).toEqual(before);
  });

  it('invalidates edges when their endpoint roles no longer match, even if edge names do', () => {
    const ir = fixture('channel'); const oldEdge = ir.geometry.edges[0]; const oldVertex = ir.geometry.vertices[0];
    oldVertex.name = 'renamed-role';
    regeneratePrimitive(ir, ir.geometry.bodies[0].id, { length: 12 });
    expect(ir.geometry.edges.find((edge) => edge.name === oldEdge.name)!.id).not.toBe(oldEdge.id);
  });

  it('uses one schema for all parameters, units, count bounds and channel choices', () => {
    expect(nativeShapeParameters('frame2d')).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'spanX', kind: 'length' }), expect.objectContaining({ key: 'columns', kind: 'count', max: 1000, changesTopology: true })]));
    expect(nativeShapeParameters('channel')).toContainEqual(expect.objectContaining({ key: 'dimensionality', kind: 'choice', options: ['2D', '3D'] }));
    expect(nativeShapeParameters('imported_stl')).toEqual([]);
  });

  it.each([['pipe', { innerRadius: 2 }], ['plateWithHole', { holeRadius: 2 }], ['lBracket', { thickness: 4 }], ['frame2d', { columns: 1000, floors: 1000 }], ['truss2d', { divisions: 2.5 }], ['channel', { depth: 0 }]] as const)('rejects invalid %s edits without changing the model', (shapeType, changes) => {
    const ir = fixture(shapeType); const before = structuredClone(ir);
    expect(() => regeneratePrimitive(ir, ir.geometry.bodies[0].id, changes)).toThrow();
    expect(ir).toEqual(before);
  });

  it('restores topology, invalidated references and metadata in one Undo/Redo command', () => {
    useAppStore.getState().createProject('frame');
    useAppStore.getState().mutateIR('fixture', (ir) => Object.assign(ir, fixture('frame2d')));
    const before = useAppStore.getState().ir; const body = before.geometry.bodies[0];
    useAppStore.getState().mutateIR('dimensions', (ir) => regeneratePrimitive(ir, body.id, { floors: 5 }));
    const after = useAppStore.getState().ir;
    expect(after.named_selections[1].status).toBe('stale');
    useAppStore.getState().undo(); expect(useAppStore.getState().ir.geometry).toEqual(before.geometry); expect(useAppStore.getState().ir.named_selections).toEqual(before.named_selections);
    useAppStore.getState().redo(); expect(useAppStore.getState().ir.geometry).toEqual(after.geometry); expect(useAppStore.getState().ir.named_selections).toEqual(after.named_selections);
  });

  it.each([1e200, 1e-50])('rejects dimensions outside the rendering range (%s) without changing the model', (width) => {
    const ir = fixture('box'); const before = structuredClone(ir);
    expect(() => regeneratePrimitive(ir, ir.geometry.bodies[0].id, { width })).toThrow(/finite rendering range/);
    expect(ir).toEqual(before);
    expect(() => generateShape({ ...DEFAULT_SHAPE_PARAMS.box, width } as Parameters<typeof generateShape>[0])).toThrow(/finite rendering range/);
  });

  it('keeps large finite geometry and small engineering dimensions valid', () => {
    for (const width of [3e38, 1e-9]) {
      const shape = generateShape({ shapeType: 'box', width, height: width, depth: width });
      expect(shape.vertices.every((vertex) => vertex.position.every(Number.isFinite))).toBe(true);
      expect(shape.edges.every((edge) => Number.isFinite(edge.length))).toBe(true);
      expect(shape.faces.every((face) => Number.isFinite(face.area))).toBe(true);
      expect(Array.from(shape.threeGeometry.attributes.position.array).every(Number.isFinite)).toBe(true);
      shape.threeGeometry.dispose();
    }
  });

  it('rejects topology changes that would remove an attached coordinate frame reference', () => {
    const ir = fixture('frame2d'); const body = ir.geometry.bodies[0];
    ir.geometry.reference_frames.push({ id: 'local-frame', name: 'Support frame', origin: [0, 0, 0], axis_x: [1, 0, 0], axis_y: [0, 1, 0], axis_z: [0, 0, 1], type: 'cartesian', attached_to: ir.geometry.vertices[0].id });
    const before = structuredClone(ir);
    expect(() => regeneratePrimitive(ir, body.id, { columns: 4 })).toThrow(/Support frame \(local-frame\)/);
    expect(ir).toEqual(before);
    regeneratePrimitive(ir, body.id, { spanX: 12 });
    expect(ir.geometry.reference_frames).toEqual(before.geometry.reference_frames);
    expect(ir.geometry.vertices.some((vertex) => vertex.id === ir.geometry.reference_frames[0].attached_to)).toBe(true);
    ir.geometry.reference_frames[0].attached_to = body.id;
    regeneratePrimitive(ir, body.id, { columns: 4 });
    expect(ir.geometry.reference_frames[0].attached_to).toBe(body.id);
  });
});
