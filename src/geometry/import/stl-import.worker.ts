import { importSTL } from './stl-loader';
import type { STLWorkerRequest, STLWorkerResponse } from './stl-worker-protocol';

self.onmessage = (event: MessageEvent<STLWorkerRequest>) => {
  const { buffer, fileName, scaleToMeters, sourceUnit } = event.data;
  const { geometry, ...result } = importSTL(buffer, fileName, scaleToMeters, sourceUnit);
  const positions = geometry?.getAttribute('position').array as Float32Array | undefined;
  const normals = geometry?.getAttribute('normal')?.array as Float32Array | undefined;
  const response: STLWorkerResponse = { ...result, positions, normals };
  const transfers: Transferable[] = [];
  if (positions) transfers.push(positions.buffer);
  if (normals) transfers.push(normals.buffer);
  self.postMessage(response, { transfer: transfers });
  geometry?.dispose();
};
