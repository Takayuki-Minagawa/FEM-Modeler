// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { useEffect } from 'react';
import { AppContext, type AppContextValue } from '@/contexts/app-context-value';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProject } from '@/core/ir/defaults';
import { useAppStore } from '@/state/store';
import { useProjectDraftPersistence } from '@/hooks/useProjectDraftPersistence';
import { RecentProjects } from '@/ui/dialogs/RecentProjects';
import * as storage from '@/lib/project-draft-storage';

let persistence: ReturnType<typeof useProjectDraftPersistence>;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));
vi.mock('@/export/project/save', () => ({ downloadProjectFile: vi.fn() }));
function Harness() {
  const value = useProjectDraftPersistence();
  useEffect(() => { persistence = value; }, [value]);
  return <AppContext.Provider value={value as unknown as AppContextValue}><RecentProjects /></AppContext.Provider>;
}

beforeEach(async () => {
  await storage.clearProjectDraft();
  useAppStore.setState({ ir: createDefaultProject(), projectSession: 0, isStartScreenOpen: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function startRename() {
  const ir = createDefaultProject(); ir.meta.project_name = 'Saved original';
  const saved = await storage.saveProjectDraft(ir);
  render(<Harness />);
  await screen.findByRole('button', { name: `Rename Saved original (${ir.meta.project_id})` });
  fireEvent.click(screen.getByRole('button', { name: `Rename Saved original (${ir.meta.project_id})` }));
  return { ir, saved };
}

describe('Recent projects rename workflow', () => {
  it('renames from the list, reloads the saved name and preserves previous versions', async () => {
    const { ir, saved } = await startRename();
    fireEvent.change(screen.getByLabelText('Saved project name'), { target: { value: 'Recent rename' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await screen.findByText('Name saved. Earlier names remain in saved versions.');
    expect((await storage.loadProjectDraft(ir.meta.project_id))?.meta.project_name).toBe('Recent rename');
    expect((await storage.loadProjectDraft(ir.meta.project_id, saved.versionId))?.meta.project_name).toBe('Saved original');
    fireEvent.click(screen.getByRole('button', { name: 'Recent rename', exact: true }));
    await waitFor(() => expect(useAppStore.getState().ir.meta.project_name).toBe('Recent rename'));
  });

  it('keeps a newer save intact and reports a rename from an outdated visible version', async () => {
    const { ir, saved } = await startRename();
    ir.meta.project_name = 'Written elsewhere';
    await storage.saveProjectDraft(ir, undefined, { expectedVersion: saved.versionId });
    fireEvent.change(screen.getByLabelText('Saved project name'), { target: { value: 'Outdated rename' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toContain('version changed');
    expect((await storage.loadProjectDraft(ir.meta.project_id))?.meta.project_name).toBe('Written elsewhere');
    expect(await storage.listProjectDraftVersions(ir.meta.project_id)).toHaveLength(1);
  });

  it('preserves current unsaved input edits made while the saved rename is pending', async () => {
    const { ir, saved } = await startRename();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { expect(await persistence.restoreDraft(ir.meta.project_id)).toBe(true); });
    await waitFor(() => expect(persistence.readiness).toBe('editing'));
    const realRename = storage.renameProjectDraft;
    let finish!: () => void;
    vi.spyOn(storage, 'renameProjectDraft').mockImplementation(async (...args) => { await new Promise<void>((resolve) => { finish = resolve; }); return realRename(...args); });
    let pending!: ReturnType<typeof persistence.renameDraft>;
    await act(async () => { pending = persistence.renameDraft(ir.meta.project_id, 'Current renamed', saved.versionId); });
    await act(async () => { useAppStore.getState().mutateIR('edit during rename', (draft) => { draft.mesh_controls.global.global_size = 0.123; }); });
    await act(async () => { finish(); expect((await pending).success).toBe(true); });
    expect(useAppStore.getState().ir.meta.project_name).toBe('Current renamed');
    expect(useAppStore.getState().ir.mesh_controls.global.global_size).toBe(0.123);
    await waitFor(async () => {
      const stored = await storage.loadProjectDraft(ir.meta.project_id);
      expect(stored?.meta.project_name).toBe('Current renamed');
      expect(stored?.mesh_controls.global.global_size).toBe(0.123);
    }, { timeout: 3500 });
    expect(persistence.autosaveState.status).toBe('saved');
  });

  it('uses this tab\'s latest autosaved version when a rename editor was opened before a model edit', async () => {
    const { ir, saved } = await startRename();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { expect(await persistence.restoreDraft(ir.meta.project_id)).toBe(true); });
    await waitFor(() => expect(persistence.readiness).toBe('editing'));
    fireEvent.click(screen.getByRole('button', { name: `Rename Saved original (${ir.meta.project_id})` }));
    fireEvent.change(screen.getByLabelText('Saved project name'), { target: { value: 'Rename after own autosave' } });
    act(() => useAppStore.getState().mutateIR('edit with rename open', (draft) => { draft.mesh_controls.global.global_size = 0.456; }));
    await waitFor(async () => {
      const summary = await storage.getProjectDraftSummary(ir.meta.project_id);
      expect(summary?.versionId).not.toBe(saved.versionId);
      expect(persistence.autosaveState.status).toBe('saved');
    }, { timeout: 3500 });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await screen.findByText('Name saved. Earlier names remain in saved versions.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useAppStore.getState().ir.meta.project_name).toBe('Rename after own autosave');
    expect((await storage.loadProjectDraft(ir.meta.project_id))?.mesh_controls.global.global_size).toBe(0.456);
    // A subsequent edit must still autosave instead of remaining conflict-paused.
    act(() => useAppStore.getState().mutateIR('continued edit', (draft) => { draft.mesh_controls.global.global_size = 0.789; }));
    await waitFor(async () => {
      const stored = await storage.loadProjectDraft(ir.meta.project_id);
      expect(stored?.meta.project_name).toBe('Rename after own autosave');
      expect(stored?.mesh_controls.global.global_size).toBe(0.789);
      expect(persistence.autosaveState.status).toBe('saved');
    }, { timeout: 3500 });
  });

  it('still rejects a foreign current-project write through CAS when no broadcast is available', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const { ir, saved } = await startRename();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { expect(await persistence.restoreDraft(ir.meta.project_id)).toBe(true); });
    await waitFor(() => expect(persistence.readiness).toBe('editing'));
    fireEvent.click(screen.getByRole('button', { name: `Rename Saved original (${ir.meta.project_id})` }));
    ir.meta.project_name = 'Foreign edit'; ir.mesh_controls.global.global_size = 0.246;
    const foreign = await storage.saveProjectDraft(ir, undefined, { expectedVersion: saved.versionId });
    fireEvent.change(screen.getByLabelText('Saved project name'), { target: { value: 'Local rename' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await screen.findByRole('alert');
    expect(persistence.autosaveState.status).toBe('conflict');
    expect((await storage.getProjectDraftSummary(ir.meta.project_id))?.versionId).toBe(foreign.versionId);
    expect((await storage.loadProjectDraft(ir.meta.project_id))?.mesh_controls.global.global_size).toBe(0.246);
    expect(useAppStore.getState().ir.meta.project_name).toBe('Saved original');
  });
});
