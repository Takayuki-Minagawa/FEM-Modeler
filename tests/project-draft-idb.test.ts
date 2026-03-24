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
