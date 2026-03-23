import * as THREE from 'three';
import { generateId } from '@/core/ir/id-generator';
import type { GeometryBody, GeometryFace } from '@/core/ir/types';

export interface STLImportResult {
  success: boolean;
  body?: GeometryBody;
  faces?: GeometryFace[];
  geometry?: THREE.BufferGeometry;
  error?: string;
  triangleCount?: number;
}

/**
 * Parse an STL file (ASCII or binary) and create a body with topology.
 */
export function importSTL(buffer: ArrayBuffer, fileName: string): STLImportResult {
  try {
    const geometry = parseSTL(buffer);
    if (!geometry) {
      return { success: false, error: 'Failed to parse STL file.' };
    }

    geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    const triangleCount = geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;

    const bodyId = generateId('body');
    const body: GeometryBody = {
      id: bodyId,
      name: fileName.replace(/\.stl$/i, ''),
      category: 'solid',
      visible: true,
      locked: false,
      color: '#607d8b',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      topology_ref: '',
      metadata: { shapeType: 'imported_stl', fileName, triangleCount },
    };

    // Extract faces by grouping triangles with similar normals
    const faces = extractFacesFromSTL(geometry, bodyId);

    return { success: true, body, faces, geometry, triangleCount };
  } catch (e) {
    return { success: false, error: `STL import error: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function parseSTL(buffer: ArrayBuffer): THREE.BufferGeometry | null {
  // Check if ASCII or binary
  const text = new TextDecoder().decode(buffer.slice(0, 80));
  if (text.startsWith('solid') && !isBinarySTL(buffer)) {
    return parseASCIISTL(new TextDecoder().decode(buffer));
  }
  return parseBinarySTL(buffer);
}

function isBinarySTL(buffer: ArrayBuffer): boolean {
  // Binary STL: 80 byte header + 4 byte triangle count
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  const expectedSize = 84 + triCount * 50;
  return Math.abs(buffer.byteLength - expectedSize) < 100;
}

function parseBinarySTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);

  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    // Normal
    const nx = view.getFloat32(offset, true); offset += 4;
    const ny = view.getFloat32(offset, true); offset += 4;
    const nz = view.getFloat32(offset, true); offset += 4;

    for (let v = 0; v < 3; v++) {
      const idx = i * 9 + v * 3;
      positions[idx] = view.getFloat32(offset, true); offset += 4;
      positions[idx + 1] = view.getFloat32(offset, true); offset += 4;
      positions[idx + 2] = view.getFloat32(offset, true); offset += 4;
      normals[idx] = nx;
      normals[idx + 1] = ny;
      normals[idx + 2] = nz;
    }
    offset += 2; // attribute byte count
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

function parseASCIISTL(text: string): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];

  const facetRegex = /facet\s+normal\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g;
  const vertexRegex = /vertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g;

  let facetMatch;
  while ((facetMatch = facetRegex.exec(text)) !== null) {
    const nx = parseFloat(facetMatch[1]);
    const ny = parseFloat(facetMatch[2]);
    const nz = parseFloat(facetMatch[3]);

    for (let v = 0; v < 3; v++) {
      const vMatch = vertexRegex.exec(text);
      if (!vMatch) break;
      positions.push(parseFloat(vMatch[1]), parseFloat(vMatch[2]), parseFloat(vMatch[3]));
      normals.push(nx, ny, nz);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

function extractFacesFromSTL(geometry: THREE.BufferGeometry, bodyId: string): GeometryFace[] {
  const normalAttr = geometry.getAttribute('normal');
  if (!normalAttr) return [];

  const triCount = normalAttr.count / 3;

  // Group triangles by dominant normal direction
  const groups: Map<string, number[]> = new Map();

  for (let i = 0; i < triCount; i++) {
    const nx = normalAttr.getX(i * 3);
    const ny = normalAttr.getY(i * 3);
    const nz = normalAttr.getZ(i * 3);

    // Quantize normal to 6 cardinal + 8 diagonal directions
    const key = quantizeNormal(nx, ny, nz);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  const faceNames = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  const faces: GeometryFace[] = [];
  let faceIdx = 0;

  for (const [, triangles] of groups) {
    const name = faceNames[faceIdx] ?? `face_${faceIdx}`;
    faces.push({
      id: generateId('face'),
      name,
      body_id: bodyId,
      triangle_indices: triangles,
    });
    faceIdx++;
  }

  return faces;
}

function quantizeNormal(nx: number, ny: number, nz: number): string {
  const abs = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  const maxIdx = abs.indexOf(Math.max(...abs));
  const sign = [nx, ny, nz][maxIdx] > 0 ? '+' : '-';
  const axis = ['X', 'Y', 'Z'][maxIdx];
  return `${sign}${axis}`;
}
