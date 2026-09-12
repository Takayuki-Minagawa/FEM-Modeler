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
/** Preserve both owners when an explicit boundary element coincides with a volume face. */
export function exteriorTriangles(mesh: ResultMesh, allowedIds?: Set<string>, field?: ResultField) {
  const faces = new Map<string, { nodes: string[]; volumeIds: string[]; boundaryIds: string[] }>();
  for (const element of mesh.elements) {
    if (allowedIds && !allowedIds.has(element.id)) continue;
    const volume = element.type === 'tetra4' || element.type === 'hexa8';
    for (const face of FACES[element.type]) {
      const nodes = face.map((index) => element.node_ids[index]);
      const key = [...nodes].sort().join('\0');
      const existing = faces.get(key);
      if (existing) {
        if (volume) { existing.volumeIds.push(element.id); existing.nodes = nodes; }
        else existing.boundaryIds.push(element.id);
      } else faces.set(key, { nodes, volumeIds: volume ? [element.id] : [], boundaryIds: volume ? [] : [element.id] });
    }
  }
  const fieldIds = field && field.location !== 'node' ? new Set(field.entity_ids) : undefined;
  const triangles: { nodes: string[]; elementId: string; volumeIds: string[]; boundaryIds: string[] }[] = [];
  for (const face of faces.values()) {
    if (face.volumeIds.length > 1) continue;
    // Cell fields prefer the containing volume; boundary/element fields prefer
    // the explicit surface. A field can also cover just one of these owners.
    const candidates = field?.location === 'element' || field?.location === 'facet'
      ? [...face.boundaryIds, ...face.volumeIds] : [...face.volumeIds, ...face.boundaryIds];
    const elementId = candidates.find((id) => fieldIds?.has(id)) ?? candidates[0];
    const owner = { elementId, volumeIds: face.volumeIds, boundaryIds: face.boundaryIds };
    triangles.push({ nodes: face.nodes.slice(0, 3), ...owner });
    if (face.nodes.length === 4) triangles.push({ nodes: [face.nodes[0], face.nodes[2], face.nodes[3]], ...owner });
  }
  return triangles;
}
export function scalarColor(value: number | undefined, minimum: number, maximum: number): [number, number, number] {
  if (value === undefined || !Number.isFinite(value)) return [0.5, 0.5, 0.5];
  const t = maximum === minimum ? 0.5 : Math.max(0, Math.min(1, (value / 2 - minimum / 2) / (maximum / 2 - minimum / 2)));
  return [t, 0.2 + 0.65 * (1 - Math.abs(2 * t - 1)), 1 - t];
}
