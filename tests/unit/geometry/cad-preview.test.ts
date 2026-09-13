import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { importSTL } from '@/geometry/import/stl-loader';
import { cacheSTLGeometry, clearSTLGeometryCache, getSTLGeometry, hydrateSTLGeometryCache, usesImportedPreview } from '@/geometry/import/stl-geometry-cache';
import { selectionGeometry } from '@/viewer/condition-data';
import { createCadSource } from '@/geometry/import/cad-source';
import { generateShape } from '@/geometry/primitives/generators';

afterEach(clearSTLGeometryCache);
const bytes = new TextEncoder().encode('solid preview\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid preview').buffer;

describe('imported CAD preview connection', () => {
  it('centres the perforated plate thickness consistently with CAD and FEM geometry', () => {
    const generated = generateShape({ shapeType: 'plateWithHole', width: 4, depth: 3, thickness: 0.2, holeRadius: 0.3 });
    generated.threeGeometry.computeBoundingBox();
    const bounds = generated.threeGeometry.boundingBox!;
    expect(bounds.min.x).toBeCloseTo(-2); expect(bounds.max.x).toBeCloseTo(2);
    expect(bounds.min.y).toBeCloseTo(-0.1); expect(bounds.max.y).toBeCloseTo(0.1);
    expect(bounds.min.z).toBeCloseTo(-1.5); expect(bounds.max.z).toBeCloseTo(1.5);
    generated.threeGeometry.dispose();
  });
  it('restores a persisted CAD preview and uses its face triangle map for overlays', () => {
    const imported = importSTL(bytes, 'preview.stl', 1, 'm');
    const ir = createDefaultProject(); const body = imported.body!;
    body.metadata.shapeType = 'imported_cad'; body.metadata.importFormat = 'step';
    body.metadata.fileName = 'part.step';
    imported.asset!.cad_source = createCadSource(new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;'), 'step', 'part.step');
    body.transform.position = [2, 3, 4];
    imported.geometry!.dispose();
    ir.geometry.bodies = [body]; ir.geometry.faces = imported.faces!; ir.assets = [imported.asset!];
    ir.named_selections = [{ id: 'cad-face', name: 'CAD face', target_dimension: 2, entity_type: 'face', member_refs: [imported.faces![0].id], color: '#cccccc', description: '', created_by: 'user', status: 'active', usages: [] }];
    expect(usesImportedPreview(body.metadata)).toBe(true);
    expect(hydrateSTLGeometryCache(ir)).toEqual([]);
    const geometry = getSTLGeometry(body.id)!;
    expect(geometry.getAttribute('position').count).toBe(3);
    const dispose = vi.spyOn(geometry, 'dispose');
    const target = selectionGeometry(ir, 'cad-face');
    expect(target.points).toEqual([[2, 3, 4], [3, 3, 4], [2, 4, 4]]);
    expect(target.triangles).toHaveLength(9);
    expect(target.surfaceAnchors![0].normal).toEqual([0, 0, 1]);
    expect(dispose).not.toHaveBeenCalled();
    cacheSTLGeometry(body.id, geometry);
    expect(hydrateSTLGeometryCache(ir)).toEqual([]); expect(getSTLGeometry(body.id)).toBe(geometry);
  });

  it('reports missing CAD previews and leaves native shapes out of the imported cache', () => {
    const ir = createDefaultProject(); const imported = importSTL(bytes, 'preview.stl', 1, 'm');
    imported.geometry!.dispose(); imported.body!.metadata.shapeType = 'imported_cad';
    ir.geometry.bodies = [imported.body!];
    expect(hydrateSTLGeometryCache(ir)[0]).toContain('missing preview asset');
    expect(usesImportedPreview({ shapeType: 'box' })).toBe(false);
  });
});
