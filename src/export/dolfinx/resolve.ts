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
import { localFaceProbe, totalTransformedArea, transformedVolume, vectorNorm } from './geometry';
import { convectionAmbientTemperature, convectionCoefficient, isFiniteNumber, isPositiveFinite, isUnresolvedStatus, safeComment, structuralDofValues } from './helpers';
import type { PhysicsMode, ResolvedMaterialAssignment, ResolvedSurfaceSelection, ShapeDefinition, SupportedShapeType } from './model';

export const SUPPORTED_SHAPES = new Set<SupportedShapeType>([
  'box',
  'plate',
  'plateWithHole',
  'cylinder',
]);

export const DEFAULT_MESH_QUALITY_TARGETS = {
  min_jacobian: 0.3,
  max_aspect_ratio: 10,
  min_skewness: 0.1,
  preferred_quality_level: 'balanced',
} as const;

export function resolveAnalysisCase(
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

export function resolveParticipatingItems<T extends { id: string; physics_domain: string }>(
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

export function resolveAssignedMaterial(
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

export function validateMaterial(material: Material, mode: PhysicsMode, errors: string[]): void {
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

export function validateTransform(body: GeometryBody, errors: string[]): void {
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

export function validateMeshControls(
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

export function validateBoundaryConditions(
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

export function validateLoads(
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

export function validateWellPosedness(
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

export function validateBoundaryConflicts(
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

export function validateStructuralDofs(bc: BoundaryCondition, errors: string[]): void {
  if (bc.bc_type === 'prescribed_displacement') {
    const hasVector = bc.values.vector?.every(isFiniteNumber) ?? false;
    if (!hasVector && !isFiniteNumber(bc.values.scalar)) {
      errors.push(
        `DFX_INVALID_BC_VALUE: Prescribed displacement "${safeComment(bc.name)}" requires a finite values.vector or scalar.`,
      );
    }
    if (!hasVector && isFiniteNumber(bc.values.scalar) && !bc.values.dof_map) {
      errors.push(
        `DFX_AMBIGUOUS_BC_VALUE: Prescribed displacement "${safeComment(bc.name)}" uses a scalar value and requires an explicit dof_map to select its direction.`,
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

export function validateDirection(load: Load, errors: string[]): void {
  if (!load.direction.every(isFiniteNumber) || vectorNorm(load.direction) <= 0) {
    errors.push(`DFX_INVALID_LOAD_DIRECTION: Load "${safeComment(load.name)}" requires a finite, non-zero direction.`);
  }
}

export function validateSurfaceTarget(
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

export function validateBodyTarget(
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

export function resolveSurfaceSelections(
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

export function resolveShapeDefinition(
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
