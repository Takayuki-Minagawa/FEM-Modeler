const CACHE_PREFIX = 'fem-modeler-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const SHELL_URLS = ['./', './manifest.webmanifest', './favicon.svg'];
const MAX_CACHE_ENTRIES = 80;

async function putBounded(cache, request, response) {
  await cache.put(request, response);
  const requests = await cache.keys();
  const protectedUrls = new Set(SHELL_URLS.map((url) => new URL(url, self.registration.scope).href));
  const removable = requests.filter((candidate) => !protectedUrls.has(candidate.url));
  while (requests.length > MAX_CACHE_ENTRIES && removable.length > 0) {
    const oldest = removable.shift();
    if (oldest) await cache.delete(oldest);
    requests.shift();
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_URLS);
    const response = await fetch('./');
    if (response.ok) {
      const html = await response.text();
      const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
        .map((match) => new URL(match[1], self.registration.scope))
        .filter((url) => url.origin === self.location.origin && url.href.startsWith(self.registration.scope))
        .map((url) => url.href);
      await cache.addAll([...new Set(urls)]);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || !requestUrl.href.startsWith(self.registration.scope)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request);
        if (response.ok) await putBounded(cache, event.request, response.clone());
        return response;
      } catch {
        return (await cache.match(event.request))
          ?? (await cache.match('./'))
          ?? new Response('FEM Modeler is unavailable offline before its app shell is cached.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await putBounded(cache, event.request, response.clone());
    return response;
  })());
});
