/**
 * Central model registry — one place to see and manage every downloadable
 * model/data file across the app (detection, recognizers, translation, dict).
 * Powers the Settings page's per-language download UX (status / size / progress
 * / delete / WiFi warning).
 *
 * Each engine caches in its own store; this layer just unifies the
 * isCached / download / remove surface.
 */
import type { ComputeBackend } from '../capabilities'
import { getDetModelSpec, isModelCached, fetchModel, deleteModel } from '../ocr/modelManager'
import { loadMangaOcr, isMangaOcrCached, getMangaOcrModelId } from '../ocr/recognizers'
import { loadOpusModel, getOpusChain } from '../translate'
import { isDictCached, downloadDict, deleteDict } from '../dict/jmdict'
import { isEcdictCached, downloadEcdict, deleteEcdict } from '../dict/ecdict'
import type { OcrLanguage } from '../ocr/recognizers/types'

export type ModelScope = '通用' | '英文' | '日文'

export interface ModelEntry {
  id: string
  label: string
  scope: ModelScope
  approxBytes: number
  /** Large enough to warrant a WiFi prompt on metered connections. */
  large: boolean
  isCached(): Promise<boolean>
  download(
    backend: ComputeBackend,
    onProgress: (ratio: number | undefined, msg: string) => void,
  ): Promise<void>
  remove(): Promise<void>
}

const MB = 1024 * 1024

// ---- Transformers.js cache helpers (shared store) -------------------------

const TRANSFORMERS_CACHE = 'transformers-cache'

async function transformersCached(modelId: string): Promise<boolean> {
  if (!('caches' in self)) return false
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE)
    const keys = await cache.keys()
    return keys.some((r) => r.url.includes(modelId) && r.url.endsWith('.onnx'))
  } catch {
    return false
  }
}

async function transformersDelete(modelId: string): Promise<void> {
  if (!('caches' in self)) return
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE)
    const keys = await cache.keys()
    await Promise.all(keys.filter((r) => r.url.includes(modelId)).map((r) => cache.delete(r)))
  } catch {
    /* ignore */
  }
}

// Opus-MT chains may have >1 hop (ja pivots ja->en->zh); a chain is "cached"
// only when every hop is cached, and download/remove cover all hops.
async function opusChainCached(lang: OcrLanguage): Promise<boolean> {
  for (const id of getOpusChain(lang)) {
    if (!(await transformersCached(id))) return false
  }
  return true
}
async function opusChainDownload(
  lang: OcrLanguage,
  backend: ComputeBackend,
  onP: (ratio: number | undefined, msg: string) => void,
): Promise<void> {
  for (const id of getOpusChain(lang)) {
    await loadOpusModel(id, backend, (p) => onP(p.ratio, p.message ?? '下載翻譯模型…'))
  }
}
async function opusChainDelete(lang: OcrLanguage): Promise<void> {
  for (const id of getOpusChain(lang)) await transformersDelete(id)
}

// ---- Registry -------------------------------------------------------------

export const MODEL_ENTRIES: ModelEntry[] = [
  {
    id: 'paddle-det',
    label: '文字偵測（PaddleOCR）',
    scope: '通用',
    approxBytes: 4.7 * MB,
    large: false,
    isCached: () => isModelCached(getDetModelSpec()),
    download: (_b, onP) =>
      fetchModel(getDetModelSpec(), (p) => onP(p.ratio, '下載偵測模型…')).then(() => undefined),
    remove: () => deleteModel(getDetModelSpec()),
  },
  {
    id: 'opus-en-zh',
    label: '翻譯 英→中（Opus-MT）',
    scope: '英文',
    approxBytes: 80 * MB,
    large: true,
    isCached: () => opusChainCached('en'),
    download: (backend, onP) => opusChainDownload('en', backend, onP),
    remove: () => opusChainDelete('en'),
  },
  {
    id: 'ecdict',
    label: '英文字典（ECDICT 英→中 / sql.js）',
    scope: '英文',
    approxBytes: 60 * MB,
    large: true,
    isCached: () => isEcdictCached(),
    download: (_b, onP) => downloadEcdict((ratio, msg) => onP(ratio, msg)),
    remove: () => deleteEcdict(),
  },
  {
    id: 'manga-ocr',
    label: '日文辨識（manga-ocr）',
    scope: '日文',
    approxBytes: 440 * MB,
    large: true,
    isCached: () => isMangaOcrCached(),
    download: (backend, onP) =>
      loadMangaOcr(backend, (p) => onP(p.ratio, p.message ?? '下載日文模型…')).then(() => undefined),
    remove: () => transformersDelete(getMangaOcrModelId()),
  },
  {
    id: 'opus-ja-zh',
    label: '翻譯 日→中（Opus-MT，經英文轉譯）',
    scope: '日文',
    approxBytes: 160 * MB, // pivot ja->en->zh = two models
    large: true,
    isCached: () => opusChainCached('ja'),
    download: (backend, onP) => opusChainDownload('ja', backend, onP),
    remove: () => opusChainDelete('ja'),
  },
  {
    id: 'jmdict',
    label: '日文字典（JMdict / sql.js）',
    scope: '日文',
    approxBytes: 50 * MB,
    large: true,
    isCached: () => isDictCached(),
    download: (_b, onP) => downloadDict((ratio, msg) => onP(ratio, msg)),
    remove: () => deleteDict(),
  },
]
