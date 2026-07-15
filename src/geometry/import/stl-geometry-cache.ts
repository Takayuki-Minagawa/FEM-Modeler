import type * as THREE from 'three';
import type { GeometryAsset, ProjectIR } from '@/core/ir/types';
import { validateSTLAsset } from './stl-loader';

const cache = new Map<string, THREE.BufferGeometry>();

export function cacheSTLGeometry(bodyId: string, geometry: THREE.BufferGeometry): void {
  const previous = cache.get(bodyId);
  if (previous && previous !== geometry) previous.dispose();
  cache.set(bodyId, geometry);
}

export function getSTLGeometry(bodyId: string): THREE.BufferGeometry | null {
  return cache.get(bodyId) ?? null;
}

export function restoreSTLGeometry(bodyId: string, asset: GeometryAsset): THREE.BufferGeometry {
  const existing = cache.get(bodyId);
  if (existing) return existing;
  const geometry = validateSTLAsset(asset);
  cache.set(bodyId, geometry);
  return geometry;
}

export function hydrateSTLGeometryCache(ir: ProjectIR): string[] {
  const errors: string[] = [];
  const assets = new Map(ir.assets.map((asset) => [asset.id, asset]));
  for (const body of ir.geometry.bodies.filter((item) => item.metadata.shapeType === 'imported_stl')) {
    const asset = body.asset_ref ? assets.get(body.asset_ref) : undefined;
    if (!asset) {
      errors.push(`STL body ${body.id} references a missing asset.`);
      continue;
    }
    try {
      restoreSTLGeometry(body.id, asset);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return errors;
}

export function removeSTLGeometry(bodyId: string): void {
  cache.get(bodyId)?.dispose();
  cache.delete(bodyId);
}

export function clearSTLGeometryCache(): void {
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}
