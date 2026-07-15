import * as THREE from 'three';
import { generateId } from '@/core/ir/id-generator';
import type { GeometryAsset, GeometryBody, GeometryFace } from '@/core/ir/types';

export const MAX_STL_BYTES = 50 * 1024 * 1024;
const MAX_TRIANGLES = 1_000_000;
const TOPOLOGY_CHECK_TRIANGLES = 250_000;

export type STLSourceUnit = GeometryAsset['source_unit'];
export const STL_SOURCE_UNIT_TO_METERS: Record<STLSourceUnit, number> = {
  m: 1,
  mm: 1e-3,
  cm: 1e-2,
  in: 0.0254,
  ft: 0.3048,
};

export interface STLImportResult {
  success: boolean;
  body?: GeometryBody;
  faces?: GeometryFace[];
  asset?: GeometryAsset;
  geometry?: THREE.BufferGeometry;
  error?: string;
  triangleCount?: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function contentHash(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * prime) & mask;
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function validateGeometry(geometry: THREE.BufferGeometry): {
  triangleCount: number;
  degenerateTriangles: number;
  finiteCoordinates: boolean;
  watertight: boolean | null;
  manifold: boolean | null;
} {
  const positions = geometry.getAttribute('position');
  if (!positions || positions.count === 0 || positions.count % 3 !== 0) {
    throw new Error('STL must contain one or more complete triangles.');
  }
  const triangleCount = positions.count / 3;
  if (triangleCount > MAX_TRIANGLES) throw new Error(`STL exceeds the ${MAX_TRIANGLES.toLocaleString()} triangle safety limit.`);

  let finiteCoordinates = true;
  let degenerateTriangles = 0;
  const edgeCounts = triangleCount <= TOPOLOGY_CHECK_TRIANGLES ? new Map<string, number>() : null;
  const keyFor = (index: number) => `${positions.getX(index).toPrecision(9)},${positions.getY(index).toPrecision(9)},${positions.getZ(index).toPrecision(9)}`;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const a = new THREE.Vector3(positions.getX(offset), positions.getY(offset), positions.getZ(offset));
    const b = new THREE.Vector3(positions.getX(offset + 1), positions.getY(offset + 1), positions.getZ(offset + 1));
    const c = new THREE.Vector3(positions.getX(offset + 2), positions.getY(offset + 2), positions.getZ(offset + 2));
    if (![a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].every(Number.isFinite)) finiteCoordinates = false;
    if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).lengthSq() <= 1e-24) degenerateTriangles += 1;
    if (edgeCounts) {
      const keys = [keyFor(offset), keyFor(offset + 1), keyFor(offset + 2)];
      for (const [left, right] of [[0, 1], [1, 2], [2, 0]] as const) {
        const edge = keys[left] < keys[right] ? `${keys[left]}|${keys[right]}` : `${keys[right]}|${keys[left]}`;
        edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
      }
    }
  }
  if (!finiteCoordinates) throw new Error('STL contains NaN or infinite coordinates.');
  if (degenerateTriangles === triangleCount) throw new Error('Every STL triangle is degenerate.');

  const counts = edgeCounts ? [...edgeCounts.values()] : null;
  return {
    triangleCount,
    degenerateTriangles,
    finiteCoordinates,
    watertight: counts ? counts.every((count) => count === 2) : null,
    manifold: counts ? counts.every((count) => count <= 2) : null,
  };
}

/** Parse and validate an ASCII or binary STL into a portable project asset. */
export function importSTL(
  buffer: ArrayBuffer,
  fileName: string,
  scaleToMeters = 1,
  sourceUnit: STLSourceUnit = 'm',
): STLImportResult {
  try {
    if (buffer.byteLength === 0) throw new Error('STL file is empty.');
    if (buffer.byteLength > MAX_STL_BYTES) throw new Error(`STL exceeds the ${MAX_STL_BYTES / 1024 / 1024} MB file-size limit.`);
    if (!Number.isFinite(scaleToMeters) || scaleToMeters <= 0
        || Math.abs(scaleToMeters - STL_SOURCE_UNIT_TO_METERS[sourceUnit]) > 1e-15) {
      throw new Error('STL source unit and metre scale are inconsistent.');
    }
    const geometry = parseSTL(buffer);
    geometry.scale(scaleToMeters, scaleToMeters, scaleToMeters);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const diagnostics = validateGeometry(geometry);
    const bounds = geometry.boundingBox;
    if (!bounds) throw new Error('STL bounds could not be computed.');

    const assetId = generateId('asset');
    const bodyId = generateId('body');
    const bytes = new Uint8Array(buffer);
    const asset: GeometryAsset = {
      id: assetId,
      kind: 'stl_mesh',
      file_name: fileName,
      media_type: 'model/stl',
      encoding: 'base64',
      data: bytesToBase64(bytes),
      content_hash: contentHash(bytes),
      byte_length: bytes.byteLength,
      source_unit: sourceUnit,
      scale_to_meters: scaleToMeters,
      triangle_count: diagnostics.triangleCount,
      bounds: {
        min: bounds.min.toArray() as [number, number, number],
        max: bounds.max.toArray() as [number, number, number],
      },
      diagnostics: {
        degenerate_triangles: diagnostics.degenerateTriangles,
        finite_coordinates: diagnostics.finiteCoordinates,
        watertight: diagnostics.watertight,
        manifold: diagnostics.manifold,
      },
    };
    const body: GeometryBody = {
      id: bodyId,
      name: fileName.replace(/\.stl$/i, ''),
      category: diagnostics.watertight === true ? 'solid' : 'shell',
      visible: true,
      locked: false,
      color: '#607d8b',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      topology_ref: '',
      asset_ref: assetId,
      metadata: {
        shapeType: 'imported_stl',
        fileName,
        triangleCount: diagnostics.triangleCount,
        contentHash: asset.content_hash,
        sourceUnit,
        scaleToMeters,
      },
    };
    return {
      success: true,
      body,
      faces: extractFacesFromSTL(geometry, bodyId),
      asset,
      geometry,
      triangleCount: diagnostics.triangleCount,
    };
  } catch (error) {
    return { success: false, error: `STL import error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function base64ToBytes(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_STL_BYTES / 3) * 4 + 4) {
    throw new Error('Encoded STL exceeds the 50 MB safety limit.');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function boundsMatch(
  actual: [number, number, number],
  declared: [number, number, number],
): boolean {
  return actual.every((value, index) => (
    Number.isFinite(declared[index])
    && Math.abs(value - declared[index]) <= 1e-7 * Math.max(1, Math.abs(value), Math.abs(declared[index]))
  ));
}

/** Validate embedded bytes and all derived STL metadata before project load. */
export function validateSTLAsset(asset: GeometryAsset): THREE.BufferGeometry {
  if (asset.encoding !== 'base64' || asset.kind !== 'stl_mesh') {
    throw new Error(`Unsupported geometry asset ${asset.id}.`);
  }
  if (Math.abs(asset.scale_to_meters - STL_SOURCE_UNIT_TO_METERS[asset.source_unit]) > 1e-15) {
    throw new Error(`Geometry asset ${asset.id} has inconsistent source-unit scaling.`);
  }
  const bytes = base64ToBytes(asset.data);
  if (bytes.byteLength !== asset.byte_length) {
    throw new Error(`Geometry asset ${asset.id} byte length does not match its metadata.`);
  }
  if (contentHash(bytes) !== asset.content_hash) {
    throw new Error(`Geometry asset ${asset.id} content hash does not match its bytes.`);
  }
  const rawBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(rawBuffer).set(bytes);
  const geometry = parseSTL(rawBuffer);
  geometry.scale(asset.scale_to_meters, asset.scale_to_meters, asset.scale_to_meters);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const diagnostics = validateGeometry(geometry);
  const bounds = geometry.boundingBox;
  if (!bounds
      || diagnostics.triangleCount !== asset.triangle_count
      || diagnostics.degenerateTriangles !== asset.diagnostics.degenerate_triangles
      || diagnostics.finiteCoordinates !== asset.diagnostics.finite_coordinates
      || diagnostics.watertight !== asset.diagnostics.watertight
      || diagnostics.manifold !== asset.diagnostics.manifold
      || !boundsMatch(bounds.min.toArray() as [number, number, number], asset.bounds.min)
      || !boundsMatch(bounds.max.toArray() as [number, number, number], asset.bounds.max)) {
    geometry.dispose();
    throw new Error(`Geometry asset ${asset.id} derived topology metadata is inconsistent.`);
  }
  return geometry;
}

export function parseSTL(buffer: ArrayBuffer): THREE.BufferGeometry {
  if (buffer.byteLength >= 84) {
    const count = new DataView(buffer).getUint32(80, true);
    const expected = 84 + count * 50;
    if (expected === buffer.byteLength) return parseBinarySTL(buffer, count);
  }
  const text = new TextDecoder().decode(buffer);
  if (/^\s*solid\b/i.test(text)) return parseASCIISTL(text);
  throw new Error('Binary STL length does not match 84 + 50 × triangleCount, and the file is not ASCII STL.');
}

function parseBinarySTL(buffer: ArrayBuffer, triangleCount: number): THREE.BufferGeometry {
  if (triangleCount === 0) throw new Error('Binary STL declares zero triangles.');
  if (triangleCount > MAX_TRIANGLES) throw new Error(`Binary STL declares too many triangles (${triangleCount}).`);
  const view = new DataView(buffer);
  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  let offset = 84;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const nx = view.getFloat32(offset, true); offset += 4;
    const ny = view.getFloat32(offset, true); offset += 4;
    const nz = view.getFloat32(offset, true); offset += 4;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const index = triangle * 9 + vertex * 3;
      positions[index] = view.getFloat32(offset, true); offset += 4;
      positions[index + 1] = view.getFloat32(offset, true); offset += 4;
      positions[index + 2] = view.getFloat32(offset, true); offset += 4;
      normals[index] = nx;
      normals[index + 1] = ny;
      normals[index + 2] = nz;
    }
    offset += 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

function parseASCIISTL(text: string): THREE.BufferGeometry {
  const positions: number[] = [];
  const vertexRegex = /\bvertex\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = vertexRegex.exec(text)) !== null) {
    positions.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  if (positions.length === 0 || positions.length % 9 !== 0) throw new Error('ASCII STL has an incomplete triangle list.');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function extractFacesFromSTL(geometry: THREE.BufferGeometry, bodyId: string): GeometryFace[] {
  const normalAttribute = geometry.getAttribute('normal');
  if (!normalAttribute) return [];
  const groups = new Map<string, number[]>();
  for (let triangle = 0; triangle < normalAttribute.count / 3; triangle += 1) {
    const index = triangle * 3;
    const values = [normalAttribute.getX(index), normalAttribute.getY(index), normalAttribute.getZ(index)];
    const dominant = values.map(Math.abs).indexOf(Math.max(...values.map(Math.abs)));
    const key = `${values[dominant] >= 0 ? '+' : '-'}${['X', 'Y', 'Z'][dominant]}`;
    const group = groups.get(key) ?? [];
    group.push(triangle);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([name, triangleIndices]) => ({
    id: generateId('face'),
    name,
    body_id: bodyId,
    triangle_indices: triangleIndices,
  }));
}
