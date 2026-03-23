import type { ProjectIR, ValidationItem } from '@/core/ir/types';
import { createItem } from '../types';

export function validateCommon(ir: ProjectIR): ValidationItem[] {
  const items: ValidationItem[] = [];

  // Project name
  if (!ir.meta.project_name || ir.meta.project_name === 'Untitled Project') {
    items.push(createItem('info', 'PROJ_NAME', 'Project name not set', 'Consider naming your project for easier identification.', 'meta', 'Set a project name in the global bar.'));
  }

  // No geometry
  if (ir.geometry.bodies.length === 0) {
    items.push(createItem('warning', 'NO_GEOMETRY', 'No geometry defined', 'The project has no geometry bodies. Create or import geometry first.', 'geometry', 'Go to Geometry panel and create a shape.', false));
  }

  // No analysis cases
  if (ir.analysis_cases.length === 0) {
    items.push(createItem('info', 'NO_ANALYSIS', 'No analysis case defined', 'Define at least one analysis case before exporting.', 'analysis', 'Go to Analysis Cases panel.'));
  }

  // Named selections without usages
  for (const ns of ir.named_selections) {
    const usedInMat = ir.material_assignments.some((a) => a.target_named_selection_id === ns.id);
    const usedInSec = ir.section_assignments.some((a) => a.target_named_selection_id === ns.id);
    const usedInBC = ir.boundary_conditions.some((bc) => bc.target_named_selection_id === ns.id);
    const usedInLoad = ir.loads.some((l) => l.target_named_selection_id === ns.id);
    const usedInIC = ir.initial_conditions.some((ic) => ic.target_named_selection_id === ns.id);
    if (!usedInMat && !usedInSec && !usedInBC && !usedInLoad && !usedInIC) {
      items.push(createItem('info', 'UNUSED_NS', `Unused named selection: ${ns.display_name ?? ns.name}`, 'This named selection is not referenced by any material, section, BC, load, or initial condition.', ns.id, 'Assign a condition to it or remove it if unnecessary.'));
    }
  }

  // Materials without assignments
  for (const mat of ir.materials) {
    const assigned = ir.material_assignments.some((a) => a.material_id === mat.id);
    if (!assigned) {
      items.push(createItem('warning', 'MAT_UNASSIGNED', `Material not assigned: ${mat.name}`, 'This material is defined but not assigned to any named selection.', mat.id, 'Assign it to a named selection in the Materials panel.'));
    }
  }

  // Materials with missing key properties
  for (const mat of ir.materials) {
    if (mat.class === 'elastic' || mat.class === 'thermo_elastic') {
      if (mat.parameter_set.young_modulus.value === null) {
        items.push(createItem('error', 'MAT_NO_E', `Missing Young's modulus: ${mat.name}`, "Young's modulus is required for elastic materials.", mat.id, 'Set the value in the Materials panel.', false));
      }
    }
    if (mat.class === 'fluid_newtonian') {
      if (mat.parameter_set.density.value === null) {
        items.push(createItem('error', 'MAT_NO_RHO', `Missing density: ${mat.name}`, 'Density is required for fluid materials.', mat.id, 'Set the value in the Materials panel.', false));
      }
    }
  }

  // BCs referencing empty target
  for (const bc of ir.boundary_conditions) {
    if (!bc.target_named_selection_id) {
      items.push(createItem('error', 'BC_NO_TARGET', `BC has no target: ${bc.name}`, 'This boundary condition is not assigned to any named selection.', bc.id, 'Select a target in the BC form.', false));
    }
  }

  // Loads referencing empty target
  for (const load of ir.loads) {
    if (!load.target_named_selection_id) {
      items.push(createItem('error', 'LOAD_NO_TARGET', `Load has no target: ${load.name}`, 'This load is not assigned to any named selection.', load.id, 'Select a target in the Load form.', false));
    }
  }

  // Frame/truss domain with no sections
  if ((ir.meta.domain_type === 'frame' || ir.meta.domain_type === 'truss') && ir.sections.length === 0 && ir.geometry.bodies.length > 0) {
    items.push(createItem('error', 'NO_SECTIONS', 'No sections defined for frame/truss', 'Frame and truss analyses require cross-section definitions.', 'sections', 'Go to Sections panel and define sections.', false));
  }

  return items;
}
