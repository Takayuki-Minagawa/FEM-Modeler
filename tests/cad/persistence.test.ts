import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCAD } from '@/cad/kernel';
import { runCADTask } from '@/cad/async';
import { importCADAsync } from '@/geometry/import/cad-async';
import { validateCadSource } from '@/geometry/import/cad-source';
import { clearSTLGeometryCache, getSTLGeometry, hydrateSTLGeometryCache } from '@/geometry/import/stl-geometry-cache';
import { parseProjectFile } from '@/export/project/load';
import { createProjectBundle, parseProjectBundle } from '@/export/project/bundle';
import { cadExportBodies } from '@/export/cad/exporter';
import { clearProjectDraft, loadProjectDraft, saveProjectDraft } from '@/lib/project-draft-storage';
import { useAppStore } from '@/state/store';
import { loadTestKernel } from './occt-test-runtime';

// Only replace transport: production import, tessellation, asset encoding and
// persistence all run against the actual pinned OCCT kernel and fixture bytes.
vi.mock('@/cad/async', () => ({ runCADTask: vi.fn() }));
beforeAll(async () => {
  const oc = await loadTestKernel();
  vi.mocked(runCADTask).mockImplementation(async (request) => {
    if (request.operation !== 'import') throw new Error('Unexpected export task');
    return readCAD(oc, request.data, request.format);
  });
}, 30000);
beforeEach(async () => { await clearProjectDraft(); useAppStore.getState().createProject('Real CAD round trip'); });
afterEach(clearSTLGeometryCache);

describe('real CAD source and preview persistence', () => {
  it.each(['cylinder_inch.step', 'holed_box_mm.iges', 'placed_solids_m.step'])('preserves %s through JSON, ZIP and IndexedDB', async (fileName) => {
    const original = new Uint8Array(readFileSync(new URL(`../fixtures/cad/${fileName}`, import.meta.url)));
    const imported = await importCADAsync(original.slice().buffer, fileName);
    expect(imported.success).toBe(true);
    expect(imported.asset!.triangle_count).toBeGreaterThan(10);
    expect(imported.faces!.length).toBeGreaterThan(1);
    const positions = new Float32Array(imported.geometry!.getAttribute('position').array);
    imported.geometry!.dispose();
    useAppStore.getState().addBodyWithTopology(imported.body!, { faces: imported.faces!, assets: [imported.asset!] });
    const ir = useAppStore.getState().ir;

    const json = parseProjectFile(JSON.stringify(ir));
    expect(json.success, json.error).toBe(true);
    const blob = await createProjectBundle(ir);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('bundle_manifest.json')!.async('text'));
    expect(await zip.file(manifest.assets[0].cad_source.path)!.async('uint8array')).toEqual(original);
    const bundle = await parseProjectBundle(await blob.arrayBuffer());
    expect(bundle.success, bundle.error).toBe(true);
    await saveProjectDraft(ir);
    const draft = await loadProjectDraft(ir.meta.project_id);
    expect(draft).not.toBeNull();

    for (const restored of [json.data!, bundle.data!, draft!]) {
      expect(restored.assets).toEqual(ir.assets);
      expect(restored.geometry).toEqual(ir.geometry);
      expect(validateCadSource(restored.assets[0].cad_source!)).toEqual(original);
      clearSTLGeometryCache();
      expect(hydrateSTLGeometryCache(restored)).toEqual([]);
      expect(getSTLGeometry(restored.geometry.bodies[0].id)!.getAttribute('position').array).toEqual(positions);
      const shape = cadExportBodies(restored)[0].shape;
      expect(shape.shapeType).toBe('imported_cad');
      if (shape.shapeType !== 'imported_cad') throw new Error('Original CAD source was not selected for export');
      expect(shape.data).toEqual(original);
      expect(shape.format).toBe(fileName.endsWith('.step') ? 'step' : 'iges');
    }
  }, 30000);
});
