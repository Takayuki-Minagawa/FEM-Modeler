import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { regeneratePrimitive } from '@/geometry/regeneration';
import { conditionOverlays, selectionGeometry, worldDirection } from '@/viewer/condition-data';
import { generateShape } from '@/geometry/primitives/generators';
import { createDefaultProject } from '@/core/ir/defaults';

describe('native dimension regeneration', () => {
  beforeEach(() => { useAppStore.getState().createProject('thermal', 'thermal'); applyTemplate('thermal', 'en'); });
  it('keeps semantic face/edge/vertex IDs and assignments through regeneration and Undo', () => {
    const before = useAppStore.getState().ir; const body = before.geometry.bodies[0];
    const width = Number(body.metadata.width);
    useAppStore.getState().mutateIR('dimensions', (ir) => regeneratePrimitive(ir, body.id, { width: width * 2 }));
    const after = useAppStore.getState().ir;
    expect(after.geometry.bodies[0].id).toBe(body.id);
    expect(after.geometry.faces.map((item) => item.id)).toEqual(before.geometry.faces.map((item) => item.id));
    expect(after.geometry.edges.map((item) => item.id)).toEqual(before.geometry.edges.map((item) => item.id));
    expect(after.named_selections).toEqual(before.named_selections);
    expect(after.boundary_conditions).toEqual(before.boundary_conditions);
    expect(after.geometry.vertices[0].position[0]).toBe(before.geometry.vertices[0].position[0] * 2);
    useAppStore.getState().undo(); expect(useAppStore.getState().ir.geometry).toEqual(before.geometry);
  });
  it('marks unmatched selections stale, rejects invalid dimensions and preserves cylinder cap roles', () => {
    const ir = structuredClone(useAppStore.getState().ir); const body = ir.geometry.bodies[0];
    const face = ir.geometry.faces[0]; const selection = ir.named_selections.find((item) => item.member_refs.includes(face.id)) ?? ir.named_selections[0];
    selection.member_refs = [face.id]; face.name = 'unmatched-custom-role';
    regeneratePrimitive(ir, body.id, { width: 4 }); expect(selection.status).toBe('stale'); expect(selection.member_refs).toEqual([]);
    expect(() => regeneratePrimitive(ir, body.id, { width: 0 })).toThrow(/dimension/);
    const cylinder = generateShape({ shapeType: 'cylinder', radius: 1, height: 2, segments: 12 });
    const plain = createDefaultProject(); plain.geometry.bodies.push(cylinder.body); plain.geometry.faces.push(...cylinder.faces);
    const ids = plain.geometry.faces.map((face) => face.id);
    regeneratePrimitive(plain, cylinder.body.id, { radius: 2, segments: 24 }); expect(plain.geometry.faces.map((face) => face.id)).toEqual(ids); expect(plain.geometry.faces[0].area).toBeCloseTo(4 * Math.PI);
    cylinder.threeGeometry.dispose();
  });
});

describe('case scoped condition geometry', () => {
  it('only includes participating conditions and uses transformed target geometry and normal', () => {
    useAppStore.getState().createProject('solid', 'solid'); applyTemplate('solid', 'en');
    const ir = structuredClone(useAppStore.getState().ir);
    const active = ir.analysis_cases.find((item) => item.active)!;
    const hiddenLoad = { ...ir.loads[0], id: 'not-participating' }; ir.loads.push(hiddenLoad);
    const overlays = conditionOverlays(ir); expect(overlays.some((item) => item.id === hiddenLoad.id)).toBe(false);
    expect(overlays.filter((item) => item.kind === 'load')).toHaveLength(active.participating_load_ids.length);
    const selection = ir.named_selections.find((item) => item.entity_type === 'face')!;
    const before = selectionGeometry(ir, selection.id);
    ir.geometry.bodies[0].transform.position = [3, 4, 5];
    const after = selectionGeometry(ir, selection.id);
    expect(after.points[0]).toEqual(before.points[0].map((v, i) => v + [3, 4, 5][i]));
    expect(after.triangles.length).toBeGreaterThan(0);
  });
  it('rotates attached local force directions without scaling their magnitude', () => {
    const ir = createDefaultProject(); const body = generateShape({ shapeType: 'box', width: 1, height: 1, depth: 1 });
    body.body.transform.rotation = [0, 0, 90]; body.body.transform.scale = [2, 3, 4]; ir.geometry.bodies.push(body.body);
    ir.geometry.reference_frames.push({ id: 'local', name: 'local', origin: [0, 0, 0], axis_x: [1, 0, 0], axis_y: [0, 1, 0], axis_z: [0, 0, 1], type: 'cartesian', attached_to: body.body.id });
    const direction = worldDirection(ir, 'local', [2, 0, 0])!;
    expect(direction[0]).toBeCloseTo(0); expect(direction[1]).toBeCloseTo(2); expect(worldDirection(ir, 'unknown', [1, 0, 0])).toBeNull(); body.threeGeometry.dispose();
  });
});
