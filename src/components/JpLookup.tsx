import { useEffect, useState } from 'react'
import { tokenize, isKuromojiAvailable, type JpToken } from '../lib/jp/tokenizer'
import { lookup, type LookupResult } from '../lib/dict/jmdict'
import { addNote } from '../db/db'

interface Props {
  /** Any region-like object with recognized text (OCR result or saved page). */
  regions: { text: string }[]
  /** Optional source context, linking saved notes back to a book/page. */
  bookId?: number
  pageIndex?: number
  onSaved?: () => void
}

interface Selection {
  token: JpToken
  /** The region text the token came from, used as note context. */
  context: string
}

/**
 * Japanese click-to-look-up: tokenizes each region (kuromoji, with
 * Intl.Segmenter fallback), renders clickable content words, and on click shows
 * the JMdict definition with a "save to notebook" action.
 */
export default function JpLookup({ regions, bookId, pageIndex, onSaved }: Props) {
  const [tokensByRegion, setTokensByRegion] = useState<JpToken[][] | null>(null)
  const [usingKuromoji, setUsingKuromoji] = useState<boolean | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setTokensByRegion(null)
      const avail = await isKuromojiAvailable()
      const all = await Promise.all(regions.map((r) => tokenize(r.text)))
      if (cancelled) return
      setUsingKuromoji(avail)
      setTokensByRegion(all)
    })()
    return () => {
      cancelled = true
    }
  }, [regions])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-300">日文斷詞</span>
        {usingKuromoji === null ? (
          <span>斷詞中…</span>
        ) : usingKuromoji ? (
          <span className="text-emerald-300">kuromoji</span>
        ) : (
          <span className="text-amber-300">Intl.Segmenter 後備（無讀音／辭典原形）</span>
        )}
        <span>· 點選詞語查字典</span>
      </div>

      <div className="space-y-2">
        {!tokensByRegion &&
          regions.map((r, i) => (
            <p key={i} className="rounded border border-slate-700 bg-slate-900/60 p-2 text-sm text-slate-300">
              {r.text}
            </p>
          ))}
        {tokensByRegion?.map((tokens, i) => (
          <p
            key={i}
            className="rounded border border-slate-700 bg-slate-900/60 p-2 text-base leading-relaxed text-slate-100"
          >
            {tokens.map((t, j) =>
              t.isWord ? (
                <button
                  key={j}
                  onClick={() => setSelection({ token: t, context: regions[i].text })}
                  className={`rounded px-0.5 hover:bg-sky-500/30 ${
                    selection?.token === t ? 'bg-sky-500/40' : ''
                  }`}
                >
                  {t.surface}
                </button>
              ) : (
                <span key={j}>{t.surface}</span>
              ),
            )}
          </p>
        ))}
      </div>

      {selection && (
        <LookupPanel
          selection={selection}
          bookId={bookId}
          pageIndex={pageIndex}
          onClose={() => setSelection(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

function LookupPanel({
  selection,
  bookId,
  pageIndex,
  onClose,
  onSaved,
}: {
  selection: Selection
  bookId?: number
  pageIndex?: number
  onClose: () => void
  onSaved?: () => void
}) {
  const { token, context } = selection
  const [result, setResult] = useState<LookupResult | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setSaved(false)
    void lookup(token.surface, token.base).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [token])

  async function save() {
    const definition = result?.entries.flatMap((e) => e.glosses).slice(0, 6).join('；')
    await addNote({
      sourceType: 'word',
      term: token.base ?? token.surface,
      reading: token.reading,
      definition: definition || undefined,
      contextSentence: context,
      bookId,
      pageIndex,
      tags: token.pos ? [token.pos] : [],
    })
    setSaved(true)
    onSaved?.()
  }

  return (
    <div className="rounded-lg border border-sky-800 bg-slate-900 p-3">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <span className="text-lg font-semibold text-slate-100">{token.surface}</span>
          {token.reading && <span className="ml-2 text-sm text-slate-400">{token.reading}</span>}
          {token.base && token.base !== token.surface && (
            <span className="ml-2 text-xs text-slate-500">原形 {token.base}</span>
          )}
          {token.pos && <span className="ml-2 text-xs text-slate-500">{token.pos}</span>}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
          ✕
        </button>
      </div>

      {!result && <p className="text-sm text-slate-500">查詢中…</p>}
      {result && !result.available && (
        <p className="text-sm text-amber-300">{result.reason}</p>
      )}
      {result?.available && result.entries.length === 0 && (
        <p className="text-sm text-slate-500">字典查無此詞。</p>
      )}
      {result?.available && result.entries.length > 0 && (
        <ul className="space-y-1 text-sm">
          {result.entries.map((e, i) => (
            <li key={i} className="text-slate-200">
              {e.kanji && <span className="font-medium">{e.kanji}</span>}
              {e.reading && <span className="ml-1 text-slate-400">【{e.reading}】</span>}
              {e.glosses.length > 0 && (
                <span className="ml-1 text-slate-300">{e.glosses.join('；')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={save}
          disabled={saved}
          className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-900 enabled:hover:bg-emerald-400 disabled:opacity-50"
        >
          {saved ? '已存入筆記本 ✓' : '存入筆記本'}
        </button>
        <span className="text-xs text-slate-500">情境：{context.slice(0, 24)}…</span>
      </div>
    </div>
  )
}
