import type {
  GeometryBody,
  ProjectIR
} from '@/core/ir/types';
import { applyTransformToPoint } from '@/geometry/transforms';
import { coordinatesEqual, pushUnique, readIntegerMetadataNumber, readPositiveMetadataNumber } from './helpers';
import type { LocalElement, LocalNode, OpenSeesPyNode, OpenSeesPyTopologyElement, OpenSeesPyTopologyResult } from './model';

export const COORDINATE_TOLERANCE = 1e-7;

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

export function buildFrameTopology(
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
  for (let floor = 0;floor <= floors;floor += 1) {
    for (let column = 0;column < columns;column += 1) {
      nodes.push({
        position: [column * colSpacing, floor * floorHeight, 0],
        sourceRefs: [`${body.id}:node:c${column}:f${floor}`],
      });
    }
  }

  const elements: LocalElement[] = [];
  for (let column = 0;column < columns;column += 1) {
    for (let floor = 0;floor < floors;floor += 1) {
      elements.push({
        nodeI: floor * columns + column,
        nodeJ: (floor + 1) * columns + column,
        sourceRefs: [`${body.id}:column:c${column}:f${floor}`],
      });
    }
  }
  for (let floor = 1;floor <= floors;floor += 1) {
    for (let column = 0;column < columns - 1;column += 1) {
      elements.push({
        nodeI: floor * columns + column,
        nodeJ: floor * columns + column + 1,
        sourceRefs: [`${body.id}:beam:c${column}:f${floor}`],
      });
    }
  }
  return { nodes, elements };
}

export function buildTrussTopology(
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

  for (let panel = 0;panel <= divisions;panel += 1) {
    bottomNodeIndexes.push(nodes.length);
    nodes.push({
      position: [panel * segmentLength, 0, 0],
      sourceRefs: [`${body.id}:bottom-node:${panel}`],
    });
  }
  for (let panel = 1;panel < divisions;panel += 1) {
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
  for (let panel = 0;panel < divisions;panel += 1) {
    elements.push({
      nodeI: bottomNodeIndexes[panel],
      nodeJ: bottomNodeIndexes[panel + 1],
      sourceRefs: [`${body.id}:bottom:${panel}`],
    });
  }
  for (let panel = 0;panel < divisions;panel += 1) {
    elements.push({
      nodeI: topNodeIndex(panel),
      nodeJ: topNodeIndex(panel + 1),
      sourceRefs: [`${body.id}:top:${panel}`],
    });
  }
  for (let panel = 1;panel < divisions;panel += 1) {
    elements.push({
      nodeI: bottomNodeIndexes[panel],
      nodeJ: topNodeIndex(panel),
      sourceRefs: [`${body.id}:web:${panel}`],
    });
  }
  for (let panel = 1;panel < divisions - 1;panel += 1) {
    elements.push({
      nodeI: panel % 2 === 1 ? bottomNodeIndexes[panel] : topNodeIndex(panel),
      nodeJ: panel % 2 === 1 ? topNodeIndex(panel + 1) : bottomNodeIndexes[panel + 1],
      sourceRefs: [`${body.id}:diagonal:${panel}`],
    });
  }
  return { nodes, elements };
}

export function matchStoredVertices(
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
