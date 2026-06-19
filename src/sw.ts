/// <reference lib="webworker" />
/**
 * Custom service worker (injectManifest). Two jobs:
 *  1) Offline: precache the app shell, runtime-cache the big model/runtime
 *     assets (CacheFirst) so the app works offline after first online use.
 *  2) Cross-origin isolation: stamp COOP/COEP (credentialless) on navigation +
 *     same-origin responses so `crossOriginIsolated` becomes true → enables
 *     SharedArrayBuffer → multi-threaded WASM. GitHub Pages can't set these
 *     headers, so the SW does it. Cross-origin model fetches (HF/CDN) are CORS
 *     and load fine under COEP credentialless.
 *
 * Safe by design: navigation is network-first with a precache fallback; if the
 * SW or COI ever misbehaves, the recognizers fall back to single-threaded
 * (numThreads gated on crossOriginIsolated).
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[]
}

const PRECACHE = 'app-shell-v5'
const RUNTIME = 'app-runtime-v2'
const ASSET_CACHE = 'app-runtime-assets'
const KEEP = new Set([
  PRECACHE,
  RUNTIME,
  ASSET_CACHE,
  'app-wasm',
  'remote-models',
  'reading-app-models-v1',
  'reading-app-dict-v1',
  'reading-app-ecdict-v1',
  'transformers-cache',
])

const BASE = '/reading-app/'
const ASSET_RE = /\/(ort|dict|sqljs|tesseract|dict-db)\//
const WASM_RE = /\/assets\/.*\.wasm$/
const PRECACHE_URLS = (self.__WB_MANIFEST || []).map((e) => e.url)

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE)
      await cache.addAll(PRECACHE_URLS)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (!KEEP.has(k)) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

/** Re-emit a response with COOP/COEP so the page is cross-origin isolated. */
function withCOI(resp: Response): Response {
  if (!resp || resp.status === 0 || resp.type === 'opaque' || resp.type === 'opaqueredirect') {
    return resp
  }
  const h = new Headers(resp.headers)
  h.set('Cross-Origin-Opener-Policy', 'same-origin')
  h.set('Cross-Origin-Embedder-Policy', 'credentialless')
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h })
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  const sameOrigin = url.origin === self.location.origin

  // Navigations: network-first (COI-stamped), fall back to the precached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return withCOI(await fetch(req))
        } catch {
          const cache = await caches.open(PRECACHE)
          const idx = (await cache.match(BASE + 'index.html')) || (await cache.match(BASE))
          return idx ? withCOI(idx) : Response.error()
        }
      })(),
    )
    return
  }

  // Cross-origin (HF / CDN model weights): let the browser handle it under the
  // page's COEP. We don't rewrite headers we don't own.
  if (!sameOrigin) return

  // Same-origin GET: cache-first, COI-stamped. Big model/runtime files go to the
  // long-lived asset cache; everything else to the rolling runtime cache.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req)
      if (cached) return withCOI(cached)
      try {
        const resp = await fetch(req)
        if (resp.ok && resp.type === 'basic') {
          const isAsset = ASSET_RE.test(url.pathname) || WASM_RE.test(url.pathname)
          const cache = await caches.open(isAsset ? ASSET_CACHE : RUNTIME)
          void cache.put(req, resp.clone())
        }
        return withCOI(resp)
      } catch {
        return Response.error()
      }
    })(),
  )
})
