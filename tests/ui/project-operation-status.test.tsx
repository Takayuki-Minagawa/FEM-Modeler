// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppContextProvider } from '@/contexts/AppContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useAppStore } from '@/state/store';
import { GlobalBar } from '@/ui/layout/GlobalBar';
import { StartScreen } from '@/ui/dialogs/StartScreen';
import { ExportForm } from '@/ui/forms/ExportForm';
import { modelExportCopy } from '@/i18n/locales/model-export';

const mocks = vi.hoisted(() => ({ read: vi.fn(), download: vi.fn(), activity: vi.fn() }));
vi.mock('@/export/project/load', async (original) => ({ ...await original<typeof import('@/export/project/load')>(), readFileAsText: mocks.read }));
vi.mock('@/hooks/useProjectDraftPersistence', () => ({ useProjectDraftPersistence: () => ({
  saveProjectFile: mocks.download, addActivity: mocks.activity, clearActivityLog: vi.fn(),
  transitionProject: async (replace: () => void) => { replace(); return { success: true }; },
  draftSummary: null, autosaveState: { status: 'idle' }, recentProjects: [], readiness: 'editing',
}) }));
beforeEach(async () => {
  await i18n.changeLanguage('en'); vi.clearAllMocks(); window.innerWidth = 2000;
  useAppStore.getState().createProject('Current project', 'solid');
  mocks.download.mockReturnValue({ fileName: 'current.fem.json', bytes: 123 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['bar', 'start'] as const)('shows cancellable project-file progress from the %s screen and ignores late reads', async (surface) => {
  const selectedInputs: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { selectedInputs.push(this); });
  let finish!: (text: string) => void;
  mocks.read.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve; }));
  if (surface === 'start') useAppStore.getState().setStartScreenOpen(true);
  render(<AppContextProvider>{surface === 'bar' ? <GlobalBar /> : <StartScreen />}</AppContextProvider>);
  fireEvent.click(screen.getByRole('button', { name: surface === 'bar' ? 'Load' : i18n.t('startScreen.openExisting'), exact: true }));
  act(() => fireEvent.change(selectedInputs[0], { target: { files: [new File(['{}'], 'pending.fem.json')] } }));
  expect(screen.getByRole('status').textContent).toContain('pending.fem.json');
  expect(screen.getByRole('status').textContent).toContain('Operation: run_');
  expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await act(async () => { finish('not JSON'); });
  expect(screen.getByRole('status').textContent).toContain('Import cancelled.');
  expect(useAppStore.getState().ir.meta.project_name).toBe('Current project');
  expect(mocks.activity).not.toHaveBeenCalled();
});

function HistoryProbe() {
  const { exportHistory } = useAppContext();
  return <pre aria-label="Saved history">{JSON.stringify(exportHistory)}</pre>;
}
it('records the JSON export operation ID shown to the user without losing artifact identity', async () => {
  render(<AppContextProvider><ExportForm /><HistoryProbe /></AppContextProvider>);
  fireEvent.click(screen.getByRole('button', { name: `${modelExportCopy('en').save} ${modelExportCopy('en').targets.JSON}`, exact: true }));
  const history = JSON.parse(screen.getByLabelText('Saved history').textContent!);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ target: 'JSON', projectId: useAppStore.getState().ir.meta.project_id, fileName: 'current.fem.json', bytes: 123 });
  expect(history[0].operationId).toMatch(/^run_/);
  expect(screen.getByRole('status').textContent).toContain(history[0].operationId);
});
