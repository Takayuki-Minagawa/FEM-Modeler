// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import * as THREE from 'three';
import { generateShape } from '@/geometry/primitives/generators';
import { importSTL } from '@/geometry/import/stl-loader';
import { bodyFocusPoints, focusCamera, geometryFocusPoints } from '@/viewer/focus-bounds';
import { ViewerControls } from '@/viewer/ViewerControls';
import { useViewerState } from '@/viewer/view-state';
import { useAppStore } from '@/state/store';
import type { Vector3Tuple } from '@/geometry/transforms';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useAppStore.getState().createProject('fit', 'solid');
  useViewerState.getState().set({ focus: null, resultId: '', showConditions: false, showMaterials: false });
});
afterEach(cleanup);

function box() {
  const generated = generateShape({ shapeType: 'box', width: 2, height: 4, depth: 6 });
  generated.threeGeometry.dispose();
  return generated;
}
function bounds(points: Vector3Tuple[]) {
  return new THREE.Box3().setFromPoints(points.map((point) => new THREE.Vector3(...point)));
}

describe('viewer fitting', () => {
  it('uses transformed corners and ignores hidden bodies for all and child selections', () => {
    const visible = box();
    visible.body.transform = { position: [100, 20, 30], rotation: [0, 0, 90], scale: [2, 3, 4] };
    const hidden = box(); hidden.body.visible = false; hidden.body.transform.position = [-1e8, 0, 0];
    useAppStore.getState().addBodyWithTopology(visible.body, visible);
    useAppStore.getState().addBodyWithTopology(hidden.body, hidden);
    const ir = useAppStore.getState().ir;
    const all = geometryFocusPoints(ir);
    expect(all).toHaveLength(8);
    expect(bounds(all).min.toArray()).toEqual([94, 18, 18]);
    expect(bounds(all).max.toArray()).toEqual([106, 22, 42]);
    expect(geometryFocusPoints(ir, [visible.faces[0].id])).toEqual(all);
    expect(geometryFocusPoints(ir, [hidden.body.id])).toEqual([]);
  });

  it('fits an imported mesh using asset bounds without decoding its triangle payload', () => {
    const bytes = new TextEncoder().encode('solid fit\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 3 0\nendloop\nendfacet\nendsolid fit').buffer;
    const imported = importSTL(bytes, 'fit.stl', 1, 'm');
    imported.geometry?.dispose();
    const body = imported.body!; const asset = imported.asset!;
    body.transform.position = [1000, 2000, 3000];
    Object.defineProperty(asset, 'data', { get() { throw new Error('Mesh payload must not be decoded to fit'); } });
    const points = bodyFocusPoints(body, asset);
    expect(points).toHaveLength(8);
    expect(bounds(points).min.toArray()).toEqual([1000, 2000, 3000]);
    expect(bounds(points).max.toArray()).toEqual([1002, 2003, 3000]);
  });

  it.each([
    { center: 0, size: 1e-9, aspect: 1.5 },
    { center: 1e6, size: 1e-4, aspect: 0.3 },
    { center: 1e8, size: 100, aspect: 2 },
  ])('fits tiny and distant models inside viewport and clipping planes: %j', ({ center, size, aspect }) => {
    const points: Vector3Tuple[] = [[center - size, -size, -size], [center + size, size, size]];
    const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    const target = focusCamera(camera, points, 'front')!;
    expect(target.x).toBe(center);
    expect(camera.position.distanceTo(target)).toBeLessThan(size * 30);
    for (const point of points) {
      const projected = new THREE.Vector3(...point).project(camera);
      expect(Math.abs(projected.x)).toBeLessThan(1);
      expect(Math.abs(projected.y)).toBeLessThan(1);
      expect(Math.abs(projected.z)).toBeLessThan(1);
    }
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far / camera.near).toBeLessThan(100);
  });

  it('preserves view orientation when fitting a different center, and defines a stable top view', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    camera.position.set(10, 10, 10); camera.lookAt(0, 0, 0);
    const before = camera.getWorldDirection(new THREE.Vector3());
    const points: Vector3Tuple[] = [[999, -1, -1], [1001, 1, 1]];
    focusCamera(camera, points);
    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-12);
    focusCamera(camera, points, 'top');
    expect(camera.up.toArray()).toEqual([0, 0, -1]);
    expect(camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, -1, 0))).toBeLessThan(1e-12);
  });

  it('exposes accessible fit and view buttons with selection-aware disabled states', () => {
    const generated = box(); useAppStore.getState().addBodyWithTopology(generated.body, generated);
    useAppStore.getState().setSelectedEntities([generated.vertices[0].id]);
    render(<ViewerControls />);
    fireEvent.click(screen.getByRole('button', { name: 'Fit Selected' }));
    expect(useViewerState.getState().focus?.points).toHaveLength(8);
    for (const [name, direction] of [['Front', 'front'], ['Top', 'top'], ['Right', 'right'], ['Isometric', 'isometric']]) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(useViewerState.getState().focus?.direction).toBe(direction);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Fit All' }));
    expect(useViewerState.getState().focus?.direction).toBeUndefined();
  });

  it('disables fitting when no visible geometry is available', () => {
    render(<ViewerControls />);
    expect((screen.getByRole('button', { name: 'Fit All' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Fit Selected' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
