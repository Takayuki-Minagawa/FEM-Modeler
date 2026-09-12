// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { useAppStore } from '@/state/store';
import { useProjectDraftPersistence } from '@/hooks/useProjectDraftPersistence';

const mocks = vi.hoisted(() => ({ list: vi.fn(), summary: vi.fn(), save: vi.fn(), load: vi.fn(), clear: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));
vi.mock('@/lib/project-draft-storage', async (original) => ({ ...await original<typeof import('@/lib/project-draft-storage')>(),
  listProjectDrafts: mocks.list, getProjectDraftSummary: mocks.summary, saveProjectDraft: mocks.save,
  loadProjectDraft: mocks.load, clearProjectDraft: mocks.clear,
}));
vi.mock('@/export/project/save', () => ({ downloadProjectFile: vi.fn() }));
const savedIr = createDefaultProject();
const saved = { projectId: savedIr.meta.project_id, projectName: savedIr.meta.project_name,
  savedAt: new Date(0).toISOString(), schemaVersion: savedIr.meta.schema_version, versionId: 'head-1' };
let unmount: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  useAppStore.setState({ ir: createDefaultProject(), projectSession: 0, isStartScreenOpen: true });
  mocks.list.mockResolvedValue([saved]); mocks.summary.mockResolvedValue(saved); mocks.load.mockResolvedValue(savedIr);
  mocks.save.mockResolvedValue({ ...saved, versionId: 'head-2' }); mocks.clear.mockResolvedValue(undefined);
});
afterEach(() => { unmount?.(); vi.useRealTimers(); });

async function restoreInitial() {
  const hook = renderHook(useProjectDraftPersistence); unmount = hook.unmount;
  await act(async () => { await Promise.resolve(); });
  await act(async () => { expect(await hook.result.current.restoreDraft()).toBe(true); });
  return hook.result;
}
async function editAndSave(name: string) {
  await act(async () => useAppStore.getState().setProjectName(name));
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(mocks.save.mock.calls.at(-1)?.[0].meta.project_name).toBe(name);
}

describe('failed and concurrent recovery', () => {
  it.each(['missing-project', 'evicted-version', 'read-error'] as const)('resumes autosave after %s', async (failure) => {
    const hook = await restoreInitial();
    if (failure === 'missing-project') mocks.summary.mockResolvedValueOnce(null);
    if (failure === 'evicted-version') mocks.load.mockResolvedValueOnce(null);
    if (failure === 'read-error') mocks.load.mockRejectedValueOnce(new Error('IndexedDB read failed'));
    await act(async () => { expect(await hook.current.restoreDraft(saved.projectId, 'old-version')).toBe(false); });
    await editAndSave('Edit after failed recovery');
    expect(hook.current.autosaveState.status).toBe('saved');
  });

  it('preserves and saves edits made while a restore is loading', async () => {
    const hook = await restoreInitial();
    let complete!: (value: typeof savedIr) => void;
    mocks.load.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = hook.current.restoreDraft(); });
    await act(async () => useAppStore.getState().setProjectName('Edit while loading'));
    await act(async () => { complete(savedIr); expect(await pending).toBe(false); });
    expect(useAppStore.getState().ir.meta.project_name).toBe('Edit while loading');
    expect(useAppStore.getState().canUndo).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.save.mock.calls.at(-1)?.[0].meta.project_name).toBe('Edit while loading');
  });

  it('does not replace a new project when an older restore finishes', async () => {
    const hook = await restoreInitial();
    let complete!: (value: typeof savedIr) => void;
    mocks.load.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    let pending!: Promise<boolean>;
    await act(async () => { pending = hook.current.restoreDraft(); });
    await act(async () => useAppStore.getState().createProject('New project'));
    const id = useAppStore.getState().ir.meta.project_id;
    await act(async () => { complete(savedIr); expect(await pending).toBe(false); });
    expect(useAppStore.getState().ir.meta.project_id).toBe(id);
    await editAndSave('New project edit');
  });

  it('resumes autosave after deleting the current draft fails', async () => {
    const hook = await restoreInitial();
    await act(async () => useAppStore.getState().setProjectName('Pending deletion edit'));
    mocks.clear.mockRejectedValueOnce(new Error('Deletion failed'));
    await act(async () => { await hook.current.discardDraft(saved.projectId); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.save.mock.calls.at(-1)?.[0].meta.project_name).toBe('Pending deletion edit');
  });
});
