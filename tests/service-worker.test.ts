import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const scope = 'https://example.test/FEM-Modeler/';
const script = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function worker() {
  const listeners = new Map<string, (event: object) => void>();
  const entries = new Map<string, Response>();
  const urlOf = (request: Request | string) => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const cache = {
    put: vi.fn(async (request: Request | string, response: Response) => { entries.set(urlOf(request), response); }),
    match: vi.fn(async (request: Request | string) => entries.get(urlOf(request))?.clone()),
    keys: vi.fn(async () => [...entries.keys()].map((url) => new Request(url))),
    delete: vi.fn(async (request: Request | string) => entries.delete(urlOf(request))),
    addAll: vi.fn(async () => {}),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ['fem-modeler-shell-v3', 'fem-modeler-shell-v4', 'other-app-cache']),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn(async () => new Response('network data'));
  const self = {
    registration: { scope }, location: { origin: new URL(scope).origin },
    addEventListener: (name: string, handler: (event: object) => void) => { listeners.set(name, handler); },
    skipWaiting: vi.fn(async () => {}), clients: { claim: vi.fn(async () => {}) },
  };
  vm.runInNewContext(script, { self, caches, fetch, URL, Response });
  function request(path: string, navigate = false) {
    // Navigation mode is browser-owned and cannot be passed to Node's Request constructor.
    const input = { url: new URL(path, scope).href, method: 'GET', mode: navigate ? 'navigate' : 'cors' } as Request;
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request: input, respondWith: (pending: Promise<Response>) => { response = pending; } });
    if (!response) throw new Error('Request was not intercepted');
    return response;
  }
  async function activate() {
    let pending: Promise<void> | undefined;
    listeners.get('activate')!({ waitUntil: (value: Promise<void>) => { pending = value; } });
    await pending;
  }
  return { request, activate, entries, cache, caches, fetch, self };
}

describe('deployed service worker', () => {
  it('delivers fetched CAD WASM bytes when cache quota is exhausted', async () => {
    const sw = worker();
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    sw.fetch.mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }));
    sw.cache.put.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));
    const response = await sw.request('assets/cad-occt-1.1.1/opencascade.wasm');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/wasm');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(sw.cache.put).toHaveBeenCalledOnce();
    expect(sw.cache.delete).not.toHaveBeenCalled();
  });

  it('keeps the fresh navigation response when a cache write fails', async () => {
    const sw = worker(); sw.entries.set(scope, new Response('old cached shell'));
    sw.fetch.mockResolvedValue(new Response('fresh shell'));
    sw.cache.put.mockRejectedValue(new DOMException('Quota exceeded', 'QuotaExceededError'));
    expect(await (await sw.request('./', true)).text()).toBe('fresh shell');
  });

  it.each(['open', 'match', 'prune'] as const)('does not turn cache %s failures into network failures', async (failure) => {
    const sw = worker();
    if (failure === 'open') sw.caches.open.mockRejectedValue(new Error('Storage unavailable'));
    if (failure === 'match') sw.cache.match.mockRejectedValue(new Error('Storage unavailable'));
    if (failure === 'prune') sw.cache.keys.mockRejectedValue(new Error('Storage unavailable'));
    expect(await (await sw.request('assets/app.js')).text()).toBe('network data');
  });

  it('retains the protected shell and serves it when navigation is offline', async () => {
    const sw = worker();
    for (const path of ['./', './manifest.webmanifest', './favicon.svg']) sw.entries.set(new URL(path, scope).href, new Response(`cached ${path}`));
    for (let index = 0; index < 80; index++) sw.entries.set(`${scope}assets/old-${index}.js`, new Response('old'));
    await sw.request('assets/new.js');
    expect(sw.entries.size).toBe(80);
    expect(sw.entries.has(scope)).toBe(true);
    expect(sw.entries.has(`${scope}manifest.webmanifest`)).toBe(true);
    expect(sw.entries.has(`${scope}favicon.svg`)).toBe(true);
    sw.fetch.mockRejectedValue(new TypeError('Offline'));
    expect(await (await sw.request('unknown-route', true)).text()).toBe('cached ./');
  });

  it('serves cached build modules offline despite the precache Origin variation', async () => {
    const sw = worker(); sw.entries.set(`${scope}assets/app-123.js`, new Response('cached module'));
    sw.fetch.mockRejectedValue(new TypeError('Offline'));
    expect(await (await sw.request('assets/app-123.js')).text()).toBe('cached module');
    expect(sw.cache.match).toHaveBeenCalledWith(expect.objectContaining({ url: `${scope}assets/app-123.js` }), { ignoreVary: true });
    expect(sw.fetch).not.toHaveBeenCalled();
  });

  it('reports an uncached offline navigation and preserves network errors for uncached assets', async () => {
    const sw = worker(); sw.fetch.mockRejectedValue(new TypeError('Offline'));
    expect((await sw.request('./', true)).status).toBe(503);
    await expect(sw.request('assets/missing.js')).rejects.toThrow('Offline');
  });

  it('uses cache v4 and retires only older FEM Modeler caches on activation', async () => {
    const sw = worker(); await sw.request('assets/app.js'); await sw.activate();
    expect(sw.caches.open).toHaveBeenCalledWith('fem-modeler-shell-v4');
    expect(sw.caches.delete).toHaveBeenCalledExactlyOnceWith('fem-modeler-shell-v3');
    expect(sw.self.clients.claim).toHaveBeenCalledOnce();
  });
});
