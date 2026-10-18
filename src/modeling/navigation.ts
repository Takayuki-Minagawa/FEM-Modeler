import type { ProjectIR } from '@/core/ir/types';

export interface ModelDiagnosticTarget { panel: 'geometry' | 'selections' | 'materials' | 'sections'; id?: string; name: string }

/** A model diagnostic can only navigate to a model editing panel. */
export function modelDiagnosticTarget(ir: ProjectIR, ref: string): ModelDiagnosticTarget | null {
  for (const [panel, collection] of [
    ['geometry', ir.geometry.bodies], ['selections', ir.named_selections], ['materials', ir.materials], ['sections', ir.sections],
  ] as const) {
    const item = collection.find(entity => entity.id === ref);
    if (item) return { panel, id: item.id, name: item.name };
  }
  const entity = [...ir.geometry.faces, ...ir.geometry.edges, ...ir.geometry.vertices].find(item => item.id === ref);
  const body = ir.geometry.bodies.find(item => item.id === entity?.body_id || item.asset_ref === ref);
  if (body) return { panel: 'geometry', id: body.id, name: entity ? `${body.name} / ${entity.name}` : body.name };
  const materialAssignment = ir.material_assignments.find(item => item.id === ref);
  if (materialAssignment) return modelDiagnosticTarget(ir, materialAssignment.material_id) ?? { panel: 'materials', name: ref };
  const sectionAssignment = ir.section_assignments.find(item => item.id === ref);
  if (sectionAssignment) return modelDiagnosticTarget(ir, sectionAssignment.section_id) ?? { panel: 'sections', name: ref };
  if (ref === 'geometry' || ir.geometry.reference_frames.some(item => item.id === ref) || ir.geometry.geometry_parameters.some(item => item.id === ref)) return { panel: 'geometry', name: ref };
  return null;
}
