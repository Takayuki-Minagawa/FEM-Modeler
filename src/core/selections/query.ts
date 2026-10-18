import { Matrix3, Vector3 } from 'three';
import type { EntityType, GeometryBody, GeometryFace, NamedSelection, ProjectIR } from '@/core/ir/types';
import { nativeShapeBounds } from '@/geometry/native-bounds';
import { namedSelectionQuerySchema } from '@/core/ir/schema/selection-query';
import { applyTransformToPoint, getTransformMatrix, type Vector3Tuple } from '@/geometry/transforms';
import { getSTLGeometry, restoreSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import type { EditableEntityType, NamedSelectionQuery } from './types';

export function editableEntityType(type: EntityType): type is EditableEntityType {
  return type === 'body' || type === 'face' || type === 'edge' || type === 'vertex';
}

export function selectionEntities(ir: Pick<ProjectIR, 'geometry'>, type: EntityType) {
  return type === 'body' ? ir.geometry.bodies : type === 'face' ? ir.geometry.faces : type === 'edge' ? ir.geometry.edges : type === 'vertex' ? ir.geometry.vertices : [];
}

type Bounds = { min: Vector3Tuple; max: Vector3Tuple };
function bodyBounds(ir: ProjectIR, body: GeometryBody): Bounds | null {
  const asset = ir.assets.find((item) => item.id === body.asset_ref);
  if (asset) return asset.bounds;
  return nativeShapeBounds(body.metadata);
}

function facePoint(ir: ProjectIR, body: GeometryBody, face: GeometryFace): Vector3Tuple | null {
  if (body.asset_ref) {
    const asset = ir.assets.find((item) => item.id === body.asset_ref);
    if (!asset || !face.triangle_indices.length) return null;
    try {
      const geometry = getSTLGeometry(body.id) ?? restoreSTLGeometry(body.id, asset);
      const positions = geometry.getAttribute('position');
      const indices = geometry.index;
      const count = (indices?.count ?? positions.count) / 3;
      const transform = getTransformMatrix(body.transform);
      const sum = new Vector3();
      let totalArea = 0;
      for (const triangle of new Set(face.triangle_indices)) {
        if (!Number.isInteger(triangle) || triangle < 0 || triangle >= count) return null;
        const vertices = [0, 1, 2].map((offset) => new Vector3().fromBufferAttribute(positions, indices ? indices.getX(triangle * 3 + offset) : triangle * 3 + offset).applyMatrix4(transform));
        const area = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).length() / 2;
        sum.add(vertices[0].add(vertices[1]).add(vertices[2]).multiplyScalar(area / 3));
        totalArea += area;
      }
      if (!(totalArea > 0) || !Number.isFinite(totalArea)) return null;
      return sum.divideScalar(totalArea).toArray() as Vector3Tuple;
    } catch { return null; }
  }
  // Only planar native faces with a defined axis normal have an unambiguous anchor.
  // Curved/unnormalled surfaces are reported as unavailable, never selected by owner centre.
  const bounds = bodyBounds(ir, body);
  if (!bounds || !face.normal) return null;
  const axis = face.normal.findIndex((value) => Math.abs(value) === 1);
  if (axis < 0 || face.normal.some((value, index) => index !== axis && value !== 0)) return null;
  const point = bounds.min.map((v, index) => (v + bounds.max[index]) / 2) as Vector3Tuple;
  point[axis] = face.normal[axis] > 0 ? bounds.max[axis] : bounds.min[axis];
  return applyTransformToPoint(point, body.transform);
}

/** World SI representative point: bounding-box centre, face surface centre, edge midpoint, vertex. */
export function entitySelectionPoint(ir: ProjectIR, type: EditableEntityType, id: string): Vector3Tuple | null {
  const entity = selectionEntities(ir, type).find((item) => item.id === id);
  if (!entity) return null;
  const body = 'body_id' in entity ? ir.geometry.bodies.find((item) => item.id === entity.body_id) : entity;
  if (!body) return null;
  let point: Vector3Tuple | null = null;
  if ('position' in entity) point = applyTransformToPoint(entity.position, body.transform);
  else if ('vertex_ids' in entity) {
    const vertices = entity.vertex_ids.map((vertexId) => ir.geometry.vertices.find((vertex) => vertex.id === vertexId && vertex.body_id === body.id));
    if (vertices[0] && vertices[1]) point = applyTransformToPoint(vertices[0].position.map((v, axis) => (v + vertices[1]!.position[axis]) / 2) as Vector3Tuple, body.transform);
  } else if ('triangle_indices' in entity) point = facePoint(ir, body, entity);
  else {
    const bounds = bodyBounds(ir, body);
    if (bounds) point = applyTransformToPoint(bounds.min.map((v, axis) => (v + bounds.max[axis]) / 2) as Vector3Tuple, body.transform);
  }
  return point?.every(Number.isFinite) ? point : null;
}

export interface SelectionEditPreview {
  memberRefs: string[];
  matchedRefs: string[];
  unavailableRefs: string[];
  staleRefs: string[];
  added: number;
  removed: number;
  status: NamedSelection['status'];
}

/** Does not mutate the model. Explicit base refs make saved edits reproducible and replayable. */
export function previewSelectionEdit(ir: ProjectIR, selection: NamedSelection, input: NamedSelectionQuery): SelectionEditPreview {
  const query = namedSelectionQuerySchema.parse(input);
  if (!editableEntityType(selection.entity_type)) throw new Error('Unsupported entity type');
  if (query.predicate.kind === 'face_normal' && selection.entity_type !== 'face') throw new Error('Normal queries require faces');
  const entities = selectionEntities(ir, selection.entity_type);
  const universe = new Set(entities.map((item) => item.id));
  const unavailableRefs: string[] = [];
  const matchedRefs: string[] = [];
  const requestedIds = query.predicate.kind === 'ids' ? new Set(query.predicate.ids) : null;
  for (const entity of entities) {
    const predicate = query.predicate;
    let match = false;
    if (predicate.kind === 'all' || query.operation === 'invert') match = true;
    else if (predicate.kind === 'ids') match = requestedIds!.has(entity.id);
    else if (predicate.kind === 'coordinate_range') {
      const point = entitySelectionPoint(ir, selection.entity_type, entity.id);
      if (!point) unavailableRefs.push(entity.id);
      else match = (predicate.min === null || point[predicate.axis] >= predicate.min) && (predicate.max === null || point[predicate.axis] <= predicate.max);
    } else {
      const face = ir.geometry.faces.find((item) => item.id === entity.id);
      const body = ir.geometry.bodies.find((item) => item.id === face?.body_id);
      if (!face?.normal || !body || body.transform.scale.some((v) => !Number.isFinite(v) || v === 0)) unavailableRefs.push(entity.id);
      else {
        const normal = new Vector3(...face.normal).applyMatrix3(new Matrix3().getNormalMatrix(getTransformMatrix(body.transform)));
        if (normal.lengthSq() === 0 || ![normal.x, normal.y, normal.z].every(Number.isFinite)) unavailableRefs.push(entity.id);
        else match = normal.normalize().dot(new Vector3(...predicate.direction).normalize()) >= Math.cos(predicate.tolerance_degrees * Math.PI / 180) - 1e-12;
      }
    }
    if (match) matchedRefs.push(entity.id);
  }
  if (requestedIds) for (const id of requestedIds) if (!universe.has(id)) unavailableRefs.push(id);
  const base = new Set(query.base_member_refs);
  const matched = new Set(matchedRefs);
  const memberRefs = query.operation === 'replace' ? matchedRefs : query.operation === 'invert' ? [...universe].filter((id) => !base.has(id))
    : query.operation === 'remove' ? [...base].filter((id) => !matched.has(id)) : [...new Set([...base, ...matchedRefs])];
  const staleRefs = memberRefs.filter((id) => !universe.has(id));
  const current = new Set(selection.member_refs);
  const result = new Set(memberRefs);
  return { memberRefs, matchedRefs, unavailableRefs, staleRefs,
    added: memberRefs.filter((id) => !current.has(id)).length, removed: [...current].filter((id) => !result.has(id)).length,
    status: staleRefs.length ? 'stale' : memberRefs.length ? 'active' : 'unresolved' };
}
