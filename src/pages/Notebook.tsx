import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listNotes,
  deleteNote,
  updateNote,
  listBookmarks,
  deleteBookmark,
  type Note,
  type Bookmark,
} from '../db/db'

type Filter = 'all' | 'word' | 'sentence'

const DAY = 24 * 60 * 60 * 1000
type Grade = 'again' | 'good' | 'easy'

/** SM-2-lite scheduler. */
function schedule(n: Note, grade: Grade): Partial<Note> {
  const ease = n.srsEase ?? 2.5
  const interval = n.srsInterval ?? 0
  if (grade === 'again') {
    return { srsDue: Date.now() + 10 * 60 * 1000, srsInterval: 0, srsEase: Math.max(1.3, ease - 0.2) }
  }
  const base = interval > 0 ? interval * ease : 1
  const nextInterval = grade === 'easy' ? base * 1.5 : base
  const nextEase = grade === 'easy' ? ease + 0.1 : ease
  return {
    srsDue: Date.now() + nextInterval * DAY,
    srsInterval: nextInterval,
    srsEase: nextEase,
  }
}

const isDue = (n: Note) => !n.srsDue || n.srsDue <= Date.now()

function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Anki = tab-separated (front, back, tags); CSV = quoted full columns. */
function exportNotes(notes: Note[], fmt: 'anki' | 'csv') {
  if (fmt === 'anki') {
    const rows = notes.map((n) => {
      const front = n.reading ? `${n.term}（${n.reading}）` : n.term
      const back = [n.definition, n.contextSentence && n.contextSentence !== n.term ? n.contextSentence : '']
        .filter(Boolean)
        .join('<br>')
      const tags = n.tags.join(' ')
      // Tab-separated; strip tabs/newlines from fields.
      return [front, back, tags].map((f) => f.replace(/[\t\r\n]+/g, ' ')).join('\t')
    })
    download('notes-anki.txt', rows.join('\n'), 'text/plain;charset=utf-8')
    return
  }
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const header = ['type', 'term', 'reading', 'definition', 'context', 'tags'].join(',')
  const rows = notes.map((n) =>
    [n.sourceType, n.term, n.reading ?? '', n.definition ?? '', n.contextSentence ?? '', n.tags.join(' ')]
      .map((v) => esc(String(v)))
      .join(','),
  )
  download('notes.csv', '﻿' + [header, ...rows].join('\n'), 'text/csv;charset=utf-8')
}

export default function Notebook() {
  const [notes, setNotes] = useState<Note[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState(false)

  const due = useMemo(() => notes.filter(isDue), [notes])

  async function refresh() {
    const [n, b] = await Promise.all([listNotes(), listBookmarks()])
    setNotes(n)
    setBookmarks(b)
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
  }, [])

  const filtered = useMemo(
    () => (filter === 'all' ? notes : notes.filter((n) => n.sourceType === filter)),
    [notes, filter],
  )

  async function removeNote(id: number) {
    await deleteNote(id)
    void refresh()
  }
  async function removeBookmark(id: number) {
    await deleteBookmark(id)
    void refresh()
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">筆記本</h2>
          <p className="mt-1 text-sm text-slate-400">
            在「閱讀」分頁點選詞語或句子即可存入這裡。
          </p>
        </div>
        {!reviewing && due.length > 0 && (
          <button
            onClick={() => setReviewing(true)}
            className="shrink-0 rounded bg-violet-500 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-violet-400"
          >
            複習（{due.length}）
          </button>
        )}
      </div>

      {reviewing && (
        <ReviewSession
          notes={due}
          onDone={() => {
            setReviewing(false)
            void refresh()
          }}
        />
      )}

      {!reviewing && (
        <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['all', 'word', 'sentence'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-3 py-1.5 ${
              filter === f ? 'bg-sky-500 text-slate-900' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {f === 'all' ? '全部' : f === 'word' ? '單字' : '句子'}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-500">{filtered.length} 筆</span>
        <button
          onClick={() => exportNotes(filtered, 'anki')}
          disabled={filtered.length === 0}
          className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 enabled:hover:bg-slate-800 disabled:opacity-40"
        >
          匯出 Anki
        </button>
        <button
          onClick={() => exportNotes(filtered, 'csv')}
          disabled={filtered.length === 0}
          className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 enabled:hover:bg-slate-800 disabled:opacity-40"
        >
          匯出 CSV
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500">載入中…</p>}

      {!loading && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-500">
          還沒有筆記。
        </div>
      )}

      <ul className="space-y-2">
        {filtered.map((n) => (
          <li key={n.id} className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded bg-slate-700 px-1.5 text-xs text-slate-200">
                    {n.sourceType === 'word' ? '單字' : '句子'}
                  </span>
                  <span className="font-medium text-slate-100">{n.term}</span>
                  {n.reading && <span className="text-sm text-slate-400">{n.reading}</span>}
                </div>
                {n.definition && <p className="mt-1 text-sm text-slate-300">{n.definition}</p>}
                {n.contextSentence && n.contextSentence !== n.term && (
                  <p className="mt-1 text-xs text-slate-500">情境：{n.contextSentence}</p>
                )}
                {n.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {n.tags.map((t) => (
                      <span key={t} className="rounded bg-slate-800 px-1.5 text-xs text-slate-400">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => removeNote(n.id)}
                className="shrink-0 text-slate-500 hover:text-rose-300"
                title="刪除"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>

      {bookmarks.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-300">書籤</h3>
          <ul className="space-y-2">
            {bookmarks.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/60 p-3"
              >
                <div>
                  <Link
                    to={`/book/${b.bookId}/page/${b.pageIndex}`}
                    className="text-slate-100 hover:text-sky-300 hover:underline"
                  >
                    {b.label}
                  </Link>
                  <span className="ml-2 text-xs text-slate-500">第 {b.pageIndex + 1} 頁</span>
                  {b.note && <p className="mt-1 text-sm text-slate-400">{b.note}</p>}
                </div>
                <button
                  onClick={() => removeBookmark(b.id)}
                  className="text-slate-500 hover:text-rose-300"
                  title="刪除"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
        </>
      )}
    </div>
  )
}

function ReviewSession({ notes, onDone }: { notes: Note[]; onDone: () => void }) {
  const [i, setI] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const card = notes[i]

  if (!card) {
    return (
      <div className="rounded-lg border border-slate-700 p-6 text-center">
        <p className="text-slate-200">複習完成 🎉</p>
        <button
          onClick={onDone}
          className="mt-3 rounded bg-sky-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-sky-400"
        >
          回筆記本
        </button>
      </div>
    )
  }

  async function grade(g: Grade) {
    await updateNote(card.id, schedule(card, g))
    setRevealed(false)
    setI((n) => n + 1)
  }

  return (
    <div className="space-y-4 rounded-lg border border-violet-800 bg-slate-900/60 p-6">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          複習 {i + 1} / {notes.length}
        </span>
        <button onClick={onDone} className="hover:text-slate-300">
          結束
        </button>
      </div>

      <div className="py-4 text-center">
        <div className="text-2xl font-semibold text-slate-100">{card.term}</div>
        {revealed && (
          <div className="mt-3 space-y-1 text-left">
            {card.reading && <p className="text-sm text-slate-400">{card.reading}</p>}
            {card.definition && <p className="text-sm text-slate-200">{card.definition}</p>}
            {card.contextSentence && card.contextSentence !== card.term && (
              <p className="text-xs text-slate-500">情境：{card.contextSentence}</p>
            )}
          </div>
        )}
      </div>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded bg-slate-700 py-2 text-sm font-medium text-slate-100 hover:bg-slate-600"
        >
          顯示答案
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => grade('again')}
            className="rounded bg-rose-500/80 py-2 text-sm font-medium text-slate-900 hover:bg-rose-400"
          >
            忘記
          </button>
          <button
            onClick={() => grade('good')}
            className="rounded bg-sky-500 py-2 text-sm font-medium text-slate-900 hover:bg-sky-400"
          >
            普通
          </button>
          <button
            onClick={() => grade('easy')}
            className="rounded bg-emerald-500 py-2 text-sm font-medium text-slate-900 hover:bg-emerald-400"
          >
            簡單
          </button>
        </div>
      )}
    </div>
  )
}
