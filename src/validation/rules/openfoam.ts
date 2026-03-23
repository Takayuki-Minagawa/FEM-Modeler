import type { ProjectIR, ValidationItem } from '@/core/ir/types';
import { createItem } from '../types';

export function validateOpenFOAM(ir: ProjectIR): ValidationItem[] {
  const target = ir.solver_targets.find((t) => t.target_name === 'OpenFOAM');
  if (!target?.enabled) return [];

  const items: ValidationItem[] = [];
  const fluidBodies = ir.geometry.bodies.filter((b) => b.category === 'fluid_region');

  if (fluidBodies.length === 0) {
    items.push(createItem('error', 'OFM_NO_FLUID', 'No fluid region for OpenFOAM', 'OpenFOAM export requires a fluid_region geometry (e.g. Channel).', 'tgt_openfoam', 'Create a channel or fluid geometry.', false));
  }

  // Check for inlet/outlet named selections
  const hasInlet = ir.boundary_conditions.some((bc) => bc.bc_type === 'velocity_inlet');
  const hasOutlet = ir.boundary_conditions.some((bc) => bc.bc_type === 'pressure_outlet');

  if (!hasInlet && fluidBodies.length > 0) {
    items.push(createItem('error', 'OFM_NO_INLET', 'No velocity inlet defined', 'OpenFOAM requires at least one velocity inlet boundary condition.', 'tgt_openfoam', 'Add a velocity_inlet BC on an inlet named selection.', false));
  }
  if (!hasOutlet && fluidBodies.length > 0) {
    items.push(createItem('error', 'OFM_NO_OUTLET', 'No pressure outlet defined', 'OpenFOAM requires at least one pressure outlet boundary condition.', 'tgt_openfoam', 'Add a pressure_outlet BC on an outlet named selection.', false));
  }

  // Fluid material needed
  const hasFluidMat = ir.materials.some((m) => m.class === 'fluid_newtonian');
  if (!hasFluidMat && fluidBodies.length > 0) {
    items.push(createItem('error', 'OFM_NO_FLUID_MAT', 'No fluid material', 'OpenFOAM needs a Newtonian fluid material (density, viscosity).', 'tgt_openfoam', 'Add a fluid material from the library.', false));
  }

  return items;
}
