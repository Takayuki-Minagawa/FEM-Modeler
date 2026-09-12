import { toSI, type QuantityKind } from '@/core/units';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scaleNumber(record: Record<string, unknown>, key: string, factor: number): void {
  if (typeof record[key] === 'number') record[key] *= factor;
}

function scaleTuple(record: Record<string, unknown>, key: string, factor: number): void {
  const tuple = record[key];
  if (Array.isArray(tuple)) record[key] = tuple.map((value) => typeof value === 'number' ? value * factor : value);
}

function factorFor(kind: QuantityKind, system: 'SI' | 'mm-N-s' | 'mm-t-s'): number {
  return toSI(1, kind, system);
}

/**
 * Convert pre-0.2 files to canonical SI using the actual 0.1 UI provenance.
 * The legacy UI mixed display-basis geometry/section values with SI-valued
 * library materials and raw solver inputs, so a blanket dimensional scaling
 * would corrupt valid projects.
 */
export function migrateLegacyUnits(raw: Record<string, unknown>): {
  data: Record<string, unknown>;
  warnings: string[];
} {
  const migrated = structuredClone(raw);
  const warnings: string[] = [];
  const units = isRecord(migrated.units) ? migrated.units : {};
  const geometry = isRecord(migrated.geometry) ? migrated.geometry : {};
  if (units.angle_unit === 'rad') {
    for (const body of Array.isArray(geometry.bodies) ? geometry.bodies : []) {
      if (!isRecord(body) || !isRecord(body.transform)) continue;
      const rotation = body.transform.rotation;
      if (Array.isArray(rotation)) {
        body.transform.rotation = rotation.map((value) => (
          typeof value === 'number' ? value * 180 / Math.PI : value
        ));
      }
    }
  } else if (units.angle_unit !== undefined && units.angle_unit !== 'deg') {
    throw new Error(`Legacy angle unit "${String(units.angle_unit)}" is unsupported.`);
  }
  units.angle_unit = 'deg';
  migrated.units = units;
  if (units.value_basis === 'SI') return { data: migrated, warnings };

  const systemName = units.system_name;
  if (systemName === 'custom') {
    throw new Error('Legacy custom unit projects have no canonical value basis and cannot be migrated safely.');
  }
  const system = systemName === 'mm-N-s' || systemName === 'mm-t-s' ? systemName : 'SI';
  const length = factorFor('length', system);
  // Geometry inputs in 0.1 had no unit label or conversion, and every exporter
  // emitted raw coordinates (including OpenFOAM convertToMeters 1). Preserve
  // those historical solver semantics instead of inferring from the final UI
  // preset, which users could change without converting existing values.
  const legacyGeometryFactor = 1;

  for (const body of Array.isArray(geometry.bodies) ? geometry.bodies : []) {
    if (!isRecord(body)) continue;
    const transform = isRecord(body.transform) ? body.transform : {};
    scaleTuple(transform, 'position', legacyGeometryFactor);
    const metadata = isRecord(body.metadata) ? body.metadata : {};
    for (const key of ['width', 'height', 'depth', 'radius', 'thickness', 'holeRadius', 'outerRadius', 'innerRadius', 'length', 'span', 'spanX', 'spanY']) {
      scaleNumber(metadata, key, legacyGeometryFactor);
    }
  }
  for (const face of Array.isArray(geometry.faces) ? geometry.faces : []) if (isRecord(face)) scaleNumber(face, 'area', legacyGeometryFactor ** 2);
  for (const edge of Array.isArray(geometry.edges) ? geometry.edges : []) if (isRecord(edge)) scaleNumber(edge, 'length', legacyGeometryFactor);
  for (const vertex of Array.isArray(geometry.vertices) ? geometry.vertices : []) if (isRecord(vertex)) scaleTuple(vertex, 'position', legacyGeometryFactor);
  for (const frame of Array.isArray(geometry.reference_frames) ? geometry.reference_frames : []) if (isRecord(frame)) scaleTuple(frame, 'origin', legacyGeometryFactor);
  for (const parameter of Array.isArray(geometry.geometry_parameters) ? geometry.geometry_parameters : []) if (isRecord(parameter)) scaleNumber(parameter, 'value', legacyGeometryFactor);

  for (const material of Array.isArray(migrated.materials) ? migrated.materials : []) {
    if (!isRecord(material) || !isRecord(material.parameter_set)) continue;
    const manuallyDisplayedFactors: Record<string, number> = {
      // The 0.1 Material form used kg/mm3 for both mm presets, MPa, and
      // W/(mm K). These labels intentionally differ from the 0.2 registry.
      density: system === 'SI' ? 1 : 1e9,
      young_modulus: system === 'SI' ? 1 : 1e6,
      thermal_conductivity: system === 'SI' ? 1 : 1e3,
    };
    for (const [key, factor] of Object.entries(manuallyDisplayedFactors)) {
      const tracked = material.parameter_set[key];
      if (!isRecord(tracked) || typeof tracked.value !== 'number') continue;
      // Library/imported/inferred values were already stored in SI in 0.1.
      if (tracked.status === 'library' || tracked.status === 'imported' || tracked.status === 'inferred') continue;
      if (tracked.status === 'confirmed') {
        scaleNumber(tracked, 'value', factor);
        continue;
      }
      if (system !== 'SI') {
        const reference = `${String(material.id ?? material.name ?? '')}.${key}`;
        const originalStatus = String(tracked.status);
        scaleNumber(tracked, 'value', factor);
        tracked.status = 'needs_review';
        warnings.push(
          `Legacy material ${reference} had ambiguous unit provenance (status: ${originalStatus}); its value was interpreted using ${system} display units and marked needs_review.`,
        );
      }
    }
  }

  for (const section of Array.isArray(migrated.sections) ? migrated.sections : []) {
    if (!isRecord(section)) continue;
    if (isRecord(section.dimensions)) for (const key of Object.keys(section.dimensions)) scaleNumber(section.dimensions, key, length);
    scaleNumber(section, 'area', factorFor('area', system));
    for (const key of ['inertia_y', 'inertia_z', 'torsion_constant']) scaleNumber(section, key, factorFor('fourth_moment', system));
    scaleNumber(section, 'thickness', length);
  }

  if (isRecord(migrated.mesh_controls)) {
    if (isRecord(migrated.mesh_controls.global)) scaleNumber(migrated.mesh_controls.global, 'global_size', length);
    for (const control of Array.isArray(migrated.mesh_controls.local) ? migrated.mesh_controls.local : []) if (isRecord(control)) scaleNumber(control, 'size', length);
  }

  // 0.1 BC inputs had no displayed units. Preserve their historical raw solver
  // values. OpenFOAM wrote outlet pressure directly to p, so mark it kinematic.
  for (const bc of Array.isArray(migrated.boundary_conditions) ? migrated.boundary_conditions : []) {
    if (!isRecord(bc) || !isRecord(bc.values)) continue;
    if (bc.bc_type === 'pressure_outlet' && bc.values.pressure_basis === undefined) {
      bc.values.pressure_basis = 'kinematic';
    }
    if (bc.values.heat_transfer_coefficient !== undefined || bc.values.ambient_temperature !== undefined) {
      throw new Error('Legacy convection named fields have ambiguous unit provenance and require an explicit current-schema conversion.');
    }
  }

  // The 0.1 Load form displayed MPa only for pressure and N for every other
  // load type, irrespective of application_mode. Preserve that exact contract.
  for (const load of Array.isArray(migrated.loads) ? migrated.loads : []) {
    if (!isRecord(load)) continue;
    const kind: QuantityKind = load.load_type === 'pressure' ? 'pressure' : 'force';
    scaleNumber(load, 'magnitude', factorFor(kind, system));
  }
  // Initial-condition editing was not exposed by the 0.1 UI; preserve imported
  // raw values instead of guessing a display basis.

  units.value_basis = 'SI';
  migrated.units = units;
  const auditTrail = Array.isArray(migrated.audit_trail) ? migrated.audit_trail : [];
  auditTrail.push({
    id: `audit_unit_migration_${Date.now()}`,
    timestamp: new Date().toISOString(),
    actor: 'migration',
    action_type: 'unit_conversion',
    target_ref: 'units',
    before_summary: `${String(systemName ?? 'SI')} mixed legacy values`,
    after_summary: 'canonical SI values',
    note: 'Field-aware migration: unlabeled raw geometry, SI library materials, and raw solver inputs were preserved; explicitly labelled display-basis fields were converted.',
  });
  migrated.audit_trail = auditTrail;
  return { data: migrated, warnings };
}
