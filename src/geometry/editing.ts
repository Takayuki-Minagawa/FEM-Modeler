import { generateId } from '@/core/ir/id-generator';
import type {
  GeometryBody,
  GeometryEdge,
  GeometryFace,
  GeometryVertex,
} from '@/core/ir/types';

interface GeometrySnapshot {
  bodies: GeometryBody[];
  faces: GeometryFace[];
  edges: GeometryEdge[];
  vertices: GeometryVertex[];
}

interface DuplicateLinearResult {
  bodies: GeometryBody[];
  faces: GeometryFace[];
  edges: GeometryEdge[];
  vertices: GeometryVertex[];
  createdBodyIds: string[];
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (typeof structuredClone === 'function') {
    return structuredClone(metadata);
  }
  return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

export function duplicateBodiesLinear(
  geometry: GeometrySnapshot,
  bodyIds: string[],
  copies: number,
  offset: [number, number, number],
): DuplicateLinearResult {
  if (copies < 1 || bodyIds.length === 0) {
    return { bodies: [], faces: [], edges: [], vertices: [], createdBodyIds: [] };
  }

  const selectedBodies = geometry.bodies.filter((body) => bodyIds.includes(body.id));
  if (selectedBodies.length === 0) {
    return { bodies: [], faces: [], edges: [], vertices: [], createdBodyIds: [] };
  }

  const facesByBody = new Map<string, GeometryFace[]>();
  const edgesByBody = new Map<string, GeometryEdge[]>();
  const verticesByBody = new Map<string, GeometryVertex[]>();

  for (const face of geometry.faces) {
    const bucket = facesByBody.get(face.body_id);
    if (bucket) {
      bucket.push(face);
    } else {
      facesByBody.set(face.body_id, [face]);
    }
  }

  for (const edge of geometry.edges) {
    const bucket = edgesByBody.get(edge.body_id);
    if (bucket) {
      bucket.push(edge);
    } else {
      edgesByBody.set(edge.body_id, [edge]);
    }
  }

  for (const vertex of geometry.vertices) {
    const bucket = verticesByBody.get(vertex.body_id);
    if (bucket) {
      bucket.push(vertex);
    } else {
      verticesByBody.set(vertex.body_id, [vertex]);
    }
  }

  const newBodies: GeometryBody[] = [];
  const newFaces: GeometryFace[] = [];
  const newEdges: GeometryEdge[] = [];
  const newVertices: GeometryVertex[] = [];
  const createdBodyIds: string[] = [];

  for (let copyIndex = 1; copyIndex <= copies; copyIndex += 1) {
    for (const body of selectedBodies) {
      const vertexIdMap = new Map<string, string>();
      const bodyVertices = verticesByBody.get(body.id) ?? [];
      const bodyEdges = edgesByBody.get(body.id) ?? [];
      const bodyFaces = facesByBody.get(body.id) ?? [];
      const newBodyId = generateId('body');

      const clonedBody: GeometryBody = {
        ...body,
        id: newBodyId,
        name: `${body.name} Copy ${copyIndex}`,
        transform: {
          position: [
            body.transform.position[0] + offset[0] * copyIndex,
            body.transform.position[1] + offset[1] * copyIndex,
            body.transform.position[2] + offset[2] * copyIndex,
          ],
          rotation: [...body.transform.rotation] as [number, number, number],
          scale: [...body.transform.scale] as [number, number, number],
        },
        metadata: cloneMetadata(body.metadata),
      };

      for (const vertex of bodyVertices) {
        const newVertexId = generateId('vertex');
        vertexIdMap.set(vertex.id, newVertexId);
        newVertices.push({
          ...vertex,
          id: newVertexId,
          body_id: newBodyId,
          position: [...vertex.position] as [number, number, number],
        });
      }

      for (const edge of bodyEdges) {
        const [startId, endId] = edge.vertex_ids;
        const mappedStart = vertexIdMap.get(startId);
        const mappedEnd = vertexIdMap.get(endId);
        if (!mappedStart || !mappedEnd) {
          continue;
        }
        newEdges.push({
          ...edge,
          id: generateId('edge'),
          body_id: newBodyId,
          vertex_ids: [mappedStart, mappedEnd],
        });
      }

      for (const face of bodyFaces) {
        newFaces.push({
          ...face,
          id: generateId('face'),
          body_id: newBodyId,
          normal: face.normal ? [...face.normal] as [number, number, number] : undefined,
          triangle_indices: [...face.triangle_indices],
        });
      }

      newBodies.push(clonedBody);
      createdBodyIds.push(newBodyId);
    }
  }

  return {
    bodies: newBodies,
    faces: newFaces,
    edges: newEdges,
    vertices: newVertices,
    createdBodyIds,
  };
}
