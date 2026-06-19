/**
 * Optional CLOUD mode: one-shot OCR + Traditional-Chinese translation via the
 * Anthropic Claude vision model (claude-opus-4-8 by default). This is the
 * opt-in "best quality" path — it sends the page photo to Anthropic, so it is
 * NOT offline/local (unlike the default on-device pipeline).
 *
 * Pure-frontend PWA with no backend: the user brings their own API key, stored
 * in localStorage on their device, and the browser calls the API directly
 * (dangerouslyAllowBrowser + Anthropic's browser-access CORS support).
 */
import Anthropic from '@anthropic-ai/sdk'
import type { OcrLanguage } from '../ocr/recognizers/types'

const LS_KEY = 'claudeApiKey'
const LS_MODEL = 'claudeModel'
const DEFAULT_MODEL = 'claude-opus-4-8'

export function getClaudeKey(): string {
  try {
    return localStorage.getItem(LS_KEY) || ''
  } catch {
    return ''
  }
}
export function setClaudeKey(k: string) {
  try {
    if (k.trim()) localStorage.setItem(LS_KEY, k.trim())
    else localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
}
export function getClaudeModel(): string {
  try {
    return localStorage.getItem(LS_MODEL) || DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}
export function setClaudeModel(m: string) {
  try {
    if (m.trim()) localStorage.setItem(LS_MODEL, m.trim())
    else localStorage.removeItem(LS_MODEL)
  } catch {
    /* ignore */
  }
}
export function hasClaudeKey(): boolean {
  return getClaudeKey().length > 0
}

export interface CloudPair {
  source: string
  target: string
}
export interface CloudResult {
  pairs: CloudPair[]
  fullText: string
  model: string
}

/** Downscale to a JPEG base64 (Claude vision sweet spot ≈ 1568px long edge). */
function toJpegBase64(src: HTMLCanvasElement, maxSide = 1568): { data: string; mediaType: 'image/jpeg' } {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(src.width * scale))
  c.height = Math.max(1, Math.round(src.height * scale))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  const url = c.toDataURL('image/jpeg', 0.85)
  return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg' }
}

/** Tolerant JSON extraction (handles any stray prose around the object). */
function parsePairs(text: string): CloudPair[] {
  const tryParse = (s: string): CloudPair[] | null => {
    try {
      const o = JSON.parse(s) as { pairs?: CloudPair[] }
      return Array.isArray(o.pairs) ? o.pairs : null
    } catch {
      return null
    }
  }
  let pairs = tryParse(text.trim())
  if (!pairs) {
    const a = text.indexOf('{')
    const b = text.lastIndexOf('}')
    if (a !== -1 && b > a) pairs = tryParse(text.slice(a, b + 1))
  }
  return (pairs ?? [])
    .filter((p) => p && typeof p.source === 'string')
    .map((p) => ({ source: p.source, target: typeof p.target === 'string' ? p.target : '' }))
}

export async function cloudOcrTranslate(
  src: HTMLCanvasElement,
  lang: OcrLanguage,
): Promise<CloudResult> {
  const apiKey = getClaudeKey()
  if (!apiKey) throw new Error('尚未設定 Claude API key（設定 → 進階 → 雲端）')
  const model = getClaudeModel()
  const { data, mediaType } = toJpegBase64(src)
  const langName = lang === 'ja' ? 'Japanese' : 'English'

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const system =
    `You are a precise OCR + translation engine for photographed book pages. ` +
    `Read ALL the ${langName} body text in natural reading order, exactly as printed ` +
    `(fix obvious OCR-style artifacts, keep original wording). Split it into sentences. ` +
    `Translate each sentence into Traditional Chinese (zh-Hant, Taiwan). ` +
    `Ignore page numbers, running headers/footers, and photo artifacts. ` +
    `Respond with ONLY a JSON object of the form ` +
    `{"pairs":[{"source":"<original sentence>","target":"<繁體中文翻譯>"}]} and no other text.`

  const resp = await client.messages.create({
    model,
    max_tokens: 16000,
    system,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: `Transcribe and translate this ${langName} book page. JSON only.` },
        ],
      },
    ],
  })

  if (resp.stop_reason === 'refusal') {
    throw new Error('模型拒絕了這個請求（refusal）。')
  }
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
  const pairs = parsePairs(text)
  if (pairs.length === 0) {
    throw new Error(
      resp.stop_reason === 'max_tokens'
        ? '輸出過長被截斷，請改框選較少文字。'
        : '無法解析模型輸出。',
    )
  }
  return { pairs, fullText: pairs.map((p) => p.source).join('\n'), model: resp.model }
}
