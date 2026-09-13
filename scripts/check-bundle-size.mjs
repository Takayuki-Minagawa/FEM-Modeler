import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const maximumChunkBytes = Number(process.env.MAX_JS_CHUNK_BYTES ?? 1_000_000);
const maximumTotalBytes = Number(process.env.MAX_TOTAL_JS_BYTES ?? 1_900_000);
const allFiles = await readdir(assetsDirectory, { recursive: true });
const cadPrefix = 'cad-occt-1.1.1/';
const files = allFiles.filter((file) => file.endsWith('.js') && !file.startsWith(cadPrefix));
if (files.length === 0) throw new Error('No built JavaScript chunks were found. Run npm run build first.');

const sizes = await Promise.all(files.map(async (file) => ({
  file,
  bytes: (await stat(join(assetsDirectory.pathname, file))).size,
})));
const oversized = sizes.filter(({ bytes }) => bytes > maximumChunkBytes);
const total = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
if (oversized.length > 0 || total > maximumTotalBytes) {
  const details = oversized.map(({ file, bytes }) => `${file}: ${bytes} bytes`).join(', ');
  throw new Error(`Bundle budget exceeded. Total ${total}/${maximumTotalBytes} bytes.${details ? ` Oversized: ${details}` : ''}`);
}
console.log(`Bundle budget OK: ${files.length} chunks, ${total}/${maximumTotalBytes} total bytes.`);
// Exact BRep conversion is optional and fetched on the first CAD operation.
// Account for its separately distributed runtime explicitly, including WASM.
for (const [file, limit] of [['opencascade.js', 350_000], ['opencascade.wasm', 66_000_000]]) {
  const bytes = (await stat(new URL(`${cadPrefix}${file}`, assetsDirectory))).size;
  if (bytes > limit) throw new Error(`Optional CAD budget exceeded: ${file}: ${bytes}/${limit} bytes.`);
  console.log(`Optional CAD runtime: ${file}: ${bytes}/${limit} bytes.`);
}
const unexpected = allFiles.filter((file) => file.endsWith('.wasm') && file !== `${cadPrefix}opencascade.wasm`);
if (unexpected.length) throw new Error(`Unbudgeted WASM assets: ${unexpected.join(', ')}`);
