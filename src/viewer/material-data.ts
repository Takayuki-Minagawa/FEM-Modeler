import type { ProjectIR } from '@/core/ir/types';
import { applyTransformToPoint } from '@/geometry/transforms';
import { selectionGeometry, type TargetGeometry } from './selection-geometry';

export interface MaterialOverlay {
  id: string;
  name: string;
  selectionName: string;
  color: string;
  target: TargetGeometry;
  segments: number[];
}

/** Material assignments belong to the model, independently of analysis cases. */
export function materialOverlays(ir: ProjectIR): MaterialOverlay[] {
  const bodies = new Map(ir.geometry.bodies.map((body) => [body.id, body]));
  const verticesById = new Map(ir.geometry.vertices.map((vertex) => [vertex.id, vertex]));
  return ir.material_assignments.flatMap((assignment) => {
    const material = ir.materials.find((item) => item.id === assignment.material_id);
    const selection = ir.named_selections.find((item) => item.id === assignment.target_named_selection_id);
    if (!material || !selection || selection.status !== 'active') return [];
    const members = new Set(selection.member_refs);
    const segments: number[] = [];
    for (const edge of ir.geometry.edges) {
      const body = bodies.get(edge.body_id);
      if (!body?.visible || !(members.has(edge.id) || (body.category === 'beam_region' && members.has(body.id)))) continue;
      const vertices = edge.vertex_ids.map((id) => verticesById.get(id));
      if (vertices.length !== 2 || vertices.some((item) => !item)) continue;
      for (const vertex of vertices) segments.push(...applyTransformToPoint(vertex!.position, body.transform));
    }
    return [{
      id: assignment.id, name: material.name, selectionName: selection.display_name || selection.name,
      color: selection.color, target: selectionGeometry(ir, selection.id), segments,
    }];
  });
}
