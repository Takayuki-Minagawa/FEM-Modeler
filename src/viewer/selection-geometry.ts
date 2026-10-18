import { parseNativeShapeMetadata } from '@/core/ir/schema/shapes';
import * as THREE from 'three';
import type { GeometryAsset, GeometryBody, ProjectIR } from '@/core/ir/types';
import { getSTLGeometry, restoreSTLGeometry, usesImportedPreview } from '@/geometry/import/stl-geometry-cache';
import { generateShape } from '@/geometry/primitives/generators';
import { applyTransformToPoint, getTransformMatrix } from '@/geometry/transforms';
import type { Vector3Tuple } from '@/geometry/transforms';

export interface TargetGeometry { points: Vector3Tuple[]; triangles: number[]; normal?: Vector3Tuple; surfaceAnchors?: { position: Vector3Tuple; normal: Vector3Tuple }[] }
const tuple = (v: THREE.Vector3): Vector3Tuple => [v.x, v.y, v.z];

function bodySurface(body: GeometryBody, role?: string, triangles?: number[], asset?: GeometryAsset): TargetGeometry {
  const imported = usesImportedPreview(body.metadata);
  let generated: ReturnType<typeof generateShape> | null;
  try { generated = imported ? null : generateShape(parseNativeShapeMetadata(body.metadata)); }
  catch { return { points: [], triangles: [] }; }
  const geometry = generated?.threeGeometry ?? getSTLGeometry(body.id) ?? (asset ? restoreSTLGeometry(body.id, asset) : undefined);
  if (!geometry) return { points: [], triangles: [] };
  const positions = geometry.getAttribute('position');
  const indices = geometry.index;
  const normal = generated?.faces.find((face) => face.name === role)?.normal;
  const out: TargetGeometry = { points: [], triangles: [] };
  const transform = getTransformMatrix(body.transform);
  const normals = geometry.getAttribute('normal');
  if (normal) out.normal = tuple(new THREE.Vector3(...normal).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(transform)).normalize());
  if (body.category === 'beam_region') {
    out.points = (generated?.vertices ?? []).map((vertex) => applyTransformToPoint(vertex.position, body.transform));
  } else if (positions) {
    const count = indices?.count ?? positions.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const ids = [0, 1, 2].map((j) => indices ? indices.getX(i + j) : i + j);
      const ny = normals?.getY(ids[0]) ?? 0;
      const belongs = role === undefined || (triangles?.length ? triangles.includes(i / 3)
        : role === 'side' ? Math.abs(ny) < 0.5 : role === 'top' ? ny > 0.5 : role === 'bottom' ? ny < -0.5 : false);
      if (!belongs) continue;
      const triangle = ids.map((id) => new THREE.Vector3().fromBufferAttribute(positions, id).applyMatrix4(transform));
      for (const point of triangle) { const p = tuple(point); out.points.push(p); out.triangles.push(...p); }
      const faceNormal = triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).normalize();
      if (faceNormal.lengthSq() > 0) {
        const position = tuple(triangle[0].clone().add(triangle[1]).add(triangle[2]).multiplyScalar(1 / 3));
        (out.surfaceAnchors ??= []).push({ position, normal: tuple(faceNormal) });
      }
    }
  }
  if (!imported) geometry.dispose();
  return out;
}

export function selectionGeometry(ir: ProjectIR, selectionId: string): TargetGeometry {
  const selection = ir.named_selections.find((item) => item.id === selectionId);
  const output: TargetGeometry = { points: [], triangles: [] };
  if (!selection || selection.status !== 'active') return output;
  const bodies = new Map(ir.geometry.bodies.map((body) => [body.id, body]));
  const faces = new Map(ir.geometry.faces.map((face) => [face.id, face]));
  const edges = new Map(ir.geometry.edges.map((edge) => [edge.id, edge]));
  const verticesById = new Map(ir.geometry.vertices.map((vertex) => [vertex.id, vertex]));
  for (const id of selection.member_refs) {
    const body = bodies.get(id);
    const face = faces.get(id);
    const edge = edges.get(id);
    const vertex = verticesById.get(id);
    const ownerId = (face ?? edge ?? vertex)?.body_id;
    const owner = body ?? (ownerId ? bodies.get(ownerId) : undefined);
    if (!owner || !owner.visible) continue;
    if (body || face) {
      const surface = bodySurface(owner, face?.name, face?.triangle_indices, ir.assets.find((asset) => asset.id === owner.asset_ref));
      for (const point of surface.points) output.points.push(point);
      for (const value of surface.triangles) output.triangles.push(value);
      for (const anchor of surface.surfaceAnchors ?? []) (output.surfaceAnchors ??= []).push(anchor);
      if (surface.normal && selection.member_refs.length === 1) output.normal = surface.normal;
    } else {
      const vertices = vertex ? [vertex] : (edge?.vertex_ids.flatMap((vertexId) => verticesById.get(vertexId) ?? []) ?? []);
      output.points.push(...vertices.map((item) => applyTransformToPoint(item.position, owner.transform)));
    }
  }
  return output;
}
