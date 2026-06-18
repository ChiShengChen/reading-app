/**
 * JMdict dictionary lookup via sql.js (SQLite compiled to WASM).
 *
 * The SQLite engine wasm is served from /public/sqljs (copied by
 * scripts/sync-assets.mjs). The JMdict database itself is a separate ~50MB
 * .sqlite downloaded lazily from a configurable URL and cached.
 *
 * EXPECTED SCHEMA (the DB you point DICT_DB_URL at must match, or override the
 * query with setLookupSql):
 *
 *   CREATE TABLE entries (
 *     id      INTEGER PRIMARY KEY,
 *     kanji   TEXT,     -- headword (kanji/surface form), may be NULL
 *     reading TEXT,     -- kana reading
 *     glosses TEXT      -- definitions, newline-separated
 *   );
 *   CREATE INDEX idx_entries_kanji   ON entries(kanji);
 *   CREATE INDEX idx_entries_reading ON entries(reading);
 *
 * If the DB can't be loaded, lookups resolve to { available: false } and the UI
 * shows "字典未載入" — nothing crashes.
 */
import initSqlJs, { type Database } from 'sql.js'

let DICT_DB_URL = '/dict-db/jmdict.sqlite'
let LOOKUP_SQL =
  'SELECT kanji, reading, glosses FROM entries WHERE kanji = ?1 OR reading = ?1 OR kanji = ?2 LIMIT 30'

export function setDictDbUrl(url: string) {
  DICT_DB_URL = url
  dbPromise = null
}
export function setLookupSql(sql: string) {
  LOOKUP_SQL = sql
}

export interface DictEntry {
  kanji?: string
  reading?: string
  glosses: string[]
}

export interface LookupResult {
  available: boolean
  /** Why unavailable (for UI), when applicable. */
  reason?: string
  entries: DictEntry[]
}

const DICT_CACHE = 'reading-app-dict-v1'

let dbPromise: Promise<Database | null> | null = null

async function fetchDbBytes(): Promise<Uint8Array> {
  if ('caches' in self) {
    try {
      const cache = await caches.open(DICT_CACHE)
      const hit = await cache.match(DICT_DB_URL)
      if (hit) return new Uint8Array(await hit.arrayBuffer())
      const res = await fetch(DICT_DB_URL)
      if (!res.ok) throw new Error(`字典下載失敗 (${res.status})`)
      const buf = await res.arrayBuffer()
      await cache.put(DICT_DB_URL, new Response(buf))
      return new Uint8Array(buf)
    } catch (err) {
      // fall through to plain fetch
      console.warn('[jmdict] cache path failed:', err)
    }
  }
  const res = await fetch(DICT_DB_URL)
  if (!res.ok) throw new Error(`字典下載失敗 (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

function loadDb(): Promise<Database | null> {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    try {
      const SQL = await initSqlJs({ locateFile: (f) => `/sqljs/${f}` })
      const bytes = await fetchDbBytes()
      return new SQL.Database(bytes)
    } catch (err) {
      console.warn('[jmdict] dictionary unavailable:', err)
      return null
    }
  })()
  return dbPromise
}

function splitGlosses(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/\r?\n|;\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function lookup(term: string, base?: string): Promise<LookupResult> {
  const db = await loadDb()
  if (!db) {
    return { available: false, reason: '字典未載入（請設定 JMdict sqlite 路徑）', entries: [] }
  }
  const entries: DictEntry[] = []
  const seen = new Set<string>()
  const stmt = db.prepare(LOOKUP_SQL)
  try {
    stmt.bind({ 1: term, 2: base ?? term })
    while (stmt.step()) {
      const row = stmt.getAsObject() as { kanji?: string; reading?: string; glosses?: string }
      const key = `${row.kanji ?? ''}|${row.reading ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({
        kanji: row.kanji || undefined,
        reading: row.reading || undefined,
        glosses: splitGlosses(row.glosses ?? null),
      })
    }
  } finally {
    stmt.free()
  }
  return { available: true, entries }
}

export async function isDictAvailable(): Promise<boolean> {
  return (await loadDb()) !== null
}

export function getDictDbUrl(): string {
  return DICT_DB_URL
}

/** Whether the JMdict sqlite is already in Cache Storage. */
export async function isDictCached(): Promise<boolean> {
  if (!('caches' in self)) return false
  try {
    const cache = await caches.open(DICT_CACHE)
    return (await cache.match(DICT_DB_URL)) !== undefined
  } catch {
    return false
  }
}

/** Download the JMdict sqlite with progress and cache it (offline afterwards). */
export async function downloadDict(
  onProgress?: (ratio: number | undefined, msg: string) => void,
): Promise<void> {
  const res = await fetch(DICT_DB_URL)
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
        onProgress?.(total ? received / total : undefined, '下載字典資料庫…')
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
    const cache = await caches.open(DICT_CACHE)
    await cache.put(DICT_DB_URL, new Response(merged))
  }
  dbPromise = null // re-open from fresh cache on next lookup
}

export async function deleteDict(): Promise<void> {
  if ('caches' in self) {
    const cache = await caches.open(DICT_CACHE)
    await cache.delete(DICT_DB_URL)
  }
  dbPromise = null
}
