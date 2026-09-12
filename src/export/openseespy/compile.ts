import type {
  DofMap,
  ProjectIR,
  Section
} from '@/core/ir/types';
import { getOrCreateTag, pushUnique, requirePositive, VALUE_TOLERANCE } from './helpers';
import type { DofConstraint, OpenSeesPyCompileResult, OpenSeesPyElement, OpenSeesPyFixCondition, OpenSeesPyModel, OpenSeesPyNodalLoad, OpenSeesPyPrescribedDisplacement, OpenSeesPyTopology } from './model';
import { buildOpenSeesCoverage, resolveBindings, resolveOpenSeesCaseScope, resolveTargetNodes, selectionMatchesElement } from './resolve';
import { buildOpenSeesPyTopology, COORDINATE_TOLERANCE } from './topology';

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

export function compileConstraints(
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

export function compileLoads(
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

export function matrixRank(rows: number[][], tolerance = 1e-10): number {
  const matrix = rows.map((row) => [...row]);
  if (matrix.length === 0) return 0;
  const columnCount = Math.max(...matrix.map((row) => row.length));
  let rank = 0;
  for (let column = 0;column < columnCount && rank < matrix.length;column += 1) {
    let pivot = rank;
    for (let row = rank + 1;row < matrix.length;row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) <= tolerance) continue;
    [matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]];
    const divisor = matrix[rank][column];
    for (let entry = column;entry < columnCount;entry += 1) matrix[rank][entry] /= divisor;
    for (let row = 0;row < matrix.length;row += 1) {
      if (row === rank) continue;
      const factor = matrix[row][column];
      for (let entry = column;entry < columnCount;entry += 1) {
        matrix[row][entry] -= factor * matrix[rank][entry];
      }
    }
    rank += 1;
  }
  return rank;
}

export function validateTrussStability(
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
    for (let row = 0;row < 4;row += 1) {
      for (let column = 0;column < 4;column += 1) {
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

export function mergeConstraint(
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

export function getPrescribedValue(
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
