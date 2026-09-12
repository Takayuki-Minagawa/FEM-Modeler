import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler/capabilities';
import { parseNativeShapeMetadata } from '@/core/ir/schema/shapes';
import * as THREE from 'three';
import type { GeometryAsset, GeometryBody, Load, ProjectIR } from '@/core/ir/types';
import { getSTLGeometry, restoreSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import { generateShape } from '@/geometry/primitives/generators';
import { applyTransformToPoint, getTransformMatrix } from '@/geometry/transforms';
import type { Vector3Tuple } from '@/geometry/transforms';

export interface TargetGeometry { points: Vector3Tuple[]; triangles: number[]; normal?: Vector3Tuple; surfaceAnchors?: { position: Vector3Tuple; normal: Vector3Tuple }[] }
const tuple = (v: THREE.Vector3): Vector3Tuple => [v.x, v.y, v.z];

function bodySurface(body: GeometryBody, role?: string, triangles?: number[], asset?: GeometryAsset): TargetGeometry {
  const imported = body.metadata.shapeType === 'imported_stl';
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
  for (const id of selection.member_refs) {
    const body = ir.geometry.bodies.find((item) => item.id === id);
    const face = ir.geometry.faces.find((item) => item.id === id);
    const edge = ir.geometry.edges.find((item) => item.id === id);
    const vertex = ir.geometry.vertices.find((item) => item.id === id);
    const owner = body ?? ir.geometry.bodies.find((item) => item.id === (face ?? edge ?? vertex)?.body_id);
    if (!owner || !owner.visible) continue;
    if (body || face) {
      const surface = bodySurface(owner, face?.name, face?.triangle_indices, ir.assets.find((asset) => asset.id === owner.asset_ref));
      for (const point of surface.points) output.points.push(point);
      for (const value of surface.triangles) output.triangles.push(value);
      for (const anchor of surface.surfaceAnchors ?? []) (output.surfaceAnchors ??= []).push(anchor);
      if (surface.normal && selection.member_refs.length === 1) output.normal = surface.normal;
    } else {
      const vertices = vertex ? [vertex] : ir.geometry.vertices.filter((item) => edge?.vertex_ids.includes(item.id));
      output.points.push(...vertices.map((item) => applyTransformToPoint(item.position, owner.transform)));
    }
  }
  return output;
}

export function worldDirection(ir: ProjectIR, coordinateSystem: string, direction: Vector3Tuple): Vector3Tuple | null {
  if (coordinateSystem === 'global') return [...direction];
  const frame = ir.geometry.reference_frames.find((item) => item.id === coordinateSystem);
  if (!frame || frame.type === 'cylindrical') return null;
  const vector = new THREE.Vector3(...frame.axis_x).multiplyScalar(direction[0])
    .addScaledVector(new THREE.Vector3(...frame.axis_y), direction[1])
    .addScaledVector(new THREE.Vector3(...frame.axis_z), direction[2]);
  const body = ir.geometry.bodies.find((item) => item.id === frame.attached_to);
  if (body) {
    // Coordinate basis rotates with its body; geometric scaling does not scale a force.
    const rotation = getTransformMatrix({ ...body.transform, scale: [1, 1, 1] });
    vector.applyMatrix3(new THREE.Matrix3().setFromMatrix4(rotation));
  }
  return tuple(vector);
}

export interface ConditionOverlay {
  id: string; name: string; kind: 'bc' | 'load' | 'material'; color: string; selectionId: string;
  target: TargetGeometry; direction?: Vector3Tuple; arrows?: { position: Vector3Tuple; direction: Vector3Tuple }[]; constraints?: Vector3Tuple[]; detail: string;
}
export function conditionOverlays(ir: ProjectIR): ConditionOverlay[] {
  const active = ir.analysis_cases.find((item) => item.active);
  if (!active) return [];
  const scoped = scopeProjectForAnalysisCaseValidation(ir, active.id);
  const output: ConditionOverlay[] = [];
  for (const bc of scoped.boundary_conditions) {
    const constraints = (['ux', 'uy', 'uz'] as const).flatMap((dof, axis) => {
      if (!(bc.bc_type === 'fixed' && !bc.values.dof_map) && !['fixed', 'prescribed'].includes(bc.values.dof_map?.[dof] ?? '')) return [];
      const direction = worldDirection(ir, bc.coordinate_system, [axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0]);
      return direction ? [direction] : [];
    });
    const unit = bc.physics_domain === 'structural' ? 'm / rad' : bc.bc_type === 'temperature' ? 'K' : bc.bc_type === 'heat_flux' ? 'W/m²' : bc.bc_type === 'convection' ? 'W/(m²·K), K' : bc.bc_type === 'velocity_inlet' ? 'm/s' : bc.bc_type === 'pressure_outlet' ? 'Pa' : '';
    output.push({ id: bc.id, name: bc.name, kind: 'bc', color: '#38bdf8', selectionId: bc.target_named_selection_id,
      target: selectionGeometry(ir, bc.target_named_selection_id), constraints, detail: `${bc.bc_type} · ${bc.coordinate_system} · ${JSON.stringify(bc.values)} ${unit}` });
  }
  for (const load of scoped.loads) {
    const target = selectionGeometry(ir, load.target_named_selection_id);
    const direction = load.load_type === 'pressure' ? target.normal?.map((v) => -v * Math.sign(load.magnitude)) as Vector3Tuple | undefined
      : worldDirection(ir, load.coordinate_system, load.direction)?.map((v) => v * Math.sign(load.magnitude)) as Vector3Tuple | undefined;
    const anchors = target.surfaceAnchors ?? [];
    const arrows = load.load_type === 'pressure' ? anchors.filter((_, index) => index % Math.max(1, Math.ceil(anchors.length / 8)) === 0).map((anchor) => ({ position: anchor.position, direction: anchor.normal.map((v) => -v * Math.sign(load.magnitude)) as Vector3Tuple })) : undefined;
    output.push({ id: load.id, name: load.name, kind: 'load', color: '#fb923c', selectionId: load.target_named_selection_id,
      target, direction, arrows, detail: `${load.load_type} · ${load.magnitude} ${loadUnit(load)} · ${load.coordinate_system}${!direction && !arrows?.length ? ' · direction unavailable' : ''}` });
  }
  for (const assignment of scoped.material_assignments) {
    const material = ir.materials.find((item) => item.id === assignment.material_id);
    const selection = ir.named_selections.find((item) => item.id === assignment.target_named_selection_id);
    output.push({ id: assignment.id, name: material?.name ?? assignment.material_id, kind: 'material', color: selection?.color ?? '#a78bfa',
      selectionId: assignment.target_named_selection_id, target: selectionGeometry(ir, assignment.target_named_selection_id), detail: 'material' });
  }
  return output;
}

function loadUnit(load: Load): string {
  if (load.load_type === 'gravity') return 'm/s²';
  if (load.load_type === 'mass_flow_rate') return 'kg/s';
  const base = ['heat_source', 'volumetric_heat'].includes(load.load_type) ? 'W' : 'N';
  return base + ({ total: '', per_area: '/m²', per_length: '/m', per_volume: '/m³' }[load.application_mode]);
}
