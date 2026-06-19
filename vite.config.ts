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
      // Custom SW (injectManifest) so it can add COOP/COEP headers → enables
      // SharedArrayBuffer → multi-threaded WASM (much faster Tesseract/ORT on
      // GitHub Pages, which can't set those headers server-side).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: [
          '**/ort/**',
          '**/dict/**',
          '**/sqljs/**',
          '**/tesseract/**',
          '**/dict-db/**',
        ],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
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
