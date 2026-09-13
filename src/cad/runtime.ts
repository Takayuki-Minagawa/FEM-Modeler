import type { OCCT } from './occt-types';

export async function loadCADKernel(): Promise<OCCT> {
  const base = `${import.meta.env.BASE_URL}assets/cad-occt-1.1.1/`;
  const [{ default: initialize }, response] = await Promise.all([
    import(/* @vite-ignore */ `${base}opencascade.js`),
    fetch(`${base}opencascade.wasm`),
  ]);
  if (!response.ok) throw new Error('CAD engine could not be downloaded. Connect once before using CAD conversion offline.');
  return initialize({ wasmBinary: new Uint8Array(await response.arrayBuffer()), print() {}, printErr() {} }) as Promise<OCCT>;
}
