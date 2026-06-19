/**
 * English recognition via PaddleOCR PP-OCRv5 (CTC) on onnxruntime-web.
 *
 * Faster + usually more accurate than Tesseract on printed lines, and light
 * enough for phones (CTC, not autoregressive). Pairs with the PaddleOCR
 * detector. Reads one detected line crop at a time.
 *
 * Preprocess: RGB, resize to height 32 (keep aspect), normalize (x/255-0.5)/0.5,
 * NCHW. Decode: argmax per timestep → collapse repeats → drop blank(0) → map to
 * chars via dict.txt where index 0 = CTC blank, 1..N = dict lines, N+1 = space.
 */
import * as ort from 'onnxruntime-web/webgpu'
import type { ComputeBackend } from '../../capabilities'
import type { RecognitionOutput } from './types'

const BASE = import.meta.env.BASE_URL
ort.env.wasm.wasmPaths = `${BASE}ort/`
ort.env.wasm.numThreads = globalThis.crossOriginIsolated
  ? Math.min(4, navigator.hardwareConcurrency || 4)
  : 1
ort.env.wasm.proxy = false

const REC_BASE = 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/english'
const LS_REC = 'paddleRecUrl'
const LS_DICT = 'paddleRecDictUrl'

function lsGet(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}
function lsSet(key: string, v: string) {
  try {
    if (v.trim()) localStorage.setItem(key, v.trim())
    else localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function getPaddleRecUrl(): string {
  return lsGet(LS_REC, `${REC_BASE}/rec.onnx`)
}
export function setPaddleRecUrl(url: string) {
  lsSet(LS_REC, url)
  loaded = null
}
export function getPaddleDictUrl(): string {
  return lsGet(LS_DICT, `${REC_BASE}/dict.txt`)
}
export function setPaddleDictUrl(url: string) {
  lsSet(LS_DICT, url)
  loaded = null
}

interface Loaded {
  session: ort.InferenceSession
  charset: string[] // index 0 = blank
  backend: ComputeBackend
}
let loaded: Promise<Loaded> | null = null
let loadedBackend: ComputeBackend | null = null

async function load(backend: ComputeBackend): Promise<Loaded> {
  if (loaded && loadedBackend === backend) return loaded
  loadedBackend = backend
  loaded = (async () => {
    const [modelRes, dictRes] = await Promise.all([
      fetch(getPaddleRecUrl()),
      fetch(getPaddleDictUrl()),
    ])
    if (!modelRes.ok) throw new Error(`PaddleOCR rec 下載失敗 (${modelRes.status})`)
    if (!dictRes.ok) throw new Error(`PaddleOCR 字典下載失敗 (${dictRes.status})`)
    const bytes = new Uint8Array(await modelRes.arrayBuffer())
    const dictText = await dictRes.text()
    const dict = dictText.replace(/\r/g, '').split('\n')
    // Trailing empty line is common; keep only meaningful entries but preserve
    // intentional blank-ish entries by trimming only the final empty line.
    if (dict.length && dict[dict.length - 1] === '') dict.pop()
    // CTC charset: [blank, ...dict, space]
    const charset = ['', ...dict, ' ']
    const providers = backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm']
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
    })
    return { session, charset, backend }
  })()
  return loaded
}

function preprocess(src: HTMLCanvasElement): { data: Float32Array; w: number } {
  const H = 32
  const w = Math.max(16, Math.round((H * src.width) / src.height))
  const c = document.createElement('canvas')
  c.width = w
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0, w, H)
  const { data } = ctx.getImageData(0, 0, w, H)
  const chw = new Float32Array(3 * H * w)
  const plane = H * w
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    chw[p] = (data[i] / 255 - 0.5) / 0.5
    chw[plane + p] = (data[i + 1] / 255 - 0.5) / 0.5
    chw[2 * plane + p] = (data[i + 2] / 255 - 0.5) / 0.5
  }
  return { data: chw, w }
}

function softmaxMax(row: Float32Array, off: number, classes: number): { idx: number; prob: number } {
  let max = -Infinity
  let idx = 0
  for (let c = 0; c < classes; c++) {
    const v = row[off + c]
    if (v > max) {
      max = v
      idx = c
    }
  }
  // softmax prob of the argmax
  let sum = 0
  for (let c = 0; c < classes; c++) sum += Math.exp(row[off + c] - max)
  return { idx, prob: 1 / sum }
}

export async function recognizePaddleEn(
  src: HTMLCanvasElement,
  backend: ComputeBackend,
): Promise<RecognitionOutput> {
  const { session, charset } = await load(backend)
  const { data, w } = preprocess(src)
  const input = new ort.Tensor('float32', data, [1, 3, 32, w])
  const out = await session.run({ [session.inputNames[0]]: input })
  const t = out[session.outputNames[0]]
  const logits = t.data as Float32Array
  // dims: [1, T, C]
  const dims = t.dims
  const T = dims[dims.length - 2]
  const C = dims[dims.length - 1]

  let text = ''
  let prev = -1
  let probSum = 0
  let probCount = 0
  for (let i = 0; i < T; i++) {
    const { idx, prob } = softmaxMax(logits, i * C, C)
    if (idx !== 0 && idx !== prev) {
      text += charset[idx] ?? ''
      probSum += prob
      probCount++
    }
    prev = idx
  }
  return { text: text.trim(), score: probCount ? probSum / probCount : 0 }
}

export function disposePaddleRec() {
  loaded = null
  loadedBackend = null
}
