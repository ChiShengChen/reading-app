import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getBook, listPages, deletePage, type Book, type Page } from '../db/db'
import { useObjectUrl } from '../lib/useObjectUrl'

export default function BookView() {
  const { bookId } = useParams()
  const id = Number(bookId)
  const [book, setBook] = useState<Book | undefined>()
  const [pages, setPages] = useState<Page[] | null>(null)

  async function refresh() {
    const [b, p] = await Promise.all([getBook(id), listPages(id)])
    setBook(b)
    setPages(p)
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function remove(pageId: number) {
    if (!confirm('刪除此頁？')) return
    await deletePage(pageId)
    void refresh()
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center gap-3 text-sm">
        <Link to="/" className="text-slate-400 hover:text-slate-200">
          ← 書庫
        </Link>
        {pages && pages.length > 0 && (
          <Link
            to={`/book/${id}/read`}
            className="ml-auto rounded bg-sky-500 px-3 py-1.5 font-medium text-slate-900 hover:bg-sky-400"
          >
            連續閱讀
          </Link>
        )}
      </div>

      <h2 className="mb-1 text-xl font-semibold">{book?.title ?? '書本'}</h2>
      <p className="mb-4 text-sm text-slate-500">
        {book ? (book.language === 'ja' ? '日文' : '英文') : ''} · {pages?.length ?? 0} 頁
      </p>

      {pages?.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-500">
          這本書還沒有頁面。
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {pages?.map((p) => (
          <PageThumb key={p.id} page={p} bookId={id} onDelete={() => remove(p.id)} />
        ))}
      </div>
    </div>
  )
}

function PageThumb({
  page,
  bookId,
  onDelete,
}: {
  page: Page
  bookId: number
  onDelete: () => void
}) {
  const url = useObjectUrl(page.imageBlob)
  return (
    <div className="group relative overflow-hidden rounded border border-slate-700 bg-slate-900/60">
      <Link to={`/book/${bookId}/page/${page.index}`}>
        <div className="flex aspect-[3/4] items-center justify-center bg-slate-800">
          {url && <img src={url} alt={`第 ${page.index + 1} 頁`} className="h-full w-full object-cover" />}
        </div>
        <p className="p-1 text-center text-xs text-slate-400">第 {page.index + 1} 頁</p>
      </Link>
      <button
        onClick={onDelete}
        title="刪除此頁"
        className="absolute right-1 top-1 hidden rounded bg-slate-900/80 px-1.5 text-slate-300 hover:text-rose-300 group-hover:block"
      >
        ✕
      </button>
    </div>
  )
}
