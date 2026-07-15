import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { parseProjectFile } from '@/export/project/load';
import { serializeProject } from '@/export/project/save';
import { duplicateBodiesLinear } from '@/geometry/editing';
import { restoreSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import { importSTL } from '@/geometry/import/stl-loader';

const TETRAHEDRON_STL = `solid tetra
facet normal 0 0 -1
 outer loop
  vertex 0 0 0
  vertex 0 1 0
  vertex 1 0 0
 endloop
endfacet
facet normal 0 -1 0
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 0 1
 endloop
endfacet
facet normal -1 0 0
 outer loop
  vertex 0 0 0
  vertex 0 0 1
  vertex 0 1 0
 endloop
endfacet
facet normal 1 1 1
 outer loop
  vertex 1 0 0
  vertex 0 1 0
  vertex 0 0 1
 endloop
endfacet
endsolid tetra`;

describe('portable STL assets', () => {
  it('survives import, project save/reload, geometry restore and duplication', () => {
    const buffer = new TextEncoder().encode(TETRAHEDRON_STL).buffer;
    const imported = importSTL(buffer, 'tetra.stl');
    expect(imported.success).toBe(true);
    expect(imported.asset?.diagnostics.watertight).toBe(true);
    expect(imported.body?.category).toBe('solid');

    const project = createDefaultProject();
    project.geometry.bodies.push(imported.body!);
    project.geometry.faces.push(...imported.faces!);
    project.assets.push(imported.asset!);
    const parsed = parseProjectFile(serializeProject(project));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.assets[0].content_hash).toBe(imported.asset?.content_hash);

    const restored = restoreSTLGeometry(parsed.data!.geometry.bodies[0].id, parsed.data!.assets[0]);
    expect(restored.getAttribute('position').count / 3).toBe(4);

    const duplicated = duplicateBodiesLinear(parsed.data!.geometry, [parsed.data!.geometry.bodies[0].id], 1, [2, 0, 0]);
    expect(duplicated.bodies[0].asset_ref).toBe(parsed.data!.assets[0].id);
    expect(duplicated.bodies[0].transform.position).toEqual([2, 0, 0]);
  });

  it('rejects an inconsistent binary triangle count before allocation', () => {
    const bytes = new Uint8Array(84);
    new DataView(bytes.buffer).setUint32(80, 1_000_000, true);

    const result = importSTL(bytes.buffer, 'broken.stl');

    expect(result.success).toBe(false);
    expect(result.error).toContain('shorter than');
  });

  it('accepts a binary STL with trailing padding bytes', () => {
    const bytes = new Uint8Array(84 + 50 + 8);
    const view = new DataView(bytes.buffer);
    view.setUint32(80, 1, true);
    const values = [
      0, 0, 1,
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ];
    values.forEach((value, index) => view.setFloat32(84 + index * 4, value, true));
    bytes.fill(0xa5, 84 + 50);

    const result = importSTL(bytes.buffer, 'padded-binary.stl');

    expect(result.success).toBe(true);
    expect(result.asset?.triangle_count).toBe(1);
    expect(result.asset?.byte_length).toBe(bytes.byteLength);
  });

  it('converts an explicit unitless-STL source unit to canonical metres', () => {
    const buffer = new TextEncoder().encode(TETRAHEDRON_STL).buffer;
    const imported = importSTL(buffer, 'millimetre-tetra.stl', 1e-3, 'mm');

    expect(imported.success).toBe(true);
    expect(imported.asset).toMatchObject({ source_unit: 'mm', scale_to_meters: 1e-3 });
    expect(imported.asset?.bounds.max[0]).toBeCloseTo(0.001);
    expect(imported.asset?.bounds.max[1]).toBeCloseTo(0.001);
    expect(imported.asset?.bounds.max[2]).toBeCloseTo(0.001);
    expect(imported.body?.metadata).toMatchObject({ sourceUnit: 'mm', scaleToMeters: 1e-3 });
  });

  it('rejects tampered embedded STL bytes or derived metadata during project load', () => {
    const buffer = new TextEncoder().encode(TETRAHEDRON_STL).buffer;
    const imported = importSTL(buffer, 'tetra.stl');
    const project = createDefaultProject();
    project.geometry.bodies.push(imported.body!);
    project.geometry.faces.push(...imported.faces!);
    project.assets.push(imported.asset!);

    const badHash = structuredClone(project);
    badHash.assets[0].content_hash = 'fnv1a64:0000000000000000';
    expect(parseProjectFile(serializeProject(badHash)).error).toContain('content hash');

    const badTopology = structuredClone(project);
    badTopology.assets[0].triangle_count += 1;
    expect(parseProjectFile(serializeProject(badTopology)).error).toContain('derived topology metadata');
  });
});
