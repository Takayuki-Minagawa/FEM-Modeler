import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler/capabilities';
import * as THREE from 'three';
import type { Load, ProjectIR } from '@/core/ir/types';
import { getTransformMatrix } from '@/geometry/transforms';
import type { Vector3Tuple } from '@/geometry/transforms';

export { selectionGeometry } from './selection-geometry';
import { selectionGeometry, type TargetGeometry } from './selection-geometry';
const tuple = (v: THREE.Vector3): Vector3Tuple => [v.x, v.y, v.z];

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
    const unit = bc.physics_domain === 'structural' ? 'm / rad' : bc.bc_type === 'temperature' ? 'K' : bc.bc_type === 'heat_flux' ? 'W/m²' : bc.bc_type === 'convection' ? 'W/(m²·K), K' : bc.bc_type === 'velocity_inlet' ? 'm/s' : bc.bc_type === 'pressure_outlet' ? (bc.values.pressure_basis === 'kinematic' ? 'm²/s²' : 'Pa') : '';
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
