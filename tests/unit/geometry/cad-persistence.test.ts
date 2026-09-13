import 'fake-indexeddb/auto';
import JSZip from 'jszip';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CadSource } from '@/core/ir/types';
import { createDefaultProject } from '@/core/ir/defaults';
import { createCadSource, MAX_CAD_SOURCE_BYTES, validateCadSource } from '@/geometry/import/cad-source';
import { importSTL } from '@/geometry/import/stl-loader';
import { createProjectBundle, parseProjectBundle } from '@/export/project/bundle';
import { parseProjectFile } from '@/export/project/load';
import { clearProjectDraft, estimateProjectDraftBytes, loadProjectDraft, saveProjectDraft } from '@/lib/project-draft-storage';
import { createExportProvenance, inputFingerprint, resultImportExpectations, resultMatchesInput } from '@/core/ir/provenance';
import { importResultText } from '@/results/importer';
import { applyTemplate } from '@/lib/project-templates';
import { useAppStore } from '@/state/store';

const displayBytes = new TextEncoder().encode('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t');
// Storage tests preserve bytes independently of the CAD kernel's syntax checks.
const originalBytes = new Uint8Array([73, 83, 79, 45, 49, 48, 51, 48, 51, 13, 10, 0, 255]);
function project(format: CadSource['format'] = 'step') {
  const imported = importSTL(displayBytes.buffer, 'display.stl');
  const ir = createDefaultProject();
  imported.asset!.cad_source = createCadSource(originalBytes, format, `original.${format}`);
  imported.body!.metadata = { ...imported.body!.metadata, shapeType: 'imported_cad', importFormat: format, fileName: `original.${format}` };
  ir.geometry.bodies = [imported.body!]; ir.geometry.faces = imported.faces!;
  ir.geometry.model_type = 'cad_brep'; ir.geometry.source = format === 'step' ? 'imported_step' : 'imported_iges';
  ir.assets = [imported.asset!]; imported.geometry!.dispose();
  return ir;
}
beforeEach(async () => { await clearProjectDraft(); });

describe('original CAD source contract', () => {
  it.each(['step', 'iges'] as const)('round trips every original %s byte through JSON and draft storage', async (format) => {
    const ir = project(format);
    const json = parseProjectFile(JSON.stringify(ir));
    expect(json.success).toBe(true);
    expect(json.data?.assets[0].cad_source).toEqual(ir.assets[0].cad_source);
    expect(validateCadSource(json.data!.assets[0].cad_source!)).toEqual(originalBytes);
    await saveProjectDraft(ir);
    expect((await loadProjectDraft(ir.meta.project_id))?.assets[0].cad_source).toEqual(ir.assets[0].cad_source);
    expect(estimateProjectDraftBytes(ir) - estimateProjectDraftBytes({ ...ir, assets: [{ ...ir.assets[0], cad_source: undefined }] })).toBe(ir.assets[0].cad_source!.data.length * 2);
  });

  it.each(['bytes', 'hash', 'length', 'format', 'media', 'reference', 'scale', 'display-hash', 'missing-source', 'face-reference'] as const)('rejects inconsistent %s', (change) => {
    const ir = project(), asset = ir.assets[0], source = asset.cad_source!, body = ir.geometry.bodies[0];
    if (change === 'bytes') source.data = btoa('a'.repeat(originalBytes.length));
    if (change === 'hash') source.content_hash = `sha256:${'0'.repeat(64)}`;
    if (change === 'length') source.byte_length += 1;
    if (change === 'format') body.metadata.importFormat = 'iges';
    if (change === 'media') source.media_type = 'model/iges';
    if (change === 'reference') body.asset_ref = 'absent';
    if (change === 'scale') asset.scale_to_meters = 0.001;
    if (change === 'display-hash') body.metadata.contentHash = 'another-display';
    if (change === 'missing-source') delete asset.cad_source;
    if (change === 'face-reference') ir.geometry.faces[0].triangle_indices = [asset.triangle_count];
    expect(parseProjectFile(JSON.stringify(ir)).success).toBe(false);
  });

  it('enforces the source byte limit before allocating or hashing an oversized payload', () => {
    expect(() => createCadSource(new Uint8Array(MAX_CAD_SOURCE_BYTES + 1), 'step', 'large.step')).toThrow('25 MiB');
    const ir = project(); ir.assets[0].cad_source!.byte_length = MAX_CAD_SOURCE_BYTES + 1;
    expect(parseProjectFile(JSON.stringify(ir)).success).toBe(false);
  });

  it('tracks CAD bytes in input identity even when the display tessellation is unchanged', () => {
    useAppStore.getState().createProject('thermal', 'thermal'); applyTemplate('thermal', 'en');
    const ir = structuredClone(useAppStore.getState().ir), cad = project();
    ir.geometry.bodies = cad.geometry.bodies; ir.geometry.faces = cad.geometry.faces; ir.assets = cad.assets;
    const caseId = ir.analysis_cases[0].id;
    const before = inputFingerprint(ir, 'DOLFINx', caseId);
    ir.assets[0].cad_source = createCadSource(new Uint8Array([1, 2, 3]), 'step', 'changed.step');
    expect(inputFingerprint(ir, 'DOLFINx', caseId)).not.toBe(before);
  });

  it('retains schema 0.3 result verification and SI values during the additive 0.4 migration', () => {
    useAppStore.getState().createProject('frame', 'frame'); applyTemplate('frame', 'en');
    const ir = structuredClone(useAppStore.getState().ir), caseId = ir.analysis_cases[0].id;
    const manifest = createExportProvenance(ir, 'OpenSeesPy', caseId);
    const result = importResultText(`# FEM_MODELER_PROVENANCE ${JSON.stringify(manifest)}\nnode_id,ux_m\n1,0.1`, 'result.csv', caseId, 'OpenSeesPy', resultImportExpectations(ir, 'OpenSeesPy', caseId));
    ir.results = [result.result!]; ir.meta.schema_version = '0.3.0'; ir.units.system_name = 'mm-N-s';
    const loaded = parseProjectFile(JSON.stringify(ir));
    expect(loaded.success).toBe(true); expect(loaded.data?.meta.schema_version).toBe('0.4.0');
    expect(loaded.data?.geometry).toEqual(ir.geometry);
    expect(loaded.data?.results).toEqual(ir.results);
    expect(resultMatchesInput(loaded.data!, loaded.data!.results[0])).toBe(true);
  });

  it('does not silently fill missing required fields when upgrading a schema 0.3 file', () => {
    const ir = { ...createDefaultProject(), geometry: undefined };
    ir.meta.schema_version = '0.3.0';
    expect(parseProjectFile(JSON.stringify(ir)).success).toBe(false);
  });

  it.each(['step', 'iges'] as const)('sets the imported_%s source and preserves source assets through delete/Undo', (format) => {
    useAppStore.getState().createProject('CAD'); const ir = project(format);
    useAppStore.getState().addBodyWithTopology(ir.geometry.bodies[0], { faces: ir.geometry.faces, assets: ir.assets });
    expect(useAppStore.getState().ir.geometry.source).toBe(`imported_${format}`);
    useAppStore.getState().removeBody(ir.geometry.bodies[0].id);
    expect(useAppStore.getState().ir.assets).toHaveLength(0);
    useAppStore.getState().undo();
    expect(useAppStore.getState().ir.assets[0].cad_source).toEqual(ir.assets[0].cad_source);
  });
});

describe('CAD project ZIP integrity', () => {
  it.each(['step', 'iges'] as const)('externalizes the original %s bytes and restores them without loss', async (format) => {
    const ir = project(format), blob = await createProjectBundle(ir), zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('bundle_manifest.json')!.async('text'));
    const embedded = JSON.parse(await zip.file('project.fem.json')!.async('text'));
    expect(manifest.version).toBe(3);
    expect(embedded.assets[0].data).toBe(''); expect(embedded.assets[0].cad_source.data).toBe('');
    expect(await zip.file(manifest.assets[0].cad_source.path)!.async('uint8array')).toEqual(originalBytes);
    const loaded = await parseProjectBundle(await blob.arrayBuffer());
    expect(loaded.success).toBe(true); expect(loaded.data?.assets).toEqual(ir.assets);
  });

  it.each(['bytes', 'missing', 'path', 'oversize', 'duplicate-path'] as const)('rejects CAD source %s corruption in a bundle', async (change) => {
    const ir = project(), blob = await createProjectBundle(ir), zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const manifest = JSON.parse(await zip.file('bundle_manifest.json')!.async('text')), source = manifest.assets[0].cad_source;
    if (change === 'bytes') zip.file(source.path, new Uint8Array(originalBytes.length));
    if (change === 'missing') zip.remove(source.path);
    if (change === 'path') source.path = 'assets/../outside.step';
    if (change === 'oversize') source.byte_length = MAX_CAD_SOURCE_BYTES + 1;
    if (change === 'duplicate-path') source.path = manifest.assets[0].path;
    zip.file('bundle_manifest.json', JSON.stringify(manifest));
    expect((await parseProjectBundle(await zip.generateAsync({ type: 'arraybuffer' }))).success).toBe(false);
  });

  it('still opens a v2 bundle containing an STL project', async () => {
    const ir = project(); delete ir.assets[0].cad_source; ir.geometry.bodies[0].metadata.shapeType = 'imported_stl';
    const zip = await JSZip.loadAsync(await (await createProjectBundle(ir)).arrayBuffer());
    const manifest = JSON.parse(await zip.file('bundle_manifest.json')!.async('text')); manifest.version = 2;
    zip.file('bundle_manifest.json', JSON.stringify(manifest));
    expect((await parseProjectBundle(await zip.generateAsync({ type: 'arraybuffer' }))).success).toBe(true);
  });
});

describe('CAD draft deduplication and retention', () => {
  it('keeps different original CAD data behind identical meshes and collects only unused generations', async () => {
    const first = project(), saved = await saveProjectDraft(first);
    const original = structuredClone(first.assets[0].cad_source);
    first.assets[0].cad_source = createCadSource(new Uint8Array([1, 2, 3]), 'step', 'second.step');
    await saveProjectDraft(first);
    const second = structuredClone(first); second.meta.project_id = 'second'; await saveProjectDraft(second);
    const db = await openDB('fem-modeler');
    expect(await db.count('draft-assets')).toBe(3); // one display mesh, two original CAD byte streams
    const row = await db.get('project-drafts', first.meta.project_id);
    expect(JSON.parse(row.irJson).assets[0].cad_source.data).toBe('');
    expect((await loadProjectDraft(first.meta.project_id, saved.versionId))?.assets[0].cad_source).toEqual(original);
    expect((await loadProjectDraft(second.meta.project_id))?.assets[0].cad_source).toEqual(first.assets[0].cad_source);
    await clearProjectDraft(first.meta.project_id); expect(await db.count('draft-assets')).toBe(2);
    await clearProjectDraft(second.meta.project_id); expect(await db.count('draft-assets')).toBe(0); db.close();
  });

  it('rejects a draft whose original CAD blob was lost instead of restoring only its STL preview', async () => {
    const ir = project(); await saveProjectDraft(ir); const db = await openDB('fem-modeler');
    const row = await db.get('project-drafts', ir.meta.project_id);
    await db.delete('draft-assets', row.cadSourceKeys[0]);
    await expect(loadProjectDraft(ir.meta.project_id)).rejects.toThrow('original CAD source is missing'); db.close();
  });
});
