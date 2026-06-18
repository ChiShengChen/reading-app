/**
 * Model weight manager: lazy download with progress, cached in Cache Storage so
 * weights survive offline and across sessions. Models are downloaded per-need
 * (e.g. detection model on first OCR), never bundled or SW-precached.
 */

const MODEL_CACHE = 'reading-app-models-v1'

export interface ModelSpec {
  id: string
  /** Remote weight URL (CDN / Hugging Face). Configurable at runtime. */
  url: string
  /** Approximate download size for UX, in bytes. */
  approxBytes: number
  label: string
}

/**
 * Default PaddleOCR text-DETECTION model (DBNet), exported to ONNX.
 *
 * Source: RapidOCR's ONNX model zoo (PP-OCRv4 detection, ~4.7 MB). The det
 * model is small; the heavy weights come later from manga-ocr (Phase 2).
 *
 * NOTE: This URL is overridable via setDetModelUrl(). If it 404s or CORS-fails,
 * the pipeline degrades to full-page Tesseract (see pipeline.ts) instead of
 * crashing, and the UI surfaces the reason.
 */
export const DEFAULT_DET_MODEL_URL =
  'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer/ch_PP-OCRv4_det_infer.onnx'

let detModelUrl = DEFAULT_DET_MODEL_URL

export function setDetModelUrl(url: string) {
  detModelUrl = url
}

export function getDetModelSpec(): ModelSpec {
  return {
    id: 'paddle-det-v4',
    url: detModelUrl,
    approxBytes: 4.7 * 1024 * 1024,
    label: 'PaddleOCR 偵測模型 (PP-OCRv4 det)',
  }
}

export interface DownloadProgress {
  receivedBytes: number
  totalBytes?: number
  ratio?: number
}

async function cacheOpen(): Promise<Cache | null> {
  if (!('caches' in self)) return null
  try {
    return await caches.open(MODEL_CACHE)
  } catch {
    return null
  }
}

/**
 * Fetch a model with progress, returning its bytes. Served from Cache Storage
 * when present (offline-capable); otherwise downloaded and stored.
 */
export async function fetchModel(
  spec: ModelSpec,
  onProgress?: (p: DownloadProgress) => void,
): Promise<Uint8Array> {
  const cache = await cacheOpen()
  if (cache) {
    const hit = await cache.match(spec.url)
    if (hit) {
      const buf = await hit.arrayBuffer()
      onProgress?.({ receivedBytes: buf.byteLength, totalBytes: buf.byteLength, ratio: 1 })
      return new Uint8Array(buf)
    }
  }

  const res = await fetch(spec.url)
  if (!res.ok) throw new Error(`下載模型失敗 (${res.status}): ${spec.url}`)

  const totalHeader = res.headers.get('content-length')
  const totalBytes = totalHeader ? Number(totalHeader) : spec.approxBytes

  // Stream to report progress; tee one copy into the cache.
  if (res.body && onProgress) {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.byteLength
        onProgress({
          receivedBytes: received,
          totalBytes,
          ratio: totalBytes ? Math.min(1, received / totalBytes) : undefined,
        })
      }
    }
    const merged = new Uint8Array(received)
    let offset = 0
    for (const c of chunks) {
      merged.set(c, offset)
      offset += c.byteLength
    }
    if (cache) {
      await cache.put(spec.url, new Response(merged, { headers: res.headers }))
    }
    return merged
  }

  const buf = await res.arrayBuffer()
  if (cache) await cache.put(spec.url, new Response(buf))
  onProgress?.({ receivedBytes: buf.byteLength, totalBytes, ratio: 1 })
  return new Uint8Array(buf)
}

export async function isModelCached(spec: ModelSpec): Promise<boolean> {
  const cache = await cacheOpen()
  if (!cache) return false
  return (await cache.match(spec.url)) !== undefined
}

export async function deleteModel(spec: ModelSpec): Promise<void> {
  const cache = await cacheOpen()
  if (cache) await cache.delete(spec.url)
}
