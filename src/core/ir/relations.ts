import type { ProjectIR } from './types';

export interface ReferenceIssue {
  code: 'DUPLICATE_ID' | 'BROKEN_REFERENCE';
  sourceId: string;
  field: string;
  missingId: string;
}

type ParticipationField = keyof Pick<
  ProjectIR['analysis_cases'][number],
  | 'participating_material_ids'
  | 'participating_section_ids'
  | 'participating_bc_ids'
  | 'participating_load_ids'
  | 'participating_ic_ids'
>;

function removeFromAnalysisCases(ir: ProjectIR, field: ParticipationField, removedIds: Set<string>): void {
  for (const analysisCase of ir.analysis_cases) {
    analysisCase[field] = analysisCase[field].filter((id) => !removedIds.has(id));
  }
}

function removeNamedSelectionDependents(ir: ProjectIR, removedIds: Set<string>): void {
  const removedBcIds = new Set(ir.boundary_conditions.filter((item) => removedIds.has(item.target_named_selection_id)).map((item) => item.id));
  const removedLoadIds = new Set(ir.loads.filter((item) => removedIds.has(item.target_named_selection_id)).map((item) => item.id));
  const removedIcIds = new Set(ir.initial_conditions.filter((item) => removedIds.has(item.target_named_selection_id)).map((item) => item.id));

  ir.material_assignments = ir.material_assignments.filter((item) => !removedIds.has(item.target_named_selection_id));
  ir.section_assignments = ir.section_assignments.filter((item) => !removedIds.has(item.target_named_selection_id));
  ir.boundary_conditions = ir.boundary_conditions.filter((item) => !removedBcIds.has(item.id));
  ir.loads = ir.loads.filter((item) => !removedLoadIds.has(item.id));
  ir.initial_conditions = ir.initial_conditions.filter((item) => !removedIcIds.has(item.id));
  ir.mesh_controls.local = ir.mesh_controls.local.filter((item) => !removedIds.has(item.target_named_selection_id));
  removeFromAnalysisCases(ir, 'participating_bc_ids', removedBcIds);
  removeFromAnalysisCases(ir, 'participating_load_ids', removedLoadIds);
  removeFromAnalysisCases(ir, 'participating_ic_ids', removedIcIds);
}

export function deleteNamedSelectionCascade(ir: ProjectIR, id: string): void {
  const removedIds = new Set([id]);
  ir.named_selections = ir.named_selections.filter((item) => !removedIds.has(item.id));
  removeNamedSelectionDependents(ir, removedIds);
}

export function deleteBodyCascade(ir: ProjectIR, id: string): void {
  const entityIds = new Set<string>([id]);
  for (const item of ir.geometry.faces) if (item.body_id === id) entityIds.add(item.id);
  for (const item of ir.geometry.edges) if (item.body_id === id) entityIds.add(item.id);
  for (const item of ir.geometry.vertices) if (item.body_id === id) entityIds.add(item.id);

  ir.geometry.bodies = ir.geometry.bodies.filter((item) => item.id !== id);
  ir.geometry.faces = ir.geometry.faces.filter((item) => item.body_id !== id);
  ir.geometry.edges = ir.geometry.edges.filter((item) => item.body_id !== id);
  ir.geometry.vertices = ir.geometry.vertices.filter((item) => item.body_id !== id);

  const emptySelectionIds = new Set<string>();
  for (const selection of ir.named_selections) {
    selection.member_refs = selection.member_refs.filter((ref) => !entityIds.has(ref));
    if (selection.member_refs.length === 0) emptySelectionIds.add(selection.id);
  }
  ir.named_selections = ir.named_selections.filter((item) => !emptySelectionIds.has(item.id));
  removeNamedSelectionDependents(ir, emptySelectionIds);
}

export function deleteMaterialCascade(ir: ProjectIR, id: string): void {
  const removedMaterialIds = new Set([id]);
  const removedSectionIds = new Set(ir.sections.filter((item) => item.material_id === id).map((item) => item.id));
  ir.materials = ir.materials.filter((item) => item.id !== id);
  ir.material_assignments = ir.material_assignments.filter((item) => item.material_id !== id);
  ir.sections = ir.sections.filter((item) => !removedSectionIds.has(item.id));
  ir.section_assignments = ir.section_assignments.filter((item) => !removedSectionIds.has(item.section_id));
  removeFromAnalysisCases(ir, 'participating_material_ids', removedMaterialIds);
  removeFromAnalysisCases(ir, 'participating_section_ids', removedSectionIds);
}

export function deleteSectionCascade(ir: ProjectIR, id: string): void {
  const removedIds = new Set([id]);
  ir.sections = ir.sections.filter((item) => item.id !== id);
  ir.section_assignments = ir.section_assignments.filter((item) => item.section_id !== id);
  removeFromAnalysisCases(ir, 'participating_section_ids', removedIds);
}

export function deleteBoundaryConditionCascade(ir: ProjectIR, id: string): void {
  const removedIds = new Set([id]);
  ir.boundary_conditions = ir.boundary_conditions.filter((item) => item.id !== id);
  removeFromAnalysisCases(ir, 'participating_bc_ids', removedIds);
}

export function deleteLoadCascade(ir: ProjectIR, id: string): void {
  const removedIds = new Set([id]);
  ir.loads = ir.loads.filter((item) => item.id !== id);
  removeFromAnalysisCases(ir, 'participating_load_ids', removedIds);
}

export function deleteInitialConditionCascade(ir: ProjectIR, id: string): void {
  const removedIds = new Set([id]);
  ir.initial_conditions = ir.initial_conditions.filter((item) => item.id !== id);
  removeFromAnalysisCases(ir, 'participating_ic_ids', removedIds);
}

export function validateReferences(ir: ProjectIR): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const ids = new Set<string>();
  const duplicateIds = new Set<string>();
  const register = (id: string) => (ids.has(id) ? duplicateIds.add(id) : ids.add(id));

  register(ir.meta.project_id);
  for (const collection of [
    ir.geometry.bodies,
    ir.geometry.faces,
    ir.geometry.edges,
    ir.geometry.vertices,
    ir.geometry.reference_frames,
    ir.geometry.geometry_parameters,
    ir.assets,
    ir.named_selections,
    ir.materials,
    ir.material_assignments,
    ir.sections,
    ir.section_assignments,
    ir.mesh_controls.local,
    ir.boundary_conditions,
    ir.loads,
    ir.initial_conditions,
    ir.analysis_cases,
    ir.results,
  ]) for (const item of collection) register(item.id);
  for (const id of duplicateIds) issues.push({ code: 'DUPLICATE_ID', sourceId: id, field: 'id', missingId: id });

  const check = (sourceId: string, field: string, value: string, valid: Set<string>) => {
    if (value && !valid.has(value)) issues.push({ code: 'BROKEN_REFERENCE', sourceId, field, missingId: value });
  };
  const bodies = new Set(ir.geometry.bodies.map((item) => item.id));
  const vertices = new Set(ir.geometry.vertices.map((item) => item.id));
  const assets = new Set(ir.assets.map((item) => item.id));
  const geometryEntities = new Set([
    ...bodies,
    ...ir.geometry.faces.map((item) => item.id),
    ...ir.geometry.edges.map((item) => item.id),
    ...ir.geometry.vertices.map((item) => item.id),
  ]);
  const referenceFrames = new Set(ir.geometry.reference_frames.map((item) => item.id));
  const attachableGeometry = new Set([...geometryEntities, ...referenceFrames]);
  const namedSelections = new Set(ir.named_selections.map((item) => item.id));
  const materials = new Set(ir.materials.map((item) => item.id));
  const sections = new Set(ir.sections.map((item) => item.id));
  const bcs = new Set(ir.boundary_conditions.map((item) => item.id));
  const loads = new Set(ir.loads.map((item) => item.id));
  const ics = new Set(ir.initial_conditions.map((item) => item.id));
  const analysisCases = new Set(ir.analysis_cases.map((item) => item.id));

  for (const face of ir.geometry.faces) check(face.id, 'body_id', face.body_id, bodies);
  for (const edge of ir.geometry.edges) {
    check(edge.id, 'body_id', edge.body_id, bodies);
    for (const vertexId of edge.vertex_ids) check(edge.id, 'vertex_ids', vertexId, vertices);
  }
  for (const vertex of ir.geometry.vertices) check(vertex.id, 'body_id', vertex.body_id, bodies);
  for (const frame of ir.geometry.reference_frames) {
    if (frame.attached_to) check(frame.id, 'attached_to', frame.attached_to, attachableGeometry);
  }
  for (const body of ir.geometry.bodies) if (body.asset_ref) check(body.id, 'asset_ref', body.asset_ref, assets);
  for (const selection of ir.named_selections) for (const ref of selection.member_refs) check(selection.id, 'member_refs', ref, geometryEntities);
  for (const item of ir.material_assignments) {
    check(item.id, 'material_id', item.material_id, materials);
    check(item.id, 'target_named_selection_id', item.target_named_selection_id, namedSelections);
  }
  for (const item of ir.sections) {
    check(item.id, 'material_id', item.material_id, materials);
    if (item.orientation_ref) check(item.id, 'orientation_ref', item.orientation_ref, referenceFrames);
  }
  for (const item of ir.section_assignments) {
    check(item.id, 'section_id', item.section_id, sections);
    check(item.id, 'target_named_selection_id', item.target_named_selection_id, namedSelections);
  }
  for (const item of [...ir.boundary_conditions, ...ir.loads, ...ir.initial_conditions, ...ir.mesh_controls.local]) {
    check(item.id, 'target_named_selection_id', item.target_named_selection_id, namedSelections);
  }
  for (const item of [...ir.boundary_conditions, ...ir.loads]) {
    if (item.coordinate_system !== 'global') {
      check(item.id, 'coordinate_system', item.coordinate_system, referenceFrames);
    }
  }
  const noFunctionDefinitions = new Set<string>();
  for (const item of [...ir.boundary_conditions, ...ir.initial_conditions]) {
    if (item.values.function_ref) check(item.id, 'values.function_ref', item.values.function_ref, noFunctionDefinitions);
  }
  for (const item of ir.analysis_cases) {
    for (const ref of item.participating_material_ids) check(item.id, 'participating_material_ids', ref, materials);
    for (const ref of item.participating_section_ids) check(item.id, 'participating_section_ids', ref, sections);
    for (const ref of item.participating_bc_ids) check(item.id, 'participating_bc_ids', ref, bcs);
    for (const ref of item.participating_load_ids) check(item.id, 'participating_load_ids', ref, loads);
    for (const ref of item.participating_ic_ids) check(item.id, 'participating_ic_ids', ref, ics);
  }
  for (const result of ir.results) check(result.id, 'analysis_case_id', result.analysis_case_id, analysisCases);
  return issues;
}
