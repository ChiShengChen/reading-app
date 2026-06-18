import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listNotes,
  deleteNote,
  listBookmarks,
  deleteBookmark,
  type Note,
  type Bookmark,
} from '../db/db'

type Filter = 'all' | 'word' | 'sentence'

export default function Notebook() {
  const [notes, setNotes] = useState<Note[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)

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
      <div>
        <h2 className="text-xl font-semibold">筆記本</h2>
        <p className="mt-1 text-sm text-slate-400">
          在「閱讀」分頁點選日文詞語或句子即可存入這裡（Phase 4）。
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
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
    </div>
  )
}
