import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const maximumChunkBytes = Number(process.env.MAX_JS_CHUNK_BYTES ?? 1_000_000);
const maximumTotalBytes = Number(process.env.MAX_TOTAL_JS_BYTES ?? 1_900_000);
const files = (await readdir(assetsDirectory)).filter((file) => file.endsWith('.js'));
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
