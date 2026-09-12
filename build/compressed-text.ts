import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Keep lockfiles byte-for-byte reproducible without shipping repeated registry metadata as JavaScript text. */
export function compressedText(): Plugin {
  const query = '?compressed';
  return {
    name: 'fem-compressed-text', enforce: 'pre',
    async load(id) {
      if (!id.endsWith(query)) return;
      const path = id.slice(0, -query.length);
      this.addWatchFile(path);
      const encoded = deflateRawSync(await readFile(path)).toString('base64');
      return `import { inflateSync, strFromU8 } from 'fflate';
export default strFromU8(inflateSync(Uint8Array.from(atob(${JSON.stringify(encoded)}), c => c.charCodeAt(0))));`;
    },
  };
}
