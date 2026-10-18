import type { ProjectIR } from '@/core/ir/types';

export interface DiagnosticTarget { panel: string; id?: string; name: string }

export function diagnosticTarget(ir: ProjectIR, ref: string, code = ''): DiagnosticTarget | null {
  const groups = [
    ['geometry', ir.geometry.bodies], ['selections', ir.named_selections], ['materials', ir.materials],
    ['sections', ir.sections], ['bc', ir.boundary_conditions], ['loads', ir.loads], ['analysis', ir.analysis_cases],
  ] as const;
  for (const [panel, entities] of groups) {
    const item = entities.find(entity => entity.id === ref);
    if (item) return { panel, id: item.id, name: item.name };
  }
  const entity = [...ir.geometry.faces, ...ir.geometry.edges, ...ir.geometry.vertices].find(item => item.id === ref);
  if (entity) {
    const body = ir.geometry.bodies.find(item => item.id === entity.body_id);
    return { panel: 'geometry', id: body?.id, name: `${body?.name ?? entity.body_id} / ${entity.name}` };
  }
  const materialAssignment = ir.material_assignments.find(item => item.id === ref);
  if (materialAssignment) return diagnosticTarget(ir, materialAssignment.material_id, code);
  const sectionAssignment = ir.section_assignments.find(item => item.id === ref);
  if (sectionAssignment) return diagnosticTarget(ir, sectionAssignment.section_id, code);
  if (ir.mesh_controls.local.some(item => item.id === ref) || /MESH/.test(code)) return { panel: 'mesh', name: ref || 'mesh' };
  if (code.startsWith('MAT_')) return { panel: 'materials', name: ref || 'materials' };
  if (code.startsWith('SEC_')) return { panel: 'sections', name: ref || 'sections' };
  if (code.startsWith('NS_')) return { panel: 'selections', name: ref || 'selections' };
  if (code.startsWith('LOAD_')) return { panel: 'loads', name: ref || 'loads' };
  if (code.startsWith('BC_')) return { panel: 'bc', name: ref || 'boundary conditions' };
  if (code.startsWith('CASE_') || code.startsWith('ANALYSIS_')) return { panel: 'analysis', name: ref || 'analysis case' };
  return null;
}
