import type { ProjectIR, ValidationItem } from '@/core/ir/types';
import { createItem } from '../types';
import { validateReferences } from '@/core/ir/relations';
import { calculateSectionProperties } from '@/core/sections/properties';

const ENTITY_DIMENSION: Record<string, number> = {
  vertex: 0,
  node: 0,
  edge: 1,
  element: 1,
  face: 2,
  patch: 2,
  body: 3,
  cell: 3,
};

function isPositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function validateCommon(ir: ProjectIR): ValidationItem[] {
  const items: ValidationItem[] = [];

  for (const targetName of ['OpenSeesPy', 'DOLFINx', 'OpenFOAM'] as const) {
    const count = ir.solver_targets.filter((target) => target.target_name === targetName).length;
    if (count !== 1) {
      items.push(createItem('error', 'SOLVER_TARGET_CARDINALITY', `Invalid solver target count: ${targetName}`, `Exactly one ${targetName} solver target is required; found ${count}.`, 'solver_targets', 'Repair the project solver target list.', false));
    }
  }

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
  } else {
    const activeCases = ir.analysis_cases.filter((item) => item.active);
    if (activeCases.length !== 1) {
      items.push(createItem('error', 'ANALYSIS_ACTIVE_COUNT', 'Exactly one active analysis case is required', `Found ${activeCases.length} active analysis cases.`, 'analysis_cases', 'Activate exactly one case in the Analysis Cases panel.', false));
    }
    for (const analysisCase of ir.analysis_cases) {
      if (analysisCase.result_requests.length === 0) {
        items.push(createItem('error', 'ANALYSIS_RESULTS_EMPTY', `No results requested: ${analysisCase.name}`, 'A strict analysis case must explicitly request at least one supported result.', analysisCase.id, 'Select one or more result requests.', false));
      }
    }
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
    if (mat.class === 'fluid_newtonian' && mat.physical_model !== 'incompressible_newtonian') {
      items.push(createItem('error', 'MAT_CLASS_MODEL_MISMATCH', `Incompatible material model: ${mat.name}`, 'Newtonian fluid materials require the incompressible_newtonian physical model.', mat.id, 'Select a compatible class/model pair.', false));
    }
    if ((mat.class === 'elastic' || mat.class === 'thermo_elastic')
      && mat.physical_model === 'incompressible_newtonian') {
      items.push(createItem('error', 'MAT_CLASS_MODEL_MISMATCH', `Incompatible material model: ${mat.name}`, 'Elastic materials cannot use a fluid-only physical model.', mat.id, 'Select isotropic_linear or another compatible solid model.', false));
    }
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

  const selectionsById = new Map(ir.named_selections.map((selection) => [selection.id, selection]));
  for (const bc of ir.boundary_conditions) {
    const selection = selectionsById.get(bc.target_named_selection_id);
    const allowed = bc.bc_type === 'fixed' || bc.bc_type === 'prescribed_displacement' || bc.bc_type === 'symmetry'
      ? [0, 2]
      : [2];
    if (selection && !allowed.includes(selection.target_dimension)) {
      items.push(createItem('error', 'BC_TARGET_DIMENSION', `Invalid BC target: ${bc.name}`, `${bc.bc_type} cannot target a dimension-${selection.target_dimension} selection.`, bc.id, `Choose a dimension-${allowed.join(' or ')} named selection.`, false));
    }
  }
  const loadDimensions: Record<string, number> = {
    nodal_force: 0,
    line_load: 1,
    surface_traction: 2,
    pressure: 2,
    mass_flow_rate: 2,
    body_force: 3,
    gravity: 3,
    heat_source: 2,
    volumetric_heat: 3,
  };
  for (const load of ir.loads) {
    const selection = selectionsById.get(load.target_named_selection_id);
    const required = loadDimensions[load.load_type];
    if (selection && required !== undefined && selection.target_dimension !== required) {
      items.push(createItem('error', 'LOAD_TARGET_DIMENSION', `Invalid load target: ${load.name}`, `${load.load_type} requires a dimension-${required} selection.`, load.id, 'Choose a named selection with the required entity dimension.', false));
    }
  }
  for (const assignment of ir.material_assignments) {
    const selection = selectionsById.get(assignment.target_named_selection_id);
    if (selection && selection.target_dimension === 0) items.push(createItem('error', 'MATERIAL_TARGET_DIMENSION', 'Material assigned to nodes', 'Materials must be assigned to elements, surfaces, or bodies rather than isolated nodes.', assignment.id, 'Choose an edge, face, or body selection.', false));
  }
  for (const assignment of ir.section_assignments) {
    const selection = selectionsById.get(assignment.target_named_selection_id);
    if (selection && selection.target_dimension !== 1 && selection.target_dimension !== 3) items.push(createItem('error', 'SECTION_TARGET_DIMENSION', 'Section assigned to incompatible entities', 'Frame sections require an edge/member or beam-region body selection.', assignment.id, 'Choose an edge or beam body selection.', false));
  }

  // Frame/truss domain with no sections
  if ((ir.meta.domain_type === 'frame' || ir.meta.domain_type === 'truss') && ir.sections.length === 0 && ir.geometry.bodies.length > 0) {
    items.push(createItem('error', 'NO_SECTIONS', 'No sections defined for frame/truss', 'Frame and truss analyses require cross-section definitions.', 'sections', 'Go to Sections panel and define sections.', false));
  }

  // Stable foreign-key and unique-ID validation.
  for (const issue of validateReferences(ir)) {
    items.push(createItem(
      'error',
      issue.code,
      issue.code === 'DUPLICATE_ID' ? `Duplicate ID: ${issue.sourceId}` : `Broken reference: ${issue.missingId}`,
      issue.code === 'DUPLICATE_ID'
        ? 'Every entity ID must be unique across the project.'
        : `${issue.sourceId}.${issue.field} refers to an entity that does not exist.`,
      issue.sourceId,
      'Repair the reference or recreate the missing entity.',
      false,
    ));
  }

  const materialAssignmentByTarget = new Map<string, string>();
  for (const assignment of ir.material_assignments) {
    const previousMaterialId = materialAssignmentByTarget.get(assignment.target_named_selection_id);
    if (previousMaterialId === assignment.material_id) {
      items.push(createItem('error', 'DUPLICATE_MATERIAL_ASSIGNMENT', 'Duplicate material assignment', 'The same material is assigned to the same target more than once.', assignment.id, 'Remove the duplicate assignment.', false));
    } else if (previousMaterialId !== undefined) {
      items.push(createItem('error', 'OVERLAPPING_MATERIAL_ASSIGNMENT', 'Overlapping material assignments', 'Strict export requires exactly one material assignment for each exact target selection.', assignment.id, 'Use disjoint named selections or remove the competing assignment.', false));
    }
    materialAssignmentByTarget.set(assignment.target_named_selection_id, assignment.material_id);
  }
  const sectionAssignmentTargets = new Set<string>();
  for (const assignment of ir.section_assignments) {
    if (sectionAssignmentTargets.has(assignment.target_named_selection_id)) {
      items.push(createItem('error', 'OVERLAPPING_SECTION_ASSIGNMENT', 'Overlapping section assignments', 'Strict export requires exactly one section assignment for each member target.', assignment.id, 'Remove the duplicate or split the named selections.', false));
    }
    sectionAssignmentTargets.add(assignment.target_named_selection_id);
  }

  for (const selection of ir.named_selections) {
    const expected = ENTITY_DIMENSION[selection.entity_type];
    if (expected !== undefined && selection.target_dimension !== expected) {
      items.push(createItem('error', 'NS_DIMENSION_MISMATCH', `Invalid selection dimension: ${selection.name}`, `${selection.entity_type} selections must use target dimension ${expected}.`, selection.id, 'Correct the named selection entity type or dimension.', false));
    }
    if (selection.member_refs.length === 0 || selection.status !== 'active') {
      items.push(createItem('error', 'NS_UNRESOLVED', `Unresolved named selection: ${selection.name}`, 'Strict analysis requires an active named selection with at least one exact member.', selection.id, 'Re-select valid geometry entities.', false));
    }
    const validMemberIds = selection.entity_type === 'vertex' || selection.entity_type === 'node'
      ? new Set(ir.geometry.vertices.map((item) => item.id))
      : selection.entity_type === 'edge' || selection.entity_type === 'element'
        ? new Set(ir.geometry.edges.map((item) => item.id))
        : selection.entity_type === 'face' || selection.entity_type === 'patch'
          ? new Set(ir.geometry.faces.map((item) => item.id))
          : new Set(ir.geometry.bodies.map((item) => item.id));
    for (const memberRef of selection.member_refs) {
      if (!validMemberIds.has(memberRef)) {
        items.push(createItem('error', 'NS_MEMBER_TYPE_MISMATCH', `Selection member type mismatch: ${selection.name}`, `${memberRef} is not a ${selection.entity_type} entity in the exact topology.`, selection.id, 'Rebuild the named selection using matching entity types.', false));
      }
    }
  }

  // Material ranges and dynamic/kinematic viscosity consistency.
  for (const material of ir.materials) {
    const p = material.parameter_set;
    for (const [key, tracked] of Object.entries(p)) {
      if (tracked.value !== null && !Number.isFinite(tracked.value)) {
        items.push(createItem('error', 'MAT_NONFINITE', `Non-finite material value: ${material.name}`, `${key} must be a finite number.`, material.id, 'Enter a finite material property.', false));
      }
    }
    if (p.young_modulus.value !== null && !isPositive(p.young_modulus.value)) items.push(createItem('error', 'MAT_E_RANGE', `Invalid Young's modulus: ${material.name}`, 'Young\'s modulus must be greater than zero.', material.id, 'Enter E > 0.', false));
    if (p.density.value !== null && !isPositive(p.density.value)) items.push(createItem('error', 'MAT_RHO_RANGE', `Invalid density: ${material.name}`, 'Density must be greater than zero.', material.id, 'Enter density > 0.', false));
    const poisson = p.poisson_ratio.value;
    if (poisson !== null && !(poisson > -1 && poisson < 0.5)) items.push(createItem('error', 'MAT_NU_RANGE', `Invalid Poisson ratio: ${material.name}`, 'Stable isotropic elasticity requires -1 < nu < 0.5.', material.id, 'Enter a Poisson ratio inside the open interval.', false));
    for (const [key, label] of [
      ['thermal_conductivity', 'Thermal conductivity'],
      ['specific_heat', 'Specific heat'],
      ['dynamic_viscosity', 'Dynamic viscosity'],
      ['kinematic_viscosity', 'Kinematic viscosity'],
    ] as const) {
      const value = p[key].value;
      if (value !== null && !isPositive(value)) items.push(createItem('error', `MAT_${key.toUpperCase()}_RANGE`, `Invalid ${label}: ${material.name}`, `${label} must be greater than zero.`, material.id, `Enter ${label} > 0.`, false));
    }
    const rho = p.density.value;
    const mu = p.dynamic_viscosity.value;
    const nu = p.kinematic_viscosity.value;
    if (isPositive(rho) && isPositive(mu) && isPositive(nu)) {
      const relativeError = Math.abs(mu - rho * nu) / Math.max(mu, rho * nu);
      if (relativeError > 0.05) items.push(createItem('warning', 'MAT_VISCOSITY_INCONSISTENT', `Viscosity mismatch: ${material.name}`, 'Dynamic viscosity should approximately equal density times kinematic viscosity.', material.id, 'Review rho, mu, and nu in canonical SI units.'));
    }
  }

  for (const section of ir.sections) {
    for (const [key, value] of [
      ['area', section.area],
      ['inertia_y', section.inertia_y],
      ['inertia_z', section.inertia_z],
      ['torsion_constant', section.torsion_constant],
      ['thickness', section.thickness],
    ] as const) {
      if (value !== null && !isPositive(value)) items.push(createItem('error', 'SECTION_PROPERTY_RANGE', `Invalid section property: ${section.name}`, `${key} must be greater than zero when provided.`, section.id, 'Enter a finite positive section property.', false));
    }
    for (const [key, value] of Object.entries(section.dimensions)) {
      if (!isPositive(value)) items.push(createItem('error', 'SECTION_DIMENSION_RANGE', `Invalid section dimension: ${section.name}`, `${key} must be a finite positive length.`, section.id, 'Correct the section dimension.', false));
    }
    if (section.section_type === 'beam_h') {
      const { width, height, flange_thickness: flange, web_thickness: web } = section.dimensions;
      if (isPositive(height ?? null) && isPositive(flange ?? null) && 2 * flange >= height) {
        items.push(createItem('error', 'SECTION_H_FLANGE_GEOMETRY', `Invalid H-section flange geometry: ${section.name}`, 'Twice the flange thickness must be smaller than the overall section height.', section.id, 'Reduce flange thickness or increase section height.', false));
      }
      if (isPositive(width ?? null) && isPositive(web ?? null) && web > width) {
        items.push(createItem('error', 'SECTION_H_WEB_GEOMETRY', `Invalid H-section web geometry: ${section.name}`, 'Web thickness must not exceed the overall flange width.', section.id, 'Reduce web thickness or increase section width.', false));
      }
    }
    if (section.metadata.property_source === 'needs_review') {
      items.push(createItem('error', 'SECTION_DIMENSIONS_UNRESOLVED', `Section dimensions are unresolved: ${section.name}`, 'Dimension-derived properties were cleared because the dimensions are incomplete or geometrically invalid.', section.id, 'Enter a complete valid dimension set.', false));
    }
    const effectiveLengthFactor = section.metadata.effective_length_factor;
    if (effectiveLengthFactor !== undefined
      && (typeof effectiveLengthFactor !== 'number' || !isPositive(effectiveLengthFactor))) {
      items.push(createItem('error', 'SECTION_EFFECTIVE_LENGTH_RANGE', `Invalid effective length factor: ${section.name}`, 'Effective length factor K must be a finite positive number.', section.id, 'Enter K > 0 or remove the optional value.', false));
    }
    const calculated = calculateSectionProperties(section);
    if (calculated) {
      for (const [label, entered, expected] of [
        ['area', section.area, calculated.area],
        ['inertia_y', section.inertia_y, calculated.inertiaY],
        ['inertia_z', section.inertia_z, calculated.inertiaZ],
        ['torsion_constant', section.torsion_constant, calculated.torsionConstant],
      ] as const) {
        if (entered !== null && Math.abs(entered - expected) / expected > 0.01) {
          items.push(createItem('warning', `SECTION_PROPERTY_MISMATCH_${label.toUpperCase()}`, `Section dimensions/properties disagree: ${section.name}`, `${label} differs by more than 1% from the value calculated from explicit dimensions.`, section.id, 'Recalculate properties from dimensions or document the manual value.'));
        }
      }
    }
  }

  for (const body of ir.geometry.bodies) {
    const metadata = body.metadata;
    const shapeType = String(metadata.shapeType ?? '');
    for (const key of ['segments', 'columns', 'floors', 'divisions']) {
      const value = metadata[key];
      if (value !== undefined && (!Number.isInteger(value) || Number(value) < 1)) items.push(createItem('error', 'GEOM_INTEGER_DIVISION', `Invalid ${key}: ${body.name}`, `${key} must be a positive integer.`, body.id, 'Enter an integer subdivision count.', false));
    }
    if (shapeType === 'pipe' && Number(metadata.innerRadius) >= Number(metadata.outerRadius)) items.push(createItem('error', 'GEOM_PIPE_RADII', `Invalid pipe radii: ${body.name}`, 'Inner radius must be smaller than outer radius.', body.id, 'Reduce the inner radius.', false));
    if (shapeType === 'plateWithHole' && Number(metadata.holeRadius) * 2 >= Math.min(Number(metadata.width), Number(metadata.depth))) items.push(createItem('error', 'GEOM_HOLE_OUTSIDE', `Invalid hole: ${body.name}`, 'The hole must remain strictly inside the plate.', body.id, 'Reduce the hole radius or enlarge the plate.', false));
    if (shapeType === 'imported_stl') {
      const asset = body.asset_ref ? ir.assets.find((item) => item.id === body.asset_ref) : undefined;
      if (!asset) items.push(createItem('error', 'STL_ASSET_MISSING', `Missing STL asset: ${body.name}`, 'The imported body cannot be restored and will not be replaced by a box.', body.id, 'Re-import the STL file.', false));
      else if (asset.diagnostics.watertight !== true && body.category === 'solid') items.push(createItem('error', 'STL_NOT_WATERTIGHT', `Non-watertight solid STL: ${body.name}`, 'A surface-only or unchecked STL cannot be used as a solid volume.', body.id, 'Repair the STL or use it as a shell.', false));
    }
  }

  for (const edge of ir.geometry.edges) {
    const start = ir.geometry.vertices.find((item) => item.id === edge.vertex_ids[0]);
    const end = ir.geometry.vertices.find((item) => item.id === edge.vertex_ids[1]);
    if (start && end && Math.hypot(start.position[0] - end.position[0], start.position[1] - end.position[1], start.position[2] - end.position[2]) <= 1e-12) {
      items.push(createItem('error', 'GEOM_ZERO_LENGTH_EDGE', `Zero-length edge: ${edge.name}`, 'Structural members and mesh edges must have nonzero length.', edge.id, 'Move or merge the coincident vertices.', false));
    }
  }

  for (const load of ir.loads) {
    if (['nodal_force', 'surface_traction', 'body_force', 'gravity', 'line_load', 'pressure'].includes(load.load_type)
      && Math.hypot(...load.direction) <= 1e-12) {
      items.push(createItem('error', 'LOAD_ZERO_DIRECTION', `Zero load direction: ${load.name}`, 'Directional loads require a nonzero direction vector.', load.id, 'Set a nonzero direction.', false));
    }
    if (!Number.isFinite(load.magnitude)) items.push(createItem('error', 'LOAD_NONFINITE', `Invalid load magnitude: ${load.name}`, 'Load magnitude must be finite.', load.id, 'Enter a finite value.', false));
  }

  const activeThermal = ir.analysis_cases.some((item) => item.active && item.domain_type === 'thermal');
  if (activeThermal && !ir.boundary_conditions.some((item) => item.bc_type === 'temperature' || item.bc_type === 'convection')) {
    items.push(createItem('error', 'THERMAL_NULLSPACE', 'Thermal problem has no temperature reference', 'A steady pure-Neumann thermal model has an undetermined additive temperature.', 'analysis_cases', 'Add a temperature or convection boundary condition.', false));
  }

  if (ir.units.value_basis !== 'SI') {
    items.push(createItem('error', 'UNIT_BASIS_UNSUPPORTED', 'Unknown numeric value basis', 'ProjectIR numeric values must be stored in canonical SI.', 'units', 'Migrate the project to schema 0.2.0.', false));
  }
  if (ir.units.system_name !== 'SI') {
    items.push(createItem('info', 'UNIT_MIXED_DISPLAY', 'Engineering display units enabled', 'The selected mm-based preset affects display only; all stored and exported values remain canonical SI.', 'units', 'No action is required.'));
  }

  return items;
}
