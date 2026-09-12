import { afterEach, describe, expect, it, vi } from 'vitest';
import { importSTLAsync, STL_WORKER_THRESHOLD_BYTES } from '@/geometry/import/stl-async';

class FakeWorker {
  static instance: FakeWorker;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.instance = this; }
}
afterEach(() => vi.unstubAllGlobals());
describe('asynchronous STL import', () => {
  it('transfers large input to a worker and reconstructs its geometry', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const buffer = new ArrayBuffer(STL_WORKER_THRESHOLD_BYTES);
    const pending = importSTLAsync(buffer, 'large.stl');
    expect(FakeWorker.instance.postMessage).toHaveBeenCalledWith(expect.objectContaining({ buffer }), [buffer]);
    FakeWorker.instance.onmessage!({ data: { success: true, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array(9) } });
    const result = await pending;
    expect(result.geometry?.getAttribute('position').count).toBe(3);
    expect(FakeWorker.instance.terminate).toHaveBeenCalledOnce(); result.geometry?.dispose();
  });
  it('cancels active worker processing', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const pending = importSTLAsync(new ArrayBuffer(STL_WORKER_THRESHOLD_BYTES), 'large.stl', 1, 'm', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instance.terminate).toHaveBeenCalledOnce();
  });
  it('reports worker errors rather than silently blocking the UI with a large synchronous retry', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const pending = importSTLAsync(new ArrayBuffer(STL_WORKER_THRESHOLD_BYTES), 'large.stl');
    FakeWorker.instance.onerror!({ message: 'Worker load failed' });
    await expect(pending).rejects.toThrow('Worker load failed');
  });
  it('keeps small imports on the existing validated parser', async () => {
    const bytes = new TextEncoder().encode('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t');
    const result = await importSTLAsync(bytes.buffer, 'small.stl');
    expect(result.success).toBe(true); expect(result.triangleCount).toBe(1); result.geometry?.dispose();
  });
});
