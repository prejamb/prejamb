/* ============================================================================
 * PreJamb service worker
 * ----------------------------------------------------------------------------
 * Provides installability + full offline launch:
 *   - Pre-caches the public app-shell routes and icons.
 *   - Caches hashed Next.js assets (`/_next/static/*`) cache-first.
 *   - Caches navigation (HTML) network-first, falling back to cache offline.
 *   - Caches icons / fonts / images stale-while-revalidate.
 *   - Never touches `/api/*` or cross-origin (Supabase) requests.
 *
 * Bump VERSION to invalidate previously cached shells and assets.
 * ========================================================================== */

const VERSION = "v3";
const SHELL_CACHE = `prejamb-shell-${VERSION}`;
const STATIC_CACHE = `prejamb-static-${VERSION}`;
const RUNTIME_CACHE = `prejamb-runtime-${VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/login",
  "/exam/session",
  "/manifest.json",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

/* ------------------------------- lifecycle ------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    precache(PRECACHE_URLS).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith("prejamb-") &&
                !key.endsWith(`-${VERSION}`),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/* -------------------------------- helpers -------------------------------- */

async function precache(urls) {
  const shell = await caches.open(SHELL_CACHE);
  const statics = await caches.open(STATIC_CACHE);
  const assets = new Set();

  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(url);

        // Skip failed/redirected responses (e.g. `/login` while signed in —
        // the Cache API rejects redirected responses).
        if (!response || !response.ok || response.redirected) {
          return;
        }

        const contentType = response.headers.get("content-type") || "";

        // Collect the hashed build assets this shell needs, so the app can
        // launch offline immediately after install without a prior visit.
        if (contentType.includes("text/html")) {
          const html = await response.clone().text();

          for (const match of html.matchAll(
            /(?:src|href)="(\/_next\/static\/[^"]+)"/g,
          )) {
            assets.add(match[1]);
          }
        }

        await shell.put(url, response);
      } catch {
        // Individual failures are non-fatal: runtime caching fills the gap.
      }
    }),
  );

  await Promise.all(
    [...assets].map(async (url) => {
      try {
        // Scope to the current cache only: `caches.match` would also see the
        // outgoing version's cache, which is deleted on activate.
        const cached = await statics.match(url);

        if (cached) {
          return;
        }

        const response = await fetch(url);

        if (response && response.ok) {
          await statics.put(url, response);
        }
      } catch {
        // The asset will be picked up by the cache-first handler on next load.
      }
    }),
  );
}

function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) {
      return cached;
    }

    return fetch(request).then((response) => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
      }

      return response;
    });
  });
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);

    // A 5xx (or a proxy error page) means the origin is unreachable — prefer a
    // cached shell over showing the error. Other statuses pass through.
    if (response && response.status < 500) {
      if (response.ok) {
        // Store in the shell cache so a refreshed navigation replaces the
        // precached copy instead of leaving two competing versions.
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      }

      return response;
    }
  } catch {
    // Genuinely offline — fall through to the cache.
  }

  // `ignoreSearch` lets `/exam/session?subject=ENG` reuse the cached
  // `/exam/session` shell; the subject is re-read from the URL on the client.
  const cached = await caches.match(request, { ignoreSearch: true });

  if (cached) {
    return cached;
  }

  return (await caches.match("/")) || Response.error();
}

function staleWhileRevalidate(request) {
  return caches.match(request).then((cached) => {
    const network = fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches
            .open(RUNTIME_CACHE)
            .then((cache) => cache.put(request, copy));
        }

        return response;
      })
      .catch(() => cached);

    return cached || network;
  });
}

/* --------------------------------- fetch --------------------------------- */

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Never intercept cross-origin (Supabase) or API traffic.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // 1. Hashed, immutable Next.js build output → cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 2. Full-page navigations → network-first with offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  // 3. Manifest, icons, images and fonts → stale-while-revalidate.
  if (
    request.destination === "manifest" ||
    request.destination === "image" ||
    request.destination === "font" ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 4. RSC payloads and everything else → leave to the network (Next.js falls
  //    back to a full navigation, which the SW serves from cache, when offline).
});
