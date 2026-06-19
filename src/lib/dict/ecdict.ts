/**
 * English->Chinese dictionary lookup via sql.js, for reading English text.
 * Data built by scripts/build-ecdict-sqlite.py from ECDICT and hosted on HF.
 *
 * Schema:
 *   entries(word TEXT, phonetic TEXT, translation TEXT)   -- word lowercased
 * Lookup tries the clicked word + a few de-inflected candidates (plural / -ed /
 * -ing / -ly), so "running"/"books"/"quickly" resolve without a JS lemmatizer.
 *
 * Overridable + persisted via 設定→進階. If the DB can't load, lookups resolve
 * to { available: false } and the UI shows "字典未載入".
 */
import initSqlJs, { type Database } from 'sql.js'

const DEFAULT_ECDICT_DB_URL =
  'https://huggingface.co/ms57rd/ecdict-sqlite/resolve/main/ecdict.sqlite'
const LS_KEY = 'ecdictDbUrl'
const ECDICT_CACHE = 'reading-app-ecdict-v1'

function readUrl(): string {
  try {
    return localStorage.getItem(LS_KEY) || DEFAULT_ECDICT_DB_URL
  } catch {
    return DEFAULT_ECDICT_DB_URL
  }
}

let DB_URL = readUrl()

export function setEcdictDbUrl(url: string) {
  try {
    if (url.trim()) localStorage.setItem(LS_KEY, url.trim())
    else localStorage.removeItem(LS_KEY)
  } catch {
    /* ignore */
  }
  DB_URL = readUrl()
  dbPromise = null
}
export function getEcdictDbUrl(): string {
  return DB_URL
}

export interface EnEntry {
  word: string
  phonetic?: string
  translation: string
}
export interface EnLookupResult {
  available: boolean
  reason?: string
  entries: EnEntry[]
}

let dbPromise: Promise<Database | null> | null = null

async function fetchDbBytes(): Promise<Uint8Array> {
  if ('caches' in self) {
    try {
      const cache = await caches.open(ECDICT_CACHE)
      const hit = await cache.match(DB_URL)
      if (hit) return new Uint8Array(await hit.arrayBuffer())
      const res = await fetch(DB_URL)
      if (!res.ok) throw new Error(`字典下載失敗 (${res.status})`)
      const buf = await res.arrayBuffer()
      await cache.put(DB_URL, new Response(buf))
      return new Uint8Array(buf)
    } catch (err) {
      console.warn('[ecdict] cache path failed:', err)
    }
  }
  const res = await fetch(DB_URL)
  if (!res.ok) throw new Error(`字典下載失敗 (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

function loadDb(): Promise<Database | null> {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    try {
      const SQL = await initSqlJs({ locateFile: (f) => `/sqljs/${f}` })
      return new SQL.Database(await fetchDbBytes())
    } catch (err) {
      console.warn('[ecdict] dictionary unavailable:', err)
      return null
    }
  })()
  return dbPromise
}

/** Clicked word + simple de-inflected forms to try, in priority order. */
export function candidates(raw: string): string[] {
  const w = raw.toLowerCase().replace(/[^a-z'-]/g, '')
  if (!w) return []
  const out = new Set<string>([w])
  const add = (s: string) => s.length >= 2 && out.add(s)
  if (w.endsWith("'s") || w.endsWith("’s")) add(w.slice(0, -2))
  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y')
  if (w.endsWith('es')) add(w.slice(0, -2))
  if (w.endsWith('s')) add(w.slice(0, -1))
  if (w.endsWith('ed')) {
    add(w.slice(0, -2))
    add(w.slice(0, -1)) // "-d" (e.g. lived -> live)
  }
  if (w.endsWith('ing')) {
    add(w.slice(0, -3))
    add(w.slice(0, -3) + 'e') // making -> make
  }
  if (w.endsWith('ly')) add(w.slice(0, -2))
  // doubled final consonant: "running" -> "run", "stopped" -> "stop"
  const m = w.match(/^(.*?)([bcdfghjklmnpqrstvwxz])\2(ed|ing)$/)
  if (m) add(m[1] + m[2])
  return [...out]
}

export async function lookupEn(word: string): Promise<EnLookupResult> {
  const db = await loadDb()
  if (!db) {
    return { available: false, reason: '字典未載入（請設定 ECDICT sqlite 路徑）', entries: [] }
  }
  const cands = candidates(word)
  if (cands.length === 0) return { available: true, entries: [] }

  const placeholders = cands.map(() => '?').join(',')
  const stmt = db.prepare(
    `SELECT word, phonetic, translation FROM entries WHERE word IN (${placeholders})`,
  )
  const byWord = new Map<string, EnEntry>()
  try {
    stmt.bind(cands)
    while (stmt.step()) {
      const row = stmt.getAsObject() as { word?: string; phonetic?: string; translation?: string }
      if (row.word && !byWord.has(row.word)) {
        byWord.set(row.word, {
          word: row.word,
          phonetic: row.phonetic || undefined,
          translation: row.translation ?? '',
        })
      }
    }
  } finally {
    stmt.free()
  }
  // Return in candidate priority order (exact form first).
  const entries = cands.map((c) => byWord.get(c)).filter((e): e is EnEntry => !!e)
  return { available: true, entries }
}

export async function isEcdictCached(): Promise<boolean> {
  if (!('caches' in self)) return false
  try {
    const cache = await caches.open(ECDICT_CACHE)
    return (await cache.match(DB_URL)) !== undefined
  } catch {
    return false
  }
}

export async function downloadEcdict(
  onProgress?: (ratio: number | undefined, msg: string) => void,
): Promise<void> {
  const res = await fetch(DB_URL)
  if (!res.ok) throw new Error(`字典下載失敗 (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const chunks: Uint8Array[] = []
  let received = 0
  if (res.body) {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.byteLength
        onProgress?.(total ? received / total : undefined, '下載英文字典…')
      }
    }
  }
  const merged = new Uint8Array(received)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.byteLength
  }
  if ('caches' in self) {
    await (await caches.open(ECDICT_CACHE)).put(DB_URL, new Response(merged))
  }
  dbPromise = null
}

export async function deleteEcdict(): Promise<void> {
  if ('caches' in self) await (await caches.open(ECDICT_CACHE)).delete(DB_URL)
  dbPromise = null
}
