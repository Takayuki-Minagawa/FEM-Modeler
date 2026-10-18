// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { useAppStore } from '@/state/store';
import { ExportForm } from '@/ui/forms/ExportForm';
import { generateShape } from '@/geometry/primitives/generators';

const mocks = vi.hoisted(() => ({
  addActivity: vi.fn(), recordExportResult: vi.fn(), saveProjectFile: vi.fn(), bundle: vi.fn(), cad: vi.fn(),
}));
vi.mock('@/hooks/useAppActionsContext', () => ({ useAppActionsContext: () => mocks }));
vi.mock('@/export/project/bundle', () => ({ downloadProjectBundle: mocks.bundle }));
vi.mock('@/export/cad/exporter', () => ({ downloadCAD: mocks.cad }));

beforeEach(async () => {
  vi.clearAllMocks();
  await i18n.changeLanguage('en');
  useAppStore.getState().createProject('Assembly handoff');
  for (const width of [1, 2]) {
    const generated = generateShape({ shapeType: 'box', width, height: 1, depth: 1 });
    useAppStore.getState().addBodyWithTopology(generated.body, generated);
    generated.threeGeometry.dispose();
  }
  mocks.bundle.mockResolvedValue({ fileName: 'assembly.fem.zip', bytes: 1234 });
});
afterEach(cleanup);

describe('model handoff', () => {
  it.each(['en', 'ja'])('offers only the four model formats and explains CAD limits in %s', async (language) => {
    await i18n.changeLanguage(language);
    render(<ExportForm />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
    for (const format of ['STEP', 'IGES', 'JSON', 'Bundle']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${format}`) })).toBeTruthy();
    }
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/OpenSeesPy|DOLFINx|OpenFOAM/)).toBeNull();
    expect(screen.getByText(language === 'ja' ? /断面を持つソリッドにはなりません/ : /without section solids/)).toBeTruthy();
    expect(screen.getByText(language === 'ja' ? /STEP／IGES には、これらの編集上の関連付けは引き継がれません/ : /STEP\/IGES do not transfer these editing relationships/)).toBeTruthy();
  });

  it('saves the complete immutable model without running or changing validation', async () => {
    useAppStore.getState().mutateIR('Legacy validation context', ir => {
      ir.validation.summary.error_count = 3;
      ir.validation.validated_revision = -1;
    });
    const snapshot = useAppStore.getState().ir;
    render(<ExportForm />);
    fireEvent.click(screen.getByRole('button', { name: /^Bundle / }));
    await waitFor(() => expect(mocks.bundle).toHaveBeenCalledWith(snapshot));
    expect(useAppStore.getState().ir).toBe(snapshot);
    expect(snapshot.geometry.bodies).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toContain('Bundle: Success');
    expect(mocks.recordExportResult).toHaveBeenCalledWith('Bundle', [], [], expect.objectContaining({
      projectId: snapshot.meta.project_id, projectName: snapshot.meta.project_name,
      revision: snapshot.validation.model_revision, fileName: 'assembly.fem.zip', bytes: 1234,
    }));
    expect(mocks.recordExportResult.mock.calls[0][3]).not.toHaveProperty('analysisCaseId');
  });

  it('uses the existing JSON save and history action exactly once', () => {
    render(<ExportForm />);
    fireEvent.click(screen.getByRole('button', { name: /^JSON / }));
    expect(mocks.saveProjectFile).toHaveBeenCalledWith(expect.stringMatching(/^run_/));
    expect(mocks.saveProjectFile).toHaveBeenCalledOnce();
    expect(mocks.recordExportResult).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('JSON: Success');
  });

  it.each(['project switch', 'same-project reload', 'unmount'])('records an already started Bundle under its original snapshot after %s', async (navigation) => {
    let finish!: (value: { fileName: string; bytes: number }) => void;
    mocks.bundle.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const original = useAppStore.getState().ir;
    const view = render(<ExportForm />);
    fireEvent.click(screen.getByRole('button', { name: /^Bundle / }));
    await waitFor(() => expect(mocks.bundle).toHaveBeenCalledOnce());
    if (navigation === 'project switch') act(() => useAppStore.getState().createProject('Next model'));
    else if (navigation === 'same-project reload') act(() => useAppStore.getState().loadProject(structuredClone(original)));
    else view.unmount();
    await act(async () => finish({ fileName: 'original.fem.zip', bytes: 20 }));
    expect(mocks.recordExportResult).toHaveBeenCalledWith('Bundle', [], [], expect.objectContaining({
      projectId: original.meta.project_id, projectName: original.meta.project_name,
      revision: original.validation.model_revision, fileName: 'original.fem.zip', bytes: 20,
    }));
    expect(mocks.addActivity).not.toHaveBeenCalled();
    expect(screen.queryByText('Bundle: Success')).toBeNull();
  });
});
