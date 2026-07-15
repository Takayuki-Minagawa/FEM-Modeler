import type {
  AnalysisCase,
  AnalysisType,
  BoundaryConditionType,
  DomainType,
  LoadType,
  ProjectIR,
  ResultRequest,
  SolverProfileHint,
  SolverTargetName,
} from '@/core/ir/types';

export interface SolverCapabilities {
  target: SolverTargetName;
  domains: readonly DomainType[];
  analysisTypes: readonly AnalysisType[];
  solverProfiles: readonly SolverProfileHint[];
  boundaryConditions: readonly BoundaryConditionType[];
  loads: readonly LoadType[];
  results: readonly ResultRequest[];
  supportsInitialConditions: boolean;
  supportsMultipleBodies: boolean;
}

export interface CapabilityIssue {
  code: string;
  message: string;
  targetRef: string;
}

export interface ExportCoverage {
  analysisCaseId: string;
  consumedIds: string[];
  ignoredIds: string[];
  capabilities: SolverCapabilities;
}

export interface ExportPreflight {
  analysisCase?: AnalysisCase;
  errors: CapabilityIssue[];
  warnings: CapabilityIssue[];
  coverage?: ExportCoverage;
}

export const SOLVER_CAPABILITIES: Record<SolverTargetName, SolverCapabilities> = {
  OpenSeesPy: {
    target: 'OpenSeesPy',
    domains: ['frame', 'truss'],
    analysisTypes: ['static_linear'],
    solverProfiles: ['openseespy_frame_basic'],
    boundaryConditions: ['fixed', 'prescribed_displacement'],
    loads: ['nodal_force'],
    results: ['displacement', 'reaction_force'],
    supportsInitialConditions: false,
    supportsMultipleBodies: false,
  },
  DOLFINx: {
    target: 'DOLFINx',
    domains: ['solid', 'thermal'],
    analysisTypes: ['static_linear', 'steady_thermal'],
    solverProfiles: ['dolfinx_linear_elasticity', 'dolfinx_poisson', 'dolfinx_steady_heat'],
    boundaryConditions: [
      'fixed',
      'prescribed_displacement',
      'temperature',
      'heat_flux',
      'convection',
      'insulation',
    ],
    loads: [
      'surface_traction',
      'body_force',
      'pressure',
      'heat_source',
      'volumetric_heat',
    ],
    results: ['displacement', 'temperature'],
    supportsInitialConditions: false,
    supportsMultipleBodies: false,
  },
  OpenFOAM: {
    target: 'OpenFOAM',
    domains: ['fluid'],
    analysisTypes: ['incompressible_flow_steady'],
    solverProfiles: ['openfoam_simpleFoam'],
    boundaryConditions: ['velocity_inlet', 'pressure_outlet', 'wall', 'no_slip'],
    loads: [],
    results: ['velocity', 'pressure'],
    supportsInitialConditions: false,
    supportsMultipleBodies: false,
  },
};

const DEFAULT_STRICT_MESH_SETTINGS = {
  algorithm_preference: 'auto',
  global_size: null,
  growth_rate: 1.2,
  element_order: 1,
  recombine_preference: 'none',
  curvature_based_refinement: false,
  min_jacobian: 0.3,
  max_aspect_ratio: 10,
  min_skewness: 0.1,
  preferred_quality_level: 'balanced',
} as const;

/**
 * OpenSees receives an already-discrete member graph, not a continuum mesh.
 * Only untouched UI defaults are accepted; any user-authored mesh intent must
 * fail explicitly instead of being reported as consumed.
 */
export function unsupportedOpenSeesMeshSettings(ir: ProjectIR): string[] {
  const global = ir.mesh_controls.global;
  const quality = ir.mesh_controls.quality_targets;
  const settings: Array<[string, unknown, unknown]> = [
    ['mesh_controls.global.algorithm_preference', global.algorithm_preference, DEFAULT_STRICT_MESH_SETTINGS.algorithm_preference],
    ['mesh_controls.global.global_size', global.global_size, DEFAULT_STRICT_MESH_SETTINGS.global_size],
    ['mesh_controls.global.growth_rate', global.growth_rate, DEFAULT_STRICT_MESH_SETTINGS.growth_rate],
    ['mesh_controls.global.element_order', global.element_order, DEFAULT_STRICT_MESH_SETTINGS.element_order],
    ['mesh_controls.global.recombine_preference', global.recombine_preference, DEFAULT_STRICT_MESH_SETTINGS.recombine_preference],
    ['mesh_controls.global.curvature_based_refinement', global.curvature_based_refinement, DEFAULT_STRICT_MESH_SETTINGS.curvature_based_refinement],
    ['mesh_controls.quality_targets.min_jacobian', quality.min_jacobian, DEFAULT_STRICT_MESH_SETTINGS.min_jacobian],
    ['mesh_controls.quality_targets.max_aspect_ratio', quality.max_aspect_ratio, DEFAULT_STRICT_MESH_SETTINGS.max_aspect_ratio],
    ['mesh_controls.quality_targets.min_skewness', quality.min_skewness, DEFAULT_STRICT_MESH_SETTINGS.min_skewness],
    ['mesh_controls.quality_targets.preferred_quality_level', quality.preferred_quality_level, DEFAULT_STRICT_MESH_SETTINGS.preferred_quality_level],
  ];
  const unsupported = settings
    .filter(([, actual, expected]) => !Object.is(actual, expected))
    .map(([path]) => path);
  unsupported.push(...ir.mesh_controls.local.map((control) => `mesh_controls.local:${control.id}`));
  return unsupported;
}

/**
 * Return an export-only ProjectIR view with exactly the requested analysis case
 * active. The source IR is never mutated, so UI selection and exporter
 * compilation cannot silently diverge when a project contains multiple cases.
 */
export function scopeProjectToAnalysisCase(ir: ProjectIR, analysisCaseId: string): ProjectIR {
  if (!ir.analysis_cases.some((item) => item.id === analysisCaseId)) {
    throw new Error(`Analysis case "${analysisCaseId}" does not exist.`);
  }
  return {
    ...ir,
    analysis_cases: ir.analysis_cases.map((item) => ({
      ...item,
      active: item.id === analysisCaseId,
    })),
  };
}

/** Build the exact participation scope used by case-specific validation. */
export function scopeProjectForAnalysisCaseValidation(ir: ProjectIR, analysisCaseId: string): ProjectIR {
  const activated = scopeProjectToAnalysisCase(ir, analysisCaseId);
  const analysisCase = activated.analysis_cases.find((item) => item.id === analysisCaseId)!;
  const select = <T extends { id: string }>(items: T[], ids: string[]): T[] => {
    if (ids.length === 0) return items;
    const selected = new Set(ids);
    return items.filter((item) => selected.has(item.id));
  };
  const allowedCategories = analysisCase.domain_type === 'frame' || analysisCase.domain_type === 'truss'
    ? new Set(['beam_region'])
    : analysisCase.domain_type === 'fluid'
      ? new Set(['fluid_region'])
      : new Set(['solid', 'shell']);
  const relevantBodies = activated.geometry.bodies.filter((body) => allowedCategories.has(body.category));
  const relevantBodyIds = new Set(relevantBodies.map((body) => body.id));
  const entityBodyId = new Map<string, string>();
  for (const body of activated.geometry.bodies) entityBodyId.set(body.id, body.id);
  for (const item of [...activated.geometry.faces, ...activated.geometry.edges, ...activated.geometry.vertices]) {
    entityBodyId.set(item.id, item.body_id);
  }
  const selectionById = new Map(activated.named_selections.map((selection) => [selection.id, selection]));
  const targetIsRelevant = (selectionId: string): boolean => {
    const selection = selectionById.get(selectionId);
    if (!selection) return true;
    let resolvedMember = false;
    for (const ref of selection.member_refs) {
      const bodyId = entityBodyId.get(ref);
      if (!bodyId) continue;
      resolvedMember = true;
      if (relevantBodyIds.has(bodyId)) return true;
    }
    return !resolvedMember;
  };
  const expectedPhysics = analysisCase.domain_type === 'thermal'
    ? 'thermal'
    : analysisCase.domain_type === 'fluid' ? 'fluid' : 'structural';
  const selectConditions = <T extends { id: string; physics_domain: string; target_named_selection_id: string }>(
    items: T[],
    ids: string[],
  ): T[] => ids.length > 0
    ? select(items, ids)
    : items.filter((item) => item.physics_domain === expectedPhysics && targetIsRelevant(item.target_named_selection_id));
  const boundaryConditions = selectConditions(activated.boundary_conditions, analysisCase.participating_bc_ids);
  const loads = selectConditions(activated.loads, analysisCase.participating_load_ids);
  const initialConditions = selectConditions(activated.initial_conditions, analysisCase.participating_ic_ids);

  const requestedMaterialIds = new Set(
    analysisCase.participating_material_ids.length > 0
      ? analysisCase.participating_material_ids
      : activated.materials.map((item) => item.id),
  );
  const requestedSectionIds = new Set(
    analysisCase.participating_section_ids.length > 0
      ? analysisCase.participating_section_ids
      : activated.sections.map((item) => item.id),
  );
  const materialAssignments = activated.material_assignments.filter(
    (item) => requestedMaterialIds.has(item.material_id) && targetIsRelevant(item.target_named_selection_id),
  );
  const sectionAssignments = activated.section_assignments.filter(
    (item) => requestedSectionIds.has(item.section_id) && targetIsRelevant(item.target_named_selection_id),
  );
  const assignedMaterialIds = new Set(materialAssignments.map((item) => item.material_id));
  const assignedSectionIds = new Set(sectionAssignments.map((item) => item.section_id));
  const materials = activated.materials.filter((item) => (
    analysisCase.participating_material_ids.length > 0
      ? requestedMaterialIds.has(item.id)
      : assignedMaterialIds.has(item.id)
  ));
  const sections = activated.sections.filter((item) => (
    analysisCase.participating_section_ids.length > 0
      ? requestedSectionIds.has(item.id)
      : assignedSectionIds.has(item.id)
  ));
  const localMeshControls = activated.mesh_controls.local.filter(
    (item) => targetIsRelevant(item.target_named_selection_id),
  );
  const referencedSelectionIds = new Set([
    ...materialAssignments.map((item) => item.target_named_selection_id),
    ...sectionAssignments.map((item) => item.target_named_selection_id),
    ...boundaryConditions.map((item) => item.target_named_selection_id),
    ...loads.map((item) => item.target_named_selection_id),
    ...initialConditions.map((item) => item.target_named_selection_id),
    ...localMeshControls.map((item) => item.target_named_selection_id),
  ]);
  const referencedFrameIds = new Set([
    ...sections.map((item) => item.orientation_ref).filter((id): id is string => Boolean(id)),
    ...boundaryConditions.map((item) => item.coordinate_system).filter((id) => id !== 'global'),
    ...loads.map((item) => item.coordinate_system).filter((id) => id !== 'global'),
  ]);
  let addedFrame = true;
  while (addedFrame) {
    addedFrame = false;
    for (const frame of activated.geometry.reference_frames) {
      if (!referencedFrameIds.has(frame.id) || !frame.attached_to) continue;
      if (activated.geometry.reference_frames.some((candidate) => candidate.id === frame.attached_to)
          && !referencedFrameIds.has(frame.attached_to)) {
        referencedFrameIds.add(frame.attached_to);
        addedFrame = true;
      }
    }
  }
  const assetIds = new Set(relevantBodies.map((body) => body.asset_ref).filter((id): id is string => Boolean(id)));
  return {
    ...activated,
    meta: { ...activated.meta, domain_type: analysisCase.domain_type },
    geometry: {
      ...activated.geometry,
      bodies: relevantBodies,
      faces: activated.geometry.faces.filter((item) => relevantBodyIds.has(item.body_id)),
      edges: activated.geometry.edges.filter((item) => relevantBodyIds.has(item.body_id)),
      vertices: activated.geometry.vertices.filter((item) => relevantBodyIds.has(item.body_id)),
      reference_frames: activated.geometry.reference_frames.filter((item) => referencedFrameIds.has(item.id)),
      geometry_parameters: [],
    },
    assets: activated.assets.filter((item) => assetIds.has(item.id)),
    materials,
    material_assignments: materialAssignments,
    sections,
    section_assignments: sectionAssignments,
    named_selections: activated.named_selections.filter((item) => referencedSelectionIds.has(item.id)),
    boundary_conditions: boundaryConditions,
    loads,
    initial_conditions: initialConditions,
    mesh_controls: { ...activated.mesh_controls, local: localMeshControls },
    analysis_cases: [{ ...analysisCase, active: true }],
    results: activated.results.filter((item) => item.analysis_case_id === analysisCaseId),
  };
}

function selectAnalysisCase(ir: ProjectIR, analysisCaseId?: string): AnalysisCase | undefined {
  if (analysisCaseId) return ir.analysis_cases.find((item) => item.id === analysisCaseId);
  return ir.analysis_cases.find((item) => item.active) ?? ir.analysis_cases[0];
}

function selectedIds(allIds: string[], participatingIds: string[]): Set<string> {
  return new Set(participatingIds.length > 0 ? participatingIds : allIds);
}

/**
 * Strict, analysis-case-centric capability check shared by the UI and exporters.
 * Exporters still validate solver-specific topology and numeric requirements.
 */
export function preflightExport(
  ir: ProjectIR,
  target: SolverTargetName,
  analysisCaseId?: string,
): ExportPreflight {
  const capabilities = SOLVER_CAPABILITIES[target];
  const errors: CapabilityIssue[] = [];
  const warnings: CapabilityIssue[] = [];
  const analysisCase = selectAnalysisCase(ir, analysisCaseId);

  if (!analysisCase) {
    errors.push({ code: 'CASE_MISSING', message: 'An analysis case is required for strict export.', targetRef: 'analysis_cases' });
    return { errors, warnings };
  }

  if (!capabilities.domains.includes(analysisCase.domain_type)) {
    errors.push({
      code: 'CASE_DOMAIN_UNSUPPORTED',
      message: `${target} does not support domain ${analysisCase.domain_type}.`,
      targetRef: analysisCase.id,
    });
  }
  if (!capabilities.analysisTypes.includes(analysisCase.analysis_type)) {
    errors.push({
      code: 'CASE_ANALYSIS_UNSUPPORTED',
      message: `${target} does not support analysis type ${analysisCase.analysis_type}.`,
      targetRef: analysisCase.id,
    });
  }
  if (!capabilities.solverProfiles.includes(analysisCase.solver_profile_hint)) {
    errors.push({
      code: 'CASE_PROFILE_UNSUPPORTED',
      message: `${analysisCase.solver_profile_hint} is not a ${target} profile.`,
      targetRef: analysisCase.id,
    });
  }
  if (analysisCase.nonlinear || analysisCase.transient) {
    errors.push({
      code: 'CASE_FLAGS_UNSUPPORTED',
      message: `${target} strict export does not support the requested nonlinear/transient flags.`,
      targetRef: analysisCase.id,
    });
  }
  if (analysisCase.mesh_policy_ref) {
    errors.push({
      code: 'MESH_POLICY_UNSUPPORTED',
      message: `${target} does not resolve mesh policy reference ${analysisCase.mesh_policy_ref}.`,
      targetRef: analysisCase.id,
    });
  }
  if (target === 'OpenSeesPy') {
    for (const path of unsupportedOpenSeesMeshSettings(ir)) {
      errors.push({
        code: 'MESH_CONTROL_UNSUPPORTED',
        message: `OpenSeesPy consumes the explicit member graph and does not consume ${path}.`,
        targetRef: path,
      });
    }
  } else {
    const globalSize = ir.mesh_controls.global.global_size;
    if (globalSize === null || !Number.isFinite(globalSize) || globalSize <= 0) {
      errors.push({
        code: 'MESH_SIZE_REQUIRED',
        message: `${target} strict export requires an explicit positive global mesh size.`,
        targetRef: 'mesh_controls.global.global_size',
      });
    }
    for (const control of ir.mesh_controls.local) {
      errors.push({
        code: 'MESH_CONTROL_UNSUPPORTED',
        message: `${target} does not consume local mesh control ${control.id}.`,
        targetRef: control.id,
      });
    }
    const global = ir.mesh_controls.global;
    const quality = ir.mesh_controls.quality_targets;
    const unsupportedSettings: Array<[string, boolean]> = target === 'DOLFINx'
      ? [
        ['mesh_controls.global.algorithm_preference', global.algorithm_preference === 'structured'],
        ['mesh_controls.global.growth_rate', !Object.is(global.growth_rate, DEFAULT_STRICT_MESH_SETTINGS.growth_rate)],
        ['mesh_controls.global.recombine_preference', global.recombine_preference !== 'none'],
        ['mesh_controls.quality_targets.min_jacobian', !Object.is(quality.min_jacobian, DEFAULT_STRICT_MESH_SETTINGS.min_jacobian)],
        ['mesh_controls.quality_targets.max_aspect_ratio', !Object.is(quality.max_aspect_ratio, DEFAULT_STRICT_MESH_SETTINGS.max_aspect_ratio)],
        ['mesh_controls.quality_targets.min_skewness', !Object.is(quality.min_skewness, DEFAULT_STRICT_MESH_SETTINGS.min_skewness)],
        ['mesh_controls.quality_targets.preferred_quality_level', quality.preferred_quality_level !== DEFAULT_STRICT_MESH_SETTINGS.preferred_quality_level],
      ]
      : [
        ['mesh_controls.global.algorithm_preference', global.algorithm_preference !== DEFAULT_STRICT_MESH_SETTINGS.algorithm_preference],
        ['mesh_controls.global.growth_rate', !Object.is(global.growth_rate, DEFAULT_STRICT_MESH_SETTINGS.growth_rate)],
        ['mesh_controls.global.element_order', global.element_order !== DEFAULT_STRICT_MESH_SETTINGS.element_order],
        ['mesh_controls.global.recombine_preference', global.recombine_preference !== DEFAULT_STRICT_MESH_SETTINGS.recombine_preference],
        ['mesh_controls.global.curvature_based_refinement', global.curvature_based_refinement !== DEFAULT_STRICT_MESH_SETTINGS.curvature_based_refinement],
        ['mesh_controls.quality_targets.min_jacobian', !Object.is(quality.min_jacobian, DEFAULT_STRICT_MESH_SETTINGS.min_jacobian)],
        ['mesh_controls.quality_targets.max_aspect_ratio', !Object.is(quality.max_aspect_ratio, DEFAULT_STRICT_MESH_SETTINGS.max_aspect_ratio)],
        ['mesh_controls.quality_targets.min_skewness', !Object.is(quality.min_skewness, DEFAULT_STRICT_MESH_SETTINGS.min_skewness)],
        ['mesh_controls.quality_targets.preferred_quality_level', quality.preferred_quality_level !== DEFAULT_STRICT_MESH_SETTINGS.preferred_quality_level],
      ];
    for (const [path, unsupported] of unsupportedSettings) {
      if (!unsupported) continue;
      errors.push({
        code: 'MESH_CONTROL_UNSUPPORTED',
        message: `${target} does not consume the requested setting ${path}.`,
        targetRef: path,
      });
    }
  }

  const caseScope = scopeProjectForAnalysisCaseValidation(ir, analysisCase.id);
  if (target !== 'OpenSeesPy') {
    for (const section of caseScope.sections) {
      errors.push({
        code: 'SECTION_UNSUPPORTED',
        message: `${target} does not consume structural section ${section.name}.`,
        targetRef: section.id,
      });
    }
    for (const assignment of caseScope.section_assignments) {
      errors.push({
        code: 'SECTION_UNSUPPORTED',
        message: `${target} does not consume section assignment ${assignment.id}.`,
        targetRef: assignment.id,
      });
    }
  }

  const relevantBodies = ir.geometry.bodies.filter((body) => {
    if (target === 'OpenSeesPy') return body.category === 'beam_region';
    if (target === 'DOLFINx') return body.category === 'solid' || body.category === 'shell';
    return body.category === 'fluid_region';
  });
  if (!capabilities.supportsMultipleBodies && relevantBodies.length > 1) {
    errors.push({
      code: 'MULTIPLE_BODIES_UNSUPPORTED',
      message: `${target} strict export supports exactly one applicable body; found ${relevantBodies.length}.`,
      targetRef: 'geometry',
    });
  }

  const bcIds = selectedIds(caseScope.boundary_conditions.map((item) => item.id), analysisCase.participating_bc_ids);
  const loadIds = selectedIds(caseScope.loads.map((item) => item.id), analysisCase.participating_load_ids);
  const icIds = selectedIds(caseScope.initial_conditions.map((item) => item.id), analysisCase.participating_ic_ids);
  const materialIds = selectedIds(caseScope.materials.map((item) => item.id), analysisCase.participating_material_ids);
  const sectionIds = selectedIds(caseScope.sections.map((item) => item.id), analysisCase.participating_section_ids);
  for (const [label, requested, known] of [
    ['boundary condition', analysisCase.participating_bc_ids, new Set(ir.boundary_conditions.map((item) => item.id))],
    ['load', analysisCase.participating_load_ids, new Set(ir.loads.map((item) => item.id))],
    ['initial condition', analysisCase.participating_ic_ids, new Set(ir.initial_conditions.map((item) => item.id))],
    ['material', analysisCase.participating_material_ids, new Set(ir.materials.map((item) => item.id))],
    ['section', analysisCase.participating_section_ids, new Set(ir.sections.map((item) => item.id))],
  ] as const) {
    for (const id of requested) {
      if (!known.has(id)) errors.push({ code: 'CASE_REFERENCE_MISSING', message: `Analysis case references missing ${label} ${id}.`, targetRef: analysisCase.id });
    }
  }

  for (const bc of ir.boundary_conditions.filter((item) => bcIds.has(item.id))) {
    if (!capabilities.boundaryConditions.includes(bc.bc_type)) {
      errors.push({ code: 'BC_UNSUPPORTED', message: `${target} cannot consume BC ${bc.name} (${bc.bc_type}).`, targetRef: bc.id });
    }
  }
  for (const load of ir.loads.filter((item) => loadIds.has(item.id))) {
    if (!capabilities.loads.includes(load.load_type)) {
      errors.push({ code: 'LOAD_UNSUPPORTED', message: `${target} cannot consume load ${load.name} (${load.load_type}).`, targetRef: load.id });
    }
  }
  if (!capabilities.supportsInitialConditions && icIds.size > 0) {
    for (const id of icIds) {
      errors.push({ code: 'IC_UNSUPPORTED', message: `${target} does not consume initial conditions in this profile.`, targetRef: id });
    }
  }
  for (const result of analysisCase.result_requests) {
    if (!capabilities.results.includes(result)) {
      errors.push({ code: 'RESULT_UNSUPPORTED', message: `${target} cannot produce requested result ${result}.`, targetRef: analysisCase.id });
    }
  }

  const relevantBodyIds = new Set(relevantBodies.map((body) => body.id));
  const topologyIdsForRelevantBodies = [
    ...ir.geometry.faces.filter((item) => relevantBodyIds.has(item.body_id)).map((item) => item.id),
    ...ir.geometry.edges.filter((item) => relevantBodyIds.has(item.body_id)).map((item) => item.id),
    ...ir.geometry.vertices.filter((item) => relevantBodyIds.has(item.body_id)).map((item) => item.id),
  ];
  const relevantTopologyIdSet = new Set(topologyIdsForRelevantBodies);
  const candidateMaterialAssignments = caseScope.material_assignments.filter(
    (item) => materialIds.has(item.material_id),
  );
  let selectedMaterialAssignments = candidateMaterialAssignments;
  if (target !== 'OpenSeesPy') {
    const selectionsById = new Map(
      caseScope.named_selections.map((selection) => [selection.id, selection]),
    );
    selectedMaterialAssignments = candidateMaterialAssignments.filter((assignment) => {
      const selection = selectionsById.get(assignment.target_named_selection_id);
      if (!selection || selection.status !== 'active' || selection.target_dimension !== 3) return false;
      if (target === 'DOLFINx') {
        return selection.entity_type === 'body'
          && selection.member_refs.length === 1
          && relevantBodyIds.has(selection.member_refs[0]);
      }
      return (selection.entity_type === 'body' || selection.entity_type === 'cell')
        && selection.member_refs.some((id) => relevantBodyIds.has(id));
    });
    for (const assignment of candidateMaterialAssignments) {
      if (selectedMaterialAssignments.includes(assignment)) continue;
      errors.push({
        code: 'MATERIAL_ASSIGNMENT_UNSUPPORTED',
        message: `${target} cannot resolve material assignment ${assignment.id} to the exported body.`,
        targetRef: assignment.id,
      });
    }
    if (selectedMaterialAssignments.length !== 1) {
      errors.push({
        code: 'MATERIAL_ASSIGNMENT_CARDINALITY',
        message: `${target} strict export requires exactly one body material assignment; found ${selectedMaterialAssignments.length}.`,
        targetRef: 'material_assignments',
      });
    }
    const assignedMaterialIds = new Set(
      selectedMaterialAssignments.map((assignment) => assignment.material_id),
    );
    for (const materialId of materialIds) {
      if (assignedMaterialIds.has(materialId)) continue;
      errors.push({
        code: 'MATERIAL_UNCONSUMED',
        message: `${target} cannot consume participating material ${materialId} because it is not assigned to the exported body.`,
        targetRef: materialId,
      });
    }
  }
  const selectedAssignments = [
    ...selectedMaterialAssignments,
    ...(target === 'OpenSeesPy'
      ? caseScope.section_assignments.filter((item) => sectionIds.has(item.section_id))
      : []),
  ];
  const referencedSelectionIds = new Set([
    ...selectedAssignments.map((item) => item.target_named_selection_id),
    ...ir.boundary_conditions.filter((item) => bcIds.has(item.id)).map((item) => item.target_named_selection_id),
    ...ir.loads.filter((item) => loadIds.has(item.id)).map((item) => item.target_named_selection_id),
    ...(capabilities.supportsInitialConditions
      ? ir.initial_conditions.filter((item) => icIds.has(item.id)).map((item) => item.target_named_selection_id)
      : []),
  ]);
  const referencedTopologyIds = caseScope.named_selections
    .filter((selection) => referencedSelectionIds.has(selection.id))
    .flatMap((selection) => selection.member_refs)
    .filter((id) => relevantTopologyIdSet.has(id));
  const relevantTopologyIds = target === 'OpenSeesPy'
    ? [
      ...ir.geometry.edges.filter((item) => relevantBodyIds.has(item.body_id)).map((item) => item.id),
      ...ir.geometry.vertices.filter((item) => relevantBodyIds.has(item.body_id)).map((item) => item.id),
    ]
    : referencedTopologyIds;
  const consumedIds = [
    analysisCase.id,
    ...relevantBodyIds,
    ...relevantTopologyIds,
    ...referencedSelectionIds,
    ...materialIds,
    ...(target === 'OpenSeesPy' ? [...sectionIds] : []),
    ...selectedAssignments.map((item) => item.id),
    ...bcIds,
    ...loadIds,
    ...(capabilities.supportsInitialConditions ? [...icIds] : []),
    ...(target === 'OpenSeesPy' ? [] : ['mesh_controls.global']),
    ...analysisCase.result_requests.map((item) => `result_request:${analysisCase.id}:${item}`),
  ];
  const scopedIds = [
    ...ir.geometry.bodies.map((item) => item.id),
    ...ir.geometry.faces.map((item) => item.id),
    ...ir.geometry.edges.map((item) => item.id),
    ...ir.geometry.vertices.map((item) => item.id),
    ...ir.named_selections.map((item) => item.id),
    ...ir.materials.map((item) => item.id),
    ...ir.material_assignments.map((item) => item.id),
    ...ir.sections.map((item) => item.id),
    ...ir.section_assignments.map((item) => item.id),
    ...ir.boundary_conditions.map((item) => item.id),
    ...ir.loads.map((item) => item.id),
    ...ir.initial_conditions.map((item) => item.id),
    ...ir.analysis_cases.map((item) => item.id),
    ...ir.mesh_controls.local.map((item) => item.id),
  ];
  const consumed = new Set(consumedIds);
  const ignoredIds = scopedIds.filter((id) => !consumed.has(id));
  if (ignoredIds.length > 0) {
    warnings.push({
      code: 'CASE_ITEMS_EXCLUDED',
      message: `${ignoredIds.length} IR item(s) are outside the selected analysis case and will not be exported.`,
      targetRef: analysisCase.id,
    });
  }

  return {
    analysisCase,
    errors,
    warnings,
    coverage: { analysisCaseId: analysisCase.id, consumedIds: [...consumed], ignoredIds, capabilities },
  };
}
