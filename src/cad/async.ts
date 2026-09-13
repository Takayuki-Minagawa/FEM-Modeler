import workerUrl from 'virtual:fem-worker-url/cad';
import type { CADImportData, CADRequest, CADResponse } from './types';

const TIMEOUT_MS = 120_000;
export function runCADTask(request: CADRequest, signal?: AbortSignal): Promise<CADImportData | Uint8Array> {
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  if (typeof Worker === 'undefined') return Promise.reject(new Error('STEP/IGES conversion requires browser Worker support.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { type: 'module' });
    const finish = () => { worker.terminate(); window.clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = window.setTimeout(() => { finish(); reject(new Error('CAD conversion exceeded two minutes. Simplify the source model.')); }, TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { finish(); reject(new Error(event.message || 'CAD engine failed.')); };
    worker.onmessage = (event: MessageEvent<CADResponse>) => {
      finish();
      if (event.data.success) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    try { worker.postMessage(request); }
    catch (error) { finish(); reject(error); }
  });
}
