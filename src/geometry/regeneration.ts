import { nativeShapeParameters, nativeShapeSchema, parseNativeShapeMetadata } from '@/core/ir/schema/shapes';
import type { ProjectIR } from '@/core/ir/types';
import { generateShape } from './primitives/generators';

export const REGENERABLE_PARAMETERS: Record<string, readonly string[]> = Object.fromEntries(nativeShapeSchema.options.map((variant) => {
  const shapeType = variant.shape.shapeType.value;
  return [shapeType, nativeShapeParameters(shapeType).map((parameter) => parameter.key)];
}));

/** Regenerate native topology by semantic role, preserving IDs and all body-level assignments. */
export function regeneratePrimitive(ir: ProjectIR, bodyId: string, parameters: Record<string, number | string | undefined>): void {
  const body = ir.geometry.bodies.find((item) => item.id === bodyId);
  if (!body) throw new Error('Body no longer exists.');
  if (body.locked) throw new Error('Unlock the body before editing its dimensions.');
  const shapeType = String(body.metadata.shapeType);
  const keys = REGENERABLE_PARAMETERS[shapeType];
  if (!keys) throw new Error('Dimension editing requires a native shape.');
  if (Object.keys(parameters).some((key) => !keys.includes(key))) throw new Error('Unknown primitive parameter.');
  const metadata: Record<string, unknown> = { ...body.metadata, ...parameters, shapeType };
  const parsed = parseNativeShapeMetadata(metadata);
  const topologyChanged = nativeShapeParameters(shapeType).some((parameter) => parameter.changesTopology && metadata[parameter.key] !== body.metadata[parameter.key]);
  const generated = generateShape(parsed, body.name);
  generated.threeGeometry.dispose();
  const oldEntities = [...ir.geometry.faces, ...ir.geometry.edges, ...ir.geometry.vertices].filter((item) => item.body_id === bodyId);
  const retained = new Set<string>();
  const match = <T extends { id: string; name: string; body_id: string }>(items: T[], old: T[], compatible: (item: T, candidate: T) => boolean = () => true) => {
    const bodyItems = old.filter((candidate) => candidate.body_id === bodyId);
    const roles = new Map<string, T | null>();
    if (!topologyChanged && bodyItems.length === items.length) {
      for (const item of bodyItems) roles.set(item.name, roles.has(item.name) ? null : item);
    }
    return items.map((item) => {
      const candidate = roles.get(item.name);
      const id = candidate && compatible(item, candidate) ? candidate.id : item.id;
      retained.add(id);
      return { ...item, id, body_id: bodyId };
    });
  };
  const vertices = match(generated.vertices, ir.geometry.vertices);
  const vertexMap = new Map(generated.vertices.map((vertex, index) => [vertex.id, vertices[index].id]));
  const remappedEdges = generated.edges.map((edge) => ({ ...edge, vertex_ids: edge.vertex_ids.map((id) => vertexMap.get(id) ?? id) as [string, string] }));
  const edges = match(remappedEdges, ir.geometry.edges, (edge, candidate) => edge.vertex_ids.every((id, index) => id === candidate.vertex_ids[index]));
  const faces = match(generated.faces, ir.geometry.faces);
  const removed = new Set(oldEntities.filter((item) => !retained.has(item.id)).map((item) => item.id));
  const attachedFrames = ir.geometry.reference_frames.filter((frame) => frame.attached_to && removed.has(frame.attached_to));
  if (attachedFrames.length) {
    throw new Error(`Reattach these reference frames before changing topology: ${attachedFrames.map((frame) => `${frame.name} (${frame.id})`).join(', ')}.`);
  }
  ir.geometry.faces = [...ir.geometry.faces.filter((item) => item.body_id !== bodyId), ...faces];
  ir.geometry.edges = [...ir.geometry.edges.filter((item) => item.body_id !== bodyId), ...edges];
  ir.geometry.vertices = [...ir.geometry.vertices.filter((item) => item.body_id !== bodyId), ...vertices];
  for (const selection of ir.named_selections) {
    if (selection.member_refs.some((id) => removed.has(id))) {
      selection.member_refs = selection.member_refs.filter((id) => !removed.has(id));
      selection.status = 'stale';
    }
  }
  ir.ui_state.selection_state = ir.ui_state.selection_state.filter((id) => !removed.has(id));
  // Generators may canonicalize metadata (for example, the minimum truss division count).
  body.metadata = { ...metadata, ...generated.body.metadata };
}
