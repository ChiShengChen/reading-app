import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listBooks, countPages, deleteBook, type Book } from '../db/db'
import { useObjectUrl } from '../lib/useObjectUrl'

interface BookRow extends Book {
  pages: number
}

export default function Library() {
  const [books, setBooks] = useState<BookRow[] | null>(null)

  async function refresh() {
    const list = await listBooks()
    const withCounts = await Promise.all(
      list.map(async (b) => ({ ...b, pages: await countPages(b.id) })),
    )
    setBooks(withCounts)
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function remove(id: number, title: string) {
    if (!confirm(`刪除「${title}」與其所有頁面？`)) return
    await deleteBook(id)
    void refresh()
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">書庫</h2>
        <Link
          to="/reader"
          className="rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-sky-400"
        >
          ＋ 新增頁面
        </Link>
      </div>

      {books === null && <p className="text-sm text-slate-500">載入中…</p>}

      {books?.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-500">
          書庫是空的。到
          <Link to="/reader" className="text-sky-300 underline">
            {' '}
            閱讀{' '}
          </Link>
          拍照辨識後，按「存入書庫」即可建立書本。
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {books?.map((b) => (
          <BookCard key={b.id} book={b} onDelete={() => remove(b.id, b.title)} />
        ))}
      </div>
    </div>
  )
}

function BookCard({ book, onDelete }: { book: BookRow; onDelete: () => void }) {
  const coverUrl = useObjectUrl(book.cover)
  return (
    <div className="group relative overflow-hidden rounded-lg border border-slate-700 bg-slate-900/60">
      <Link to={`/book/${book.id}`}>
        <div className="flex aspect-[3/4] items-center justify-center bg-slate-800">
          {coverUrl ? (
            <img src={coverUrl} alt={book.title} className="h-full w-full object-cover" />
          ) : (
            <span className="text-3xl">📖</span>
          )}
        </div>
        <div className="p-2">
          <p className="truncate text-sm font-medium text-slate-100">{book.title}</p>
          <p className="text-xs text-slate-500">
            {book.language === 'ja' ? '日文' : '英文'} · {book.pages} 頁
          </p>
        </div>
      </Link>
      <button
        onClick={onDelete}
        title="刪除書本"
        className="absolute right-1 top-1 hidden rounded bg-slate-900/80 px-1.5 text-slate-300 hover:text-rose-300 group-hover:block"
      >
        ✕
      </button>
    </div>
  )
}
