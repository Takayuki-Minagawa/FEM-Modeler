// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/state/store';
import { applyTemplate } from '@/lib/project-templates';
import { ResultsForm } from '@/ui/forms/ResultsForm';
import { createExportProvenance } from '@/core/ir/provenance';
import { parseResultText } from '@/results/importer';
import type { ResultImportResponse } from '@/results/importer';
import type { ResultParseRequest } from '@/results/worker-handler';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
class PendingWorker {
  static current: PendingWorker;
  request!: ResultParseRequest;
  onmessage: ((event: MessageEvent<ResultImportResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  constructor() { PendingWorker.current = this; }
  postMessage(request: ResultParseRequest) { this.request = request; }
}
let source: string;
beforeEach(() => {
  useAppStore.getState().createProject('thermal', 'thermal'); applyTemplate('thermal', 'en');
  const ir = useAppStore.getState().ir;
  source = `# FEM_MODELER_PROVENANCE ${JSON.stringify(createExportProvenance(ir, 'DOLFINx', ir.analysis_cases[0].id))}\nnode_id,temperature_K\n1,300\n`;
  vi.stubGlobal('Worker', PendingWorker);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function start() {
  const view = render(<ResultsForm />);
  const file = { name: 'large.csv', size: 2 * 1024 * 1024, text: vi.fn(async () => source) };
  fireEvent.change(view.container.querySelector('input[type=file]')!, { target: { files: [file] } });
  const worker = PendingWorker.current;
  const request = worker.request;
  const response = parseResultText(source, file.name, request.analysisCaseId, request.solverTarget);
  expect(file.text).not.toHaveBeenCalled();
  return { view, worker, response };
}
const importButton = () => screen.getByRole('button', { name: 'Import result CSV / manifest / mesh JSON' }) as HTMLButtonElement;

describe('result Worker UI completion guard', () => {
  it('verifies current input on worker completion and unlocks the import button', async () => {
    const { worker, response } = start();
    expect(importButton().disabled).toBe(true);
    await act(async () => { worker.onmessage!({ data: response } as MessageEvent<ResultImportResponse>); });
    expect(useAppStore.getState().ir.results[0].metadata.provenance_verified).toBe(true);
    expect(importButton().disabled).toBe(false); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('rejects old physics parsed in the worker after model editing', async () => {
    const { worker, response } = start();
    act(() => useAppStore.getState().updateBoundaryCondition(useAppStore.getState().ir.boundary_conditions[0].id, { values: { scalar: 350 } }));
    await act(async () => { worker.onmessage!({ data: response } as MessageEvent<ResultImportResponse>); });
    expect(useAppStore.getState().ir.results).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toMatch(/input fingerprint/);
    expect(importButton().disabled).toBe(false);
  });
  it('rejects completion after switching to a different project', async () => {
    const { worker, response } = start();
    act(() => { useAppStore.getState().createProject('other', 'thermal'); applyTemplate('thermal', 'en'); });
    await act(async () => { worker.onmessage!({ data: response } as MessageEvent<ResultImportResponse>); });
    expect(useAppStore.getState().ir.results).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain('project or analysis case changed');
    expect(importButton().disabled).toBe(false);
  });
  it('cancels immediately and ignores a response queued before termination', async () => {
    const { worker, response } = start(); const lateMessage = worker.onmessage!;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    await act(async () => { lateMessage({ data: response } as MessageEvent<ResultImportResponse>); });
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(importButton().disabled).toBe(false);
    expect(useAppStore.getState().ir.results).toHaveLength(0); expect(screen.getByRole('status').textContent).toContain('cancelled');
  });
  it('terminates on unmount and never stores a late result', async () => {
    const { worker, response, view } = start(); const lateMessage = worker.onmessage!;
    view.unmount();
    await act(async () => { lateMessage({ data: response } as MessageEvent<ResultImportResponse>); });
    expect(worker.terminate).toHaveBeenCalledOnce(); expect(useAppStore.getState().ir.results).toHaveLength(0);
  });
  it('releases busy state on worker failures and parser errors', async () => {
    const { worker } = start();
    await act(async () => { worker.onerror!({ message: 'Worker load failed', preventDefault: vi.fn() } as unknown as ErrorEvent); });
    expect(importButton().disabled).toBe(false); expect(screen.getByRole('status').textContent).toContain('Worker load failed');
    expect(useAppStore.getState().ir.results).toHaveLength(0);
  });
});
