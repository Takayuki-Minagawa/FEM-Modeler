import { parseNativeShapeMetadata } from '@/core/ir/schema/shapes';
import type { ProjectIR } from '@/core/ir/types';
import { generateShape } from './primitives/generators';

export const REGENERABLE_PARAMETERS: Record<string, readonly string[]> = {
  box: ['width', 'height', 'depth'], plate: ['width', 'depth', 'thickness'], cylinder: ['radius', 'height', 'segments'],
};

/** Regenerate native topology by semantic role, preserving IDs and all body-level assignments. */
export function regeneratePrimitive(ir: ProjectIR, bodyId: string, parameters: Record<string, number>): void {
  const body = ir.geometry.bodies.find((item) => item.id === bodyId);
  if (!body) throw new Error('Body no longer exists.');
  if (body.locked) throw new Error('Unlock the body before editing its dimensions.');
  const shapeType = String(body.metadata.shapeType);
  const keys = REGENERABLE_PARAMETERS[shapeType];
  if (!keys) throw new Error('Dimension editing supports box, plate, and cylinder.');
  if (Object.keys(parameters).some((key) => !keys.includes(key))) throw new Error('Unknown primitive parameter.');
  const metadata: Record<string, unknown> = { ...body.metadata, ...parameters, shapeType };
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid positive dimension: ${key}.`);
    if (key === 'segments' && (!Number.isInteger(value) || value < 3 || value > 1000)) throw new Error('Cylinder segments must be an integer between 3 and 1000.');
  }
  const generated = generateShape(parseNativeShapeMetadata(metadata), body.name);
  generated.threeGeometry.dispose();
  const oldEntities = [...ir.geometry.faces, ...ir.geometry.edges, ...ir.geometry.vertices].filter((item) => item.body_id === bodyId);
  const retained = new Set<string>();
  const match = <T extends { id: string; name: string; body_id: string }>(items: T[], old: T[]) => items.map((item) => {
    const matches = old.filter((candidate) => candidate.body_id === bodyId && candidate.name === item.name);
    const id = matches.length === 1 ? matches[0].id : item.id;
    retained.add(id);
    return { ...item, id, body_id: bodyId };
  });
  const vertices = match(generated.vertices, ir.geometry.vertices);
  const vertexMap = new Map(generated.vertices.map((vertex, index) => [vertex.id, vertices[index].id]));
  const edges = match(generated.edges, ir.geometry.edges).map((edge) => ({ ...edge, vertex_ids: edge.vertex_ids.map((id) => vertexMap.get(id) ?? id) as [string, string] }));
  const faces = match(generated.faces, ir.geometry.faces);
  ir.geometry.faces = [...ir.geometry.faces.filter((item) => item.body_id !== bodyId), ...faces];
  ir.geometry.edges = [...ir.geometry.edges.filter((item) => item.body_id !== bodyId), ...edges];
  ir.geometry.vertices = [...ir.geometry.vertices.filter((item) => item.body_id !== bodyId), ...vertices];
  const removed = new Set(oldEntities.filter((item) => !retained.has(item.id)).map((item) => item.id));
  for (const selection of ir.named_selections) {
    if (selection.member_refs.some((id) => removed.has(id))) {
      selection.member_refs = selection.member_refs.filter((id) => !removed.has(id));
      selection.status = 'stale';
    }
  }
  ir.ui_state.selection_state = ir.ui_state.selection_state.filter((id) => !removed.has(id));
  body.metadata = metadata;
}
