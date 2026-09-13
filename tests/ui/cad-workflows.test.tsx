// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/state/store';
import { ImportDialog } from '@/ui/dialogs/ImportDialog';
import { ExportForm } from '@/ui/forms/ExportForm';
import { importSTL, type STLImportResult } from '@/geometry/import/stl-loader';
import { clearSTLGeometryCache, getSTLGeometry } from '@/geometry/import/stl-geometry-cache';
import { createCadSource } from '@/geometry/import/cad-source';
import { useViewerState } from '@/viewer/view-state';

const mocks = vi.hoisted(() => ({ importCAD: vi.fn(), importSTL: vi.fn(), downloadCAD: vi.fn(), addActivity: vi.fn(), recordExportResult: vi.fn(), saveProjectFile: vi.fn(), loadFromFile: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('@/geometry/import/cad-async', () => ({ importCADAsync: mocks.importCAD }));
vi.mock('@/geometry/import/stl-async', () => ({ importSTLAsync: mocks.importSTL }));
vi.mock('@/export/cad/exporter', () => ({ downloadCAD: mocks.downloadCAD }));
vi.mock('@/hooks/useAppActionsContext', () => ({ useAppActionsContext: () => mocks }));
vi.mock('@/hooks/useProjectFileLoader', () => ({ useProjectFileLoader: () => ({ loadFromFile: mocks.loadFromFile }) }));

const bytes = new TextEncoder().encode('solid preview\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid preview').buffer;
function preview(): STLImportResult {
  const result = importSTL(bytes, 'preview.stl', 1, 'm');
  result.body!.metadata.shapeType = 'imported_cad';
  result.body!.metadata.importFormat = 'step';
  result.body!.metadata.fileName = 'part.step';
  result.asset!.cad_source = createCadSource(new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;'), 'step', 'part.step');
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function drop(name: string, arrayBuffer = vi.fn(async () => bytes), size = bytes.byteLength) {
  fireEvent.drop(screen.getByRole('button', { name: /Drop file or click to browse/ }), { dataTransfer: { files: [{ name, size, arrayBuffer }] } });
  return arrayBuffer;
}
beforeEach(() => { vi.clearAllMocks(); useAppStore.getState().createProject('CAD workflow', 'solid'); useViewerState.getState().set({ focus: null }); });
afterEach(() => { cleanup(); clearSTLGeometryCache(); });

describe('CAD import UI', () => {
  it.each(['step', 'stp', 'iges', 'igs'])('accepts .%s and keeps the STL unit selection out of the CAD API', async (extension) => {
    const result = preview(); mocks.importCAD.mockResolvedValueOnce(result);
    render(<ImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByText(/units are read from the file automatically/)).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ft' } });
    drop(`part.${extension}`);
    await waitFor(() => expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(1));
    expect(mocks.importCAD).toHaveBeenCalledWith(bytes, `part.${extension}`, expect.any(AbortSignal));
    expect(mocks.importSTL).not.toHaveBeenCalled();
    expect(useAppStore.getState().ir.assets[0].id).toBe(result.asset!.id);
    expect(getSTLGeometry(result.body!.id)).toBe(result.geometry);
    expect(useViewerState.getState().focus?.points).toHaveLength(8);
    expect(screen.getByRole('status').textContent).toContain('Imported');
    expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
  });

  it('still applies the chosen unit to STL', async () => {
    mocks.importSTL.mockResolvedValueOnce(preview());
    render(<ImportDialog isOpen onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'in' } });
    drop('part.stl');
    await waitFor(() => expect(mocks.importSTL).toHaveBeenCalledWith(bytes, 'part.stl', 0.0254, 'in', expect.any(AbortSignal)));
    expect(mocks.importCAD).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'close', 'unmount', 'same-project-reload'])('discards and disposes a late CAD conversion after %s', async (action) => {
    const pending = deferred<STLImportResult>(); mocks.importCAD.mockReturnValueOnce(pending.promise);
    const result = preview(); const dispose = vi.spyOn(result.geometry!, 'dispose');
    const view = render(<ImportDialog isOpen onClose={vi.fn()} />);
    drop('late.step');
    await waitFor(() => expect(mocks.importCAD).toHaveBeenCalledOnce());
    const signal = mocks.importCAD.mock.calls[0][2] as AbortSignal;
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    if (action === 'close') view.rerender(<ImportDialog isOpen={false} onClose={vi.fn()} />);
    if (action === 'unmount') view.unmount();
    if (action === 'same-project-reload') act(() => useAppStore.getState().loadProject(structuredClone(useAppStore.getState().ir)));
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(result); });
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(0);
    expect(getSTLGeometry(result.body!.id)).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(mocks.addActivity).not.toHaveBeenCalled();
    if (action === 'cancel') {
      expect(screen.getByRole('status').textContent).toContain('cancelled');
      expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
    }
  });

  it('does not start the kernel when the project changes while file bytes are reading', async () => {
    const pending = deferred<ArrayBuffer>();
    render(<ImportDialog isOpen onClose={vi.fn()} />);
    drop('reading.step', vi.fn(() => pending.promise));
    act(() => useAppStore.getState().createProject('replacement', 'solid'));
    await act(async () => { pending.resolve(bytes); });
    expect(mocks.importCAD).not.toHaveBeenCalled();
    expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
  });

  it('shows conversion errors and accepts another file after failure', async () => {
    mocks.importCAD.mockRejectedValueOnce(new Error('Invalid STEP topology'));
    render(<ImportDialog isOpen onClose={vi.fn()} />);
    drop('broken.step');
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Invalid STEP topology'));
    expect(screen.queryByRole('button', { name: 'Cancel import' })).toBeNull();
    mocks.importCAD.mockResolvedValueOnce(preview());
    drop('valid.step');
    await waitFor(() => expect(useAppStore.getState().ir.geometry.bodies).toHaveLength(1));
  });

  it('rejects oversized CAD input before reading bytes', async () => {
    render(<ImportDialog isOpen onClose={vi.fn()} />);
    const read = drop('large.step', vi.fn(async () => bytes), 25 * 1024 * 1024 + 1);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('25 MB'));
    expect(read).not.toHaveBeenCalled(); expect(mocks.importCAD).not.toHaveBeenCalled();
  });
});

describe('CAD export UI', () => {
  it.each(['STEP', 'IGES'])('exports all bodies as %s without requiring solver assignments', async (target) => {
    const imported = preview();
    useAppStore.getState().addBodyWithTopology(imported.body!, { assets: [imported.asset!] });
    imported.geometry!.dispose();
    const snapshot = useAppStore.getState().ir;
    mocks.downloadCAD.mockResolvedValueOnce({ errors: [], warnings: [] });
    render(<ExportForm />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${target} Export all bodies`) }));
    await waitFor(() => expect(mocks.downloadCAD).toHaveBeenCalledWith(snapshot, target.toLowerCase(), expect.any(AbortSignal)));
    expect(screen.getByRole('status').textContent).toContain(`${target}: Success`);
    expect(mocks.recordExportResult).toHaveBeenCalledWith(target, [], []);
  });

  it('shows unsupported shape errors and releases the buttons', async () => {
    mocks.downloadCAD.mockResolvedValueOnce({ errors: ['Imported STL has no exact CAD source.'], warnings: [] });
    render(<ExportForm />);
    fireEvent.click(screen.getByRole('button', { name: /^STEP Export all bodies/ }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Imported STL has no exact CAD source.'));
    expect((screen.getByRole('button', { name: /^IGES Export all bodies/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['cancel', 'unmount', 'same-project-reload'])('aborts CAD export on %s and ignores late completion', async (action) => {
    const pending = deferred<{ errors: string[]; warnings: string[] }>(); mocks.downloadCAD.mockReturnValueOnce(pending.promise);
    const view = render(<ExportForm />);
    fireEvent.click(screen.getByRole('button', { name: /^STEP Export all bodies/ }));
    await waitFor(() => expect(mocks.downloadCAD).toHaveBeenCalledOnce());
    const signal = mocks.downloadCAD.mock.calls[0][2] as AbortSignal;
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel CAD export' }));
    if (action === 'unmount') view.unmount();
    if (action === 'same-project-reload') act(() => useAppStore.getState().loadProject(structuredClone(useAppStore.getState().ir)));
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve({ errors: [], warnings: [] }); });
    expect(mocks.recordExportResult).not.toHaveBeenCalled(); expect(mocks.addActivity).not.toHaveBeenCalled();
    if (action !== 'unmount') {
      expect(screen.getByRole('status').textContent).toContain('Cancelled');
      expect((screen.getByRole('button', { name: /^IGES Export all bodies/ }) as HTMLButtonElement).disabled).toBe(false);
    }
  });
});
