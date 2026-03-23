import type { ProjectIR, ValidationItem } from '@/core/ir/types';
import { createItem } from '../types';

export function validateOpenSeesPy(ir: ProjectIR): ValidationItem[] {
  const target = ir.solver_targets.find((t) => t.target_name === 'OpenSeesPy');
  if (!target?.enabled) return [];

  const items: ValidationItem[] = [];
  const frameBodies = ir.geometry.bodies.filter((b) => b.category === 'beam_region');

  if (frameBodies.length === 0) {
    items.push(createItem('error', 'OSP_NO_FRAME', 'No frame/truss geometry for OpenSeesPy', 'OpenSeesPy export requires beam_region geometry (2D Frame or 2D Truss).', 'tgt_openseespy', 'Create a frame or truss geometry.', false));
  }

  if (ir.sections.length === 0 && frameBodies.length > 0) {
    items.push(createItem('error', 'OSP_NO_SECTIONS', 'Sections required for OpenSeesPy', 'Each frame/truss element needs a section definition.', 'tgt_openseespy', 'Define sections in the Sections panel.', false));
  }

  const hasSupport = ir.boundary_conditions.some((bc) =>
    bc.physics_domain === 'structural' && (bc.bc_type === 'fixed' || bc.bc_type === 'prescribed_displacement'),
  );
  if (!hasSupport && frameBodies.length > 0) {
    items.push(createItem('error', 'OSP_NO_SUPPORT', 'No support conditions for OpenSeesPy', 'At least one fixed or prescribed displacement BC is needed.', 'tgt_openseespy', 'Add a fixed boundary condition.', false));
  }

  for (const sec of ir.sections) {
    if (!sec.material_id || !ir.materials.some((m) => m.id === sec.material_id)) {
      items.push(createItem('warning', 'OSP_SEC_NO_MAT', `Section without material: ${sec.name}`, 'OpenSeesPy requires a material for each section.', sec.id, 'Assign a material in the Section form.'));
    }
  }

  return items;
}
