import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed under a GitHub Pages project subpath (https://<user>.github.io/<repo>/).
// Override with VITE_BASE=/ for root-domain hosting (Netlify/Vercel/custom domain).
const BASE = process.env.VITE_BASE ?? '/reading-app/'

// https://vite.dev/config/
export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Models are large and downloaded on demand into Cache Storage / IndexedDB
      // by our own model manager, NOT precached by the service worker.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Self-hosted runtime assets (incl. tesseract's large base64 *.wasm.js)
        // are runtime-cached on demand, not precached at install time.
        globIgnores: [
          '**/ort/**',
          '**/dict/**',
          '**/sqljs/**',
          '**/tesseract/**',
          '**/dict-db/**',
        ],
        // Big model/runtime files are runtime-cached (below), not precached.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/(ort|dict|sqljs|tesseract|dict-db|models)\//],
        runtimeCaching: [
          {
            // Self-hosted runtime assets: ORT wasm, kuromoji dict, sql.js wasm,
            // tesseract worker/core, JMdict sqlite — cache once, serve offline.
            urlPattern: /\/(ort|dict|sqljs|tesseract|dict-db)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-runtime-assets',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Bundled wasm emitted into /assets (e.g. transformers.js ORT).
            urlPattern: /\/assets\/.*\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-wasm',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Remote model weights / language data (Hugging Face, tessdata, CDN).
            urlPattern:
              /^https:\/\/(huggingface\.co|cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'remote-models',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
      manifest: {
        name: '書影閱讀器',
        short_name: '書影',
        description: '本地 OCR + 翻譯的日英書籍拍照閱讀器',
        lang: 'zh-Hant',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        id: BASE,
        start_url: BASE,
        scope: BASE,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      devOptions: {
        // Keep SW off in dev to avoid caching headaches while iterating.
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      // kuromoji's DictionaryLoader uses Node's `path` (path.join) even in the
      // browser loader; polyfill it so kuromoji actually works in-browser
      // instead of silently failing to the Intl.Segmenter fallback.
      path: 'path-browserify',
    },
  },
  // onnxruntime-web (and Transformers.js, which bundles its own ORT) ship
  // prebuilt wasm/mjs that must not be pre-bundled by esbuild.
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@huggingface/transformers'],
  },
  worker: {
    format: 'es',
  },
})
