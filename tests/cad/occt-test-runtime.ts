import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import type { OCCT } from '@/cad/occt-types';

export function loadTestKernel(): Promise<OCCT> {
  const folder = new URL('../../node_modules/opencascade.js/dist/', import.meta.url).pathname;
  const module = { exports: null as unknown as (options: object) => Promise<OCCT> };
  // Execute the original pinned Emscripten module using its Node path. The browser
  // imports the unchanged ES module; only this Node harness adapts the export.
  vm.runInNewContext(readFileSync(`${folder}opencascade.wasm.js`, 'utf8').replace('export default opencascade;', 'module.exports = opencascade;'), {
    module, require: createRequire(import.meta.url), __dirname: folder, __filename: `${folder}opencascade.wasm.js`,
    process, console, Buffer, TextDecoder, WebAssembly, setTimeout, clearTimeout,
  });
  return module.exports({ wasmBinary: readFileSync(`${folder}opencascade.wasm.wasm`), print() {}, printErr() {} });
}
