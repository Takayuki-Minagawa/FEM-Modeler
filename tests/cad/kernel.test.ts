import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCAD, writeCAD } from '@/cad/kernel';
import type { OCCT } from '@/cad/occt-types';
import { parseSTL } from '@/geometry/import/stl-loader';
import { loadTestKernel } from './occt-test-runtime';
import { DEFAULT_SHAPE_PARAMS, generateShape } from '@/geometry/primitives/generators';
import { useAppStore } from '@/state/store';
import { cadExportBodies } from '@/export/cad/exporter';
import { getTransformMatrix } from '@/geometry/transforms';

let oc: OCCT;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const fixtureRoot = new URL('../fixtures/cad/', import.meta.url);
const references = JSON.parse(readFileSync(new URL('references.json', fixtureRoot), 'utf8')) as {
  cases: Array<{ file: string; expected: { bbox_m: number[] } }>;
};
beforeAll(async () => { oc = await loadTestKernel(); }, 30000);

function keepArtifact(name: string, data: Uint8Array) {
  if (!process.env.CAD_EXPORT_ARTIFACTS) return;
  mkdirSync(process.env.CAD_EXPORT_ARTIFACTS, { recursive: true });
  writeFileSync(join(process.env.CAD_EXPORT_ARTIFACTS, name), data);
}

describe('real STEP/IGES kernel', () => {
  it.each(references.cases)('imports and converts $file while retaining surfaces and file units', ({ file, expected }) => {
    const format = file.endsWith('.step') ? 'step' : 'iges';
    const data = new Uint8Array(readFileSync(new URL(file, fixtureRoot)));
    const result = readCAD(oc, data, format);
    expect(result.roots).toBeGreaterThan(0);
    expect(result.faces.length).toBeGreaterThan(0);
    const geometry = parseSTL(result.preview); geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!;
    // Preview tessellation approximates curved surfaces; exported BRep is checked
    // independently by native OCP using much tighter tolerances.
    const min = expected.bbox_m.slice(0, 3), max = expected.bbox_m.slice(3);
    const tolerance = Math.hypot(...max.map((value, axis) => value - min[axis])) * 0.003 + 1e-7;
    bbox.min.toArray().forEach((value, axis) => expect(Math.abs(value - min[axis])).toBeLessThan(tolerance));
    bbox.max.toArray().forEach((value, axis) => expect(Math.abs(value - max[axis])).toBeLessThan(tolerance));
    expect(result.faces.reduce((count, face) => count + face.count, 0)).toBe(geometry.getAttribute('position').count / 3);
    geometry.dispose();
    for (const outputFormat of ['step', 'iges'] as const) {
      const output = writeCAD(oc, [{ name: file, matrix: identity, shape: { shapeType: 'imported_cad', format, data } }], outputFormat);
      expect(output.byteLength).toBeGreaterThan(100);
      keepArtifact(`${file}.${outputFormat}`, output);
      const roundtrip = readCAD(oc, output, outputFormat);
      expect(roundtrip.faces.length).toBeGreaterThan(0);
      const roundtripGeometry = parseSTL(roundtrip.preview); roundtripGeometry.computeBoundingBox();
      roundtripGeometry.boundingBox!.min.toArray().forEach((value, axis) => expect(Math.abs(value - min[axis])).toBeLessThan(tolerance));
      roundtripGeometry.boundingBox!.max.toArray().forEach((value, axis) => expect(Math.abs(value - max[axis])).toBeLessThan(tolerance));
      roundtripGeometry.dispose();
    }
  }, 30000);

  it.each(Object.keys(DEFAULT_SHAPE_PARAMS))('exports native %s as actual CAD', (name) => {
    useAppStore.getState().createProject('CAD');
    const model = generateShape(DEFAULT_SHAPE_PARAMS[name]);
    useAppStore.getState().addBodyWithTopology(model.body, { faces: model.faces, edges: model.edges, vertices: model.vertices });
    const bodies = cadExportBodies(useAppStore.getState().ir);
    for (const format of ['step', 'iges'] as const) {
      const output = writeCAD(oc, bodies, format); keepArtifact(`native-${name}.${format}`, output);
      expect(output.byteLength).toBeGreaterThan(100);
      if (!['frame2d', 'truss2d'].includes(name)) expect(readCAD(oc, output, format).faces.length).toBeGreaterThan(0);
    }
    model.threeGeometry.dispose();
  }, 30000);

  it.each([
    { name: 'translated-rotated', scale: [1, 1, 1] as [number, number, number] },
    { name: 'nonuniform', scale: [2, 3, 0.5] as [number, number, number] },
    { name: 'mirrored', scale: [-1, 1, 1] as [number, number, number] },
  ])('preserves $name transforms of curved CAD', ({ name, scale }) => {
    const data = new Uint8Array(readFileSync(new URL('cylinder_mm.step', fixtureRoot)));
    const matrix = getTransformMatrix({ position: [0.04, -0.03, 0.02], rotation: [0, 90, 0], scale }).elements;
    for (const format of ['step', 'iges'] as const) {
      const output = writeCAD(oc, [{ name, matrix, shape: { shapeType: 'imported_cad', format: 'step', data } }], format);
      keepArtifact(`transform-${name}.${format}`, output);
      const model = parseSTL(readCAD(oc, output, format).preview); model.computeBoundingBox();
      // Cylinder axis +Z becomes +X under this rotation, centred at (0.04,-0.03,0.02).
      const radiusX = 0.01 * Math.abs(scale[0]), radiusY = 0.01 * scale[1], length = 0.03 * scale[2];
      expect(model.boundingBox!.min.x).toBeCloseTo(0.04, 4);
      expect(model.boundingBox!.max.x).toBeCloseTo(0.04 + length, 4);
      expect(model.boundingBox!.min.y).toBeCloseTo(-0.03 - radiusY, 4);
      expect(model.boundingBox!.max.y).toBeCloseTo(-0.03 + radiusY, 4);
      expect(model.boundingBox!.min.z).toBeCloseTo(0.02 - radiusX, 4);
      expect(model.boundingBox!.max.z).toBeCloseTo(0.02 + radiusX, 4);
      model.dispose();
    }
  }, 30000);

  it.each(['step', 'iges'] as const)('rejects malformed %s without partial geometry', (format) => {
    expect(() => readCAD(oc, new TextEncoder().encode('not a CAD file'), format)).toThrow();
  });
});
