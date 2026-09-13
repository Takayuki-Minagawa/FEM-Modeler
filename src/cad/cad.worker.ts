import { loadCADKernel } from './runtime';
import { readCAD, writeCAD } from './kernel';
import type { CADRequest, CADResponse } from './types';

self.onmessage = async (event: MessageEvent<CADRequest>) => {
  try {
    const oc = await loadCADKernel();
    const request = event.data;
    const result = request.operation === 'import' ? readCAD(oc, request.data, request.format) : writeCAD(oc, request.bodies, request.format);
    const transfer = result instanceof Uint8Array ? result.buffer : result.preview;
    self.postMessage({ success: true, result } satisfies CADResponse, { transfer: [transfer] });
  } catch (error) {
    self.postMessage({ success: false, error: error instanceof Error ? error.message : `CAD translation failed (${String(error)}). Check the source geometry.` } satisfies CADResponse);
  }
};
