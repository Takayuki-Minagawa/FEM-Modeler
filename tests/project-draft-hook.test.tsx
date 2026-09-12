// @vitest-environment jsdom
import { StrictMode, act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { useAppStore } from '@/state/store';
import { useProjectDraftPersistence } from '@/hooks/useProjectDraftPersistence';
import type { DraftSummary } from '@/lib/project-draft-storage';
const mocks = vi.hoisted(() => ({ language: 'en', list: vi.fn(), summary: vi.fn(), save: vi.fn(), load: vi.fn(), clear: vi.fn(), versions: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: mocks.language } }) }));
vi.mock('@/lib/project-draft-storage', async (original) => ({ ...await original<typeof import('@/lib/project-draft-storage')>(),
  listProjectDrafts: mocks.list, getProjectDraftSummary: mocks.summary, saveProjectDraft: mocks.save,
  loadProjectDraft: mocks.load, clearProjectDraft: mocks.clear, listProjectDraftVersions: mocks.versions,
}));
vi.mock('@/export/project/save', () => ({ downloadProjectFile: vi.fn() }));
let hook: ReturnType<typeof useProjectDraftPersistence>;
let root: Root;
let host: HTMLDivElement;
const savedIr = createDefaultProject();
savedIr.meta.project_name = 'Protected saved model';
const saved: DraftSummary = { projectId: savedIr.meta.project_id, projectName: savedIr.meta.project_name, savedAt: '2026-01-01T00:00:00Z', schemaVersion: savedIr.meta.schema_version, versionId: 'head-1' };
function Harness() { const value = useProjectDraftPersistence(); useEffect(() => { hook = value; }, [value]); return <div>{value.readiness}</div>; }
async function settle() { await act(async () => { await Promise.resolve(); }); }
async function mount() { await act(async () => root.render(<StrictMode><Harness /></StrictMode>)); await settle(); }

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.language = 'en';
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAppStore.setState({ ir: createDefaultProject(), projectSession: 0, isStartScreenOpen: true });
  mocks.list.mockResolvedValue([saved]); mocks.summary.mockResolvedValue(saved); mocks.load.mockResolvedValue(savedIr);
  mocks.save.mockResolvedValue({ ...saved, versionId: 'head-2' }); mocks.clear.mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

describe('draft startup and scheduling', () => {
  it('protects pending recovery for more than five seconds under StrictMode and language changes', async () => {
    await mount();
    expect(hook.readiness).toBe('awaiting_restore');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    mocks.language = 'ja'; await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(hook.draftSummary?.projectName).toBe('Protected saved model');
  });

  it('starts autosave only after restore and debounces rapid edits without a language-triggered save', async () => {
    await mount(); await act(async () => { await hook.restoreDraft(); }); await settle();
    await act(async () => { useAppStore.getState().setProjectName('one'); useAppStore.getState().setProjectName('two'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].meta.project_name).toBe('two');
    expect(mocks.save.mock.calls[0][2].expectedVersion).toBe('head-1');
    mocks.language = 'ja'; await act(async () => root.render(<StrictMode><Harness /></StrictMode>));
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending timer when the saved project is discarded', async () => {
    await mount(); await act(async () => { await hook.restoreDraft(); }); await settle();
    await act(async () => { useAppStore.getState().setProjectName('pending'); });
    mocks.list.mockResolvedValue([]);
    await act(async () => { await hook.discardDraft(saved.projectId); });
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledWith(saved.projectId);
  });

  it('shows save failures and retries after another edit', async () => {
    await mount(); await act(async () => { await hook.restoreDraft(); }); await settle();
    await act(async () => { useAppStore.getState().setProjectName('Edit before save'); });
    mocks.save.mockRejectedValueOnce(new Error('Quota exhausted'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(hook.autosaveState.status).toBe('error');
    expect(hook.autosaveState.errorMessage).toBe('Quota exhausted');
    await act(async () => { useAppStore.getState().setProjectName('Retry'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(hook.autosaveState.status).toBe('saved');
  });

  it('waits for initialization even when a new project is created before IndexedDB responds', async () => {
    let resolve!: (value: DraftSummary[]) => void;
    mocks.list.mockImplementation(() => new Promise<DraftSummary[]>((done) => { resolve = done; }));
    await mount();
    await act(async () => useAppStore.getState().createProject('New project'));
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => resolve([saved]));
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(mocks.save.mock.calls[0][0].meta.project_name).toBe('New project');
    expect(mocks.save.mock.calls[0][2].expectedVersion).toBeNull();
  });
});

describe('project transitions and conflicts', () => {
  it('flushes a pending edit before switching and auto-saves the newly created empty project', async () => {
    await mount(); await act(async () => { await hook.restoreDraft(); }); await settle();
    await act(async () => { useAppStore.getState().setProjectName('Last edit before switch'); });
    await act(async () => { useAppStore.getState().createProject('New empty project'); }); await settle();
    expect(mocks.save.mock.calls[0][0].meta.project_name).toBe('Last edit before switch');
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(mocks.save.mock.calls.at(-1)?.[0].meta.project_name).toBe('New empty project');
  });

  it('pauses after a stale-tab save conflict and keeps editing in memory without overwriting the head', async () => {
    const { DraftConflictError } = await import('@/lib/project-draft-storage');
    await mount(); await act(async () => { await hook.restoreDraft(); }); await settle();
    await act(async () => { useAppStore.getState().setProjectName('Edit before conflict'); });
    mocks.save.mockRejectedValueOnce(new DraftConflictError());
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(hook.autosaveState.status).toBe('conflict');
    await act(async () => { useAppStore.getState().setProjectName('Local conflict edit'); await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().ir.meta.project_name).toBe('Local conflict edit');
  });

  it('deleting a different recent project does not stop autosave for the current project', async () => {
    await mount(); await act(async () => { await hook.restoreDraft(); }); await settle();
    await act(async () => { await hook.discardDraft('different-project'); useAppStore.getState().setProjectName('Keep saving'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(mocks.save.mock.calls.at(-1)?.[0].meta.project_name).toBe('Keep saving');
  });
});
