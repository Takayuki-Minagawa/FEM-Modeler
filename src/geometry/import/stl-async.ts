import stlWorkerUrl from 'virtual:fem-worker-url/stl';
import { BufferAttribute, BufferGeometry, Box3, Vector3 } from 'three';
import { importSTL, type STLImportResult, type STLSourceUnit } from './stl-loader';
import type { STLWorkerResponse } from './stl-worker-protocol';

export const STL_WORKER_THRESHOLD_BYTES = 1024 * 1024;

/** Keep expensive validation, content hashing and encoding off the UI thread. */
export async function importSTLAsync(buffer: ArrayBuffer, fileName: string, scaleToMeters = 1, sourceUnit: STLSourceUnit = 'm', signal?: AbortSignal): Promise<STLImportResult> {
  if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError');
  if (buffer.byteLength < STL_WORKER_THRESHOLD_BYTES || typeof Worker === 'undefined') return importSTL(buffer, fileName, scaleToMeters, sourceUnit);
  return new Promise((resolve, reject) => {
    const worker = new Worker(stlWorkerUrl, { type: 'module' });
    const finish = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Import cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => { finish(); reject(new Error(event.message || 'STL worker failed.')); };
    worker.onmessage = (event: MessageEvent<STLWorkerResponse>) => {
      finish();
      const { positions, normals, ...result } = event.data;
      let geometry: BufferGeometry | undefined;
      if (result.success && positions) {
        geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(positions, 3));
        if (normals) geometry.setAttribute('normal', new BufferAttribute(normals, 3));
        if (result.asset) geometry.boundingBox = new Box3(new Vector3(...result.asset.bounds.min), new Vector3(...result.asset.bounds.max));
      }
      resolve({ ...result, geometry });
    };
    worker.postMessage({ buffer, fileName, scaleToMeters, sourceUnit }, [buffer]);
  });
}
