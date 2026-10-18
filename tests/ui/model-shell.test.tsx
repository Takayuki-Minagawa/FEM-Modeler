// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { useAppStore } from '@/state/store';
import { LeftSidebar } from '@/ui/layout/LeftSidebar';
import { HelpDialog } from '@/ui/dialogs/HelpDialog';
import { StartScreen } from '@/ui/dialogs/StartScreen';

vi.mock('@/hooks/useAppContext', () => ({ useAppContext: () => ({
  draftSummary: null, restoreDraft: vi.fn(), discardDraft: vi.fn(), addActivity: vi.fn(),
  transitionProject: async (replace: () => void) => { replace(); return { success: true }; },
  saveProjectFile: vi.fn(), autosaveState: { status: 'idle' },
}) }));
vi.mock('@/hooks/useProjectFileLoader', () => ({ useProjectFileLoader: () => ({ openFilePicker: vi.fn(), operation: null, cancel: vi.fn() }) }));
vi.mock('@/ui/dialogs/RecentProjects', () => ({ RecentProjects: () => null }));

beforeEach(async () => { await i18n.changeLanguage('en'); useAppStore.getState().createModelProject('Model'); });
afterEach(cleanup);

describe('modeling shell', () => {
  it('offers only geometry and composition navigation', () => {
    useAppStore.getState().mutateIR('Load legacy diagnostics', (ir) => {
      ir.validation.summary.error_count = 99;
    });
    render(<LeftSidebar />);
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Geometry', 'Named Selections', 'Materials', 'Sections', 'Model handoff', 'Model checks',
    ]);
    expect(screen.queryByText('99')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Model handoff' }));
    expect(useAppStore.getState().activePanel).toBe('export');
  });

  it('starts a geometry template without analysis configuration or results', async () => {
    useAppStore.getState().setStartScreenOpen(true);
    render(<StartScreen />);
    for (const name of ['Empty Project', '2D Frame', '2D Truss', 'Plate', 'Pipe', 'L-Bracket']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    expect(screen.queryByText(/OpenSeesPy|DOLFINx|OpenFOAM|verified samples/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Pipe/ }));
    await waitFor(() => expect(useAppStore.getState().ir.geometry.bodies[0]?.metadata.shapeType).toBe('pipe'));
    const ir = useAppStore.getState().ir;
    expect(ir.analysis_cases).toEqual([]);
    expect(ir.boundary_conditions).toEqual([]);
    expect(ir.loads).toEqual([]);
    expect(ir.results).toEqual([]);
  });

  it.each(['en', 'ja'])('describes geometry and composition handoff in %s', async (language) => {
    await i18n.changeLanguage(language);
    const { container } = render(<HelpDialog isOpen onClose={vi.fn()} />);
    expect(container.textContent).toContain('STEP');
    expect(container.textContent).toContain('IGES');
    expect(container.textContent).toContain('JSON');
    expect(container.textContent).toContain('Bundle');
    expect(container.textContent).not.toMatch(/OpenSeesPy|DOLFINx|OpenFOAM|boundary conditions|境界条件/);
  });
});
