import type {
  AnalysisCase,
  DofMap,
  GeometryBody,
  Material,
  NamedSelection,
  ProjectIR,
  Section,
} from '@/core/ir/types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { applyTransformToPoint } from '@/geometry/transforms';
import { sanitizeArtifactName } from '@/export/shared/artifact-sanitization';
import {
  scopeProjectForAnalysisCaseValidation,
  unsupportedOpenSeesMeshSettings,
} from '@/export/compiler';

const COORDINATE_TOLERANCE = 1e-7;
const VALUE_TOLERANCE = 1e-12;

export interface OpenSeesPyNode {
  id: number;
  x: number;
  y: number;
  z: number;
  bodyId: string;
  sourceRefs: string[];
}

export interface OpenSeesPyTopologyElement {
  id: number;
  nodeI: number;
  nodeJ: number;
  bodyId: string;
  sourceRefs: string[];
}

export interface OpenSeesPyElement extends OpenSeesPyTopologyElement {
  sectionId: string;
  sectionTag: number;
  materialId: string;
  materialTag: number;
  area: number;
  youngModulus: number;
  inertiaZ: number | null;
  transfTag: number;
}

export interface OpenSeesPyFixCondition {
  nodeId: number;
  dofs: number[];
}

export interface OpenSeesPyPrescribedDisplacement {
  nodeId: number;
  dof: number;
  value: number;
}

export interface OpenSeesPyNodalLoad {
  nodeId: number;
  fx: number;
  fy: number;
}

export interface OpenSeesPyTopology {
  bodyId: string;
  shapeType: 'frame2d' | 'truss2d';
  ndm: 2;
  ndf: 2 | 3;
  elementType: 'Truss' | 'elasticBeamColumn';
  nodes: OpenSeesPyNode[];
  elements: OpenSeesPyTopologyElement[];
}

export interface OpenSeesPyModel extends Omit<OpenSeesPyTopology, 'elements'> {
  elements: OpenSeesPyElement[];
  materials: Array<{ tag: number; material: Material; youngModulus: number }>;
  sections: Array<{ tag: number; section: Section }>;
  fixes: OpenSeesPyFixCondition[];
  prescribedDisplacements: OpenSeesPyPrescribedDisplacement[];
  nodalLoads: OpenSeesPyNodalLoad[];
}

export interface OpenSeesPyTopologyResult {
  topology: OpenSeesPyTopology | null;
  errors: string[];
}

export interface OpenSeesPyCompileResult {
  model: OpenSeesPyModel | null;
  topology: OpenSeesPyTopology | null;
  errors: string[];
  warnings: string[];
  analysisCaseId: string | null;
  consumedIds: string[];
  ignoredIds: string[];
}

export interface OpenSeesPyExportResult {
  success: boolean;
  script: string;
  nodesCsv: string;
  elementsCsv: string;
  manifest: string;
  errors: string[];
  warnings: string[];
}

interface LocalNode {
  position: [number, number, number];
  sourceRefs: string[];
}

interface LocalElement {
  nodeI: number;
  nodeJ: number;
  sourceRefs: string[];
}

interface ResolvedBinding<T> {
  value: T;
  selection: NamedSelection;
}

interface OpenSeesCaseScope {
  ir: ProjectIR;
  analysisCase: AnalysisCase | null;
  errors: string[];
  warnings: string[];
  consumedIds: string[];
  ignoredIds: string[];
}

type DofConstraint =
  | { kind: 'fixed' }
  | { kind: 'prescribed'; value: number };

/**
 * Build the OpenSees node/member graph without resolving solver properties.
 * This function is intentionally pure so topology can be tested independently.
 */
export function buildOpenSeesPyTopology(ir: ProjectIR): OpenSeesPyTopologyResult {
  const errors: string[] = [];
  const frameBodies = ir.geometry.bodies.filter((body) => body.category === 'beam_region');

  if (frameBodies.length === 0) {
    return { topology: null, errors: ['No frame/truss geometry found.'] };
  }

  // A mixed/multi-body OpenSees domain needs shared-node and DOF compatibility
  // rules that the current IR does not express. Stop instead of dropping bodies.
  if (frameBodies.length > 1) {
    return {
      topology: null,
      errors: [
        `OpenSeesPy export currently supports exactly one beam_region body; found ${frameBodies.length}. No body was exported.`,
      ],
    };
  }

  const body = frameBodies[0];
  const shapeType = body.metadata.shapeType;
  if (shapeType !== 'frame2d' && shapeType !== 'truss2d') {
    return {
      topology: null,
      errors: [
        `Beam body "${body.name}" has unsupported shapeType "${String(shapeType)}". Expected frame2d or truss2d.`,
      ],
    };
  }

  const bodyVertices = ir.geometry.vertices.filter((vertex) => vertex.body_id === body.id);
  const bodyEdges = ir.geometry.edges.filter((edge) => edge.body_id === body.id);
  let localNodes: LocalNode[] = [];
  let localElements: LocalElement[] = [];

  if (bodyEdges.length > 0) {
    const vertexIndex = new Map(bodyVertices.map((vertex, index) => [vertex.id, index]));
    localNodes = bodyVertices.map((vertex) => ({
      position: vertex.position,
      sourceRefs: [vertex.id],
    }));

    for (const edge of bodyEdges) {
      const nodeI = vertexIndex.get(edge.vertex_ids[0]);
      const nodeJ = vertexIndex.get(edge.vertex_ids[1]);
      if (nodeI === undefined || nodeJ === undefined) {
        pushUnique(
          errors,
          `Edge "${edge.id}" references a missing vertex on beam body "${body.name}".`,
        );
        continue;
      }
      localElements.push({ nodeI, nodeJ, sourceRefs: [edge.id] });
    }
  } else if (shapeType === 'frame2d') {
    const generated = buildFrameTopology(body, errors);
    if (generated) {
      localNodes = matchStoredVertices(body, bodyVertices, generated.nodes, errors);
      localElements = generated.elements;
    }
  } else {
    const generated = buildTrussTopology(body, errors);
    if (generated) {
      localNodes = matchStoredVertices(body, bodyVertices, generated.nodes, errors);
      localElements = generated.elements;
    }
  }

  if (localNodes.length === 0) {
    pushUnique(errors, `Beam body "${body.name}" produced no nodes.`);
  }
  if (localElements.length === 0) {
    pushUnique(errors, `Beam body "${body.name}" produced no elements.`);
  }

  const nodes: OpenSeesPyNode[] = localNodes.map((node, index) => {
    const [x, y, z] = applyTransformToPoint(node.position, body.transform);
    if (![x, y, z].every(Number.isFinite)) {
      pushUnique(errors, `Beam body "${body.name}" produced a non-finite node coordinate.`);
    }
    return {
      id: index + 1,
      x,
      y,
      z,
      bodyId: body.id,
      sourceRefs: node.sourceRefs,
    };
  });
  const referenceZ = nodes[0]?.z;
  if (referenceZ !== undefined && nodes.some((node) =>
    Math.abs(node.z - referenceZ) > COORDINATE_TOLERANCE * Math.max(1, Math.abs(referenceZ), Math.abs(node.z)))) {
    pushUnique(
      errors,
      `Beam body "${body.name}" is not parallel to the global XY plane and cannot be represented by a 2D OpenSees model.`,
    );
  }

  const seenConnectivity = new Set<string>();
  const elements: OpenSeesPyTopologyElement[] = [];
  for (const element of localElements) {
    const nodeI = nodes[element.nodeI];
    const nodeJ = nodes[element.nodeJ];
    if (!nodeI || !nodeJ) {
      pushUnique(errors, `Beam body "${body.name}" contains an element with an invalid node reference.`);
      continue;
    }
    const length = Math.hypot(nodeJ.x - nodeI.x, nodeJ.y - nodeI.y, nodeJ.z - nodeI.z);
    if (!Number.isFinite(length) || length <= COORDINATE_TOLERANCE) {
      pushUnique(
        errors,
        `Beam body "${body.name}" contains a zero-length member between nodes ${nodeI.id} and ${nodeJ.id}.`,
      );
      continue;
    }
    const connectivityKey = [nodeI.id, nodeJ.id].sort((a, b) => a - b).join(':');
    if (seenConnectivity.has(connectivityKey)) {
      pushUnique(
        errors,
        `Beam body "${body.name}" contains duplicate member connectivity ${connectivityKey}.`,
      );
      continue;
    }
    seenConnectivity.add(connectivityKey);
    elements.push({
      id: elements.length + 1,
      nodeI: nodeI.id,
      nodeJ: nodeJ.id,
      bodyId: body.id,
      sourceRefs: element.sourceRefs,
    });
  }
  const connectedNodeIds = new Set(elements.flatMap((element) => [element.nodeI, element.nodeJ]));
  for (const node of nodes) {
    if (!connectedNodeIds.has(node.id)) {
      pushUnique(errors, `Beam body "${body.name}" contains isolated node ${node.id}.`);
    }
  }
  if (nodes.length > 0 && elements.length > 0) {
    const adjacency = new Map(nodes.map((node) => [node.id, new Set<number>()]));
    for (const element of elements) {
      adjacency.get(element.nodeI)?.add(element.nodeJ);
      adjacency.get(element.nodeJ)?.add(element.nodeI);
    }
    const visited = new Set<number>();
    const stack = [nodes[0].id];
    while (stack.length > 0) {
      const nodeId = stack.pop()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      for (const neighbor of adjacency.get(nodeId) ?? []) stack.push(neighbor);
    }
    if (visited.size !== nodes.length) {
      pushUnique(
        errors,
        `Beam body "${body.name}" contains disconnected structural components (${visited.size}/${nodes.length} nodes reachable).`,
      );
    }
  }

  if (errors.length > 0) {
    return { topology: null, errors };
  }

  return {
    topology: {
      bodyId: body.id,
      shapeType,
      ndm: 2,
      ndf: shapeType === 'truss2d' ? 2 : 3,
      elementType: shapeType === 'truss2d' ? 'Truss' : 'elasticBeamColumn',
      nodes,
      elements,
    },
    errors,
  };
}

/**
 * Resolve assignments, supports and loads into a complete solver model.
 * No dates, IDs or external state are generated here; equal IR inputs produce
 * equal compile results.
 */
export function compileOpenSeesPyModel(ir: ProjectIR): OpenSeesPyCompileResult {
  const scope = resolveOpenSeesCaseScope(ir);
  const topologyResult = buildOpenSeesPyTopology(ir);
  const errors = [...scope.errors, ...topologyResult.errors];
  const warnings = [...scope.warnings];
  const topology = topologyResult.topology;
  const coverageFor = (model: OpenSeesPyModel | null) => ({
    analysisCaseId: scope.analysisCase?.id ?? null,
    ...buildOpenSeesCoverage(ir, scope, topology, model),
  });
  if (!topology) return { model: null, topology: null, errors, warnings, ...coverageFor(null) };

  const scopedIr = scope.ir;

  const body = ir.geometry.bodies.find((candidate) => candidate.id === topology.bodyId);
  if (!body) {
    pushUnique(errors, `Beam body "${topology.bodyId}" could not be resolved.`);
    return { model: null, topology, errors, warnings, ...coverageFor(null) };
  }

  const sectionBindings = resolveBindings(
    scopedIr.section_assignments,
    (assignment) => assignment.target_named_selection_id,
    (assignment) => scopedIr.sections.find((section) => section.id === assignment.section_id),
    'section assignment',
    scopedIr,
    errors,
  );
  const materialBindings = resolveBindings(
    scopedIr.material_assignments,
    (assignment) => assignment.target_named_selection_id,
    (assignment) => scopedIr.materials.find((material) => material.id === assignment.material_id),
    'material assignment',
    scopedIr,
    errors,
  );

  const sectionTags = new Map<string, number>();
  const materialTags = new Map<string, number>();
  const resolvedElements: OpenSeesPyElement[] = [];

  for (const element of topology.elements) {
    const matchingSections = sectionBindings.filter((binding) =>
      selectionMatchesElement(binding.selection, body.id, element));

    let section: Section | undefined;
    if (matchingSections.length > 1) {
      pushUnique(errors, `Element ${element.id} has multiple matching section assignments.`);
    } else if (matchingSections.length === 1) {
      section = matchingSections[0].value;
    } else {
      pushUnique(errors, `Element ${element.id} has no resolvable section assignment.`);
    }
    if (!section) continue;
    if (section.orientation_ref) {
      pushUnique(
        errors,
        `Section "${section.name}" uses orientation_ref "${section.orientation_ref}", but local section-axis orientation is not implemented for the 2D OpenSeesPy exporter.`,
      );
      continue;
    }

    const matchingMaterials = materialBindings.filter((binding) =>
      selectionMatchesElement(binding.selection, body.id, element));
    let material = scopedIr.materials.find((candidate) => candidate.id === section.material_id);

    if (matchingMaterials.length > 1) {
      pushUnique(errors, `Element ${element.id} has multiple matching material assignments.`);
      continue;
    }
    if (matchingMaterials.length === 1) {
      const binding = matchingMaterials[0];
      const assignment = scopedIr.material_assignments.find((candidate) =>
        candidate.material_id === binding.value.id
        && candidate.target_named_selection_id === binding.selection.id);
      if (material && material.id !== binding.value.id && !assignment?.override_allowed) {
        pushUnique(
          errors,
          `Element ${element.id} material assignment cannot override section "${section.name}" material without override_allowed.`,
        );
        continue;
      }
      material = binding.value;
    }

    if (!material) {
      pushUnique(
        errors,
        `Section "${section.name}" references missing material "${section.material_id}".`,
      );
      continue;
    }

    const youngModulusRecord = material.parameter_set.young_modulus;
    if (youngModulusRecord.status === 'missing' || youngModulusRecord.status === 'needs_review') {
      pushUnique(errors, `Material "${material.name}" Young's modulus is unresolved (${youngModulusRecord.status}).`);
    }
    if (section.metadata.property_source === 'needs_review') {
      pushUnique(errors, `Section "${section.name}" has unresolved dimension-derived properties.`);
    }

    const area = requirePositive(section.area, `Section "${section.name}" area`, errors);
    const youngModulus = requirePositive(
      material.parameter_set.young_modulus.value,
      `Material "${material.name}" Young's modulus`,
      errors,
    );
    const inertiaZ = topology.elementType === 'elasticBeamColumn'
      ? requirePositive(
        section.inertia_z,
        `Section "${section.name}" inertia_z (the 2D XY bending axis)`,
        errors,
      )
      : null;
    if (area === null || youngModulus === null
      || (topology.elementType === 'elasticBeamColumn' && inertiaZ === null)) {
      continue;
    }

    const sectionTag = getOrCreateTag(sectionTags, section.id);
    const materialTag = getOrCreateTag(materialTags, material.id);
    resolvedElements.push({
      ...element,
      sectionId: section.id,
      sectionTag,
      materialId: material.id,
      materialTag,
      area,
      youngModulus,
      inertiaZ,
      transfTag: 1,
    });
  }

  const usedSectionIds = new Set(resolvedElements.map((element) => element.sectionId));
  const usedMaterialIds = new Set(resolvedElements.map((element) => element.materialId));
  for (const section of scopedIr.sections) {
    if (!usedSectionIds.has(section.id)) {
      pushUnique(errors, `Participating section "${section.name}" is not consumed by any exported element.`);
    }
  }
  for (const material of scopedIr.materials) {
    if (!usedMaterialIds.has(material.id)) {
      pushUnique(errors, `Participating material "${material.name}" is not consumed by any exported element.`);
    }
  }
  for (const assignment of scopedIr.section_assignments) {
    const selection = scopedIr.named_selections.find(
      (candidate) => candidate.id === assignment.target_named_selection_id,
    );
    const consumed = selection && resolvedElements.some(
      (element) => element.sectionId === assignment.section_id
        && selectionMatchesElement(selection, body.id, element),
    );
    if (!consumed) {
      pushUnique(errors, `Participating section assignment "${assignment.id}" is not consumed by any exported element.`);
    }
  }
  for (const assignment of scopedIr.material_assignments) {
    const selection = scopedIr.named_selections.find(
      (candidate) => candidate.id === assignment.target_named_selection_id,
    );
    const consumed = selection && resolvedElements.some(
      (element) => element.materialId === assignment.material_id
        && selectionMatchesElement(selection, body.id, element),
    );
    if (!consumed) {
      pushUnique(errors, `Participating material assignment "${assignment.id}" is not consumed by any exported element.`);
    }
  }

  const { fixes, prescribedDisplacements } = compileConstraints(scopedIr, topology, errors);
  validateTrussStability(topology, fixes, prescribedDisplacements, errors);
  const nodalLoads = compileLoads(scopedIr, topology, errors);

  if (errors.length > 0 || resolvedElements.length !== topology.elements.length) {
    return { model: null, topology, errors, warnings, ...coverageFor(null) };
  }

  const materials = [...materialTags.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([materialId, tag]) => {
      const material = scopedIr.materials.find((candidate) => candidate.id === materialId);
      if (!material) throw new Error(`Resolved material ${materialId} disappeared during compilation.`);
      return {
        tag,
        material,
        youngModulus: material.parameter_set.young_modulus.value as number,
      };
    });
  const sections = [...sectionTags.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([sectionId, tag]) => {
      const section = scopedIr.sections.find((candidate) => candidate.id === sectionId);
      if (!section) throw new Error(`Resolved section ${sectionId} disappeared during compilation.`);
      return { tag, section };
    });

  const model: OpenSeesPyModel = {
    ...topology,
    elements: resolvedElements,
    materials,
    sections,
    fixes,
    prescribedDisplacements,
    nodalLoads,
  };
  return {
    topology,
    errors,
    warnings,
    ...coverageFor(model),
    model,
  };
}

export function exportOpenSeesPy(ir: ProjectIR): OpenSeesPyExportResult {
  const compiled = compileOpenSeesPyModel(ir);
  const { model, topology, errors, warnings } = compiled;
  const script = model ? renderOpenSeesPyScript(ir, model) : '';
  const nodesCsv = topology
    ? ['id,x,y,z', ...topology.nodes.map((node) => `${node.id},${node.x},${node.y},${node.z}`)].join('\n')
    : '';
  const elementsForCsv = model?.elements ?? topology?.elements ?? [];
  const elementsCsv = elementsForCsv.length > 0
    ? [
      'id,nodeI,nodeJ,sectionTag',
      ...elementsForCsv.map((element) => {
        const sectionTag = 'sectionTag' in element ? element.sectionTag : '';
        return `${element.id},${element.nodeI},${element.nodeJ},${sectionTag}`;
      }),
    ].join('\n')
    : '';

  const manifest = JSON.stringify({
    export_target: 'OpenSeesPy',
    export_time: new Date().toISOString(),
    source_project: ir.meta.project_name,
    schema_version: ir.meta.schema_version,
    model_revision: ir.validation.model_revision,
    ndm: topology?.ndm ?? null,
    ndf: topology?.ndf ?? null,
    elementType: topology?.elementType ?? null,
    node_count: topology?.nodes.length ?? 0,
    element_count: topology?.elements.length ?? 0,
    analysis_case_id: compiled.analysisCaseId,
    section_ids: model?.sections.map(({ section }) => section.id) ?? [],
    material_ids: model?.materials.map(({ material }) => material.id) ?? [],
    consumed_ir_ids: compiled.consumedIds,
    ignored_ir_ids: compiled.ignoredIds,
    generated_files: [
      'model.py',
      'nodes.csv',
      'elements.csv',
      'export_manifest.json',
      'requirements.txt',
      'run.sh',
      'README.txt',
    ],
    warnings,
    errors,
  }, null, 2);

  return {
    success: errors.length === 0 && model !== null,
    script,
    nodesCsv,
    elementsCsv,
    manifest,
    errors,
    warnings,
  };
}

function resolveOpenSeesCaseScope(ir: ProjectIR): OpenSeesCaseScope {
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

function buildOpenSeesCoverage(
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

function buildFrameTopology(
  body: GeometryBody,
  errors: string[],
): { nodes: LocalNode[]; elements: LocalElement[] } | null {
  const spanX = readPositiveMetadataNumber(body, 'spanX', errors);
  const spanY = readPositiveMetadataNumber(body, 'spanY', errors);
  const columns = readIntegerMetadataNumber(body, 'columns', 2, errors);
  const floors = readIntegerMetadataNumber(body, 'floors', 1, errors);
  if (spanX === null || spanY === null || columns === null || floors === null) return null;

  const colSpacing = spanX / (columns - 1);
  const floorHeight = spanY / floors;
  const nodes: LocalNode[] = [];
  for (let floor = 0; floor <= floors; floor += 1) {
    for (let column = 0; column < columns; column += 1) {
      nodes.push({
        position: [column * colSpacing, floor * floorHeight, 0],
        sourceRefs: [`${body.id}:node:c${column}:f${floor}`],
      });
    }
  }

  const elements: LocalElement[] = [];
  for (let column = 0; column < columns; column += 1) {
    for (let floor = 0; floor < floors; floor += 1) {
      elements.push({
        nodeI: floor * columns + column,
        nodeJ: (floor + 1) * columns + column,
        sourceRefs: [`${body.id}:column:c${column}:f${floor}`],
      });
    }
  }
  for (let floor = 1; floor <= floors; floor += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      elements.push({
        nodeI: floor * columns + column,
        nodeJ: floor * columns + column + 1,
        sourceRefs: [`${body.id}:beam:c${column}:f${floor}`],
      });
    }
  }
  return { nodes, elements };
}

function buildTrussTopology(
  body: GeometryBody,
  errors: string[],
): { nodes: LocalNode[]; elements: LocalElement[] } | null {
  const span = readPositiveMetadataNumber(body, 'span', errors);
  const height = readPositiveMetadataNumber(body, 'height', errors);
  const divisions = readIntegerMetadataNumber(body, 'divisions', 2, errors);
  if (span === null || height === null || divisions === null) return null;

  const segmentLength = span / divisions;
  const nodes: LocalNode[] = [];
  const bottomNodeIndexes: number[] = [];
  const topNodeIndexes = new Map<number, number>();

  for (let panel = 0; panel <= divisions; panel += 1) {
    bottomNodeIndexes.push(nodes.length);
    nodes.push({
      position: [panel * segmentLength, 0, 0],
      sourceRefs: [`${body.id}:bottom-node:${panel}`],
    });
  }
  for (let panel = 1; panel < divisions; panel += 1) {
    const y = Math.min(panel, divisions - panel) * (height / (divisions / 2));
    topNodeIndexes.set(panel, nodes.length);
    nodes.push({
      position: [panel * segmentLength, y, 0],
      sourceRefs: [`${body.id}:top-node:${panel}`],
    });
  }

  const topNodeIndex = (panel: number): number => {
    if (panel === 0 || panel === divisions) return bottomNodeIndexes[panel];
    return topNodeIndexes.get(panel) as number;
  };

  const elements: LocalElement[] = [];
  // Mirror generateTruss2D: bottom/top chords, vertical webs, then one brace
  // across every interior panel so the pin-jointed graph is not a mechanism.
  for (let panel = 0; panel < divisions; panel += 1) {
    elements.push({
      nodeI: bottomNodeIndexes[panel],
      nodeJ: bottomNodeIndexes[panel + 1],
      sourceRefs: [`${body.id}:bottom:${panel}`],
    });
  }
  for (let panel = 0; panel < divisions; panel += 1) {
    elements.push({
      nodeI: topNodeIndex(panel),
      nodeJ: topNodeIndex(panel + 1),
      sourceRefs: [`${body.id}:top:${panel}`],
    });
  }
  for (let panel = 1; panel < divisions; panel += 1) {
    elements.push({
      nodeI: bottomNodeIndexes[panel],
      nodeJ: topNodeIndex(panel),
      sourceRefs: [`${body.id}:web:${panel}`],
    });
  }
  for (let panel = 1; panel < divisions - 1; panel += 1) {
    elements.push({
      nodeI: panel % 2 === 1 ? bottomNodeIndexes[panel] : topNodeIndex(panel),
      nodeJ: panel % 2 === 1 ? topNodeIndex(panel + 1) : bottomNodeIndexes[panel + 1],
      sourceRefs: [`${body.id}:diagonal:${panel}`],
    });
  }
  return { nodes, elements };
}

function matchStoredVertices(
  body: GeometryBody,
  storedVertices: ProjectIR['geometry']['vertices'],
  generatedNodes: LocalNode[],
  errors: string[],
): LocalNode[] {
  if (storedVertices.length === 0) return generatedNodes;
  if (storedVertices.length !== generatedNodes.length) {
    pushUnique(
      errors,
      `Beam body "${body.name}" has ${storedVertices.length} stored vertices, but metadata requires ${generatedNodes.length}.`,
    );
    return [];
  }

  const unused = new Set(storedVertices.map((vertex) => vertex.id));
  const matched: LocalNode[] = [];
  for (const expected of generatedNodes) {
    const candidates = storedVertices.filter((vertex) =>
      unused.has(vertex.id) && coordinatesEqual(vertex.position, expected.position));
    if (candidates.length !== 1) {
      pushUnique(
        errors,
        `Beam body "${body.name}" vertices do not uniquely match its metadata topology.`,
      );
      return [];
    }
    const vertex = candidates[0];
    unused.delete(vertex.id);
    matched.push({
      position: vertex.position,
      sourceRefs: [vertex.id, ...expected.sourceRefs],
    });
  }
  return matched;
}

function resolveBindings<A, T>(
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

function selectionMatchesElement(
  selection: NamedSelection,
  bodyId: string,
  element: OpenSeesPyTopologyElement,
): boolean {
  const refs = new Set(selection.member_refs);
  return refs.has(bodyId) || element.sourceRefs.some((sourceRef) => refs.has(sourceRef));
}

function compileConstraints(
  ir: ProjectIR,
  topology: OpenSeesPyTopology,
  errors: string[],
): {
  fixes: OpenSeesPyFixCondition[];
  prescribedDisplacements: OpenSeesPyPrescribedDisplacement[];
} {
  const constraints = new Map<number, Array<DofConstraint | undefined>>();
  const activeDofs: Array<{ key: keyof DofMap; dof: number }> = topology.ndf === 3
    ? [{ key: 'ux', dof: 1 }, { key: 'uy', dof: 2 }, { key: 'rz', dof: 3 }]
    : [{ key: 'ux', dof: 1 }, { key: 'uy', dof: 2 }];
  const activeKeys = new Set(activeDofs.map(({ key }) => key));

  for (const bc of ir.boundary_conditions.filter((candidate) => candidate.physics_domain === 'structural')) {
    if (bc.status === 'missing' || bc.status === 'needs_review') {
      pushUnique(errors, `Boundary condition "${bc.name}" is unresolved (${bc.status}).`);
      continue;
    }
    if (bc.bc_type !== 'fixed' && bc.bc_type !== 'prescribed_displacement') {
      pushUnique(errors, `Boundary condition "${bc.name}" has unsupported structural type "${bc.bc_type}".`);
      continue;
    }
    if (bc.temporal_profile !== 'constant') {
      pushUnique(errors, `Boundary condition "${bc.name}" uses unsupported temporal profile "${bc.temporal_profile}".`);
      continue;
    }
    if (bc.coordinate_system !== 'global') {
      pushUnique(errors, `Boundary condition "${bc.name}" uses unsupported coordinate system "${bc.coordinate_system}".`);
      continue;
    }

    const targetNodes = resolveTargetNodes(bc.target_named_selection_id, ir, topology, errors);
    if (targetNodes.length === 0) continue;

    let dofMap = bc.values.dof_map;
    if (!dofMap && bc.bc_type === 'fixed') {
      dofMap = {
        ux: 'fixed', uy: 'fixed', uz: 'free',
        rx: 'free', ry: 'free', rz: topology.ndf === 3 ? 'fixed' : 'free',
      };
    } else if (!dofMap) {
      pushUnique(errors, `Boundary condition "${bc.name}" requires an explicit dof_map.`);
      continue;
    }

    if (bc.bc_type === 'prescribed_displacement') {
      for (const rotationalDof of ['rx', 'ry', 'rz'] as const) {
        if (dofMap[rotationalDof] === 'prescribed') {
          pushUnique(
            errors,
            `Boundary condition "${bc.name}" prescribes rotational DOF ${rotationalDof}, but the current IR stores only translational displacement values in metres.`,
          );
        }
      }
    }

    for (const [key, state] of Object.entries(dofMap) as Array<[keyof DofMap, DofMap[keyof DofMap]]>) {
      if (!activeKeys.has(key) && state === 'prescribed') {
        pushUnique(errors, `Boundary condition "${bc.name}" prescribes inactive 2D DOF ${key}.`);
      }
    }

    for (const node of targetNodes) {
      for (const { key, dof } of activeDofs) {
        const state = dofMap[key];
        if (state === 'free') continue;
        let constraint: DofConstraint;
        if (state === 'fixed') {
          constraint = { kind: 'fixed' };
        } else {
          if (bc.bc_type !== 'prescribed_displacement') {
            pushUnique(
              errors,
              `Boundary condition "${bc.name}" marks ${key} prescribed but is not prescribed_displacement.`,
            );
            continue;
          }
          const value = getPrescribedValue(bc.name, key, bc.values.scalar, bc.values.vector, errors);
          if (value === null) continue;
          constraint = { kind: 'prescribed', value };
        }
        mergeConstraint(constraints, node.id, dof, constraint, bc.name, errors);
      }
    }
  }

  if (constraints.size === 0) {
    pushUnique(
      errors,
      'No structural boundary conditions could be resolved. Define exact named-selection targets before exporting.',
    );
  }
  const rigidBodyRows: number[][] = [];
  for (const [nodeId, nodeConstraints] of constraints) {
    const node = topology.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) continue;
    if (nodeConstraints[0]) rigidBodyRows.push([1, 0, -node.y]);
    if (nodeConstraints[1]) rigidBodyRows.push([0, 1, node.x]);
    if (topology.ndf === 3 && nodeConstraints[2]) rigidBodyRows.push([0, 0, 1]);
  }
  if (matrixRank(rigidBodyRows) < 3) {
    pushUnique(
      errors,
      'Structural constraints do not independently suppress the two translations and in-plane rigid rotation.',
    );
  }

  const fixes: OpenSeesPyFixCondition[] = [];
  const prescribedDisplacements: OpenSeesPyPrescribedDisplacement[] = [];
  for (const [nodeId, nodeConstraints] of [...constraints.entries()].sort((a, b) => a[0] - b[0])) {
    const dofs = Array.from({ length: topology.ndf }, () => 0);
    nodeConstraints.forEach((constraint, index) => {
      if (constraint?.kind === 'fixed') dofs[index] = 1;
      if (constraint?.kind === 'prescribed') {
        prescribedDisplacements.push({ nodeId, dof: index + 1, value: constraint.value });
      }
    });
    if (dofs.some((value) => value === 1)) fixes.push({ nodeId, dofs });
  }
  return { fixes, prescribedDisplacements };
}

function compileLoads(
  ir: ProjectIR,
  topology: OpenSeesPyTopology,
  errors: string[],
): OpenSeesPyNodalLoad[] {
  const loadsByNode = new Map<number, { fx: number; fy: number }>();
  for (const load of ir.loads.filter((candidate) => candidate.physics_domain === 'structural')) {
    if (load.status === 'missing' || load.status === 'needs_review') {
      pushUnique(errors, `Load "${load.name}" is unresolved (${load.status}).`);
      continue;
    }
    if (load.load_type !== 'nodal_force') {
      pushUnique(errors, `Load "${load.name}" has unsupported OpenSeesPy type "${load.load_type}".`);
      continue;
    }
    if (load.application_mode !== 'total') {
      pushUnique(
        errors,
        `Nodal load "${load.name}" has unsupported application mode "${load.application_mode}"; expected total.`,
      );
      continue;
    }
    if (load.distribution !== 'uniform') {
      pushUnique(errors, `Nodal load "${load.name}" has unsupported distribution "${load.distribution}".`);
      continue;
    }
    if (load.temporal_profile !== 'constant') {
      pushUnique(errors, `Nodal load "${load.name}" has unsupported temporal profile "${load.temporal_profile}".`);
      continue;
    }
    if (load.coordinate_system !== 'global') {
      pushUnique(errors, `Nodal load "${load.name}" has unsupported coordinate system "${load.coordinate_system}".`);
      continue;
    }
    if (!Number.isFinite(load.magnitude) || !load.direction.every(Number.isFinite)) {
      pushUnique(errors, `Nodal load "${load.name}" has a non-finite magnitude or direction.`);
      continue;
    }
    const directionNorm = Math.hypot(...load.direction);
    if (Math.abs(directionNorm - 1) > COORDINATE_TOLERANCE) {
      pushUnique(errors, `Nodal load "${load.name}" direction must be a unit vector.`);
      continue;
    }
    if (Math.abs(load.direction[2]) > VALUE_TOLERANCE) {
      pushUnique(errors, `Nodal load "${load.name}" contains an unsupported out-of-plane component.`);
      continue;
    }

    const targetNodes = resolveTargetNodes(load.target_named_selection_id, ir, topology, errors);
    if (targetNodes.length === 0) continue;
    const scale = load.magnitude / targetNodes.length;
    for (const node of targetNodes) {
      const current = loadsByNode.get(node.id) ?? { fx: 0, fy: 0 };
      current.fx += scale * load.direction[0];
      current.fy += scale * load.direction[1];
      loadsByNode.set(node.id, current);
    }
  }
  return [...loadsByNode.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([nodeId, load]) => ({ nodeId, ...load }));
}

function matrixRank(rows: number[][], tolerance = 1e-10): number {
  const matrix = rows.map((row) => [...row]);
  if (matrix.length === 0) return 0;
  const columnCount = Math.max(...matrix.map((row) => row.length));
  let rank = 0;
  for (let column = 0; column < columnCount && rank < matrix.length; column += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < matrix.length; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) <= tolerance) continue;
    [matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]];
    const divisor = matrix[rank][column];
    for (let entry = column; entry < columnCount; entry += 1) matrix[rank][entry] /= divisor;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === rank) continue;
      const factor = matrix[row][column];
      for (let entry = column; entry < columnCount; entry += 1) {
        matrix[row][entry] -= factor * matrix[rank][entry];
      }
    }
    rank += 1;
  }
  return rank;
}

function validateTrussStability(
  topology: OpenSeesPyTopology,
  fixes: OpenSeesPyFixCondition[],
  prescribedDisplacements: OpenSeesPyPrescribedDisplacement[],
  errors: string[],
): void {
  if (topology.elementType !== 'Truss') return;
  if (topology.nodes.length > 250) {
    pushUnique(errors, 'Truss stability rank check is limited to 250 nodes for browser safety.');
    return;
  }
  const dofCount = topology.nodes.length * 2;
  const stiffness = Array.from({ length: dofCount }, () => Array.from({ length: dofCount }, () => 0));
  for (const element of topology.elements) {
    const nodeI = topology.nodes.find((node) => node.id === element.nodeI);
    const nodeJ = topology.nodes.find((node) => node.id === element.nodeJ);
    if (!nodeI || !nodeJ) continue;
    const dx = nodeJ.x - nodeI.x;
    const dy = nodeJ.y - nodeI.y;
    const length = Math.hypot(dx, dy);
    const c = dx / length;
    const s = dy / length;
    const local = [
      [c * c, c * s, -c * c, -c * s],
      [c * s, s * s, -c * s, -s * s],
      [-c * c, -c * s, c * c, c * s],
      [-c * s, -s * s, c * s, s * s],
    ].map((row) => row.map((value) => value / length));
    const indices = [(nodeI.id - 1) * 2, (nodeI.id - 1) * 2 + 1, (nodeJ.id - 1) * 2, (nodeJ.id - 1) * 2 + 1];
    for (let row = 0; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        stiffness[indices[row]][indices[column]] += local[row][column];
      }
    }
  }
  const constrained = new Set<number>();
  for (const fix of fixes) {
    fix.dofs.slice(0, 2).forEach((value, index) => {
      if (value === 1) constrained.add((fix.nodeId - 1) * 2 + index);
    });
  }
  for (const displacement of prescribedDisplacements) {
    if (displacement.dof <= 2) constrained.add((displacement.nodeId - 1) * 2 + displacement.dof - 1);
  }
  if (topology.elements.length + constrained.size < dofCount) {
    pushUnique(errors, 'Truss member/restraint count proves an internal mechanism or insufficient component restraint.');
  }
  const free = Array.from({ length: dofCount }, (_, index) => index).filter((index) => !constrained.has(index));
  const reduced = free.map((row) => free.map((column) => stiffness[row][column]));
  if (matrixRank(reduced, 1e-9) !== free.length) {
    pushUnique(errors, 'Truss stiffness rank check found an internal mechanism or insufficient component restraint.');
  }
}

function resolveTargetNodes(
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

function mergeConstraint(
  constraints: Map<number, Array<DofConstraint | undefined>>,
  nodeId: number,
  dof: number,
  incoming: DofConstraint,
  bcName: string,
  errors: string[],
): void {
  const nodeConstraints = constraints.get(nodeId) ?? [];
  const existing = nodeConstraints[dof - 1];
  if (!existing) {
    nodeConstraints[dof - 1] = incoming;
    constraints.set(nodeId, nodeConstraints);
    return;
  }

  if (existing.kind === 'fixed' && incoming.kind === 'fixed') return;
  if (existing.kind === 'prescribed' && incoming.kind === 'prescribed'
    && Math.abs(existing.value - incoming.value) <= VALUE_TOLERANCE) return;
  if (existing.kind === 'fixed' && incoming.kind === 'prescribed'
    && Math.abs(incoming.value) <= VALUE_TOLERANCE) return;
  if (existing.kind === 'prescribed' && incoming.kind === 'fixed'
    && Math.abs(existing.value) <= VALUE_TOLERANCE) {
    nodeConstraints[dof - 1] = incoming;
    return;
  }
  pushUnique(errors, `Boundary condition "${bcName}" conflicts at node ${nodeId}, DOF ${dof}.`);
}

function getPrescribedValue(
  bcName: string,
  key: keyof DofMap,
  scalar: number | undefined,
  vector: [number, number, number] | undefined,
  errors: string[],
): number | null {
  let value: number | undefined;
  if (key === 'ux' && vector) value = vector[0];
  else if (key === 'uy' && vector) value = vector[1];
  else value = scalar;
  if (value === undefined || !Number.isFinite(value)) {
    pushUnique(errors, `Boundary condition "${bcName}" has no finite value for prescribed DOF ${key}.`);
    return null;
  }
  return value;
}

function renderOpenSeesPyScript(ir: ProjectIR, model: OpenSeesPyModel): string {
  const analysisCaseId = ir.analysis_cases.find(
    (analysisCase) => analysisCase.active && analysisCase.solver_profile_hint.startsWith('openseespy_'),
  )?.id;
  const pythonAnalysisCaseId = analysisCaseId === undefined ? 'None' : JSON.stringify(analysisCaseId);
  const lines: string[] = [
    '# OpenSeesPy script generated by FEM Modeler',
    `# Project: ${singleLineComment(ir.meta.project_name)}`,
    `# Generated: ${new Date().toISOString()}`,
    `# Units: ${singleLineComment(ir.units.system_name)}`,
    '',
    'import openseespy.opensees as ops',
    'import csv',
    'import json',
    '',
    'ops.wipe()',
    `ops.model("basic", "-ndm", ${model.ndm}, "-ndf", ${model.ndf})`,
    '',
    '# --- Nodes ---',
  ];

  for (const node of model.nodes) lines.push(`ops.node(${node.id}, ${node.x}, ${node.y})`);

  lines.push('', '# --- Boundary Conditions ---');
  for (const fix of model.fixes) lines.push(`ops.fix(${fix.nodeId}, ${fix.dofs.join(', ')})`);

  lines.push('', '# --- Materials ---');
  for (const { tag, youngModulus } of model.materials) {
    lines.push(`ops.uniaxialMaterial("Elastic", ${tag}, ${youngModulus})`);
  }

  if (model.elementType === 'elasticBeamColumn') {
    lines.push('', '# --- Geometric Transformation ---', 'ops.geomTransf("Linear", 1)');
  }
  lines.push('', '# --- Elements ---');
  for (const element of model.elements) {
    if (model.elementType === 'elasticBeamColumn') {
      lines.push(
        `ops.element("elasticBeamColumn", ${element.id}, ${element.nodeI}, ${element.nodeJ}, ${element.area}, ${element.youngModulus}, ${element.inertiaZ as number}, ${element.transfTag})`,
      );
    } else {
      lines.push(
        `ops.element("Truss", ${element.id}, ${element.nodeI}, ${element.nodeJ}, ${element.area}, ${element.materialTag})`,
      );
    }
  }

  if (model.nodalLoads.length > 0 || model.prescribedDisplacements.length > 0) {
    lines.push('', '# --- Loads and prescribed displacements ---');
    lines.push('ops.timeSeries("Linear", 1)');
    lines.push('ops.pattern("Plain", 1, 1)');
    for (const displacement of model.prescribedDisplacements) {
      lines.push(`ops.sp(${displacement.nodeId}, ${displacement.dof}, ${displacement.value})`);
    }
    for (const load of model.nodalLoads) {
      if (model.ndf === 3) lines.push(`ops.load(${load.nodeId}, ${load.fx}, ${load.fy}, 0.0)`);
      else lines.push(`ops.load(${load.nodeId}, ${load.fx}, ${load.fy})`);
    }
  }

  lines.push('', '# --- Analysis ---');
  lines.push('ops.system("BandSPD")');
  lines.push('ops.numberer("RCM")');
  lines.push('ops.constraints("Transformation")');
  lines.push('ops.integrator("LoadControl", 1.0)');
  lines.push('ops.algorithm("Linear")');
  lines.push('ops.analysis("Static")');
  lines.push('analysis_result = ops.analyze(1)');
  lines.push('if analysis_result != 0:');
  lines.push('    raise RuntimeError(f"OpenSees analysis failed with code {analysis_result}")');
  lines.push('', '# --- Results ---');
  lines.push('ops.reactions()');
  const resultColumns = model.ndf === 3
    ? ['node_id', 'ux_m', 'uy_m', 'rz_rad', 'reaction_x_N', 'reaction_y_N', 'reaction_mz_Nm']
    : ['node_id', 'ux_m', 'uy_m', 'reaction_x_N', 'reaction_y_N'];
  lines.push(`result_provenance = {"export_target": "OpenSeesPy", "analysis_case_id": ${pythonAnalysisCaseId}, "model_revision": ${ir.validation.model_revision}}`);
  lines.push('with open("results.csv", "w", newline="", encoding="utf-8") as result_file:');
  lines.push('    result_file.write("# FEM_MODELER_PROVENANCE " + json.dumps(result_provenance, separators=(",", ":")) + "\\n")');
  lines.push(`    writer = csv.writer(result_file)`);
  lines.push(`    writer.writerow(${JSON.stringify(resultColumns)})`);
  for (const node of model.nodes) {
    lines.push(`    writer.writerow([${node.id}, *ops.nodeDisp(${node.id}), *ops.nodeReaction(${node.id})])`);
  }
  const appliedX = model.nodalLoads.reduce((sum, load) => sum + load.fx, 0);
  const appliedY = model.nodalLoads.reduce((sum, load) => sum + load.fy, 0);
  lines.push(`applied = [${appliedX}, ${appliedY}]`);
  lines.push(`reaction = [sum(ops.nodeReaction(node)[axis] for node in ${JSON.stringify(model.nodes.map((node) => node.id))}) for axis in range(2)]`);
  lines.push('imbalance = [applied[axis] + reaction[axis] for axis in range(2)]');
  lines.push('balance_tolerance = 1e-6 * max(1.0, *(abs(value) for value in applied))');
  lines.push(`balance_status = "informational_prescribed_displacement" if ${model.prescribedDisplacements.length > 0 ? 'True' : 'False'} else ("pass" if max(abs(value) for value in imbalance) <= balance_tolerance else "fail")`);
  lines.push('with open("result_manifest.json", "w", encoding="utf-8") as manifest_file:');
  lines.push(`    json.dump({"export_target": "OpenSeesPy", "analysis_case_id": ${pythonAnalysisCaseId}, "model_revision": ${ir.validation.model_revision}, "analysis_return_code": analysis_result, "applied_force_N": applied, "reaction_force_N": reaction, "force_imbalance_N": imbalance, "balance_tolerance_N": balance_tolerance, "balance_status": balance_status}, manifest_file, indent=2)`);
  lines.push('if balance_status == "fail":');
  lines.push('    raise RuntimeError(f"Reaction balance check failed: imbalance={imbalance}, tolerance={balance_tolerance}")');
  lines.push('print(f"Analysis complete. Reaction balance: {balance_status}; imbalance={imbalance}")');
  return lines.join('\n');
}

function readPositiveMetadataNumber(
  body: GeometryBody,
  key: string,
  errors: string[],
): number | null {
  const value = body.metadata[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    pushUnique(errors, `Beam body "${body.name}" metadata.${key} must be a finite positive number.`);
    return null;
  }
  return value;
}

function readIntegerMetadataNumber(
  body: GeometryBody,
  key: string,
  minimum: number,
  errors: string[],
): number | null {
  const value = body.metadata[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    pushUnique(errors, `Beam body "${body.name}" metadata.${key} must be an integer >= ${minimum}.`);
    return null;
  }
  return value;
}

function requirePositive(
  value: number | null | undefined,
  label: string,
  errors: string[],
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    pushUnique(errors, `${label} must be a finite positive number; no default was substituted.`);
    return null;
  }
  return value;
}

function getOrCreateTag(tags: Map<string, number>, id: string): number {
  const existing = tags.get(id);
  if (existing !== undefined) return existing;
  const tag = tags.size + 1;
  tags.set(id, tag);
  return tag;
}

function coordinatesEqual(
  left: [number, number, number],
  right: [number, number, number],
): boolean {
  return left.every((value, index) =>
    Math.abs(value - right[index]) <= COORDINATE_TOLERANCE * Math.max(1, Math.abs(value), Math.abs(right[index])));
}

function pushUnique(target: string[], message: string): void {
  if (!target.includes(message)) target.push(message);
}

function singleLineComment(value: string): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
      ? ' '
      : character;
  }).join('').trim();
}

export async function downloadOpenSeesPyZip(
  ir: ProjectIR,
  analysisCaseId?: string,
): Promise<OpenSeesPyExportResult> {
  const exportIr = analysisCaseId ? scopeProjectForAnalysisCaseValidation(ir, analysisCaseId) : ir;
  const result = exportOpenSeesPy(exportIr);
  if (!result.success) return result;

  const zip = new JSZip();
  zip.file('model.py', result.script);
  zip.file('nodes.csv', result.nodesCsv);
  zip.file('elements.csv', result.elementsCsv);
  zip.file('export_manifest.json', result.manifest);
  zip.file('requirements.txt', 'openseespy>=3.7,<4\n');
  zip.file('run.sh', '#!/usr/bin/env bash\nset -euo pipefail\npython -m py_compile model.py\npython model.py | tee solver.log\n');
  zip.file('README.txt', 'Run: python -m pip install -r requirements.txt && bash run.sh\nThe script stops on a non-zero OpenSees analyze() return code.\n');

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${sanitizeArtifactName(ir.meta.project_name)}_openseespy.zip`);
  return result;
}
