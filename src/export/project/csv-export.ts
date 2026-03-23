import type { ProjectIR } from '@/core/ir/types';

export function exportConditionsCsv(ir: ProjectIR): string {
  const lines: string[] = [];

  // Header
  lines.push('# FEM Modeler - Conditions Summary');
  lines.push(`# Project: ${ir.meta.project_name}`);
  lines.push(`# Units: ${ir.units.system_name}`);
  lines.push(`# Exported: ${new Date().toISOString()}`);
  lines.push('');

  // Materials
  lines.push('## Materials');
  lines.push('Name,Class,E,nu,rho,k,cp,mu');
  for (const mat of ir.materials) {
    const p = mat.parameter_set;
    lines.push([
      mat.name,
      mat.class,
      p.young_modulus.value ?? '',
      p.poisson_ratio.value ?? '',
      p.density.value ?? '',
      p.thermal_conductivity.value ?? '',
      p.specific_heat.value ?? '',
      p.dynamic_viscosity.value ?? '',
    ].join(','));
  }
  lines.push('');

  // Sections
  lines.push('## Sections');
  lines.push('Name,Type,Area,Iy,Iz,J,Thickness');
  for (const sec of ir.sections) {
    lines.push([sec.name, sec.section_type, sec.area ?? '', sec.inertia_y ?? '', sec.inertia_z ?? '', sec.torsion_constant ?? '', sec.thickness ?? ''].join(','));
  }
  lines.push('');

  // Named Selections
  lines.push('## Named Selections');
  lines.push('Name,EntityType,MemberCount');
  for (const ns of ir.named_selections) {
    lines.push([ns.display_name ?? ns.name, ns.entity_type, ns.member_refs.length].join(','));
  }
  lines.push('');

  // Boundary Conditions
  lines.push('## Boundary Conditions');
  lines.push('Name,Type,Domain,Target,Values');
  for (const bc of ir.boundary_conditions) {
    const ns = ir.named_selections.find((n) => n.id === bc.target_named_selection_id);
    const vals = bc.values.scalar != null ? String(bc.values.scalar) : bc.values.vector ? `[${bc.values.vector.join(',')}]` : bc.values.dof_map ? Object.entries(bc.values.dof_map).filter(([, v]) => v === 'fixed').map(([k]) => k).join('+') : '';
    lines.push([bc.name, bc.bc_type, bc.physics_domain, ns?.name ?? '', vals].join(','));
  }
  lines.push('');

  // Loads
  lines.push('## Loads');
  lines.push('Name,Type,Domain,Target,Magnitude,Direction');
  for (const load of ir.loads) {
    const ns = ir.named_selections.find((n) => n.id === load.target_named_selection_id);
    lines.push([load.name, load.load_type, load.physics_domain, ns?.name ?? '', load.magnitude, `[${load.direction.join(',')}]`].join(','));
  }

  return lines.join('\n');
}

export function downloadConditionsCsv(ir: ProjectIR): void {
  const csv = exportConditionsCsv(ir);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${ir.meta.project_name.replace(/\s+/g, '_')}_conditions.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
