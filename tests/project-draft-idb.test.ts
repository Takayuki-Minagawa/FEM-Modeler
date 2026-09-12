import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import {
  saveProjectDraft,
  loadProjectDraft,
  getProjectDraftSummary,
  clearProjectDraft,
} from '@/lib/project-draft-storage';

beforeEach(async () => {
  await clearProjectDraft();
});

describe('project-draft-storage (IndexedDB)', () => {
  it('round-trips a project through save and load', async () => {
    const ir = createDefaultProject();
    ir.meta.project_name = 'Round-trip Test';

    await saveProjectDraft(ir);
    const loaded = await loadProjectDraft();

    expect(loaded).not.toBeNull();
    expect(loaded!.meta.project_name).toBe('Round-trip Test');
    expect(loaded!.meta.project_id).toBe(ir.meta.project_id);
  });

  it('returns summary without deserializing full IR', async () => {
    const ir = createDefaultProject();
    ir.meta.project_name = 'Summary Test';

    const saved = await saveProjectDraft(ir, '2026-03-24T12:00:00.000Z');

    expect(saved.projectName).toBe('Summary Test');
    expect(saved.savedAt).toBe('2026-03-24T12:00:00.000Z');

    const summary = await getProjectDraftSummary();
    expect(summary).not.toBeNull();
    expect(summary!.projectName).toBe('Summary Test');
  });

  it('returns null when no draft exists', async () => {
    const loaded = await loadProjectDraft();
    expect(loaded).toBeNull();

    const summary = await getProjectDraftSummary();
    expect(summary).toBeNull();
  });

  it('clears the saved draft', async () => {
    const ir = createDefaultProject();
    await saveProjectDraft(ir);

    await clearProjectDraft();

    const loaded = await loadProjectDraft();
    expect(loaded).toBeNull();
  });

  it('overwrites previous draft on re-save', async () => {
    const ir1 = createDefaultProject();
    ir1.meta.project_name = 'Version 1';
    await saveProjectDraft(ir1);

    const ir2 = createDefaultProject();
    ir2.meta.project_name = 'Version 2';
    await saveProjectDraft(ir2);

    const loaded = await loadProjectDraft();
    expect(loaded!.meta.project_name).toBe('Version 2');
  });

  it('stores IR as JSON (no DataCloneError for class instances)', async () => {
    const ir = createDefaultProject();
    // Ensure save doesn't throw — the JSON serialization step
    // catches non-serializable values before they reach IndexedDB.
    await expect(saveProjectDraft(ir)).resolves.toBeDefined();
  });
});

describe('versioned project drafts', () => {
  it('keeps projects independent, bounds retained versions and restores an earlier head', async () => {
    const { listProjectDrafts, listProjectDraftVersions, MAX_DRAFT_VERSIONS } = await import('@/lib/project-draft-storage');
    const first = createDefaultProject();
    const second = createDefaultProject();
    await saveProjectDraft(second, '2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 8; i++) {
      first.meta.project_name = `Revision ${i}`;
      await saveProjectDraft(first, `2026-01-01T00:00:0${i + 1}.000Z`);
    }
    expect(await listProjectDrafts()).toHaveLength(2);
    const versions = await listProjectDraftVersions(first.meta.project_id);
    expect(versions).toHaveLength(MAX_DRAFT_VERSIONS);
    expect((await loadProjectDraft(first.meta.project_id, versions[0].versionId))?.meta.project_name).toBe('Revision 6');
    await clearProjectDraft(first.meta.project_id);
    expect((await loadProjectDraft(second.meta.project_id))?.meta.project_id).toBe(second.meta.project_id);
  });

  it('rejects a stale tab atomically without losing the newer head or inserting history', async () => {
    const { DraftConflictError, listProjectDraftVersions } = await import('@/lib/project-draft-storage');
    const ir = createDefaultProject();
    const first = await saveProjectDraft(ir);
    const newer = await saveProjectDraft(ir, undefined, { expectedVersion: first.versionId });
    await expect(saveProjectDraft(ir, undefined, { expectedVersion: first.versionId })).rejects.toBeInstanceOf(DraftConflictError);
    expect((await getProjectDraftSummary(ir.meta.project_id))?.versionId).toBe(newer.versionId);
    expect(await listProjectDraftVersions(ir.meta.project_id)).toHaveLength(1);
  });

  it('cancels queued work and serializes delete after an in-flight save', async () => {
    const ir = createDefaultProject();
    await expect(saveProjectDraft(ir, undefined, { shouldSave: () => false })).rejects.toMatchObject({ name: 'AbortError' });
    const pending = saveProjectDraft(ir);
    const deletion = clearProjectDraft(ir.meta.project_id);
    await Promise.all([pending, deletion]);
    expect(await loadProjectDraft(ir.meta.project_id)).toBeNull();
  });

  it('migrates the legacy current key without overwriting a newer project head', async () => {
    const { openDB } = await import('idb');
    const ir = createDefaultProject();
    ir.meta.project_name = 'Legacy';
    const db = await openDB('fem-modeler', 3);
    await db.put('project-drafts', { key: 'current', savedAt: '2020-01-01T00:00:00.000Z', projectId: ir.meta.project_id, projectName: ir.meta.project_name, schemaVersion: ir.meta.schema_version, irJson: JSON.stringify(ir) }, 'current');
    expect((await loadProjectDraft())?.meta.project_name).toBe('Legacy');
    expect(await db.get('project-drafts', 'current')).toBeUndefined();
    expect(await db.get('project-drafts', ir.meta.project_id)).toBeDefined();
    db.close();
  });
});

describe('draft assets and save ordering', () => {
  it('shares asset bytes across projects and retained versions and only collects unused data', async () => {
    const { openDB } = await import('idb');
    const { importSTL } = await import('@/geometry/import/stl-loader');
    const bytes = new TextEncoder().encode('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t');
    const imported = importSTL(bytes.buffer, 'triangle.stl');
    const first = createDefaultProject();
    first.geometry.bodies.push(imported.body!); first.geometry.faces.push(...imported.faces!); first.assets.push(imported.asset!);
    await saveProjectDraft(first);
    first.meta.project_name = 'Changed'; await saveProjectDraft(first);
    const second = structuredClone(first); second.meta.project_id = 'second-project'; await saveProjectDraft(second);
    const db = await openDB('fem-modeler', 3);
    expect(await db.count('draft-assets')).toBe(1);
    expect((await loadProjectDraft(second.meta.project_id))?.assets[0].data).toBe(imported.asset?.data);
    await clearProjectDraft(first.meta.project_id);
    expect(await db.count('draft-assets')).toBe(1);
    await clearProjectDraft(second.meta.project_id);
    expect(await db.count('draft-assets')).toBe(0);
    db.close();
  });

  it('reads the latest successful local write token when a queued save is dispatched', async () => {
    const ir = createDefaultProject();
    let token: string | null = null;
    const first = saveProjectDraft(ir, undefined, { getExpectedVersion: () => token }).then((summary) => { token = summary.versionId; });
    const second = saveProjectDraft(ir, undefined, { getExpectedVersion: () => token });
    await first;
    await expect(second).resolves.toMatchObject({ projectId: ir.meta.project_id });
  });
});

it('orders retained versions by commit sequence when timestamps are identical', async () => {
  const { listProjectDraftVersions } = await import('@/lib/project-draft-storage');
  const ir = createDefaultProject();
  for (let i = 0; i < 8; i++) { ir.meta.project_name = `Same timestamp ${i}`; await saveProjectDraft(ir, '2026-01-01T00:00:00Z'); }
  const versions = await listProjectDraftVersions(ir.meta.project_id);
  expect(versions.map((version) => version.projectName)).toEqual([6, 5, 4, 3, 2].map((i) => `Same timestamp ${i}`));
});

it('does not treat a valid imported project named current as an old storage row', async () => {
  const ir = createDefaultProject(); ir.meta.project_id = 'current';
  await saveProjectDraft(ir);
  expect((await loadProjectDraft('current'))?.meta.project_id).toBe('current');
  expect((await getProjectDraftSummary('current'))?.projectId).toBe('current');
});
