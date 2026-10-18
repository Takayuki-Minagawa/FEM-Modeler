import { generateId } from '@/core/ir/id-generator';
import { uniqueNameInSet } from '@/core/ir/names';
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

export const MAX_PATTERN_COPIES = 100;
export const MAX_PATTERN_ENTITIES = 100_000;

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
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_PATTERN_COPIES) {
    throw new Error(`Copies must be an integer between 1 and ${MAX_PATTERN_COPIES}. / 複製数は1〜${MAX_PATTERN_COPIES}の整数にしてください。`);
  }
  if (!offset.every(Number.isFinite)) throw new Error('Pattern offsets must be finite numbers. / オフセットには有限の数値を指定してください。');
  if (bodyIds.length === 0) {
    return { bodies: [], faces: [], edges: [], vertices: [], createdBodyIds: [] };
  }

  const selectedBodies = geometry.bodies.filter((body) => bodyIds.includes(body.id));
  if (selectedBodies.length === 0) {
    return { bodies: [], faces: [], edges: [], vertices: [], createdBodyIds: [] };
  }
  const selected = new Set(selectedBodies.map((body) => body.id));
  const entityCount = selectedBodies.length
    + geometry.faces.filter((entity) => selected.has(entity.body_id)).length
    + geometry.edges.filter((entity) => selected.has(entity.body_id)).length
    + geometry.vertices.filter((entity) => selected.has(entity.body_id)).length;
  if (entityCount * copies > MAX_PATTERN_ENTITIES) {
    throw new Error(`A pattern may create at most ${MAX_PATTERN_ENTITIES.toLocaleString('en-US')} entities. Reduce the copies or selected bodies. / 複製数または選択ボディ数を減らしてください。`);
  }
  if (selectedBodies.some((body) => body.transform.position.some((value, axis) => !Number.isFinite(value + offset[axis] * copies)))) {
    throw new Error('Pattern positions exceed the finite coordinate range. / 複製位置が数値の範囲を超えています。');
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
  const usedNames = new Set(geometry.bodies.map((body) => body.name));

  for (let copyIndex = 1; copyIndex <= copies; copyIndex += 1) {
    for (const body of selectedBodies) {
      const vertexIdMap = new Map<string, string>();
      const bodyVertices = verticesByBody.get(body.id) ?? [];
      const bodyEdges = edgesByBody.get(body.id) ?? [];
      const bodyFaces = facesByBody.get(body.id) ?? [];
      const newBodyId = generateId('body');
      const name = uniqueNameInSet(`${body.name} Copy ${copyIndex}`, usedNames);
      usedNames.add(name);

      const clonedBody: GeometryBody = {
        ...body,
        id: newBodyId,
        name,
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
