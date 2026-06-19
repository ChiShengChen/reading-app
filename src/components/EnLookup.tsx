import { useEffect, useState } from 'react'
import { lookupEn, type EnLookupResult } from '../lib/dict/ecdict'
import { addNote } from '../db/db'

interface Props {
  /** Region-like objects with recognized text (OCR result or saved page). */
  regions: { text: string }[]
  bookId?: number
  pageIndex?: number
}

interface Token {
  text: string
  isWord: boolean
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const re = /[A-Za-z][A-Za-z'-]*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), isWord: false })
    tokens.push({ text: m[0], isWord: true })
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ text: text.slice(last), isWord: false })
  return tokens
}

/** English click-to-look-up against ECDICT (English -> Chinese). */
export default function EnLookup({ regions, bookId, pageIndex }: Props) {
  const [sel, setSel] = useState<{ word: string; context: string } | null>(null)

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">
        <span className="font-medium text-slate-300">英文查詞</span> · 點選單字查 ECDICT（英→中）
      </div>

      <div className="space-y-2">
        {regions.map((r, i) => (
          <p
            key={i}
            className="rounded border border-slate-700 bg-slate-900/60 p-2 text-base leading-relaxed text-slate-100"
          >
            {tokenize(r.text).map((t, j) =>
              t.isWord ? (
                <button
                  key={j}
                  onClick={() => setSel({ word: t.text, context: r.text })}
                  className={`rounded hover:bg-sky-500/30 ${
                    sel?.word === t.text ? 'bg-sky-500/40' : ''
                  }`}
                >
                  {t.text}
                </button>
              ) : (
                <span key={j}>{t.text}</span>
              ),
            )}
          </p>
        ))}
      </div>

      {sel && (
        <LookupPanel
          word={sel.word}
          context={sel.context}
          bookId={bookId}
          pageIndex={pageIndex}
          onClose={() => setSel(null)}
        />
      )}
    </div>
  )
}

function LookupPanel({
  word,
  context,
  bookId,
  pageIndex,
  onClose,
}: {
  word: string
  context: string
  bookId?: number
  pageIndex?: number
  onClose: () => void
}) {
  const [result, setResult] = useState<EnLookupResult | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setSaved(false)
    void lookupEn(word).then((r) => {
      if (!cancelled) setResult(r)
    })
    return () => {
      cancelled = true
    }
  }, [word])

  async function save() {
    const top = result?.entries[0]
    await addNote({
      sourceType: 'word',
      term: word.toLowerCase(),
      reading: top?.phonetic,
      definition: top?.translation,
      contextSentence: context,
      bookId,
      pageIndex,
      tags: ['en'],
    })
    setSaved(true)
  }

  return (
    <div className="rounded-lg border border-sky-800 bg-slate-900 p-3">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <span className="text-lg font-semibold text-slate-100">{word}</span>
          {result?.entries[0]?.phonetic && (
            <span className="ml-2 text-sm text-slate-400">/{result.entries[0].phonetic}/</span>
          )}
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
          ✕
        </button>
      </div>

      {!result && <p className="text-sm text-slate-500">查詢中…</p>}
      {result && !result.available && <p className="text-sm text-amber-300">{result.reason}</p>}
      {result?.available && result.entries.length === 0 && (
        <p className="text-sm text-slate-500">字典查無此詞。</p>
      )}
      {result?.available && result.entries.length > 0 && (
        <ul className="space-y-1 text-sm">
          {result.entries.map((e, i) => (
            <li key={i} className="text-slate-200">
              {e.word !== word.toLowerCase() && (
                <span className="mr-1 text-xs text-slate-500">({e.word})</span>
              )}
              <span className="whitespace-pre-wrap text-slate-300">{e.translation}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <button
          onClick={save}
          disabled={saved}
          className="rounded bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-900 enabled:hover:bg-emerald-400 disabled:opacity-50"
        >
          {saved ? '已存入筆記本 ✓' : '存入筆記本'}
        </button>
      </div>
    </div>
  )
}
