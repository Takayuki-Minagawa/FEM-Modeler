import type { ProjectIR, ValidationItem } from '@/core/ir/types';
import { createItem } from '../types';

export function validateDOLFINx(ir: ProjectIR): ValidationItem[] {
  const target = ir.solver_targets.find((t) => t.target_name === 'DOLFINx');
  if (!target?.enabled) return [];

  const items: ValidationItem[] = [];
  const solidBodies = ir.geometry.bodies.filter((b) => b.category === 'solid' || b.category === 'shell');

  if (solidBodies.length === 0) {
    items.push(createItem('error', 'DFX_NO_SOLID', 'No solid/shell geometry for DOLFINx', 'DOLFINx export requires solid or shell geometry.', 'tgt_dolfinx', 'Create a solid geometry (Box, Plate, etc.).', false));
  }

  // Need named selections for boundary tagging
  const bcSelections = ir.boundary_conditions.map((bc) => bc.target_named_selection_id).filter(Boolean);
  if (bcSelections.length === 0 && solidBodies.length > 0) {
    items.push(createItem('warning', 'DFX_NO_BC_TAGS', 'No boundary conditions with targets', 'DOLFINx needs facet tags from named selections for boundary conditions.', 'tgt_dolfinx', 'Create named selections and assign boundary conditions.'));
  }

  // Need at least one material
  if (ir.materials.length === 0 && solidBodies.length > 0) {
    items.push(createItem('error', 'DFX_NO_MAT', 'No materials for DOLFINx', 'DOLFINx requires material properties (E, nu for elasticity; k for thermal).', 'tgt_dolfinx', 'Add materials in the Materials panel.', false));
  }

  return items;
}
