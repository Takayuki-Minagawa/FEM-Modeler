import type { ResultField, ResultIR } from '@/core/ir/types';
import type { ResultMesh } from '@/results/package';
import type { Vector3Tuple } from '@/geometry/transforms';

export function scalarLookup(field: ResultField | undefined): Map<string, number> {
  return new Map(field?.entity_ids.map((id, index) => [id, field.values[index]]) ?? []);
}
export function deformedNodes(result: ResultIR, scale: number): { positions: Map<string, Vector3Tuple>; missingIds: string[]; available: boolean } {
  if (!Number.isFinite(scale) || scale < 0) throw new Error('Deformation scale must be finite and non-negative.');
  const positions = new Map<string, Vector3Tuple>();
  const missingIds: string[] = [];
  const components = ['ux', 'uy', 'uz'].map((name) => result.fields.find((field) => field.name === name && field.location === 'node' && field.unit === 'm' && field.component_names.length === 1));
  const available = !!components[0] && !!components[1] && (!!components[2] || result.solver_target === 'OpenSeesPy');
  const lookups = components.map(scalarLookup);
  for (const node of result.mesh?.nodes ?? []) {
    const delta = lookups.map((values, axis) => !components[axis] && axis === 2 && result.solver_target === 'OpenSeesPy' ? 0 : values.get(node.id));
    if (available && delta.every((v) => v !== undefined && Number.isFinite(v))) {
      const deformed = node.position.map((v, axis) => v + scale * delta[axis]!) as Vector3Tuple;
      if (deformed.every(Number.isFinite)) positions.set(node.id, deformed);
      else { positions.set(node.id, node.position); missingIds.push(node.id); }
    } else {
      positions.set(node.id, node.position);
      if (available) missingIds.push(node.id);
    }
  }
  return { positions, missingIds, available };
}

export const ELEMENT_EDGES: Record<ResultMesh['elements'][number]['type'], number[][]> = {
  line2: [[0, 1]], triangle3: [[0, 1], [1, 2], [2, 0]], quad4: [[0, 1], [1, 2], [2, 3], [3, 0]],
  tetra4: [[0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3]],
  hexa8: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]],
};
const FACES: Record<ResultMesh['elements'][number]['type'], number[][]> = {
  line2: [], triangle3: [[0, 1, 2]], quad4: [[0, 1, 2, 3]],
  tetra4: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]],
  hexa8: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
};
/** Exterior faces only: shared volume faces are suppressed using node IDs. */
export function exteriorTriangles(mesh: ResultMesh, allowedIds?: Set<string>) {
  const faces = new Map<string, { nodes: string[]; elementId: string; volumes: number; surface: boolean }>();
  for (const element of mesh.elements) {
    if (allowedIds && !allowedIds.has(element.id)) continue;
    const volume = element.type === 'tetra4' || element.type === 'hexa8';
    for (const face of FACES[element.type]) {
      const nodes = face.map((index) => element.node_ids[index]);
      const key = [...nodes].sort().join('\0');
      const existing = faces.get(key);
      if (existing) {
        if (volume) { existing.volumes += 1; existing.elementId = element.id; existing.nodes = nodes; }
        else existing.surface = true;
      } else faces.set(key, { nodes, elementId: element.id, volumes: volume ? 1 : 0, surface: !volume });
    }
  }
  const triangles: { nodes: string[]; elementId: string }[] = [];
  for (const face of faces.values()) {
    if (face.volumes > 1) continue;
    triangles.push({ nodes: face.nodes.slice(0, 3), elementId: face.elementId });
    if (face.nodes.length === 4) triangles.push({ nodes: [face.nodes[0], face.nodes[2], face.nodes[3]], elementId: face.elementId });
  }
  return triangles;
}
export function scalarColor(value: number | undefined, minimum: number, maximum: number): [number, number, number] {
  if (value === undefined || !Number.isFinite(value)) return [0.5, 0.5, 0.5];
  const t = maximum === minimum ? 0.5 : Math.max(0, Math.min(1, (value / 2 - minimum / 2) / (maximum / 2 - minimum / 2)));
  return [t, 0.2 + 0.65 * (1 - Math.abs(2 * t - 1)), 1 - t];
}
