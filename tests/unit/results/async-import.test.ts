import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseResultFileAsync, RESULT_WORKER_THRESHOLD_BYTES } from '@/results/async-import';
import { MAX_RESULT_TEXT_BYTES, parseResultText, verifyResultImport } from '@/results/importer';
import { parseResultFileRequest } from '@/results/worker-handler';
import type { ResultImportResponse } from '@/results/importer';
import type { ResultParseRequest } from '@/results/worker-handler';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<ResultImportResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn<(request: ResultParseRequest) => void>();
  terminate = vi.fn();
  constructor(public url: string, public options: WorkerOptions) { FakeWorker.instances.push(this); }
}
const file = (size = RESULT_WORKER_THRESHOLD_BYTES) => ({ name: 'results.csv', size, text: vi.fn(async () => 'node_id,ux_m\n1,0.25\n') }) as unknown as File;
const parsed = () => parseResultText('node_id,ux_m\n1,0.25\n', 'results.csv', 'case', 'OpenSeesPy');

beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('result parsing worker lifecycle', () => {
  it('sends a File to the module worker, leaves large-file reading there, and terminates after success', async () => {
    const input = file(); const pending = parseResultFileAsync(input, 'case', 'OpenSeesPy');
    const worker = FakeWorker.instances[0];
    expect(worker.options.type).toBe('module'); expect(worker.url).toContain('result-import.worker');
    expect(worker.postMessage).toHaveBeenCalledWith({ file: input, analysisCaseId: 'case', solverTarget: 'OpenSeesPy' });
    expect(input.text).not.toHaveBeenCalled();
    const response = parsed(); worker.onmessage!({ data: response } as MessageEvent<ResultImportResponse>);
    expect(await pending).toBe(response); expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull(); expect(worker.onerror).toBeNull();
  });
  it('terminates and rejects on cancellation, and ignores late messages', async () => {
    const controller = new AbortController();
    const pending = parseResultFileAsync(file(), 'case', 'OpenSeesPy', controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const worker = FakeWorker.instances[0]; const late = worker.onmessage!;
    controller.abort(); late({ data: parsed() } as MessageEvent<ResultImportResponse>);
    await rejection; expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('cleans up worker startup errors, clone errors, unreadable responses, and timeout', async () => {
    const pending = parseResultFileAsync(file(), 'case', 'OpenSeesPy');
    const rejection = expect(pending).rejects.toThrow('failed to load');
    FakeWorker.instances[0].onerror!({ message: 'failed to load', preventDefault: vi.fn() } as unknown as ErrorEvent);
    await rejection; expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const unreadable = parseResultFileAsync(file(), 'case', 'OpenSeesPy');
    const unreadableRejection = expect(unreadable).rejects.toThrow('unreadable');
    FakeWorker.instances[1].onmessageerror!(); await unreadableRejection;
    vi.useFakeTimers();
    const timeout = parseResultFileAsync(file(), 'case', 'OpenSeesPy');
    const timeoutRejection = expect(timeout).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(60_000); await timeoutRejection;
    expect(FakeWorker.instances[2].terminate).toHaveBeenCalledOnce();
    class CloneFailure extends FakeWorker { postMessage = vi.fn(() => { throw new Error('clone failed'); }); }
    vi.stubGlobal('Worker', CloneFailure);
    await expect(parseResultFileAsync(file(), 'case', 'OpenSeesPy')).rejects.toThrow('clone failed');
    expect(FakeWorker.instances[3].terminate).toHaveBeenCalledOnce();
  });
  it('uses bounded main-thread parsing for small files and honors cancellation during File reading', async () => {
    const input = file(10); const response = await parseResultFileAsync(input, 'case', 'OpenSeesPy');
    expect(response.success).toBe(true); expect(input.text).toHaveBeenCalledOnce(); expect(FakeWorker.instances).toHaveLength(0);
    let complete!: (text: string) => void;
    const delayed = { name: 'r.csv', size: 100, text: () => new Promise<string>((resolve) => { complete = resolve; }) } as File;
    const controller = new AbortController(); const pending = parseResultFileAsync(delayed, 'case', 'OpenSeesPy', controller.signal);
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejection;
    complete('node_id,ux_m\n1,0\n');
    await expect(parseResultFileAsync(file(), 'case', 'OpenSeesPy', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects oversized inputs before reading and reports absent Worker support for large files', async () => {
    const input = file(MAX_RESULT_TEXT_BYTES + 1);
    await expect(parseResultFileAsync(input, 'case', 'OpenSeesPy')).rejects.toThrow('20 MB'); expect(input.text).not.toHaveBeenCalled();
    vi.stubGlobal('Worker', undefined);
    await expect(parseResultFileAsync(file(), 'case', 'OpenSeesPy')).rejects.toThrow('unavailable');
    expect((await parseResultFileAsync(file(10), 'case', 'OpenSeesPy')).success).toBe(true);
  });
  it('worker handler parses JSON/CSV and surfaces malformed text, read errors, and size violations', async () => {
    const csv = await parseResultFileRequest({ file: file(10), analysisCaseId: 'case', solverTarget: 'OpenSeesPy' });
    expect(csv.result?.fields[0].values).toEqual([0.25]);
    const json = await parseResultFileRequest({ file: { name: 'manifest.json', size: 50, text: async () => '{"execution_return_code":0}' }, analysisCaseId: 'case', solverTarget: 'OpenFOAM' });
    expect(json.result?.checks[0].kind).toBe('solver_execution');
    for (const input of [file(MAX_RESULT_TEXT_BYTES + 1), { name: 'r.csv', size: 10, text: async () => 'bad' }, { name: 'r.csv', size: 10, text: async () => { throw new Error('read failed'); } }]) {
      expect((await parseResultFileRequest({ file: input, analysisCaseId: 'case', solverTarget: 'OpenSeesPy' })).success).toBe(false);
    }
  });
  it('reverification changes only metadata and rejects a different parsed context', () => {
    const result = parsed().result!; result.metadata.provenance_verified = true;
    const response = verifyResultImport(result, 'case', 'OpenSeesPy');
    expect(response.result?.metadata.provenance_verified).toBe(false);
    expect(result.metadata.provenance_verified).toBe(true);
    expect(response.result?.fields).toBe(result.fields);
    expect(verifyResultImport(result, 'other-case', 'OpenSeesPy').success).toBe(false);
  });
});
