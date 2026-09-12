import resultWorkerUrl from 'virtual:fem-worker-url/results';
import type { SolverTargetName } from '@/core/ir/types';
import { MAX_RESULT_TEXT_BYTES } from './importer';
import type { ResultImportResponse } from './importer';
import { parseResultFileRequest } from './worker-handler';

export const RESULT_WORKER_THRESHOLD_BYTES = 1024 * 1024;
const WORKER_TIMEOUT_MS = 60_000;
const aborted = () => new DOMException('Result import cancelled.', 'AbortError');

/** Returns parsed data only: callers must verify it against current input before storing it. */
export async function parseResultFileAsync(
  file: File,
  analysisCaseId: string,
  solverTarget: SolverTargetName,
  signal?: AbortSignal,
): Promise<ResultImportResponse> {
  if (signal?.aborted) throw aborted();
  if (file.size > MAX_RESULT_TEXT_BYTES) throw new Error('Result file exceeds the 20 MB safety limit.');
  const request = { file, analysisCaseId, solverTarget };
  if (file.size < RESULT_WORKER_THRESHOLD_BYTES) {
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(aborted());
      signal?.addEventListener('abort', onAbort, { once: true });
      void parseResultFileRequest(request).then((response) => {
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) reject(aborted());
        else resolve(response);
      }, (error: unknown) => {
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      });
    });
  }
  if (typeof Worker === 'undefined') throw new Error('This browser cannot process large result files because Web Workers are unavailable.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(resultWorkerUrl, { type: 'module', name: 'fem-result-import' });
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    };
    const onAbort = () => fail(aborted());
    const timer = setTimeout(() => fail(new Error('Result processing timed out. Please retry or use a smaller file.')), WORKER_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<ResultImportResponse>) => {
      if (settled) return;
      settled = true; cleanup();
      if (signal?.aborted) reject(aborted());
      else resolve(event.data);
    };
    worker.onerror = (event) => { event.preventDefault(); fail(new Error(event.message || 'Result worker could not start or process this file.')); };
    worker.onmessageerror = () => fail(new Error('The result worker returned unreadable data.'));
    try { worker.postMessage(request); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}
