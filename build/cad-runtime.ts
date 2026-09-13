import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// This optional CAD runtime is fetched only inside a user-requested CAD Worker.
// It is served locally with a pinned npm checksum; no user geometry leaves the browser.
export const CAD_RUNTIME_DIRECTORY = 'assets/cad-occt-1.1.1';
const files: Record<string, string> = {
  'opencascade.js': 'dist/opencascade.wasm.js',
  'opencascade.wasm': 'dist/opencascade.wasm.wasm',
  'LICENSE.txt': 'LICENSE',
};
export function cadRuntime(): Plugin {
  let root = '', base = '/';
  return {
    name: 'fem-cad-runtime',
    configResolved(config) { root = config.root; base = config.base; },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const prefix = `${base}${CAD_RUNTIME_DIRECTORY}/`;
        if (!request.url?.startsWith(prefix)) return next();
        const name = request.url.slice(prefix.length).split('?')[0];
        if (!files[name]) return next();
        try {
          const contents = await readFile(resolve(root, 'node_modules/opencascade.js', files[name]));
          response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.js') ? 'text/javascript' : 'text/plain');
          response.end(contents);
        } catch (error) { next(error); }
      });
    },
    async generateBundle() {
      for (const [name, path] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `${CAD_RUNTIME_DIRECTORY}/${name}`, source: await readFile(resolve(root, 'node_modules/opencascade.js', path)) });
      }
    },
  };
}
