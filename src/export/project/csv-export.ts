import type { ProjectIR } from '@/core/ir/types';
import {
  sanitizeArtifactName,
  serializeCsv,
  type ArtifactScalar,
} from '@/export/shared/artifact-sanitization';

export function exportConditionsCsv(ir: ProjectIR): string {
  const records: ArtifactScalar[][] = [];

  // Header
  records.push(['# FEM Modeler - Conditions Summary']);
  records.push([`# Project: ${ir.meta.project_name}`]);
  records.push([`# Units: ${ir.units.system_name}`]);
  records.push([`# Exported: ${new Date().toISOString()}`]);
  records.push([]);

  // Materials
  records.push(['## Materials']);
  records.push(['Name', 'Class', 'E', 'nu', 'rho', 'k', 'cp', 'mu']);
  for (const mat of ir.materials) {
    const p = mat.parameter_set;
    records.push([
      mat.name,
      mat.class,
      p.young_modulus.value ?? '',
      p.poisson_ratio.value ?? '',
      p.density.value ?? '',
      p.thermal_conductivity.value ?? '',
      p.specific_heat.value ?? '',
      p.dynamic_viscosity.value ?? '',
    ]);
  }
  records.push([]);

  // Sections
  records.push(['## Sections']);
  records.push(['Name', 'Type', 'Area', 'Iy', 'Iz', 'J', 'Thickness']);
  for (const sec of ir.sections) {
    records.push([sec.name, sec.section_type, sec.area ?? '', sec.inertia_y ?? '', sec.inertia_z ?? '', sec.torsion_constant ?? '', sec.thickness ?? '']);
  }
  records.push([]);

  // Named Selections
  records.push(['## Named Selections']);
  records.push(['Name', 'EntityType', 'MemberCount']);
  for (const ns of ir.named_selections) {
    records.push([ns.display_name ?? ns.name, ns.entity_type, ns.member_refs.length]);
  }
  records.push([]);

  // Boundary Conditions
  records.push(['## Boundary Conditions']);
  records.push(['Name', 'Type', 'Domain', 'Target', 'Values']);
  for (const bc of ir.boundary_conditions) {
    const ns = ir.named_selections.find((n) => n.id === bc.target_named_selection_id);
    const vals = bc.values.scalar != null ? String(bc.values.scalar) : bc.values.vector ? `[${bc.values.vector.join(',')}]` : bc.values.dof_map ? Object.entries(bc.values.dof_map).filter(([, v]) => v === 'fixed').map(([k]) => k).join('+') : '';
    records.push([bc.name, bc.bc_type, bc.physics_domain, ns?.name ?? '', vals]);
  }
  records.push([]);

  // Loads
  records.push(['## Loads']);
  records.push(['Name', 'Type', 'Domain', 'Target', 'Magnitude', 'Direction']);
  for (const load of ir.loads) {
    const ns = ir.named_selections.find((n) => n.id === load.target_named_selection_id);
    records.push([load.name, load.load_type, load.physics_domain, ns?.name ?? '', load.magnitude, `[${load.direction.join(',')}]`]);
  }

  return serializeCsv(records);
}

export function downloadConditionsCsv(ir: ProjectIR): void {
  const csv = exportConditionsCsv(ir);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeArtifactName(ir.meta.project_name, 'project')}_conditions.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
