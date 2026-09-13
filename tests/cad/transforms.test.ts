import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCAD, writeCAD } from '@/cad/kernel';
import type { CADExportBody, CADFormat } from '@/cad/types';
import type { OCCT } from '@/cad/occt-types';
import { loadTestKernel } from './occt-test-runtime';
import { getTransformMatrix } from '@/geometry/transforms';
import { parseSTL } from '@/geometry/import/stl-loader';
import { DEFAULT_SHAPE_PARAMS } from '@/geometry/primitives/generators';

let oc: OCCT;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const formats: CADFormat[] = ['step', 'iges'];
beforeAll(async () => { oc = await loadTestKernel(); }, 30_000);

function keepArtifact(name: string, bytes: Uint8Array) {
  if (!process.env.CAD_EXPORT_ARTIFACTS) return;
  mkdirSync(process.env.CAD_EXPORT_ARTIFACTS, { recursive: true });
  writeFileSync(join(process.env.CAD_EXPORT_ARTIFACTS, name), bytes);
}

describe('CAD transform and partial preview regressions', () => {
  it.each([
    { name: 'negative-x', scale: [-2, 3, 0.5] as [number, number, number] },
    { name: 'negative-z', scale: [2, 3, -0.5] as [number, number, number] },
    { name: 'two-negative', scale: [-2, -3, 0.5] as [number, number, number] },
    { name: 'all-negative', scale: [-2, -3, -0.5] as [number, number, number] },
  ])('preserves $name nonuniform scale with arbitrary rotation', ({ name, scale }) => {
    const matrix = getTransformMatrix({ position: [0.04, -0.03, 0.02], rotation: [20, 45, 15], scale }).elements;
    // Exact AABB of a radius 10 mm, height 30 mm cylinder with local axis +Z:
    // each projected circular cross-section has radius hypot(Rx, Ry).
    const minima = [0, 1, 2].map((axis) => matrix[12 + axis] + Math.min(0, 0.03 * matrix[8 + axis]) - 0.01 * Math.hypot(matrix[axis], matrix[axis + 4]));
    const maxima = [0, 1, 2].map((axis) => matrix[12 + axis] + Math.max(0, 0.03 * matrix[8 + axis]) + 0.01 * Math.hypot(matrix[axis], matrix[axis + 4]));
    const tolerance = Math.hypot(...maxima.map((value, axis) => value - minima[axis])) * 0.003 + 1e-7;
    for (const input of formats) {
      const data = new Uint8Array(readFileSync(new URL(`../fixtures/cad/cylinder_mm.${input}`, import.meta.url)));
      for (const output of formats) {
        const bytes = writeCAD(oc, [{ name, matrix, shape: { shapeType: 'imported_cad', format: input, data } }], output);
        keepArtifact(`transform-${name}-${input}.${output}`, bytes);
        const geometry = parseSTL(readCAD(oc, bytes, output).preview); geometry.computeBoundingBox();
        try {
          geometry.boundingBox!.min.toArray().forEach((value, axis) => expect(Math.abs(value - minima[axis])).toBeLessThan(tolerance));
          geometry.boundingBox!.max.toArray().forEach((value, axis) => expect(Math.abs(value - maxima[axis])).toBeLessThan(tolerance));
        } finally { geometry.dispose(); }
      }
    }
  }, 30_000);

  it.each(formats)('rejects a mixed solid and free curve %s without importing a partial preview', (format) => {
    const bodies: CADExportBody[] = [
      { name: 'box', matrix: identity, shape: { shapeType: 'box', width: 0.04, height: 0.03, depth: 0.02 } },
      { name: 'frame', matrix: identity, shape: DEFAULT_SHAPE_PARAMS.frame2d, lines: [[[0.1, 0, 0], [0.1, 1, 0]]] },
    ];
    const bytes = writeCAD(oc, bodies, format);
    expect(bytes.byteLength).toBeGreaterThan(100);
    expect(() => readCAD(oc, bytes, format)).toThrow(/curves|points|free|not supported|unsupported/i);
  }, 30_000);
});
