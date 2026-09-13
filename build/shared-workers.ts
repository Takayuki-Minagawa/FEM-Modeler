import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Emit module workers into the application graph so pure dependencies aren't bundled twice. */
export function sharedWorkers(): Plugin {
  const entries: Record<string, string> = {
    stl: 'src/geometry/import/stl-import.worker.ts',
    results: 'src/results/result-import.worker.ts',
    cad: 'src/cad/cad.worker.ts',
  };
  const prefix = 'virtual:fem-worker-url/';
  let root = '', base = '/', build = false;
  return {
    name: 'fem-shared-module-workers',
    configResolved(config) { root = config.root; base = config.base; build = config.command === 'build'; },
    resolveId(id) {
      if (id.startsWith(prefix) && entries[id.slice(prefix.length)]) return `\0${id}`;
    },
    load(id) {
      if (!id.startsWith(`\0${prefix}`)) return;
      const name = id.slice(prefix.length + 1);
      if (!build) return `export default ${JSON.stringify(`${base}${entries[name]}`)};`;
      const reference = this.emitFile({ type: 'chunk', id: resolve(root, entries[name]), name: `${name}-worker` });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    },
  };
}
