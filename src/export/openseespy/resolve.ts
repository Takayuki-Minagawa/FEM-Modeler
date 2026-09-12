import type {
  NamedSelection,
  ProjectIR
} from '@/core/ir/types';
import {
  unsupportedOpenSeesMeshSettings
} from '@/export/compiler';
import { pushUnique } from './helpers';
import type { OpenSeesCaseScope, OpenSeesPyModel, OpenSeesPyNode, OpenSeesPyTopology, OpenSeesPyTopologyElement, ResolvedBinding } from './model';

export function resolveOpenSeesCaseScope(ir: ProjectIR): OpenSeesCaseScope {
  const errors: string[] = [];
  const warnings: string[] = [];
  const candidates = ir.analysis_cases.filter(
    (analysisCase) => analysisCase.active
      && analysisCase.solver_profile_hint.startsWith('openseespy_'),
  );
  if (candidates.length !== 1) {
    errors.push(`OpenSeesPy strict export requires exactly one active OpenSeesPy analysis case; found ${candidates.length}.`);
  }
  const analysisCase = candidates[0] ?? null;
  if (analysisCase) {
    if (analysisCase.solver_profile_hint !== 'openseespy_frame_basic') {
      errors.push(`Analysis case "${analysisCase.name}" uses unsupported profile "${analysisCase.solver_profile_hint}".`);
    }
    if (analysisCase.domain_type !== 'frame' && analysisCase.domain_type !== 'truss') {
      errors.push(`Analysis case "${analysisCase.name}" has unsupported OpenSeesPy domain "${analysisCase.domain_type}".`);
    }
    if (analysisCase.analysis_type !== 'static_linear' || analysisCase.nonlinear || analysisCase.transient) {
      errors.push(`Analysis case "${analysisCase.name}" must be a linear, non-transient static case.`);
    }
    for (const request of analysisCase.result_requests) {
      if (request !== 'displacement' && request !== 'reaction_force') {
        errors.push(`Analysis case "${analysisCase.name}" requests unsupported result "${request}".`);
      }
    }
    if (analysisCase.mesh_policy_ref) {
      errors.push(
        `OpenSeesPy does not resolve mesh policy "${analysisCase.mesh_policy_ref}"; the solver consumes the explicit member graph.`,
      );
    }
  }
  for (const path of unsupportedOpenSeesMeshSettings(ir)) {
    errors.push(
      `OpenSeesPy does not consume ${path}; reset it to the project default because the explicit member graph is the solver topology.`,
    );
  }

  const selected = <T extends { id: string }>(
    values: T[],
    requestedIds: string[] | undefined,
    label: string,
  ): T[] => {
    if (!analysisCase || !requestedIds || requestedIds.length === 0) return values;
    const knownIds = new Set(values.map((value) => value.id));
    for (const id of requestedIds) {
      if (!knownIds.has(id)) errors.push(`Analysis case "${analysisCase.name}" references missing ${label} "${id}".`);
    }
    const requested = new Set(requestedIds);
    return values.filter((value) => requested.has(value.id));
  };

  const materials = selected(ir.materials, analysisCase?.participating_material_ids, 'material');
  const sections = selected(ir.sections, analysisCase?.participating_section_ids, 'section');
  const boundaryConditions = selected(ir.boundary_conditions, analysisCase?.participating_bc_ids, 'boundary condition');
  const loads = selected(ir.loads, analysisCase?.participating_load_ids, 'load');
  const initialConditions = selected(ir.initial_conditions, analysisCase?.participating_ic_ids, 'initial condition');
  for (const boundaryCondition of boundaryConditions) {
    if (boundaryCondition.physics_domain !== 'structural') {
      errors.push(
        `OpenSeesPy boundary condition "${boundaryCondition.name}" belongs to ${boundaryCondition.physics_domain}, not structural.`,
      );
    }
  }
  for (const load of loads) {
    if (load.physics_domain !== 'structural') {
      errors.push(`OpenSeesPy load "${load.name}" belongs to ${load.physics_domain}, not structural.`);
    }
  }
  if (initialConditions.length > 0) {
    errors.push('OpenSeesPy static strict export does not consume initial conditions.');
  }

  const materialIds = new Set(materials.map((item) => item.id));
  const sectionIds = new Set(sections.map((item) => item.id));
  const scopedIr: ProjectIR = {
    ...ir,
    materials,
    sections,
    boundary_conditions: boundaryConditions,
    loads,
    initial_conditions: initialConditions,
    material_assignments: ir.material_assignments.filter((assignment) => materialIds.has(assignment.material_id)),
    section_assignments: ir.section_assignments.filter((assignment) => sectionIds.has(assignment.section_id)),
  };

  const consumedIds = analysisCase ? [
    analysisCase.id,
    ...materials.map((item) => item.id),
    ...sections.map((item) => item.id),
    ...boundaryConditions.map((item) => item.id),
    ...loads.map((item) => item.id),
  ] : [];
  const consumed = new Set(consumedIds);
  const scopedIds = [
    ...ir.materials.map((item) => item.id),
    ...ir.sections.map((item) => item.id),
    ...ir.boundary_conditions.map((item) => item.id),
    ...ir.loads.map((item) => item.id),
    ...ir.initial_conditions.map((item) => item.id),
  ];
  const ignoredIds = scopedIds.filter((id) => !consumed.has(id));
  if (analysisCase && ignoredIds.length > 0) {
    warnings.push(`${ignoredIds.length} IR item(s) are outside analysis case "${analysisCase.name}" and were not exported.`);
  }

  return { ir: scopedIr, analysisCase, errors, warnings, consumedIds, ignoredIds };
}

export function buildOpenSeesCoverage(
  sourceIr: ProjectIR,
  scope: OpenSeesCaseScope,
  topology: OpenSeesPyTopology | null,
  model: OpenSeesPyModel | null,
): { consumedIds: string[]; ignoredIds: string[] } {
  const projectEntityIds = new Set([
    ...sourceIr.geometry.bodies.map((item) => item.id),
    ...sourceIr.geometry.faces.map((item) => item.id),
    ...sourceIr.geometry.edges.map((item) => item.id),
    ...sourceIr.geometry.vertices.map((item) => item.id),
  ]);
  const consumed = new Set<string>();
  if (scope.analysisCase) consumed.add(scope.analysisCase.id);
  if (topology) {
    consumed.add(topology.bodyId);
    for (const sourceRef of [
      ...topology.nodes.flatMap((node) => node.sourceRefs),
      ...topology.elements.flatMap((element) => element.sourceRefs),
    ]) {
      if (projectEntityIds.has(sourceRef)) consumed.add(sourceRef);
    }
  }

  if (model && topology && scope.analysisCase) {
    const usedMaterialIds = new Set(model.elements.map((element) => element.materialId));
    const usedSectionIds = new Set(model.elements.map((element) => element.sectionId));
    for (const id of usedMaterialIds) consumed.add(id);
    for (const id of usedSectionIds) consumed.add(id);

    const consumedSelectionIds = new Set<string>();
    for (const assignment of scope.ir.section_assignments) {
      const selection = scope.ir.named_selections.find(
        (candidate) => candidate.id === assignment.target_named_selection_id,
      );
      if (selection && model.elements.some(
        (element) => element.sectionId === assignment.section_id
          && selectionMatchesElement(selection, topology.bodyId, element),
      )) {
        consumed.add(assignment.id);
        consumedSelectionIds.add(selection.id);
      }
    }
    for (const assignment of scope.ir.material_assignments) {
      const selection = scope.ir.named_selections.find(
        (candidate) => candidate.id === assignment.target_named_selection_id,
      );
      if (selection && model.elements.some(
        (element) => element.materialId === assignment.material_id
          && selectionMatchesElement(selection, topology.bodyId, element),
      )) {
        consumed.add(assignment.id);
        consumedSelectionIds.add(selection.id);
      }
    }
    for (const condition of [
      ...scope.ir.boundary_conditions.filter((item) => item.physics_domain === 'structural'),
      ...scope.ir.loads.filter((item) => item.physics_domain === 'structural'),
    ]) {
      consumed.add(condition.id);
      consumedSelectionIds.add(condition.target_named_selection_id);
    }
    for (const selectionId of consumedSelectionIds) consumed.add(selectionId);
    for (const request of scope.analysisCase.result_requests) {
      consumed.add(`result_request:${scope.analysisCase.id}:${request}`);
    }
  }

  const scopedIds = [
    ...sourceIr.geometry.bodies.map((item) => item.id),
    ...sourceIr.geometry.faces.map((item) => item.id),
    ...sourceIr.geometry.edges.map((item) => item.id),
    ...sourceIr.geometry.vertices.map((item) => item.id),
    ...sourceIr.named_selections.map((item) => item.id),
    ...sourceIr.materials.map((item) => item.id),
    ...sourceIr.material_assignments.map((item) => item.id),
    ...sourceIr.sections.map((item) => item.id),
    ...sourceIr.section_assignments.map((item) => item.id),
    ...sourceIr.boundary_conditions.map((item) => item.id),
    ...sourceIr.loads.map((item) => item.id),
    ...sourceIr.initial_conditions.map((item) => item.id),
    ...sourceIr.analysis_cases.map((item) => item.id),
    ...sourceIr.analysis_cases.flatMap((analysisCase) => analysisCase.result_requests.map(
      (request) => `result_request:${analysisCase.id}:${request}`,
    )),
    ...sourceIr.mesh_controls.local.map((item) => item.id),
  ];
  return {
    consumedIds: [...consumed],
    ignoredIds: [...new Set(scopedIds)].filter((id) => !consumed.has(id)),
  };
}

export function resolveBindings<A, T>(
  assignments: A[],
  getSelectionId: (assignment: A) => string,
  getValue: (assignment: A) => T | undefined,
  label: string,
  ir: ProjectIR,
  errors: string[],
): Array<ResolvedBinding<T>> {
  const bindings: Array<ResolvedBinding<T>> = [];
  for (const assignment of assignments) {
    const selectionId = getSelectionId(assignment);
    const selection = ir.named_selections.find((candidate) => candidate.id === selectionId);
    if (!selection) {
      pushUnique(errors, `${label} references missing named selection "${selectionId}".`);
      continue;
    }
    if (selection.status !== 'active') {
      pushUnique(errors, `${label} named selection "${selection.name}" is ${selection.status}.`);
      continue;
    }
    const value = getValue(assignment);
    if (!value) {
      pushUnique(errors, `${label} references a missing definition.`);
      continue;
    }
    bindings.push({ value, selection });
  }
  return bindings;
}

export function selectionMatchesElement(
  selection: NamedSelection,
  bodyId: string,
  element: OpenSeesPyTopologyElement,
): boolean {
  const refs = new Set(selection.member_refs);
  return refs.has(bodyId) || element.sourceRefs.some((sourceRef) => refs.has(sourceRef));
}

export function resolveTargetNodes(
  selectionId: string,
  ir: ProjectIR,
  topology: OpenSeesPyTopology,
  errors: string[],
): OpenSeesPyNode[] {
  const selection = ir.named_selections.find((candidate) => candidate.id === selectionId);
  if (!selection) {
    pushUnique(errors, `Named selection "${selectionId}" could not be resolved.`);
    return [];
  }
  if (selection.status !== 'active') {
    pushUnique(errors, `Named selection "${selection.name}" is ${selection.status} and cannot be exported.`);
    return [];
  }
  if (selection.member_refs.length === 0) {
    pushUnique(errors, `Named selection "${selection.name}" has no members.`);
    return [];
  }
  if ((selection.entity_type !== 'vertex' && selection.entity_type !== 'node')
    || selection.target_dimension !== 0) {
    pushUnique(
      errors,
      `Named selection "${selection.name}" must be an exact vertex/node selection for OpenSeesPy nodal constraints and loads.`,
    );
    return [];
  }

  const nodeIds = new Set<number>();
  const exactVertexIds = new Set(
    ir.geometry.vertices
      .filter((vertex) => vertex.body_id === topology.bodyId)
      .map((vertex) => vertex.id),
  );
  for (const memberRef of selection.member_refs) {
    if (!exactVertexIds.has(memberRef)) {
      pushUnique(
        errors,
        `Named selection "${selection.name}" member "${memberRef}" is not an exact vertex of body "${topology.bodyId}".`,
      );
      continue;
    }
    let resolved = false;
    if (memberRef === topology.bodyId) {
      topology.nodes.forEach((node) => nodeIds.add(node.id));
      resolved = true;
    }
    for (const node of topology.nodes) {
      if (node.sourceRefs.includes(memberRef)) {
        nodeIds.add(node.id);
        resolved = true;
      }
    }
    for (const element of topology.elements) {
      if (element.sourceRefs.includes(memberRef)) {
        nodeIds.add(element.nodeI);
        nodeIds.add(element.nodeJ);
        resolved = true;
      }
    }
    if (!resolved) {
      pushUnique(
        errors,
        `Named selection "${selection.name}" member "${memberRef}" does not resolve to body "${topology.bodyId}".`,
      );
    }
  }

  return topology.nodes.filter((node) => nodeIds.has(node.id));
}
