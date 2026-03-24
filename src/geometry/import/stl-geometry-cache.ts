import type * as THREE from 'three';

/**
 * Module-level cache for parsed STL BufferGeometry objects.
 * Keyed by body ID so the renderer can look up the geometry
 * without re-parsing or storing large vertex arrays in the IR.
 */
const cache = new Map<string, THREE.BufferGeometry>();

export function cacheSTLGeometry(bodyId: string, geometry: THREE.BufferGeometry): void {
  cache.set(bodyId, geometry);
}

export function getSTLGeometry(bodyId: string): THREE.BufferGeometry | null {
  return cache.get(bodyId) ?? null;
}
