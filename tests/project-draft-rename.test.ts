import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { clearProjectDraft, DraftConflictError, getProjectDraftSummary, listProjectDraftVersions, loadProjectDraft, renameProjectDraft, saveProjectDraft } from '@/lib/project-draft-storage';

beforeEach(async () => { await clearProjectDraft(); });

describe('saved project renaming', () => {
  it('creates a renamed head and retains prior names and model contents in saved versions', async () => {
    const ir = createDefaultProject();
    ir.meta.project_name = 'Original';
    const first = await saveProjectDraft(ir);
    const renamed = await renameProjectDraft(ir.meta.project_id, '  Renamed  ', first.versionId);
    expect(renamed.projectName).toBe('Renamed');
    expect(renamed.versionId).not.toBe(first.versionId);
    expect((await getProjectDraftSummary(ir.meta.project_id))?.projectName).toBe('Renamed');
    const loaded = (await loadProjectDraft(ir.meta.project_id))!;
    expect(loaded.meta.project_name).toBe('Renamed');
    expect({ ...loaded, meta: ir.meta }).toEqual(ir);
    expect(await loadProjectDraft(ir.meta.project_id, first.versionId)).toEqual(ir);
    expect((await listProjectDraftVersions(ir.meta.project_id))[0].projectName).toBe('Original');
  });

  it('rejects an older rename after a concurrent save without replacing inputs or inserting history', async () => {
    const ir = createDefaultProject();
    const first = await saveProjectDraft(ir);
    ir.mesh_controls.global.global_size *= 0.5;
    ir.meta.project_name = 'Another tab';
    const latest = await saveProjectDraft(ir, undefined, { expectedVersion: first.versionId });
    await expect(renameProjectDraft(ir.meta.project_id, 'Stale rename', first.versionId)).rejects.toBeInstanceOf(DraftConflictError);
    expect((await getProjectDraftSummary(ir.meta.project_id))?.versionId).toBe(latest.versionId);
    expect(await loadProjectDraft(ir.meta.project_id)).toEqual(ir);
    expect(await listProjectDraftVersions(ir.meta.project_id)).toHaveLength(1);
  });

  it('allows only one of two simultaneous renames based on the same version', async () => {
    const ir = createDefaultProject();
    const first = await saveProjectDraft(ir);
    const outcomes = await Promise.allSettled([
      renameProjectDraft(ir.meta.project_id, 'First rename', first.versionId),
      renameProjectDraft(ir.meta.project_id, 'Second rename', first.versionId),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toEqual([{ status: 'rejected', reason: expect.any(DraftConflictError) }]);
    expect(await listProjectDraftVersions(ir.meta.project_id)).toHaveLength(1);
  });

  it('reads this tab\'s version token after an already queued save completes', async () => {
    const ir = createDefaultProject();
    const first = await saveProjectDraft(ir);
    let ownVersion = first.versionId;
    ir.mesh_controls.global.global_size = 0.345;
    const saving = saveProjectDraft(ir, undefined, { expectedVersion: ownVersion }).then((summary) => { ownVersion = summary.versionId; });
    const renaming = renameProjectDraft(ir.meta.project_id, 'After queued save', () => ownVersion);
    await saving;
    await expect(renaming).resolves.toMatchObject({ projectName: 'After queued save' });
    const loaded = await loadProjectDraft(ir.meta.project_id);
    expect(loaded?.meta.project_name).toBe('After queued save');
    expect(loaded?.mesh_controls.global.global_size).toBe(0.345);
  });

  it('rejects deletion/empty names and treats the existing name as a no-op', async () => {
    const ir = createDefaultProject();
    const first = await saveProjectDraft(ir);
    await expect(renameProjectDraft(ir.meta.project_id, '   ', first.versionId)).rejects.toThrow('must not be empty');
    expect(await renameProjectDraft(ir.meta.project_id, first.projectName, first.versionId)).toEqual(first);
    expect(await listProjectDraftVersions(ir.meta.project_id)).toHaveLength(0);
    await clearProjectDraft(ir.meta.project_id);
    await expect(renameProjectDraft(ir.meta.project_id, 'Deleted', first.versionId)).rejects.toBeInstanceOf(DraftConflictError);
    expect(await loadProjectDraft(ir.meta.project_id)).toBeNull();
  });
});
