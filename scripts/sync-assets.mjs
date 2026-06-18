// Copy runtime assets from node_modules into public/ so they are served
// locally (offline-capable) instead of from a CDN. Runs before dev/build.
//
//   public/ort/   - onnxruntime-web wasm/jsep (detection + manga-ocr fallback)
//   public/dict/  - kuromoji tokenizer dictionary (*.dat.gz)
//   public/sqljs/ - sql.js wasm (JMdict dictionary engine)
import { mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'node_modules')

function copyList(srcDir, destDir, files) {
  mkdirSync(destDir, { recursive: true })
  let copied = 0
  for (const f of files) {
    const from = join(srcDir, f)
    if (!existsSync(from)) {
      console.warn(`[sync-assets] missing ${f} — skipped`)
      continue
    }
    copyFileSync(from, join(destDir, f))
    copied++
  }
  return copied
}

// 1) onnxruntime-web
const ort = copyList(
  join(nm, 'onnxruntime-web', 'dist'),
  join(root, 'public', 'ort'),
  [
    'ort-wasm-simd-threaded.jsep.wasm',
    'ort-wasm-simd-threaded.jsep.mjs',
    'ort-wasm-simd-threaded.wasm',
    'ort-wasm-simd-threaded.mjs',
  ],
)
console.log(`[sync-assets] ort: ${ort} files`)

// 2) kuromoji dictionary (all *.dat.gz)
const kuromojiDict = join(nm, 'kuromoji', 'dict')
if (existsSync(kuromojiDict)) {
  const dats = readdirSync(kuromojiDict).filter((f) => f.endsWith('.dat.gz'))
  const n = copyList(kuromojiDict, join(root, 'public', 'dict'), dats)
  console.log(`[sync-assets] kuromoji dict: ${n} files`)
} else {
  console.warn('[sync-assets] kuromoji dict not found — JP tokenizer will fall back to Intl.Segmenter')
}

// 3) sql.js wasm
const sqljs = copyList(join(nm, 'sql.js', 'dist'), join(root, 'public', 'sqljs'), ['sql-wasm.wasm'])
console.log(`[sync-assets] sql.js: ${sqljs} files`)

// 4) tesseract.js worker + core (self-hosted; only eng.traineddata stays remote)
const tWorker = copyList(join(nm, 'tesseract.js', 'dist'), join(root, 'public', 'tesseract'), [
  'worker.min.js',
])
const coreDir = join(nm, 'tesseract.js-core')
let tCore = 0
if (existsSync(coreDir)) {
  const coreFiles = readdirSync(coreDir).filter((f) => /\.(wasm|js)$/.test(f) && f !== 'index.js')
  tCore = copyList(coreDir, join(root, 'public', 'tesseract', 'core'), coreFiles)
}
console.log(`[sync-assets] tesseract: ${tWorker} worker + ${tCore} core files`)
