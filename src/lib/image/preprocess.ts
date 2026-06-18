/**
 * Phase-1 image preprocessing: decode, optional manual crop, and a light
 * enhancement pass (grayscale + contrast stretch + upscale of small inputs).
 *
 * Heavy geometric correction (deskew / perspective via OpenCV.js) is Phase 2 —
 * kept out here so the end-to-end path stays simple and fast to validate.
 */

export async function blobToBitmap(blob: Blob): Promise<ImageBitmap> {
  return await createImageBitmap(blob)
}

export function bitmapToCanvas(bmp: ImageBitmap): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  return c
}

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** Crop a region (source-pixel coords) into a new canvas. */
export function cropCanvas(src: HTMLCanvasElement, rect: CropRect): HTMLCanvasElement {
  const x = Math.max(0, Math.round(rect.x))
  const y = Math.max(0, Math.round(rect.y))
  const w = Math.min(src.width - x, Math.round(rect.w))
  const h = Math.min(src.height - y, Math.round(rect.h))
  const out = document.createElement('canvas')
  out.width = Math.max(1, w)
  out.height = Math.max(1, h)
  const ctx = out.getContext('2d')!
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h)
  return out
}

/**
 * Light enhancement for recognition. Grayscale + percentile contrast stretch,
 * and upscale when the input is small (recognizers like ~>=1000px on the long
 * side). Returns a new canvas; the input is untouched.
 */
export interface EnhanceOptions {
  minLongSide?: number
  /** Estimate and correct page skew via projection profile. Default true. */
  deskew?: boolean
  /** Otsu binarization (helps some recognizers, can hurt others). Default false. */
  binarize?: boolean
}

export function enhanceForOcr(src: HTMLCanvasElement, opts?: EnhanceOptions): HTMLCanvasElement {
  const minLongSide = opts?.minLongSide ?? 1280
  const deskew = opts?.deskew ?? true
  const binarize = opts?.binarize ?? false
  const longSide = Math.max(src.width, src.height)
  const scale = longSide < minLongSide ? Math.min(3, minLongSide / longSide) : 1

  const w = Math.round(src.width * scale)
  const h = Math.round(src.height * scale)
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)

  const img = ctx.getImageData(0, 0, w, h)
  const data = img.data

  // First pass: grayscale + histogram for percentile clipping.
  const gray = new Uint8ClampedArray(w * h)
  const hist = new Uint32Array(256)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0
    gray[p] = g
    hist[g]++
  }

  // 1st / 99th percentile bounds for a robust contrast stretch.
  const total = w * h
  const loCut = total * 0.01
  const hiCut = total * 0.99
  let lo = 0
  let hi = 255
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= loCut) {
      lo = v
      break
    }
  }
  acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= hiCut) {
      hi = v
      break
    }
  }
  const range = Math.max(1, hi - lo)

  const stretched = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let v = ((gray[p] - lo) * 255) / range
    v = v < 0 ? 0 : v > 255 ? 255 : v
    stretched[p] = v
    data[i] = data[i + 1] = data[i + 2] = v
    data[i + 3] = 255
  }

  if (binarize) {
    const t = otsuThreshold(stretched)
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const v = stretched[p] > t ? 255 : 0
      data[i] = data[i + 1] = data[i + 2] = v
    }
  }
  ctx.putImageData(img, 0, 0)

  if (deskew) {
    const angle = estimateSkewAngle(stretched, w, h)
    if (Math.abs(angle) > 0.3) return rotateCanvas(out, -angle)
  }
  return out
}

/** Otsu's method on an 8-bit grayscale buffer. */
function otsuThreshold(gray: Uint8ClampedArray): number {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]
  let sumB = 0
  let wB = 0
  let maxVar = -1
  let threshold = 127
  for (let v = 0; v < 256; v++) {
    wB += hist[v]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += v * hist[v]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) {
      maxVar = between
      threshold = v
    }
  }
  return threshold
}

/**
 * Estimate skew in degrees via projection-profile variance maximization on a
 * downscaled binary image: the angle whose horizontal ink projection has the
 * highest variance is the one where text rows line up. Range +-7 deg.
 */
function estimateSkewAngle(gray: Uint8ClampedArray, w: number, h: number): number {
  // Downscale to keep this cheap.
  const maxDim = 640
  const ds = Math.min(1, maxDim / Math.max(w, h))
  const sw = Math.max(1, Math.round(w * ds))
  const sh = Math.max(1, Math.round(h * ds))
  const small = new Uint8Array(sw * sh)
  const thr = otsuThreshold(gray)
  for (let y = 0; y < sh; y++) {
    const srcY = Math.min(h - 1, Math.floor(y / ds))
    for (let x = 0; x < sw; x++) {
      const srcX = Math.min(w - 1, Math.floor(x / ds))
      small[y * sw + x] = gray[srcY * w + srcX] < thr ? 1 : 0 // ink = 1
    }
  }

  const cx = sw / 2
  const cy = sh / 2
  let bestAngle = 0
  let bestScore = -1
  for (let deg = -7; deg <= 7; deg += 0.5) {
    const rad = (deg * Math.PI) / 180
    const sin = Math.sin(rad)
    const cos = Math.cos(rad)
    const rows = new Float64Array(sh)
    for (let y = 0; y < sh; y++) {
      const dy = y - cy
      for (let x = 0; x < sw; x++) {
        if (!small[y * sw + x]) continue
        const dx = x - cx
        const ry = Math.round(cy + dx * sin + dy * cos)
        if (ry >= 0 && ry < sh) rows[ry]++
      }
    }
    // Variance of row projection.
    let mean = 0
    for (let y = 0; y < sh; y++) mean += rows[y]
    mean /= sh
    let varr = 0
    for (let y = 0; y < sh; y++) {
      const d = rows[y] - mean
      varr += d * d
    }
    if (varr > bestScore) {
      bestScore = varr
      bestAngle = deg
    }
  }
  return bestAngle
}

/** Rotate a canvas by `deg` degrees on a white background (text-safe). */
function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180
  const out = document.createElement('canvas')
  out.width = src.width
  out.height = src.height
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate(rad)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return out
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas toBlob failed'))), type)
  })
}

/** Downscaled JPEG thumbnail (for book covers / page lists). */
export function makeThumbnail(src: HTMLCanvasElement, maxSide = 240): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * scale))
  c.height = Math.max(1, Math.round(src.height * scale))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return canvasToBlob(c, 'image/jpeg')
}
