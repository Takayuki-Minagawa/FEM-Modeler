// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { useAppStore } from '@/state/store';
import { createModelProject } from '@/modeling/project';
import { validateModel } from '@/modeling/validation';
import { ModelDiagnosticMessage, ModelValidationSummary } from '@/ui/forms/common/ModelValidationSummary';
import { BottomPanel } from '@/ui/layout/BottomPanel';
import { AppContext, type AppContextValue, type ExportHistoryEntry } from '@/contexts/app-context-value';
import { openDiagnosticTarget } from '@/ui/forms/common/openDiagnosticTarget';

beforeEach(async () => {
  await i18n.changeLanguage('en');
  useAppStore.getState().loadProject(createModelProject('Components', 'frame', 'en'));
});
afterEach(cleanup);

function context(exportHistory: ExportHistoryEntry[] = []): AppContextValue {
  return { activityLog: [], clearActivityLog: vi.fn(), addActivity: vi.fn(), clearExportHistory: vi.fn(), exportHistory } as unknown as AppContextValue;
}

describe('model checks in the workspace', () => {
  it('does not expose legacy analysis diagnostics as model checks', () => {
    useAppStore.getState().mutateArtifact('legacy checks', ir => {
      ir.validation.last_run_at = '2026-10-18T00:00:00Z';
      ir.validation.validated_revision = ir.validation.model_revision;
      ir.validation.summary.error_count = 1;
      ir.validation.items = [{ id: 'legacy', code: 'BC_MISSING', title: 'Missing supports', message: 'Add supports.', suggested_fix: 'Add boundary conditions.', target_ref: 'bc', severity: 'error', status: 'open', dismissible: false }];
    });
    render(<AppContext.Provider value={context()}><BottomPanel /></AppContext.Provider>);
    expect(screen.getByText('Model checks have not been run')).toBeTruthy();
    expect(screen.getByText('Earlier analysis checks are not used as model checks.')).toBeTruthy();
    expect(screen.queryByText('Missing supports')).toBeNull();
    expect(screen.queryByText(/No model consistency issues/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check model' }));
    expect(screen.getByText('Current model checked')).toBeTruthy();
    expect(screen.getByText('No model consistency issues were found.')).toBeTruthy();
    expect(useAppStore.getState().ir.validation.context).toBeUndefined();
  });

  it('marks current model checks stale after a geometry edit', () => {
    const ir = structuredClone(useAppStore.getState().ir);
    ir.validation = validateModel(ir);
    const view = render(<ModelValidationSummary ir={ir} />);
    expect(screen.getByText('Current model checked')).toBeTruthy();
    ir.geometry.bodies[0].transform.position = [10, 0, 0];
    view.rerender(<ModelValidationSummary ir={ir} />);
    expect(screen.getByText('Model changed after the checks')).toBeTruthy();
    expect(screen.queryByText('No model consistency issues were found.')).toBeNull();
  });

  it('opens a broken group in the component editor and supports Japanese diagnostics', async () => {
    const ir = structuredClone(useAppStore.getState().ir);
    ir.named_selections[0].member_refs = ['missing-body'];
    const item = validateModel(ir).items.find(item => item.code === 'MODEL_SELECTION');
    if (!item) throw new Error('Expected invalid group');
    useAppStore.getState().loadProject(ir);
    const view = render(<ModelDiagnosticMessage ir={ir} item={item} />);
    fireEvent.click(screen.getByRole('button', { name: `Open target: ${ir.named_selections[0].name}` }));
    expect(useAppStore.getState().activePanel).toBe('selections');
    await act(async () => { await i18n.changeLanguage('ja'); });
    view.rerender(<ModelDiagnosticMessage ir={ir} item={item} />);
    expect(screen.getByText('構成グループが不正です')).toBeTruthy();
    expect(screen.getByText('メンバーは選択した要素の種類・次元に一致する必要があります。')).toBeTruthy();
  });

  it('keeps an already selected diagnostic target open', async () => {
    const onClick = vi.fn();
    render(<button data-entity-id="group-a" aria-pressed="true" onClick={onClick}>Selected group</button>);
    openDiagnosticTarget({ panel: 'selections', id: 'group-a', name: 'Group A' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button')));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('model save and handoff history', () => {
  it('filters by project and model format while preserving readable file context', () => {
    const ir = useAppStore.getState().ir;
    const entry: ExportHistoryEntry = { id: 'current', projectId: ir.meta.project_id, projectName: ir.meta.project_name, revision: 4, fileName: 'components.step', bytes: 1200, target: 'STEP', timestamp: '2026-10-18T01:00:00Z', status: 'success', errorCount: 0, warningCount: 0, errors: [], warnings: [] };
    const history = [entry, { ...entry, id: 'old', projectId: 'other-project', projectName: 'Archived project', fileName: 'previous.json', target: 'JSON' }, { ...entry, id: 'solver', target: 'OpenSeesPy', fileName: 'analysis.zip', analysisCaseName: 'Wind', analysisCaseId: 'case-a' }];
    render(<AppContext.Provider value={context(history)}><BottomPanel /></AppContext.Provider>);
    fireEvent.click(screen.getByRole('button', { name: /^Save \/ handoff history/ }));
    expect(screen.getByText('components.step')).toBeTruthy();
    expect(screen.queryByText('previous.json')).toBeNull();
    expect(screen.queryByText('analysis.zip')).toBeNull();
    expect(screen.queryByText('Wind')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Export history scope' }), { target: { value: 'all' } });
    expect(screen.getByText('previous.json')).toBeTruthy();
    expect(screen.getByText(/Archived project/)).toBeTruthy();
    expect(screen.queryByText('analysis.zip')).toBeNull();
  });
});
