// OTG Lone Worker Safety System — Canonical Service Worker
// Cache name is updated by reading the version field from config.json at install time.
// This replaces the old build-stamp approach; cache invalidation is now driven by
// incrementing "version" in config.json rather than by regenerating files.

let CACHE_NAME = 'otg-safety-v1'; // updated dynamically at install time (see below)

const CRITICAL_ASSETS = [
    './',
    './index.html',
    './config.json',            // ← Config Model: cache the org config
    './manifest.json',
    './icon.png',
    'https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js',
    'https://cdn.tailwindcss.com'
];

// ─── 1. INSTALL ──────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        (async () => {
            // Try to read config.json to get the version for the cache name.
            // On a fresh install we must be online, so this should succeed.
            try {
                const cfgResp = await fetch('./config.json', { cache: 'no-cache' });
                if (cfgResp.ok) {
                    const cfg = await cfgResp.json();
                    if (cfg.version) {
                        // Normalise: "1.2.3" → "1-2-3"
                        const slug = String(cfg.version).replace(/[^a-z0-9]/gi, '-');
                        CACHE_NAME = `otg-safety-${slug}`;
                    }
                }
            } catch (e) {
                // Version unknown — fall back to default name (cache still works)
                console.warn('[SW] Could not read config.json version at install:', e.message);
            }

            const cache = await caches.open(CACHE_NAME);
            console.log('[SW] Pre-caching critical assets for', CACHE_NAME);

            for (const url of CRITICAL_ASSETS) {
                try {
                    const response = await fetch(url, {
                        mode: url.startsWith('http') ? 'no-cors' : 'cors',
                        redirect: 'follow'
                    });
                    await cache.put(url, response);
                } catch (err) {
                    // Non-fatal: asset unavailable at install time (e.g. offline reinstall).
                    console.warn('[SW] Could not pre-cache:', url);
                }
            }

            await self.skipWaiting();
        })()
    );
});

// ─── 2. ACTIVATE ─────────────────────────────────────────────────────────────
// Delete all old caches whose names differ from the current one.
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME)
                    .map(k => {
                        console.log('[SW] Removing old cache:', k);
                        return caches.delete(k);
                    })
            )
        ).then(() => self.clients.claim())
    );
});

// ─── 3. FETCH ────────────────────────────────────────────────────────────────
// Cache-first strategy. config.json uses network-first so version updates
// propagate immediately when the worker app is online.
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);
    const isConfig = url.pathname.endsWith('/config.json');

    event.respondWith(
        isConfig
            ? networkFirstConfig(event.request)
            : cacheFirst(event.request)
    );
});

async function networkFirstConfig(request) {
    try {
        const networkResp = await fetch(request);
        if (networkResp.ok || networkResp.status === 0) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResp.clone());
        }
        return networkResp;
    } catch (_) {
        // Offline — serve cached copy
        const cached = await caches.match(request);
        return cached || new Response('{"error":"config unavailable offline"}', {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;

    try {
        const networkResp = await fetch(request);
        if (networkResp && (networkResp.status === 200 || networkResp.status === 0)) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResp.clone());
        }
        return networkResp;
    } catch (_) {
        return caches.match('./') || new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

// ─── 4. MESSAGES ─────────────────────────────────────────────────────────────
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        event.waitUntil(self.skipWaiting());
    }
});
