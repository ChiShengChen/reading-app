/**
 * Device capability detection. The whole pipeline branches on two layers:
 *   1. WebGPU available  -> full pipeline on the WebGPU execution provider.
 *   2. No WebGPU         -> fall back to the WASM execution provider.
 * Chrome built-in AI (Translator API) is only ever an additive desktop bonus.
 */

export type ComputeBackend = 'webgpu' | 'wasm'

export interface Capabilities {
  /** Preferred ONNX Runtime / Transformers.js execution provider. */
  backend: ComputeBackend
  hasWebGPU: boolean
  /** Chrome built-in Translator API (desktop quality upgrade, optional). */
  hasTranslatorAPI: boolean
  /** Persistent storage so large model caches survive eviction. */
  storagePersistSupported: boolean
  /** Network hints for download UX (WiFi vs metered). */
  connection: {
    effectiveType?: string
    saveData?: boolean
    /** True when it's reasonable to prompt a multi-hundred-MB download. */
    goodForLargeDownload: boolean
  }
}

async function detectWebGPU(): Promise<boolean> {
  if (!('gpu' in navigator) || !navigator.gpu) return false
  try {
    const adapter = await navigator.gpu.requestAdapter()
    return adapter !== null
  } catch {
    return false
  }
}

function detectConnection(): Capabilities['connection'] {
  // navigator.connection is non-standard but present on Chrome/Android.
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } })
    .connection
  const effectiveType = c?.effectiveType
  const saveData = c?.saveData
  // Treat unknown as "good" (e.g. desktop wired) but never override saveData.
  const goodForLargeDownload =
    !saveData && (effectiveType === undefined || effectiveType === '4g')
  return { effectiveType, saveData, goodForLargeDownload }
}

let cached: Capabilities | null = null

export async function detectCapabilities(force = false): Promise<Capabilities> {
  if (cached && !force) return cached
  const hasWebGPU = await detectWebGPU()
  cached = {
    backend: hasWebGPU ? 'webgpu' : 'wasm',
    hasWebGPU,
    hasTranslatorAPI: 'Translator' in self,
    storagePersistSupported:
      typeof navigator.storage?.persist === 'function',
    connection: detectConnection(),
  }
  return cached
}
