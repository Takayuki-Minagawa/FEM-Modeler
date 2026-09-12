// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { ConvergenceStudyForm } from '@/ui/forms/ConvergenceStudyForm';
import { GeometryForm } from '@/ui/forms/GeometryForm';
import { ResultsForm } from '@/ui/forms/ResultsForm';
import { createExportProvenance } from '@/core/ir/provenance';
import { parseProjectFile } from '@/export/project/load';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
afterEach(cleanup);
beforeEach(() => { useAppStore.getState().createProject('thermal', 'thermal'); applyTemplate('thermal', 'en'); });

describe('feature editing workflows', () => {
  it('saves manual convergence provenance, restores it after remount and project schema round trip', () => {
    const caseId = useAppStore.getState().ir.analysis_cases[0].id;
    const view = render(<ConvergenceStudyForm analysisCaseId={caseId} />);
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'manual' } });
    fireEvent.change(screen.getByLabelText('Manual QoI definition'), { target: { value: 'tip temperature' } });
    fireEvent.change(screen.getByLabelText('Manual QoI unit'), { target: { value: 'K' } });
    fireEvent.change(screen.getByLabelText('Manual QoI location'), { target: { value: 'x=1 m' } });
    screen.getAllByLabelText('h').forEach((input, i) => fireEvent.change(input, { target: { value: [1, 0.5, 0.25][i] } }));
    screen.getAllByRole('spinbutton', { name: 'QoI' }).forEach((input, i) => fireEvent.change(input, { target: { value: [2, 1.25, 1.0625][i] } }));
    fireEvent.click(screen.getByText('Calculate and save'));
    const study = useAppStore.getState().ir.convergence_studies[0]; expect(study.provenance).toBe('manual_unverified');
    const saved = parseProjectFile(JSON.stringify(useAppStore.getState().ir)).data!;
    expect(saved.convergence_studies[0]).toEqual(study);
    view.unmount(); render(<ConvergenceStudyForm analysisCaseId={caseId} />);
    expect(screen.getByText(/tip temperature convergence/)).toBeTruthy(); expect(screen.getByText('Download Markdown')).toBeTruthy();
  });
  it('edits selected primitive dimensions with units and restores assignments in one Undo', () => {
    const before = useAppStore.getState().ir; const body = before.geometry.bodies[0];
    useAppStore.getState().setUnitSystem('mm-N-s'); useAppStore.getState().setSelectedEntities([body.id]);
    render(<GeometryForm />);
    fireEvent.change(screen.getByLabelText('Dimension width'), { target: { value: '3000' } });
    fireEvent.click(screen.getByText('Apply dimensions'));
    expect(useAppStore.getState().ir.geometry.bodies[0].metadata.width).toBe(3);
    expect(useAppStore.getState().ir.named_selections).toEqual(before.named_selections);
    act(() => useAppStore.getState().undo()); expect(useAppStore.getState().ir.geometry.bodies[0].metadata.width).toBe(2);
  });
  it('rechecks the current input after asynchronous result reading', async () => {
    const before = useAppStore.getState().ir; const caseId = before.analysis_cases[0].id;
    const provenance = createExportProvenance(before, 'DOLFINx', caseId);
    let resolveText!: (text: string) => void;
    const file = { name: 'results.csv', size: 200, text: () => new Promise<string>((resolve) => { resolveText = resolve; }) };
    const view = render(<ResultsForm />);
    fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file] } });
    act(() => useAppStore.getState().updateGlobalMeshControls({ global_size: 0.03 }));
    await act(async () => { resolveText(`# FEM_MODELER_PROVENANCE ${JSON.stringify(provenance)}\nnode_id,temperature_K\n1,300\n`); });
    expect(useAppStore.getState().ir.results).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toMatch(/fingerprint|input/i);
  });
});
