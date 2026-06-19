/**
 * Text DETECTION stage — PaddleOCR DBNet via onnxruntime-web.
 *
 * Critical Rule #1: detect before recognize. This returns tight boxes that the
 * recognizer then reads one-by-one. We never feed a whole page to a recognizer.
 *
 * Execution provider: WebGPU first, WASM fallback (Critical Rule #7 / two-layer
 * architecture). Postprocessing is a DB threshold + connected-components box
 * extraction with an unclip expansion — axis-aligned only for Phase 1 (rotated
 * boxes are a Phase-2 refinement).
 */
import * as ort from 'onnxruntime-web/webgpu'
import type { ComputeBackend } from '../capabilities'
import { fetchModel, getDetModelSpec, type DownloadProgress } from './modelManager'
import type { Box, DetectedRegion } from './types'

// Serve ORT's wasm/jsep binaries from <base>/ort (synced into public/ort).
// Must honour the Vite base path (e.g. GitHub Pages '/reading-app/'), else the
// WebGPU/WASM binaries 404 and the detector fails to initialise.
ort.env.wasm.wasmPaths = `${import.meta.env.BASE_URL}ort/`

// ImageNet normalization used by PaddleOCR det.
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

// DB postprocessing params.
const BIN_THRESH = 0.3
const BOX_THRESH = 0.5
const UNCLIP_RATIO = 1.6
const MIN_BOX_SIDE = 6
const MAX_SIDE = 960 // resize long side cap for detection

let sessionPromise: Promise<ort.InferenceSession> | null = null
let sessionBackend: ComputeBackend | null = null

export async function loadDetector(
  backend: ComputeBackend,
  onProgress?: (p: DownloadProgress) => void,
): Promise<ort.InferenceSession> {
  if (sessionPromise && sessionBackend === backend) return sessionPromise
  sessionBackend = backend
  sessionPromise = (async () => {
    const spec = getDetModelSpec()
    const bytes = await fetchModel(spec, onProgress)
    const providers = backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm']
    return ort.InferenceSession.create(bytes, {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
    })
  })()
  return sessionPromise
}

interface Resized {
  data: Float32Array
  w: number
  h: number
  scaleX: number // origW / w
  scaleY: number // origH / h
}

function preprocess(src: HTMLCanvasElement): Resized {
  const longSide = Math.max(src.width, src.height)
  const ratio = longSide > MAX_SIDE ? MAX_SIDE / longSide : 1
  const w = Math.max(32, Math.round((src.width * ratio) / 32) * 32)
  const h = Math.max(32, Math.round((src.height * ratio) / 32) * 32)

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  // HWC uint8 -> CHW float32, normalized.
  const chw = new Float32Array(3 * w * h)
  const plane = w * h
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    chw[p] = (data[i] / 255 - MEAN[0]) / STD[0]
    chw[plane + p] = (data[i + 1] / 255 - MEAN[1]) / STD[1]
    chw[2 * plane + p] = (data[i + 2] / 255 - MEAN[2]) / STD[2]
  }
  return { data: chw, w, h, scaleX: src.width / w, scaleY: src.height / h }
}

/** Connected-components bounding boxes over a binary mask (4-connectivity). */
function findBoxes(prob: Float32Array, w: number, h: number): Box[] {
  const visited = new Uint8Array(w * h)
  const boxes: Box[] = []
  const stack: number[] = []

  for (let start = 0; start < w * h; start++) {
    if (visited[start] || prob[start] < BIN_THRESH) continue
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0
    stack.push(start)
    visited[start] = 1
    while (stack.length) {
      const idx = stack.pop()!
      const x = idx % w
      const y = (idx / w) | 0
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      // 4-neighbours
      if (x > 0) tryPush(idx - 1)
      if (x < w - 1) tryPush(idx + 1)
      if (y > 0) tryPush(idx - w)
      if (y < h - 1) tryPush(idx + w)
    }
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    if (Math.min(bw, bh) >= MIN_BOX_SIDE) {
      boxes.push({ x: minX, y: minY, w: bw, h: bh })
    }
  }
  return boxes

  function tryPush(n: number) {
    if (!visited[n] && prob[n] >= BIN_THRESH) {
      visited[n] = 1
      stack.push(n)
    }
  }
}

function meanProb(prob: Float32Array, w: number, box: Box): number {
  let sum = 0
  let count = 0
  for (let y = box.y; y < box.y + box.h; y++) {
    const row = y * w
    for (let x = box.x; x < box.x + box.w; x++) {
      sum += prob[row + x]
      count++
    }
  }
  return count ? sum / count : 0
}

/** Expand a box outward (DB "unclip") and clamp to original image bounds. */
function unclip(box: Box, origW: number, origH: number): Box {
  // Approximate unclip with a proportional padding (axis-aligned).
  const pad = ((UNCLIP_RATIO - 1) / 2)
  const px = box.w * pad
  const py = box.h * pad
  const x = Math.max(0, box.x - px)
  const y = Math.max(0, box.y - py)
  const w = Math.min(origW - x, box.w + 2 * px)
  const h = Math.min(origH - y, box.h + 2 * py)
  return { x, y, w, h }
}

export async function detect(
  src: HTMLCanvasElement,
  backend: ComputeBackend,
): Promise<DetectedRegion[]> {
  const session = await loadDetector(backend)
  const { data, w, h, scaleX, scaleY } = preprocess(src)

  const input = new ort.Tensor('float32', data, [1, 3, h, w])
  const feeds: Record<string, ort.Tensor> = { [session.inputNames[0]]: input }
  const output = await session.run(feeds)
  const probTensor = output[session.outputNames[0]]
  const prob = probTensor.data as Float32Array
  // Output is [1,1,h,w]; same spatial size as input for DBNet.
  const [, , ph, pw] = probTensor.dims

  const rawBoxes = findBoxes(prob, pw, ph)
  const regions: DetectedRegion[] = []
  for (const b of rawBoxes) {
    const score = meanProb(prob, pw, b)
    if (score < BOX_THRESH) continue // Critical Rule #2: gate low-confidence regions
    // Map detection-space box -> original-image pixels, then unclip.
    const mapped: Box = {
      x: b.x * scaleX,
      y: b.y * scaleY,
      w: b.w * scaleX,
      h: b.h * scaleY,
    }
    regions.push({ box: unclip(mapped, src.width, src.height), detScore: score })
  }

  // Reading order: top-to-bottom, then left-to-right (rough line grouping).
  regions.sort((a, b) => {
    const dy = a.box.y - b.box.y
    if (Math.abs(dy) > Math.min(a.box.h, b.box.h) * 0.6) return dy
    return a.box.x - b.box.x
  })
  return regions
}

export function disposeDetector() {
  sessionPromise = null
  sessionBackend = null
}
