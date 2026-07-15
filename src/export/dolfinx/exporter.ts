import type {
  AnalysisCase,
  BoundaryCondition,
  GeometryBody,
  GeometryFace,
  Load,
  Material,
  NamedSelection,
  ProjectIR,
} from '@/core/ir/types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { isIdentityTransform, toRadiansTuple } from '@/geometry/transforms';
import { sanitizeArtifactName } from '@/export/shared/artifact-sanitization';
import { scopeProjectForAnalysisCaseValidation } from '@/export/compiler';

export interface DOLFINxExportResult {
  success: boolean;
  script: string;
  geoFile: string;
  manifest: string;
  errors: string[];
  warnings: string[];
}

type PhysicsMode = 'structural' | 'thermal';
type SupportedShapeType = 'box' | 'plate' | 'plateWithHole' | 'cylinder';

type ShapeDefinition =
  | { type: 'box'; width: number; height: number; depth: number }
  | { type: 'plate'; width: number; thickness: number; depth: number }
  | { type: 'plateWithHole'; width: number; thickness: number; depth: number; holeRadius: number }
  | { type: 'cylinder'; radius: number; height: number };

interface ResolvedSurfaceSelection {
  selection: NamedSelection;
  faces: GeometryFace[];
  tag: number;
  canonical: boolean;
}

interface ResolvedMaterialAssignment {
  material: Material;
  assignmentId: string;
  selectionId: string;
}

interface ExportContext {
  ir: ProjectIR;
  body: GeometryBody;
  shape: ShapeDefinition;
  mode: PhysicsMode;
  material: Material;
  materialAssignmentId: string;
  materialSelectionId: string;
  analysisCase?: AnalysisCase;
  boundaryConditions: BoundaryCondition[];
  loads: Load[];
  surfaceSelections: Map<string, ResolvedSurfaceSelection>;
  tagBySelectionId: Map<string, number>;
  tagMap: Record<string, number>;
}

const SUPPORTED_SHAPES = new Set<SupportedShapeType>([
  'box',
  'plate',
  'plateWithHole',
  'cylinder',
]);

const DEFAULT_MESH_QUALITY_TARGETS = {
  min_jacobian: 0.3,
  max_aspect_ratio: 10,
  min_skewness: 0.1,
  preferred_quality_level: 'balanced',
} as const;

/**
 * Compile a strict, single-volume DOLFINx 0.10 model.
 *
 * The exporter intentionally rejects unresolved assignments and unsupported IR
 * items. It never replaces an unsupported body with a box and never guesses a
 * Gmsh surface tag from an array index.
 */
export function exportDOLFINx(ir: ProjectIR): DOLFINxExportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const exportTime = new Date().toISOString();
  const candidates = ir.geometry.bodies.filter(
    (candidate) => candidate.category === 'solid' || candidate.category === 'shell',
  );

  if (candidates.length === 0) {
    errors.push('DFX_GEOMETRY_REQUIRED: Exactly one solid body is required; none was found.');
    return failedResult(ir, exportTime, errors, warnings);
  }
  if (candidates.length > 1) {
    errors.push(
      `DFX_MULTIPLE_BODIES: Exactly one solid body is supported; found ${candidates.length}.`,
    );
    return failedResult(ir, exportTime, errors, warnings);
  }
  if (ir.geometry.bodies.length !== 1) {
    errors.push(
      `DFX_BODY_SCOPE_UNRESOLVED: Strict DOLFINx export requires exactly one geometry body; found ${ir.geometry.bodies.length}.`,
    );
    return failedResult(ir, exportTime, errors, warnings);
  }

  const body = candidates[0];
  if (body.category !== 'solid') {
    errors.push(`DFX_UNSUPPORTED_BODY_CATEGORY: Body "${safeComment(body.name)}" is a ${body.category}; only volumetric solids are supported.`);
    return failedResult(ir, exportTime, errors, warnings);
  }

  const shapeType = body.metadata.shapeType;
  if (typeof shapeType !== 'string' || !SUPPORTED_SHAPES.has(shapeType as SupportedShapeType)) {
    errors.push(
      `DFX_UNSUPPORTED_SHAPE: Body "${safeComment(body.name)}" uses unsupported shape "${String(shapeType)}". Supported shapes: box, plate, plateWithHole, cylinder.`,
    );
    return failedResult(ir, exportTime, errors, warnings);
  }

  validateTransform(body, errors);
  const shape = resolveShapeDefinition(body, shapeType as SupportedShapeType, errors);
  if (!shape) return failedResult(ir, exportTime, errors, warnings);

  const { mode, analysisCase } = resolveAnalysisCase(ir, errors);
  if (ir.sections.length > 0 || ir.section_assignments.length > 0) {
    errors.push(
      `DFX_UNSUPPORTED_SECTION: Volumetric DOLFINx analysis does not consume sections or section assignments (sections=${ir.sections.length}, assignments=${ir.section_assignments.length}).`,
    );
  }
  const boundaryConditions = resolveParticipatingItems(
    ir.boundary_conditions,
    analysisCase?.participating_bc_ids,
    mode,
    'boundary condition',
    errors,
  );
  const loads = resolveParticipatingItems(
    ir.loads,
    analysisCase?.participating_load_ids,
    mode,
    'load',
    errors,
  );

  const participatingInitialConditions = resolveParticipatingItems(
    ir.initial_conditions,
    analysisCase?.participating_ic_ids,
    mode,
    'initial condition',
    errors,
  );
  for (const initialCondition of participatingInitialConditions) {
    errors.push(
      `DFX_UNSUPPORTED_INITIAL_CONDITION: Initial condition "${safeComment(initialCondition.name)}" (${initialCondition.ic_type}) is not consumed by a steady DOLFINx analysis.`,
    );
  }

  const materialAssignment = resolveAssignedMaterial(ir, body, analysisCase, errors);
  if (materialAssignment) validateMaterial(materialAssignment.material, mode, errors);

  validateMeshControls(ir, analysisCase, errors);

  const requestedSurfaceSelectionIds = new Set<string>();
  validateBoundaryConditions(
    ir,
    body,
    mode,
    boundaryConditions,
    requestedSurfaceSelectionIds,
    errors,
  );
  validateLoads(ir, body, shape, mode, loads, requestedSurfaceSelectionIds, errors);
  validateWellPosedness(ir, mode, boundaryConditions, errors);

  const { selections, tagBySelectionId, tagMap } = resolveSurfaceSelections(
    ir,
    body,
    shape,
    requestedSurfaceSelectionIds,
    errors,
  );
  validateBoundaryConflicts(mode, boundaryConditions, tagBySelectionId, errors);
  const geoFile = buildGeoFile(ir, body, shape, selections);

  if (!materialAssignment || errors.length > 0) {
    return failedResult(ir, exportTime, errors, warnings, geoFile, mode, tagMap);
  }

  const context: ExportContext = {
    ir,
    body,
    shape,
    mode,
    material: materialAssignment.material,
    materialAssignmentId: materialAssignment.assignmentId,
    materialSelectionId: materialAssignment.selectionId,
    analysisCase,
    boundaryConditions,
    loads,
    surfaceSelections: selections,
    tagBySelectionId,
    tagMap,
  };
  const script = buildSolverScript(context, exportTime);
  const manifest = buildManifest(context, exportTime, errors, warnings);

  return {
    success: true,
    script,
    geoFile,
    manifest,
    errors,
    warnings,
  };
}

function resolveAnalysisCase(
  ir: ProjectIR,
  errors: string[],
): { mode: PhysicsMode; analysisCase?: AnalysisCase } {
  const activeCases = ir.analysis_cases.filter(
    (analysisCase) => analysisCase.active && analysisCase.solver_profile_hint.startsWith('dolfinx_'),
  );

  if (activeCases.length > 1) {
    errors.push(
      `DFX_MULTIPLE_ANALYSIS_CASES: Exactly one active DOLFINx analysis case is supported; found ${activeCases.length}.`,
    );
  }

  const analysisCase = activeCases[0];
  if (!analysisCase) {
    errors.push('DFX_ANALYSIS_CASE_REQUIRED: Exactly one active DOLFINx analysis case is required.');
    const hasThermalInput =
      ir.meta.domain_type === 'thermal'
      || ir.boundary_conditions.some((bc) => bc.physics_domain === 'thermal')
      || ir.loads.some((load) => load.physics_domain === 'thermal');
    return { mode: hasThermalInput ? 'thermal' : 'structural' };
  }

  const mode: PhysicsMode = analysisCase.solver_profile_hint === 'dolfinx_linear_elasticity'
    ? 'structural'
    : 'thermal';
  const expectedDomain = mode === 'structural' ? 'solid' : 'thermal';
  if (analysisCase.domain_type !== expectedDomain) {
    errors.push(
      `DFX_ANALYSIS_DOMAIN_MISMATCH: Profile ${analysisCase.solver_profile_hint} requires domain ${expectedDomain}, not ${analysisCase.domain_type}.`,
    );
  }
  const expectedAnalysisType = mode === 'structural' ? 'static_linear' : 'steady_thermal';
  const poissonCompatible =
    analysisCase.solver_profile_hint === 'dolfinx_poisson'
    && (analysisCase.analysis_type === 'static_linear' || analysisCase.analysis_type === 'steady_thermal');

  if (analysisCase.analysis_type !== expectedAnalysisType && !poissonCompatible) {
    errors.push(
      `DFX_UNSUPPORTED_ANALYSIS: Analysis case "${safeComment(analysisCase.name)}" uses ${analysisCase.analysis_type}; ${analysisCase.solver_profile_hint} supports only a steady linear analysis.`,
    );
  }
  if (analysisCase.nonlinear || analysisCase.transient) {
    errors.push(
      `DFX_UNSUPPORTED_ANALYSIS_FLAGS: Analysis case "${safeComment(analysisCase.name)}" requests ${analysisCase.nonlinear ? 'nonlinear' : ''}${analysisCase.nonlinear && analysisCase.transient ? ' and ' : ''}${analysisCase.transient ? 'transient' : ''} behavior.`,
    );
  }
  const supportedResult = mode === 'structural' ? 'displacement' : 'temperature';
  for (const resultRequest of analysisCase.result_requests) {
    if (resultRequest !== supportedResult) {
      errors.push(
        `DFX_UNSUPPORTED_RESULT: Profile ${analysisCase.solver_profile_hint} does not generate requested result "${resultRequest}".`,
      );
    }
  }

  return { mode, analysisCase };
}

function resolveParticipatingItems<T extends { id: string; physics_domain: string }>(
  allItems: T[],
  participatingIds: string[] | undefined,
  mode: PhysicsMode,
  label: string,
  errors: string[],
): T[] {
  if (!participatingIds || participatingIds.length === 0) {
    return allItems.filter((item) => item.physics_domain === mode);
  }

  const resolved: T[] = [];
  const seen = new Set<string>();
  for (const id of participatingIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const item = allItems.find((candidate) => candidate.id === id);
    if (!item) {
      errors.push(`DFX_MISSING_PARTICIPANT: Participating ${label} "${safeComment(id)}" does not exist.`);
      continue;
    }
    if (item.physics_domain !== mode) {
      errors.push(
        `DFX_DOMAIN_MISMATCH: Participating ${label} "${safeComment(id)}" belongs to ${item.physics_domain}, not ${mode}.`,
      );
      continue;
    }
    resolved.push(item);
  }
  return resolved;
}

function resolveAssignedMaterial(
  ir: ProjectIR,
  body: GeometryBody,
  analysisCase: AnalysisCase | undefined,
  errors: string[],
): ResolvedMaterialAssignment | undefined {
  const applicableAssignments = ir.material_assignments.filter((assignment) => {
    const target = ir.named_selections.find(
      (selection) => selection.id === assignment.target_named_selection_id,
    );
    return target?.entity_type === 'body'
      && target.target_dimension === 3
      && target.status === 'active'
      && target.member_refs.length === 1
      && target.member_refs[0] === body.id;
  });
  for (const assignment of ir.material_assignments) {
    if (!applicableAssignments.includes(assignment)) {
      errors.push(
        `DFX_UNCONSUMED_MATERIAL_ASSIGNMENT: Assignment "${safeComment(assignment.id)}" does not resolve exclusively to body "${safeComment(body.name)}".`,
      );
    }
  }

  if (applicableAssignments.length === 0) {
    errors.push(
      `DFX_MATERIAL_ASSIGNMENT_REQUIRED: Body "${safeComment(body.name)}" has no active body-level material assignment.`,
    );
    return undefined;
  }
  if (applicableAssignments.length > 1) {
    errors.push(
      `DFX_AMBIGUOUS_MATERIAL_ASSIGNMENT: Body "${safeComment(body.name)}" has ${applicableAssignments.length} material assignments; exactly one is required.`,
    );
    return undefined;
  }

  const assignment = applicableAssignments[0];
  const material = ir.materials.find((candidate) => candidate.id === assignment.material_id);
  if (!material) {
    errors.push(
      `DFX_MATERIAL_NOT_FOUND: Assignment "${safeComment(assignment.id)}" references missing material "${safeComment(assignment.material_id)}".`,
    );
    return undefined;
  }

  if (
    analysisCase
    && analysisCase.participating_material_ids.length > 0
    && !analysisCase.participating_material_ids.includes(material.id)
  ) {
    errors.push(
      `DFX_MATERIAL_NOT_PARTICIPATING: Assigned material "${safeComment(material.name)}" is not included in analysis case "${safeComment(analysisCase.name)}".`,
    );
  }
  for (const materialId of analysisCase?.participating_material_ids ?? []) {
    if (!ir.materials.some((candidate) => candidate.id === materialId)) {
      errors.push(`DFX_MATERIAL_NOT_FOUND: Participating material "${safeComment(materialId)}" does not exist.`);
    } else if (materialId !== material.id) {
      errors.push(
        `DFX_UNCONSUMED_PARTICIPATING_MATERIAL: Participating material "${safeComment(materialId)}" is not assigned to the exported body.`,
      );
    }
  }

  return {
    material,
    assignmentId: assignment.id,
    selectionId: assignment.target_named_selection_id,
  };
}

function validateMaterial(material: Material, mode: PhysicsMode, errors: string[]): void {
  if (mode === 'structural') {
    if (
      (material.class !== 'elastic' && material.class !== 'thermo_elastic')
      || material.physical_model !== 'isotropic_linear'
    ) {
      errors.push(
        `DFX_UNSUPPORTED_MATERIAL_MODEL: Structural material "${safeComment(material.name)}" must be isotropic linear elastic.`,
      );
    }
    const youngModulus = material.parameter_set.young_modulus.value;
    const poissonRatio = material.parameter_set.poisson_ratio.value;
    if (
      isUnresolvedStatus(material.parameter_set.young_modulus.status)
      || isUnresolvedStatus(material.parameter_set.poisson_ratio.status)
    ) {
      errors.push(
        `DFX_UNRESOLVED_MATERIAL_PROPERTY: Material "${safeComment(material.name)}" has unresolved elastic properties.`,
      );
    }
    if (!isPositiveFinite(youngModulus)) {
      errors.push(
        `DFX_INVALID_YOUNG_MODULUS: Material "${safeComment(material.name)}" must have a finite Young's modulus greater than zero.`,
      );
    }
    if (!isFiniteNumber(poissonRatio) || poissonRatio <= -1 || poissonRatio >= 0.5) {
      errors.push(
        `DFX_INVALID_POISSON_RATIO: Material "${safeComment(material.name)}" must satisfy -1 < poisson_ratio < 0.5.`,
      );
    }
  } else {
    if (material.class === 'fluid_newtonian') {
      errors.push(
        `DFX_UNSUPPORTED_MATERIAL_MODEL: Thermal material "${safeComment(material.name)}" cannot use a fluid-only material class.`,
      );
    }
    const conductivity = material.parameter_set.thermal_conductivity.value;
    if (isUnresolvedStatus(material.parameter_set.thermal_conductivity.status)) {
      errors.push(
        `DFX_UNRESOLVED_MATERIAL_PROPERTY: Material "${safeComment(material.name)}" has unresolved thermal conductivity.`,
      );
    }
    if (!isPositiveFinite(conductivity)) {
      errors.push(
        `DFX_INVALID_THERMAL_CONDUCTIVITY: Material "${safeComment(material.name)}" must have finite thermal conductivity greater than zero.`,
      );
    }
  }

  for (const [label, parameter] of [
    ['density', material.parameter_set.density],
    ['specific heat', material.parameter_set.specific_heat],
  ] as const) {
    if (parameter.value !== null && isUnresolvedStatus(parameter.status)) {
      errors.push(
        `DFX_UNRESOLVED_MATERIAL_PROPERTY: Material "${safeComment(material.name)}" ${label} is unresolved.`,
      );
    }
    if (parameter.value !== null && !isPositiveFinite(parameter.value)) {
      errors.push(
        `DFX_INVALID_MATERIAL_PROPERTY: Material "${safeComment(material.name)}" ${label} must be finite and greater than zero when provided.`,
      );
    }
  }
}

function validateTransform(body: GeometryBody, errors: string[]): void {
  const values = [
    ...body.transform.position,
    ...body.transform.rotation,
    ...body.transform.scale,
  ];
  if (!values.every(isFiniteNumber)) {
    errors.push(`DFX_INVALID_TRANSFORM: Body "${safeComment(body.name)}" has a non-finite transform component.`);
  }
  if (!body.transform.scale.every((value) => isFiniteNumber(value) && value > 0)) {
    errors.push(`DFX_INVALID_TRANSFORM: Body "${safeComment(body.name)}" scale components must be greater than zero.`);
  }
}

function validateMeshControls(
  ir: ProjectIR,
  analysisCase: AnalysisCase | undefined,
  errors: string[],
): void {
  const globalSize = ir.mesh_controls.global.global_size;
  if (globalSize !== null && !isPositiveFinite(globalSize)) {
    errors.push('DFX_INVALID_MESH_SIZE: Global mesh size must be finite and greater than zero.');
  } else if (globalSize === null) {
    errors.push('DFX_MESH_SIZE_REQUIRED: Strict DOLFINx export requires an explicit positive global mesh size; no default was inferred.');
  }
  if (![1, 2].includes(ir.mesh_controls.global.element_order)) {
    errors.push('DFX_INVALID_ELEMENT_ORDER: DOLFINx export supports mesh element order 1 or 2.');
  }
  if (ir.mesh_controls.global.algorithm_preference === 'structured') {
    errors.push('DFX_UNSUPPORTED_MESH_ALGORITHM: Structured 3D meshing is not implemented for DOLFINx primitives.');
  }
  if (ir.mesh_controls.global.recombine_preference !== 'none') {
    errors.push('DFX_UNSUPPORTED_RECOMBINATION: DOLFINx export currently supports tetrahedral meshes only.');
  }
  if (!isPositiveFinite(ir.mesh_controls.global.growth_rate)) {
    errors.push('DFX_INVALID_GROWTH_RATE: Mesh growth rate must be finite and greater than zero.');
  } else if (Math.abs(ir.mesh_controls.global.growth_rate - 1.2) > 1e-12) {
    errors.push('DFX_UNSUPPORTED_GROWTH_RATE: A custom mesh growth rate is not implemented.');
  }
  for (const control of ir.mesh_controls.local) {
    errors.push(
      `DFX_UNSUPPORTED_LOCAL_MESH_CONTROL: Local mesh control "${safeComment(control.id)}" (${control.control_type}) is not implemented.`,
    );
  }
  for (const [field, actual, supportedDefault] of [
    ['min_jacobian', ir.mesh_controls.quality_targets.min_jacobian, DEFAULT_MESH_QUALITY_TARGETS.min_jacobian],
    ['max_aspect_ratio', ir.mesh_controls.quality_targets.max_aspect_ratio, DEFAULT_MESH_QUALITY_TARGETS.max_aspect_ratio],
    ['min_skewness', ir.mesh_controls.quality_targets.min_skewness, DEFAULT_MESH_QUALITY_TARGETS.min_skewness],
    ['preferred_quality_level', ir.mesh_controls.quality_targets.preferred_quality_level, DEFAULT_MESH_QUALITY_TARGETS.preferred_quality_level],
  ] as const) {
    if (!Object.is(actual, supportedDefault)) {
      errors.push(
        `DFX_UNSUPPORTED_MESH_QUALITY_TARGET: mesh_controls.quality_targets.${field} is not consumed; use the supported default ${JSON.stringify(supportedDefault)}.`,
      );
    }
  }
  if (analysisCase?.mesh_policy_ref) {
    errors.push(
      `DFX_UNRESOLVED_MESH_POLICY: Analysis case references unsupported mesh policy "${safeComment(analysisCase.mesh_policy_ref)}".`,
    );
  }
}

function validateBoundaryConditions(
  ir: ProjectIR,
  body: GeometryBody,
  mode: PhysicsMode,
  boundaryConditions: BoundaryCondition[],
  requestedSurfaceSelectionIds: Set<string>,
  errors: string[],
): void {
  const supported = mode === 'structural'
    ? new Set(['fixed', 'prescribed_displacement'])
    : new Set(['temperature', 'heat_flux', 'convection', 'insulation']);

  for (const bc of boundaryConditions) {
    if (isUnresolvedStatus(bc.status)) {
      errors.push(`DFX_UNRESOLVED_BC: Boundary condition "${safeComment(bc.name)}" has status ${bc.status}.`);
    }
    if (!supported.has(bc.bc_type)) {
      errors.push(
        `DFX_UNSUPPORTED_BC: Boundary condition "${safeComment(bc.name)}" uses unsupported type "${bc.bc_type}" for ${mode}.`,
      );
      continue;
    }
    if (bc.temporal_profile !== 'constant') {
      errors.push(
        `DFX_UNSUPPORTED_TEMPORAL_PROFILE: Boundary condition "${safeComment(bc.name)}" must use a constant profile.`,
      );
    }
    if (bc.coordinate_system !== 'global') {
      errors.push(
        `DFX_UNSUPPORTED_COORDINATE_SYSTEM: Boundary condition "${safeComment(bc.name)}" must use the global coordinate system.`,
      );
    }
    validateSurfaceTarget(ir, body, bc.target_named_selection_id, `boundary condition "${safeComment(bc.name)}"`, errors);
    requestedSurfaceSelectionIds.add(bc.target_named_selection_id);

    if (mode === 'structural') {
      validateStructuralDofs(bc, errors);
    } else if (bc.bc_type === 'temperature' || bc.bc_type === 'heat_flux') {
      if (!isFiniteNumber(bc.values.scalar)) {
        errors.push(
          `DFX_INVALID_BC_VALUE: Boundary condition "${safeComment(bc.name)}" requires a finite scalar value.`,
        );
      }
    } else if (bc.bc_type === 'convection') {
      const coefficient = convectionCoefficient(bc);
      const ambientTemperature = convectionAmbientTemperature(bc);
      if (!isPositiveFinite(coefficient)) {
        errors.push(
          `DFX_INVALID_CONVECTION: Boundary condition "${safeComment(bc.name)}" requires heat_transfer_coefficient > 0 (legacy: values.scalar).`,
        );
      }
      if (!isFiniteNumber(ambientTemperature)) {
        errors.push(
          `DFX_INVALID_CONVECTION: Boundary condition "${safeComment(bc.name)}" requires ambient_temperature (legacy: values.vector[0]).`,
        );
      }
    }
  }
}

function validateLoads(
  ir: ProjectIR,
  body: GeometryBody,
  shape: ShapeDefinition,
  mode: PhysicsMode,
  loads: Load[],
  requestedSurfaceSelectionIds: Set<string>,
  errors: string[],
): void {
  const supported = mode === 'structural'
    ? new Set(['body_force', 'surface_traction', 'pressure'])
    : new Set(['heat_source', 'volumetric_heat']);

  for (const load of loads) {
    if (isUnresolvedStatus(load.status)) {
      errors.push(`DFX_UNRESOLVED_LOAD: Load "${safeComment(load.name)}" has status ${load.status}.`);
    }
    if (!supported.has(load.load_type)) {
      errors.push(
        `DFX_UNSUPPORTED_LOAD: Load "${safeComment(load.name)}" uses unsupported type "${load.load_type}" for ${mode}.`,
      );
      continue;
    }
    if (!isFiniteNumber(load.magnitude)) {
      errors.push(`DFX_INVALID_LOAD_VALUE: Load "${safeComment(load.name)}" magnitude must be finite.`);
    }
    if (load.distribution !== 'uniform') {
      errors.push(`DFX_UNSUPPORTED_DISTRIBUTION: Load "${safeComment(load.name)}" must be uniform.`);
    }
    if (load.temporal_profile !== 'constant') {
      errors.push(`DFX_UNSUPPORTED_TEMPORAL_PROFILE: Load "${safeComment(load.name)}" must be constant.`);
    }
    if (load.coordinate_system !== 'global') {
      errors.push(`DFX_UNSUPPORTED_COORDINATE_SYSTEM: Load "${safeComment(load.name)}" must use global coordinates.`);
    }

    if (load.load_type === 'body_force') {
      validateBodyTarget(ir, body, load.target_named_selection_id, `load "${safeComment(load.name)}"`, errors);
      if (load.application_mode !== 'per_volume' && load.application_mode !== 'total') {
        errors.push(`DFX_INVALID_APPLICATION_MODE: Body force "${safeComment(load.name)}" must be per_volume or total.`);
      }
      validateDirection(load, errors);
      if (load.application_mode === 'total' && !isPositiveFinite(transformedVolume(shape, body))) {
        errors.push(`DFX_INVALID_LOAD_TARGET: Total body force "${safeComment(load.name)}" has no valid volume.`);
      }
    } else if (load.load_type === 'surface_traction') {
      const faces = validateSurfaceTarget(ir, body, load.target_named_selection_id, `load "${safeComment(load.name)}"`, errors);
      requestedSurfaceSelectionIds.add(load.target_named_selection_id);
      if (load.application_mode !== 'per_area' && load.application_mode !== 'total') {
        errors.push(`DFX_INVALID_APPLICATION_MODE: Surface traction "${safeComment(load.name)}" must be per_area or total.`);
      }
      validateDirection(load, errors);
      if (load.application_mode === 'total' && faces && !isPositiveFinite(totalTransformedArea(shape, body, faces))) {
        errors.push(
          `DFX_UNRESOLVED_SURFACE_AREA: Total surface traction "${safeComment(load.name)}" requires faces with a determinable transformed area.`,
        );
      }
    } else if (load.load_type === 'pressure') {
      validateSurfaceTarget(ir, body, load.target_named_selection_id, `load "${safeComment(load.name)}"`, errors);
      requestedSurfaceSelectionIds.add(load.target_named_selection_id);
      if (load.application_mode !== 'per_area') {
        errors.push(`DFX_INVALID_APPLICATION_MODE: Pressure "${safeComment(load.name)}" must use per_area.`);
      }
    } else if (load.load_type === 'volumetric_heat') {
      validateBodyTarget(ir, body, load.target_named_selection_id, `load "${safeComment(load.name)}"`, errors);
      if (load.application_mode !== 'per_volume' && load.application_mode !== 'total') {
        errors.push(`DFX_INVALID_APPLICATION_MODE: Volumetric heat "${safeComment(load.name)}" must be per_volume or total.`);
      }
    } else {
      const target = ir.named_selections.find(
        (selection) => selection.id === load.target_named_selection_id,
      );
      if (target?.entity_type === 'face' && target.target_dimension === 2) {
        const faces = validateSurfaceTarget(ir, body, target.id, `load "${safeComment(load.name)}"`, errors);
        requestedSurfaceSelectionIds.add(target.id);
        if (load.application_mode !== 'per_area' && load.application_mode !== 'total') {
          errors.push(`DFX_INVALID_APPLICATION_MODE: Surface heat source "${safeComment(load.name)}" must be per_area or total.`);
        }
        if (load.application_mode === 'total' && faces && !isPositiveFinite(totalTransformedArea(shape, body, faces))) {
          errors.push(
            `DFX_UNRESOLVED_SURFACE_AREA: Total heat source "${safeComment(load.name)}" requires determinable face area.`,
          );
        }
      } else {
        validateBodyTarget(ir, body, load.target_named_selection_id, `load "${safeComment(load.name)}"`, errors);
        if (load.application_mode !== 'per_volume' && load.application_mode !== 'total') {
          errors.push(`DFX_INVALID_APPLICATION_MODE: Volumetric heat source "${safeComment(load.name)}" must be per_volume or total.`);
        }
      }
    }
  }
}

function validateWellPosedness(
  ir: ProjectIR,
  mode: PhysicsMode,
  boundaryConditions: BoundaryCondition[],
  errors: string[],
): void {
  if (mode === 'thermal') {
    if (!boundaryConditions.some((bc) => bc.bc_type === 'temperature' || bc.bc_type === 'convection')) {
      errors.push(
        'DFX_THERMAL_NULLSPACE: Steady thermal analysis requires at least one temperature or convection boundary condition.',
      );
    }
    return;
  }

  const hasSufficientSurfaceConstraint = boundaryConditions.some((bc) => {
    const constrainedComponents = new Set(structuralDofValues(bc).map(({ component }) => component));
    if ([0, 1, 2].some((component) => !constrainedComponents.has(component))) return false;
    const selection = ir.named_selections.find((item) => item.id === bc.target_named_selection_id);
    return selection?.target_dimension === 2
      && selection.member_refs.some((memberRef) => ir.geometry.faces.some((face) => face.id === memberRef));
  });
  if (!hasSufficientSurfaceConstraint) {
    errors.push(
      'DFX_RIGID_BODY_MODES: Strict export requires one resolved surface constraint that fixes all three displacement components; general 3-2-1 constraint-rank analysis is not implemented.',
    );
  }
}

function validateBoundaryConflicts(
  mode: PhysicsMode,
  boundaryConditions: BoundaryCondition[],
  tagBySelectionId: Map<string, number>,
  errors: string[],
): void {
  if (mode === 'thermal') {
    const firstByTag = new Map<number, BoundaryCondition>();
    for (const bc of boundaryConditions) {
      const tag = tagBySelectionId.get(bc.target_named_selection_id);
      if (tag === undefined) continue;
      const previous = firstByTag.get(tag);
      if (previous) {
        errors.push(
          `DFX_CONFLICTING_THERMAL_BC: "${safeComment(previous.name)}" and "${safeComment(bc.name)}" target the same Physical Surface tag ${tag}.`,
        );
      } else {
        firstByTag.set(tag, bc);
      }
    }
    return;
  }

  const constrainedValues = new Map<string, { value: number; bc: BoundaryCondition }>();
  for (const bc of boundaryConditions) {
    const tag = tagBySelectionId.get(bc.target_named_selection_id);
    if (tag === undefined) continue;
    for (const dof of structuralDofValues(bc)) {
      const key = `${tag}:${dof.component}`;
      const previous = constrainedValues.get(key);
      if (previous && Math.abs(previous.value - dof.value) > 1e-12) {
        errors.push(
          `DFX_CONFLICTING_DISPLACEMENT_BC: "${safeComment(previous.bc.name)}" and "${safeComment(bc.name)}" prescribe different values on tag ${tag}, component ${dof.component}.`,
        );
      } else if (!previous) {
        constrainedValues.set(key, { value: dof.value, bc });
      }
    }
  }
}

function validateStructuralDofs(bc: BoundaryCondition, errors: string[]): void {
  if (bc.bc_type === 'prescribed_displacement') {
    const hasVector = bc.values.vector?.every(isFiniteNumber) ?? false;
    if (!hasVector && !isFiniteNumber(bc.values.scalar)) {
      errors.push(
        `DFX_INVALID_BC_VALUE: Prescribed displacement "${safeComment(bc.name)}" requires a finite values.vector or scalar.`,
      );
    }
  }

  const dofMap = bc.values.dof_map;
  if (dofMap) {
    for (const rotationalDof of ['rx', 'ry', 'rz'] as const) {
      if (dofMap[rotationalDof] !== 'free') {
        errors.push(
          `DFX_UNSUPPORTED_ROTATIONAL_DOF: Solid boundary condition "${safeComment(bc.name)}" cannot constrain ${rotationalDof}.`,
        );
      }
    }
    if (bc.bc_type === 'fixed' && ['ux', 'uy', 'uz'].some((key) => dofMap[key as 'ux'] === 'prescribed')) {
      errors.push(
        `DFX_INVALID_DOF_MAP: Fixed boundary condition "${safeComment(bc.name)}" cannot contain prescribed DOF states.`,
      );
    }
  }
  if (structuralDofValues(bc).length === 0) {
    errors.push(`DFX_EMPTY_BC: Boundary condition "${safeComment(bc.name)}" constrains no translational DOF.`);
  }
}

function validateDirection(load: Load, errors: string[]): void {
  if (!load.direction.every(isFiniteNumber) || vectorNorm(load.direction) <= 0) {
    errors.push(`DFX_INVALID_LOAD_DIRECTION: Load "${safeComment(load.name)}" requires a finite, non-zero direction.`);
  }
}

function validateSurfaceTarget(
  ir: ProjectIR,
  body: GeometryBody,
  selectionId: string,
  usage: string,
  errors: string[],
): GeometryFace[] | undefined {
  const selection = ir.named_selections.find((candidate) => candidate.id === selectionId);
  if (!selection) {
    errors.push(`DFX_SELECTION_NOT_FOUND: ${usage} references missing named selection "${safeComment(selectionId)}".`);
    return undefined;
  }
  if (selection.status !== 'active') {
    errors.push(`DFX_SELECTION_UNRESOLVED: ${usage} targets selection "${safeComment(selection.name)}" with status ${selection.status}.`);
    return undefined;
  }
  if (selection.entity_type !== 'face' || selection.target_dimension !== 2) {
    errors.push(`DFX_INVALID_SELECTION_DIMENSION: ${usage} requires a face selection (dimension 2).`);
    return undefined;
  }
  if (selection.member_refs.length === 0) {
    errors.push(`DFX_EMPTY_SELECTION: ${usage} targets empty selection "${safeComment(selection.name)}".`);
    return undefined;
  }
  if (new Set(selection.member_refs).size !== selection.member_refs.length) {
    errors.push(`DFX_DUPLICATE_FACE_REFERENCE: Selection "${safeComment(selection.name)}" contains duplicate face references.`);
    return undefined;
  }

  const faces: GeometryFace[] = [];
  for (const faceId of selection.member_refs) {
    const face = ir.geometry.faces.find((candidate) => candidate.id === faceId);
    if (!face) {
      errors.push(`DFX_FACE_NOT_FOUND: Selection "${safeComment(selection.name)}" references missing face "${safeComment(faceId)}".`);
    } else if (face.body_id !== body.id) {
      errors.push(`DFX_FOREIGN_FACE: Selection "${safeComment(selection.name)}" contains a face from another body.`);
    } else {
      faces.push(face);
    }
  }
  return faces.length === selection.member_refs.length ? faces : undefined;
}

function validateBodyTarget(
  ir: ProjectIR,
  body: GeometryBody,
  selectionId: string,
  usage: string,
  errors: string[],
): NamedSelection | undefined {
  const selection = ir.named_selections.find((candidate) => candidate.id === selectionId);
  if (!selection) {
    errors.push(`DFX_SELECTION_NOT_FOUND: ${usage} references missing named selection "${safeComment(selectionId)}".`);
    return undefined;
  }
  if (
    selection.status !== 'active'
    || selection.entity_type !== 'body'
    || selection.target_dimension !== 3
    || selection.member_refs.length !== 1
    || selection.member_refs[0] !== body.id
  ) {
    errors.push(`DFX_INVALID_BODY_SELECTION: ${usage} requires an active body selection containing only "${safeComment(body.name)}".`);
    return undefined;
  }
  return selection;
}

function resolveSurfaceSelections(
  ir: ProjectIR,
  body: GeometryBody,
  shape: ShapeDefinition,
  requestedIds: Set<string>,
  errors: string[],
): {
  selections: Map<string, ResolvedSurfaceSelection>;
  tagBySelectionId: Map<string, number>;
  tagMap: Record<string, number>;
} {
  const selections = new Map<string, ResolvedSurfaceSelection>();
  const tagBySelectionId = new Map<string, number>();
  const tagMap: Record<string, number> = {};
  const canonicalByMembers = new Map<string, ResolvedSurfaceSelection>();
  const memberSetKeyByFace = new Map<string, string>();
  let nextTag = 101;

  for (const selection of ir.named_selections) {
    if (!requestedIds.has(selection.id)) continue;
    const faces = validateSurfaceTarget(
      ir,
      body,
      selection.id,
      `named selection "${safeComment(selection.name)}"`,
      errors,
    );
    if (!faces) continue;

    for (const face of faces) {
      if (!localFaceProbe(shape, face)) {
        errors.push(
          `DFX_UNMAPPABLE_FACE: Face "${safeComment(face.name)}" (${safeComment(face.id)}) has no deterministic geometric mapping for ${shape.type}.`,
        );
      }
    }

    const key = [...new Set(faces.map((face) => face.id))].sort().join('|');
    const existing = canonicalByMembers.get(key);
    if (existing) {
      const resolved = { selection, faces, tag: existing.tag, canonical: false };
      selections.set(selection.id, resolved);
      tagBySelectionId.set(selection.id, existing.tag);
      tagMap[selection.id] = existing.tag;
      continue;
    }

    for (const face of faces) {
      const previousKey = memberSetKeyByFace.get(face.id);
      if (previousKey && previousKey !== key) {
        errors.push(
          `DFX_OVERLAPPING_SURFACE_GROUPS: Face "${safeComment(face.name)}" belongs to overlapping, non-identical boundary selections. DOLFINx MeshTags require disjoint groups.`,
        );
      }
      memberSetKeyByFace.set(face.id, key);
    }

    const resolved = { selection, faces, tag: nextTag++, canonical: true };
    canonicalByMembers.set(key, resolved);
    selections.set(selection.id, resolved);
    tagBySelectionId.set(selection.id, resolved.tag);
    tagMap[selection.id] = resolved.tag;
  }

  for (const requestedId of requestedIds) {
    if (!selections.has(requestedId)) {
      errors.push(`DFX_UNRESOLVED_SURFACE_TAG: Named selection "${safeComment(requestedId)}" could not be mapped to a Physical Surface.`);
    }
  }

  return { selections, tagBySelectionId, tagMap };
}

function resolveShapeDefinition(
  body: GeometryBody,
  shapeType: SupportedShapeType,
  errors: string[],
): ShapeDefinition | undefined {
  const value = (key: string): number | undefined => {
    const raw = body.metadata[key];
    if (!isPositiveFinite(raw)) {
      errors.push(
        `DFX_INVALID_GEOMETRY_PARAMETER: ${shapeType}.${key} must be finite and greater than zero.`,
      );
      return undefined;
    }
    return raw;
  };

  if (shapeType === 'box') {
    const width = value('width');
    const height = value('height');
    const depth = value('depth');
    return width && height && depth ? { type: 'box', width, height, depth } : undefined;
  }
  if (shapeType === 'plate') {
    const width = value('width');
    const thickness = value('thickness');
    const depth = value('depth');
    return width && thickness && depth ? { type: 'plate', width, thickness, depth } : undefined;
  }
  if (shapeType === 'cylinder') {
    const radius = value('radius');
    const height = value('height');
    return radius && height ? { type: 'cylinder', radius, height } : undefined;
  }

  const width = value('width');
  const thickness = value('thickness');
  const depth = value('depth');
  const holeRadius = value('holeRadius');
  if (!width || !thickness || !depth || !holeRadius) return undefined;
  if (holeRadius >= Math.min(width, depth) / 2) {
    errors.push('DFX_INVALID_GEOMETRY_PARAMETER: plateWithHole.holeRadius must lie inside the plate boundary.');
    return undefined;
  }
  return { type: 'plateWithHole', width, thickness, depth, holeRadius };
}

function buildGeoFile(
  ir: ProjectIR,
  body: GeometryBody,
  shape: ShapeDefinition,
  selections: Map<string, ResolvedSurfaceSelection>,
): string {
  const lines = [
    '// Gmsh .geo file generated by FEM Modeler',
    `// Project: ${safeComment(ir.meta.project_name)}`,
    '// Requires Gmsh >= 4.15 (geometric Closest surface selection).',
    '',
    'SetFactory("OpenCASCADE");',
    'Geometry.OCCBoundsUseStl = 1;',
    '',
  ];
  let volumeExpression = '1';

  if (shape.type === 'box') {
    lines.push(`Box(1) = {${number(-shape.width / 2)}, ${number(-shape.height / 2)}, ${number(-shape.depth / 2)}, ${number(shape.width)}, ${number(shape.height)}, ${number(shape.depth)}};`);
  } else if (shape.type === 'plate') {
    lines.push(`Box(1) = {${number(-shape.width / 2)}, ${number(-shape.thickness / 2)}, ${number(-shape.depth / 2)}, ${number(shape.width)}, ${number(shape.thickness)}, ${number(shape.depth)}};`);
  } else if (shape.type === 'cylinder') {
    lines.push(`Cylinder(1) = {0, ${number(-shape.height / 2)}, 0, 0, ${number(shape.height)}, 0, ${number(shape.radius)}};`);
  } else {
    lines.push(`Box(1) = {${number(-shape.width / 2)}, ${number(-shape.thickness / 2)}, ${number(-shape.depth / 2)}, ${number(shape.width)}, ${number(shape.thickness)}, ${number(shape.depth)}};`);
    lines.push(`Cylinder(2) = {0, ${number(-shape.thickness / 2)}, 0, 0, ${number(shape.thickness)}, 0, ${number(shape.holeRadius)}};`);
    lines.push('main_volume() = BooleanDifference { Volume{1}; Delete; }{ Volume{2}; Delete; };');
    volumeExpression = 'main_volume()';
  }

  if (!isIdentityTransform(body.transform)) {
    appendGmshTransform(lines, volumeExpression, body.transform);
  }

  const meshSize = ir.mesh_controls.global.global_size ?? characteristicLength(shape) / 10;
  lines.push('', `Mesh.MeshSizeMax = ${number(meshSize)};`);
  lines.push(`Mesh.ElementOrder = ${ir.mesh_controls.global.element_order};`);
  lines.push(`Mesh.Algorithm3D = ${gmshAlgorithm3D(ir.mesh_controls.global.algorithm_preference)};`);
  if (ir.mesh_controls.global.curvature_based_refinement) {
    lines.push('Mesh.MeshSizeFromCurvature = 20;');
  }
  lines.push('', '// Stable, explicit physical tag for the volume');
  lines.push(`Physical Volume("domain", 1) = {${volumeExpression}};`);

  const canonicalSelections = [...selections.values()].filter((selection) => selection.canonical);
  if (canonicalSelections.length > 0) {
    lines.push('', '// Surface tags are resolved geometrically; no OCC/Gmsh tag ordering is assumed.');
    lines.push(`domain_boundary() = Boundary { Volume{${volumeExpression}}; };`);
    const variableByFaceId = new Map<string, string>();
    let faceIndex = 0;
    for (const selection of canonicalSelections) {
      for (const face of selection.faces) {
        if (variableByFaceId.has(face.id)) continue;
        const probe = localFaceProbe(shape, face);
        if (!probe) continue;
        const transformedProbe = transformPoint(probe, body.transform);
        const variable = `resolved_face_${faceIndex++}`;
        variableByFaceId.set(face.id, variable);
        lines.push(`${variable}() = Closest {${transformedProbe.map(number).join(', ')}} { Surface{domain_boundary()}; };`);
      }
    }
    for (const selection of canonicalSelections) {
      const variables = selection.faces
        .map((face) => variableByFaceId.get(face.id))
        .filter((variable): variable is string => variable !== undefined)
        .map((variable) => `${variable}(0)`);
      lines.push(
        `Physical Surface("selection_${selection.tag}", ${selection.tag}) = {${variables.join(', ')}}; // ${safeComment(selection.selection.name)}`,
      );
    }
  }

  return lines.join('\n');
}

function appendGmshTransform(
  lines: string[],
  volumeExpression: string,
  transform: GeometryBody['transform'],
): void {
  const [sx, sy, sz] = transform.scale;
  const [rx, ry, rz] = toRadiansTuple(transform.rotation);
  const [tx, ty, tz] = transform.position;

  lines.push('', '// Apply body transform');
  if (Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9 || Math.abs(sz - 1) > 1e-9) {
    lines.push(`Dilate {{0, 0, 0}, {${number(sx)}, ${number(sy)}, ${number(sz)}}} { Volume{${volumeExpression}}; }`);
  }
  // Reverse order (Z, Y, X) matches the viewer's intrinsic THREE.js XYZ Euler transform.
  if (Math.abs(rz) > 1e-9) {
    lines.push(`Rotate {{0, 0, 1}, {0, 0, 0}, ${number(rz)}} { Volume{${volumeExpression}}; }`);
  }
  if (Math.abs(ry) > 1e-9) {
    lines.push(`Rotate {{0, 1, 0}, {0, 0, 0}, ${number(ry)}} { Volume{${volumeExpression}}; }`);
  }
  if (Math.abs(rx) > 1e-9) {
    lines.push(`Rotate {{1, 0, 0}, {0, 0, 0}, ${number(rx)}} { Volume{${volumeExpression}}; }`);
  }
  if (Math.abs(tx) > 1e-9 || Math.abs(ty) > 1e-9 || Math.abs(tz) > 1e-9) {
    lines.push(`Translate {${number(tx)}, ${number(ty)}, ${number(tz)}} { Volume{${volumeExpression}}; }`);
  }
}

function buildSolverScript(context: ExportContext, exportTime: string): string {
  const pythonAnalysisCaseId = context.analysisCase === undefined
    ? 'None'
    : JSON.stringify(context.analysisCase.id);
  const lines = [
    '"""DOLFINx 0.10 script generated by FEM Modeler."""',
    `# Project: ${safeComment(context.ir.meta.project_name)}`,
    `# Generated: ${exportTime}`,
    '',
    'import numpy as np',
    'import json',
    'from mpi4py import MPI',
    'from dolfinx import default_scalar_type, fem, io',
    'from dolfinx.fem.petsc import LinearProblem',
    'from dolfinx.io import gmsh as gmshio',
    'import ufl',
    '',
    '# Generate first: gmsh -3 model.geo -format msh4 -o model.msh',
    'mesh_data = gmshio.read_from_msh("model.msh", MPI.COMM_WORLD, rank=0, gdim=3)',
    'domain = mesh_data.mesh',
    'cell_tags = mesh_data.cell_tags',
    'facet_tags = mesh_data.facet_tags',
    'if facet_tags is None:',
    '    raise RuntimeError("model.msh has no facet tags; verify Physical Surface definitions")',
    ...requiredFacetTagChecks(context.tagBySelectionId),
    'dx = ufl.Measure("dx", domain=domain, subdomain_data=cell_tags)',
    'ds = ufl.Measure("ds", domain=domain, subdomain_data=facet_tags)',
    '',
  ];

  if (context.mode === 'thermal') {
    appendThermalProblem(lines, context);
  } else {
    appendStructuralProblem(lines, context);
  }

  lines.push(
    '',
    'problem = LinearProblem(',
    '    a,',
    '    L,',
    '    bcs=bcs,',
    '    petsc_options_prefix="fem_modeler_",',
    '    petsc_options={',
    '        "ksp_type": "preonly",',
    '        "pc_type": "lu",',
    '        "ksp_error_if_not_converged": True,',
    '    },',
    ')',
    'uh = problem.solve()',
    'converged_reason = int(problem.solver.getConvergedReason())',
    'iteration_count = int(problem.solver.getIterationNumber())',
    'if converged_reason <= 0:',
    '    raise RuntimeError(f"PETSc solve did not converge: reason={converged_reason}, iterations={iteration_count}")',
    'local_values = np.asarray(uh.x.array, dtype=float)',
    'local_minimum = float(np.min(local_values)) if local_values.size else float("inf")',
    'local_maximum = float(np.max(local_values)) if local_values.size else float("-inf")',
    'global_minimum = domain.comm.allreduce(local_minimum, op=MPI.MIN)',
    'global_maximum = domain.comm.allreduce(local_maximum, op=MPI.MAX)',
    '',
    'with io.XDMFFile(MPI.COMM_WORLD, "result.xdmf", "w") as result_file:',
    '    result_file.write_mesh(domain)',
    '    result_file.write_function(uh)',
    'if domain.comm.rank == 0:',
    '    with open("result_manifest.json", "w", encoding="utf-8") as manifest_file:',
    `        json.dump({"export_target": "DOLFINx", "analysis_case_id": ${pythonAnalysisCaseId}, "model_revision": ${context.ir.validation.model_revision}, "solver": "DOLFINx", "mode": "${context.mode}", "converged_reason": converged_reason, "iteration_count": iteration_count, "solution_min": global_minimum, "solution_max": global_maximum}, manifest_file, indent=2)`,
    `print("${context.mode === 'thermal' ? 'Steady heat' : 'Linear elasticity'} analysis complete.")`,
  );

  return lines.join('\n');
}

function requiredFacetTagChecks(tagBySelectionId: Map<string, number>): string[] {
  const tags = [...new Set(tagBySelectionId.values())].sort((left, right) => left - right);
  if (tags.length === 0) return [];
  return [
    `required_facet_tags = [${tags.join(', ')}]`,
    'for required_tag in required_facet_tags:',
    '    local_facet_count = int(facet_tags.find(required_tag).size)',
    '    global_facet_count = domain.comm.allreduce(local_facet_count, op=MPI.SUM)',
    '    if global_facet_count == 0:',
    '        raise RuntimeError(f"Physical Surface tag {required_tag} is empty")',
  ];
}

function appendStructuralProblem(lines: string[], context: ExportContext): void {
  const youngModulus = context.material.parameter_set.young_modulus.value as number;
  const poissonRatio = context.material.parameter_set.poisson_ratio.value as number;
  lines.push(
    '# --- Linear elasticity ---',
    `V = fem.functionspace(domain, ("Lagrange", ${context.ir.mesh_controls.global.element_order}, (domain.geometry.dim,)))`,
    `E = fem.Constant(domain, default_scalar_type(${number(youngModulus)}))`,
    `nu = fem.Constant(domain, default_scalar_type(${number(poissonRatio)}))`,
    'mu = E / (2 * (1 + nu))',
    'lmbda = E * nu / ((1 + nu) * (1 - 2 * nu))',
    '',
    'def epsilon(displacement):',
    '    return ufl.sym(ufl.grad(displacement))',
    '',
    'def sigma(displacement):',
    '    return lmbda * ufl.nabla_div(displacement) * ufl.Identity(domain.geometry.dim) + 2 * mu * epsilon(displacement)',
    '',
    'u = ufl.TrialFunction(V)',
    'v = ufl.TestFunction(V)',
    'a = ufl.inner(sigma(u), epsilon(v)) * dx',
    'zero_body_force = fem.Constant(domain, np.zeros(domain.geometry.dim, dtype=default_scalar_type))',
    'L = ufl.inner(zero_body_force, v) * dx',
    'n = ufl.FacetNormal(domain)',
  );

  for (let index = 0; index < context.loads.length; index++) {
    const load = context.loads[index];
    lines.push('', `# Load ${index + 1}: ${safeComment(load.name)} (${load.load_type})`);
    if (load.load_type === 'body_force') {
      const scale = load.application_mode === 'total'
        ? load.magnitude / transformedVolume(context.shape, context.body)
        : load.magnitude;
      const direction = normalizedDirection(load.direction);
      const components = direction.map((value) => value * scale);
      lines.push(`body_force_${index} = fem.Constant(domain, np.array([${components.map(number).join(', ')}], dtype=default_scalar_type))`);
      lines.push(`L += ufl.inner(body_force_${index}, v) * dx`);
    } else if (load.load_type === 'surface_traction') {
      const selection = context.surfaceSelections.get(load.target_named_selection_id)!;
      const scale = load.application_mode === 'total'
        ? load.magnitude / totalTransformedArea(context.shape, context.body, selection.faces)
        : load.magnitude;
      const components = normalizedDirection(load.direction).map((value) => value * scale);
      lines.push(`traction_${index} = fem.Constant(domain, np.array([${components.map(number).join(', ')}], dtype=default_scalar_type))`);
      lines.push(`L += ufl.inner(traction_${index}, v) * ds(${selection.tag})`);
    } else {
      const tag = context.tagBySelectionId.get(load.target_named_selection_id)!;
      lines.push(`pressure_${index} = fem.Constant(domain, default_scalar_type(${number(load.magnitude)}))`);
      lines.push(`L += ufl.inner(-pressure_${index} * n, v) * ds(${tag})`);
    }
  }

  appendStructuralBoundaryConditions(lines, context);
}

function appendStructuralBoundaryConditions(lines: string[], context: ExportContext): void {
  lines.push('', '# --- Essential boundary conditions ---', 'bcs = []', 'fdim = domain.topology.dim - 1');
  let generatedIndex = 0;
  for (let bcIndex = 0; bcIndex < context.boundaryConditions.length; bcIndex++) {
    const bc = context.boundaryConditions[bcIndex];
    const tag = context.tagBySelectionId.get(bc.target_named_selection_id)!;
    lines.push('', `# BC ${bcIndex + 1}: ${safeComment(bc.name)} (${bc.bc_type})`);
    lines.push(`facets_bc_${bcIndex} = facet_tags.find(${tag})`);
    for (const { component, value } of structuralDofValues(bc)) {
      lines.push(`dofs_bc_${generatedIndex} = fem.locate_dofs_topological(V.sub(${component}), fdim, facets_bc_${bcIndex})`);
      lines.push(`bc_${generatedIndex} = fem.dirichletbc(default_scalar_type(${number(value)}), dofs_bc_${generatedIndex}, V.sub(${component}))`);
      lines.push(`bcs.append(bc_${generatedIndex})`);
      generatedIndex++;
    }
  }
}

function appendThermalProblem(lines: string[], context: ExportContext): void {
  const conductivity = context.material.parameter_set.thermal_conductivity.value as number;
  lines.push(
    '# --- Steady-state heat conduction / scalar Poisson problem ---',
    `V = fem.functionspace(domain, ("Lagrange", ${context.ir.mesh_controls.global.element_order}))`,
    `k = fem.Constant(domain, default_scalar_type(${number(conductivity)}))`,
    'u = ufl.TrialFunction(V)',
    'v = ufl.TestFunction(V)',
    'a = k * ufl.inner(ufl.grad(u), ufl.grad(v)) * dx',
    'zero_source = fem.Constant(domain, default_scalar_type(0.0))',
    'L = zero_source * v * dx',
  );

  for (let index = 0; index < context.loads.length; index++) {
    const load = context.loads[index];
    lines.push('', `# Load ${index + 1}: ${safeComment(load.name)} (${load.load_type})`);
    const selection = context.ir.named_selections.find(
      (candidate) => candidate.id === load.target_named_selection_id,
    )!;
    if (load.load_type === 'volumetric_heat' || selection.target_dimension === 3) {
      const intensity = load.application_mode === 'total'
        ? load.magnitude / transformedVolume(context.shape, context.body)
        : load.magnitude;
      lines.push(`heat_source_${index} = fem.Constant(domain, default_scalar_type(${number(intensity)}))`);
      lines.push(`L += heat_source_${index} * v * dx`);
    } else {
      const surface = context.surfaceSelections.get(load.target_named_selection_id)!;
      const intensity = load.application_mode === 'total'
        ? load.magnitude / totalTransformedArea(context.shape, context.body, surface.faces)
        : load.magnitude;
      lines.push(`surface_heat_${index} = fem.Constant(domain, default_scalar_type(${number(intensity)}))`);
      lines.push(`L += surface_heat_${index} * v * ds(${surface.tag})`);
    }
  }

  for (let index = 0; index < context.boundaryConditions.length; index++) {
    const bc = context.boundaryConditions[index];
    const tag = context.tagBySelectionId.get(bc.target_named_selection_id)!;
    if (bc.bc_type === 'heat_flux') {
      // values.scalar is positive for outward heat flux q_n = -k grad(T) . n.
      lines.push('', `outward_flux_${index} = fem.Constant(domain, default_scalar_type(${number(bc.values.scalar as number)}))`);
      lines.push(`L += -outward_flux_${index} * v * ds(${tag})`);
    } else if (bc.bc_type === 'convection') {
      const h = convectionCoefficient(bc) as number;
      const ambient = convectionAmbientTemperature(bc) as number;
      lines.push('', `h_${index} = fem.Constant(domain, default_scalar_type(${number(h)}))`);
      lines.push(`ambient_temperature_${index} = fem.Constant(domain, default_scalar_type(${number(ambient)}))`);
      lines.push(`a += h_${index} * u * v * ds(${tag})`);
      lines.push(`L += h_${index} * ambient_temperature_${index} * v * ds(${tag})`);
    } else if (bc.bc_type === 'insulation') {
      lines.push('', `# ${safeComment(bc.name)}: zero outward flux is the natural boundary condition on tag ${tag}.`);
    }
  }

  appendThermalDirichletBoundaryConditions(lines, context);
}

function convectionCoefficient(bc: BoundaryCondition): number | undefined {
  return bc.values.heat_transfer_coefficient ?? bc.values.scalar;
}

function convectionAmbientTemperature(bc: BoundaryCondition): number | undefined {
  return bc.values.ambient_temperature ?? bc.values.vector?.[0];
}

function appendThermalDirichletBoundaryConditions(lines: string[], context: ExportContext): void {
  lines.push('', '# --- Essential boundary conditions ---', 'bcs = []', 'fdim = domain.topology.dim - 1');
  let generatedIndex = 0;
  for (let index = 0; index < context.boundaryConditions.length; index++) {
    const bc = context.boundaryConditions[index];
    if (bc.bc_type !== 'temperature') continue;
    const tag = context.tagBySelectionId.get(bc.target_named_selection_id)!;
    lines.push('', `# BC ${index + 1}: ${safeComment(bc.name)} (temperature)`);
    lines.push(`facets_bc_${generatedIndex} = facet_tags.find(${tag})`);
    lines.push(`dofs_bc_${generatedIndex} = fem.locate_dofs_topological(V, fdim, facets_bc_${generatedIndex})`);
    lines.push(`bc_${generatedIndex} = fem.dirichletbc(default_scalar_type(${number(bc.values.scalar as number)}), dofs_bc_${generatedIndex}, V)`);
    lines.push(`bcs.append(bc_${generatedIndex})`);
    generatedIndex++;
  }
}

function structuralDofValues(bc: BoundaryCondition): { component: number; value: number }[] {
  if (bc.bc_type !== 'fixed' && bc.bc_type !== 'prescribed_displacement') return [];
  const keys = ['ux', 'uy', 'uz'] as const;
  const dofMap = bc.values.dof_map;
  const scalar = bc.values.scalar ?? 0;
  const vector = bc.values.vector ?? [scalar, scalar, scalar];
  const values: { component: number; value: number }[] = [];

  for (let component = 0; component < keys.length; component++) {
    const state = dofMap?.[keys[component]];
    const constrained = dofMap ? state !== 'free' : true;
    if (!constrained) continue;
    const value = bc.bc_type === 'prescribed_displacement' && state !== 'fixed'
      ? vector[component]
      : 0;
    values.push({ component, value });
  }
  return values;
}

function localFaceProbe(shape: ShapeDefinition, face: GeometryFace): [number, number, number] | undefined {
  const axisFace = axisAlignedFace(face);
  if (!axisFace) return undefined;
  if (shape.type === 'cylinder') {
    return axisFace.axis === 1 ? [0, axisFace.sign * shape.height / 2, 0] : undefined;
  }

  const dimensions: [number, number, number] = shape.type === 'box'
    ? [shape.width, shape.height, shape.depth]
    : [shape.width, shape.thickness, shape.depth];
  const probe: [number, number, number] = [0, 0, 0];
  probe[axisFace.axis] = axisFace.sign * dimensions[axisFace.axis] / 2;
  if (shape.type === 'plateWithHole' && axisFace.axis === 1) {
    // The plate centre is a void; choose a point strictly between the hole and edge.
    probe[0] = (shape.holeRadius + shape.width / 2) / 2;
  }
  return probe;
}

function transformPoint(
  point: [number, number, number],
  transform: GeometryBody['transform'],
): [number, number, number] {
  let x = point[0] * transform.scale[0];
  let y = point[1] * transform.scale[1];
  let z = point[2] * transform.scale[2];
  const [rx, ry, rz] = toRadiansTuple(transform.rotation);

  [x, y] = [Math.cos(rz) * x - Math.sin(rz) * y, Math.sin(rz) * x + Math.cos(rz) * y];
  [x, z] = [Math.cos(ry) * x + Math.sin(ry) * z, -Math.sin(ry) * x + Math.cos(ry) * z];
  [y, z] = [Math.cos(rx) * y - Math.sin(rx) * z, Math.sin(rx) * y + Math.cos(rx) * z];

  return [
    x + transform.position[0],
    y + transform.position[1],
    z + transform.position[2],
  ];
}

function transformedVolume(shape: ShapeDefinition, body: GeometryBody): number {
  let localVolume: number;
  if (shape.type === 'box') localVolume = shape.width * shape.height * shape.depth;
  else if (shape.type === 'plate') localVolume = shape.width * shape.thickness * shape.depth;
  else if (shape.type === 'cylinder') localVolume = Math.PI * shape.radius ** 2 * shape.height;
  else localVolume = (shape.width * shape.depth - Math.PI * shape.holeRadius ** 2) * shape.thickness;
  return localVolume * Math.abs(body.transform.scale[0] * body.transform.scale[1] * body.transform.scale[2]);
}

function totalTransformedArea(
  shape: ShapeDefinition,
  body: GeometryBody,
  faces: GeometryFace[],
): number {
  return faces.reduce((sum, face) => sum + transformedFaceArea(shape, body, face), 0);
}

function transformedFaceArea(shape: ShapeDefinition, body: GeometryBody, face: GeometryFace): number {
  const axisFace = axisAlignedFace(face);
  const localArea = localFaceArea(shape, axisFace?.axis);
  if (!isPositiveFinite(localArea) || !axisFace) return Number.NaN;
  const [sx, sy, sz] = body.transform.scale;
  const determinant = Math.abs(sx * sy * sz);
  const inverseScaledNormalNorm = Math.sqrt(
    (axisFace.normal[0] / sx) ** 2
    + (axisFace.normal[1] / sy) ** 2
    + (axisFace.normal[2] / sz) ** 2,
  );
  return localArea * determinant * inverseScaledNormalNorm;
}

function localFaceArea(shape: ShapeDefinition, axis: 0 | 1 | 2 | undefined): number {
  if (axis === undefined) return Number.NaN;
  if (shape.type === 'box') return boxFaceArea(axis, shape.width, shape.height, shape.depth);
  if (shape.type === 'plate') return boxFaceArea(axis, shape.width, shape.thickness, shape.depth);
  if (shape.type === 'cylinder') {
    return axis === 1 ? Math.PI * shape.radius ** 2 : Number.NaN;
  }
  if (axis === 0) return shape.depth * shape.thickness;
  if (axis === 1) return shape.width * shape.depth - Math.PI * shape.holeRadius ** 2;
  return shape.width * shape.thickness;
}

function boxFaceArea(axis: 0 | 1 | 2, width: number, height: number, depth: number): number {
  if (axis === 0) return height * depth;
  if (axis === 1) return width * depth;
  return width * height;
}

function axisAlignedFace(face: GeometryFace): {
  axis: 0 | 1 | 2;
  sign: -1 | 1;
  normal: [number, number, number];
} | undefined {
  if (!face.normal || !face.normal.every(isFiniteNumber)) return undefined;
  const norm = vectorNorm(face.normal);
  if (norm <= 0) return undefined;
  const normal: [number, number, number] = [
    face.normal[0] / norm,
    face.normal[1] / norm,
    face.normal[2] / norm,
  ];
  const axis = normal.findIndex((component) => Math.abs(component) > 1 - 1e-9);
  if (axis < 0 || normal.some((component, index) => index !== axis && Math.abs(component) > 1e-9)) {
    return undefined;
  }
  return {
    axis: axis as 0 | 1 | 2,
    sign: normal[axis] < 0 ? -1 : 1,
    normal,
  };
}

function characteristicLength(shape: ShapeDefinition): number {
  if (shape.type === 'box') return Math.min(shape.width, shape.height, shape.depth);
  if (shape.type === 'plate') return Math.min(shape.width, shape.thickness, shape.depth);
  if (shape.type === 'cylinder') return Math.min(2 * shape.radius, shape.height);
  return Math.min(shape.width, shape.thickness, shape.depth, shape.holeRadius);
}

function gmshAlgorithm3D(
  preference: ProjectIR['mesh_controls']['global']['algorithm_preference'],
): number {
  return preference === 'frontal' ? 4 : 1;
}

function normalizedDirection(direction: [number, number, number]): [number, number, number] {
  const norm = vectorNorm(direction);
  return [direction[0] / norm, direction[1] / norm, direction[2] / norm];
}

function vectorNorm(vector: [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function buildManifest(
  context: ExportContext,
  exportTime: string,
  errors: string[],
  warnings: string[],
): string {
  const consumedIds = [
    context.body.id,
    context.material.id,
    context.materialAssignmentId,
    context.materialSelectionId,
    'mesh_controls.global',
    ...(context.analysisCase ? [context.analysisCase.id] : []),
    ...context.boundaryConditions.map((bc) => bc.id),
    ...context.loads.map((load) => load.id),
    ...context.boundaryConditions.map((bc) => bc.target_named_selection_id),
    ...context.loads.map((load) => load.target_named_selection_id),
    ...context.surfaceSelections.keys(),
    ...[...context.surfaceSelections.values()].flatMap((selection) =>
      selection.faces.map((face) => face.id)),
    ...(context.analysisCase?.result_requests.map(
      (request) => `result_request:${context.analysisCase!.id}:${request}`,
    ) ?? []),
  ];
  const consumedIdSet = new Set(consumedIds);
  const scopedIds = [
    ...context.ir.geometry.bodies.map((body) => body.id),
    ...context.ir.geometry.faces.map((face) => face.id),
    ...context.ir.geometry.edges.map((edge) => edge.id),
    ...context.ir.geometry.vertices.map((vertex) => vertex.id),
    ...context.ir.named_selections.map((selection) => selection.id),
    ...context.ir.materials.map((material) => material.id),
    ...context.ir.material_assignments.map((assignment) => assignment.id),
    ...context.ir.sections.map((section) => section.id),
    ...context.ir.section_assignments.map((assignment) => assignment.id),
    ...context.ir.mesh_controls.local.map((control) => control.id),
    ...context.ir.boundary_conditions.map((bc) => bc.id),
    ...context.ir.loads.map((load) => load.id),
    ...context.ir.initial_conditions.map((condition) => condition.id),
    ...context.ir.analysis_cases.map((analysisCase) => analysisCase.id),
    ...context.ir.analysis_cases.flatMap((analysisCase) => analysisCase.result_requests.map(
      (request) => `result_request:${analysisCase.id}:${request}`,
    )),
  ];
  const ignoredIds = [...new Set(scopedIds)].filter((id) => !consumedIdSet.has(id));
  return JSON.stringify({
    export_target: 'DOLFINx',
    dolfinx_api_version: '0.10',
    gmsh_min_version: '4.15',
    export_time: exportTime,
    source_project: context.ir.meta.project_name,
    schema_version: context.ir.meta.schema_version,
    model_revision: context.ir.validation.model_revision,
    analysis_type: context.mode === 'thermal' ? 'steady_heat_or_poisson' : 'linear_elasticity',
    analysis_case_id: context.analysisCase?.id ?? null,
    body_id: context.body.id,
    material_id: context.material.id,
    material_assignment_id: context.materialAssignmentId,
    heat_flux_sign_convention: context.mode === 'thermal' ? 'positive_outward' : null,
    tag_map_key: 'named_selection_id',
    tag_map: context.tagMap,
    mesh_control_coverage: {
      consumed_fields: [
        'mesh_controls.global.global_size',
        'mesh_controls.global.algorithm_preference',
        'mesh_controls.global.element_order',
        'mesh_controls.global.curvature_based_refinement',
      ],
      validated_but_not_consumed_fields: [
        'mesh_controls.global.growth_rate',
        'mesh_controls.global.recombine_preference',
        'mesh_controls.quality_targets.min_jacobian',
        'mesh_controls.quality_targets.max_aspect_ratio',
        'mesh_controls.quality_targets.min_skewness',
        'mesh_controls.quality_targets.preferred_quality_level',
      ],
    },
    consumed_ir_ids: [...consumedIdSet],
    ignored_ir_ids: ignoredIds,
    generated_files: ['solve.py', 'model.geo', 'export_manifest.json', 'run.sh', 'README.txt'],
    errors,
    warnings,
  }, null, 2);
}

function failedResult(
  ir: ProjectIR,
  exportTime: string,
  errors: string[],
  warnings: string[],
  geoFile = '',
  mode?: PhysicsMode,
  tagMap: Record<string, number> = {},
): DOLFINxExportResult {
  return {
    success: false,
    script: '',
    geoFile,
    manifest: JSON.stringify({
      export_target: 'DOLFINx',
      dolfinx_api_version: '0.10',
      export_time: exportTime,
      source_project: ir.meta.project_name,
      schema_version: ir.meta.schema_version,
      analysis_type: mode ?? null,
      tag_map: tagMap,
      errors,
      warnings,
    }, null, 2),
    errors,
    warnings,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isUnresolvedStatus(status: string): boolean {
  return status === 'missing' || status === 'needs_review';
}

function number(value: number): string {
  if (Object.is(value, -0)) return '0';
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
}

function safeComment(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
      ? ' '
      : character;
  }).join('').replace(/\*\//g, '* /');
}

export async function downloadDOLFINxZip(
  ir: ProjectIR,
  analysisCaseId?: string,
): Promise<DOLFINxExportResult> {
  const exportIr = analysisCaseId ? scopeProjectForAnalysisCaseValidation(ir, analysisCaseId) : ir;
  const result = exportDOLFINx(exportIr);
  if (!result.success) return result;

  const zip = new JSZip();
  zip.file('solve.py', result.script);
  zip.file('model.geo', result.geoFile);
  zip.file('export_manifest.json', result.manifest);
  zip.file('run.sh', '#!/usr/bin/env bash\nset -euo pipefail\ngmsh -3 model.geo -format msh4 -o model.msh\npython -m py_compile solve.py\nmpirun -n "${NPROC:-1}" python solve.py | tee solver.log\n');
  zip.file('README.txt', 'Requires Gmsh >= 4.15 and DOLFINx >= 0.10. Run: bash run.sh\nThe package first generates and validates exact Physical Surface/Volume tags.\n');

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${sanitizeArtifactName(ir.meta.project_name)}_dolfinx.zip`);
  return result;
}
