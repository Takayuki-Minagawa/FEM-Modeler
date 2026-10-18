import * as THREE from 'three';
import type { GeometryAsset, GeometryBody, ProjectIR } from '@/core/ir/types';
import { nativeShapeBounds } from '@/geometry/native-bounds';
import { getTransformMatrix, type Vector3Tuple } from '@/geometry/transforms';

export type ViewDirection = 'front' | 'top' | 'right' | 'isometric';
/** Eight world-space corners, without generating meshes or decoding imported assets. */
export function bodyFocusPoints(body: GeometryBody, asset?: GeometryAsset): Vector3Tuple[] {
  const bounds = asset?.bounds ?? nativeShapeBounds(body.metadata);
  if (!bounds) return [];
  const matrix = getTransformMatrix(body.transform);
  const points: Vector3Tuple[] = [];
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(matrix);
        if ([point.x, point.y, point.z].every(Number.isFinite)) points.push([point.x, point.y, point.z]);
      }
    }
  }
  return points;
}

/** Selected faces/edges/vertices focus their owning bodies. Hidden bodies are excluded. */
export function geometryFocusPoints(ir: Pick<ProjectIR, 'geometry' | 'assets'>, selectedIds?: readonly string[]): Vector3Tuple[] {
  const selected = selectedIds ? new Set(selectedIds) : null;
  const ownerIds = selected ? new Set(ir.geometry.bodies.filter((body) => selected.has(body.id)).map((body) => body.id)) : null;
  if (selected && ownerIds) {
    for (const entities of [ir.geometry.faces, ir.geometry.edges, ir.geometry.vertices]) {
      for (const entity of entities) if (selected.has(entity.id)) ownerIds.add(entity.body_id);
    }
  }
  const assets = new Map(ir.assets.map((asset) => [asset.id, asset]));
  const points: Vector3Tuple[] = [];
  for (const body of ir.geometry.bodies) {
    if (!body.visible || (ownerIds && !ownerIds.has(body.id))) continue;
    const corners = bodyFocusPoints(body, assets.get(body.asset_ref ?? ''));
    for (const corner of corners) points.push(corner);
  }
  return points;
}

/** Fit the limiting field of view and keep clipping relative to the fitted model. */
export function focusCamera(camera: THREE.Camera, points: readonly Vector3Tuple[], direction?: ViewDirection): THREE.Vector3 | null {
  const bounds = new THREE.Box3();
  for (const point of points) if (point.every(Number.isFinite)) bounds.expandByPoint(new THREE.Vector3(...point));
  if (bounds.isEmpty()) return null;
  const center = bounds.getCenter(new THREE.Vector3());
  const magnitude = Math.max(Math.abs(center.x), Math.abs(center.y), Math.abs(center.z));
  const extent = bounds.getSize(new THREE.Vector3()).length() / 2;
  // Only degenerate bounds use a fallback size; nonzero microscopic bounds retain their scale.
  const radius = Math.max(extent || magnitude * 1e-6 || 1e-6, magnitude * Number.EPSILON * 32);
  const view = direction === 'front' ? new THREE.Vector3(0, 0, 1)
    : direction === 'top' ? new THREE.Vector3(0, 1, 0)
      : direction === 'right' ? new THREE.Vector3(1, 0, 0)
        : direction === 'isometric' ? new THREE.Vector3(1, 1, 1).normalize()
          : camera.getWorldDirection(new THREE.Vector3()).negate();
  if (direction) camera.up.set(0, direction === 'top' ? 0 : 1, direction === 'top' ? -1 : 0);
  let distance = radius * 3;
  if (camera instanceof THREE.PerspectiveCamera) {
    const vertical = THREE.MathUtils.degToRad(camera.getEffectiveFOV() / 2);
    const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
    distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.2;
  } else if (camera instanceof THREE.OrthographicCamera) {
    camera.zoom = Math.min(camera.right - camera.left, camera.top - camera.bottom) / (radius * 2.4);
  }
  camera.position.copy(center).addScaledVector(view, distance);
  if (camera instanceof THREE.PerspectiveCamera || camera instanceof THREE.OrthographicCamera) {
    camera.near = Math.max(distance - radius * 1.5, distance / 10000);
    camera.far = distance + radius * 3;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(center);
  camera.updateMatrixWorld();
  return center;
}
