import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getBook, listPages, type Book, type Page } from '../db/db'
import { useObjectUrl } from '../lib/useObjectUrl'

/** Scroll through every page of a book: image + saved translation in one view. */
export default function ContinuousReader() {
  const { bookId } = useParams()
  const id = Number(bookId)
  const [book, setBook] = useState<Book | undefined>()
  const [pages, setPages] = useState<Page[] | null>(null)
  const [showImage, setShowImage] = useState(true)

  useEffect(() => {
    void (async () => {
      const [b, p] = await Promise.all([getBook(id), listPages(id)])
      setBook(b)
      setPages(p)
    })()
  }, [id])

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <div className="flex items-center justify-between text-sm">
        <Link to={`/book/${id}`} className="text-slate-400 hover:text-slate-200">
          ← {book?.title ?? '書本'}
        </Link>
        <label className="flex items-center gap-1 text-slate-400">
          <input
            type="checkbox"
            checked={showImage}
            onChange={(e) => setShowImage(e.target.checked)}
          />
          顯示原圖
        </label>
      </div>

      {pages === null && <p className="text-sm text-slate-500">載入中…</p>}
      {pages?.length === 0 && <p className="text-sm text-slate-500">這本書還沒有頁面。</p>}

      <div className="space-y-8">
        {pages?.map((p) => (
          <PageBlock key={p.id} page={p} bookId={id} showImage={showImage} />
        ))}
      </div>
    </div>
  )
}

function PageBlock({ page, bookId, showImage }: { page: Page; bookId: number; showImage: boolean }) {
  const url = useObjectUrl(page.imageBlob)
  return (
    <div className="space-y-3 border-t border-slate-800 pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>第 {page.index + 1} 頁</span>
        <Link to={`/book/${bookId}/page/${page.index}`} className="text-sky-300 hover:underline">
          單頁／查詞 →
        </Link>
      </div>
      {showImage && url && (
        <img src={url} alt={`第 ${page.index + 1} 頁`} className="w-full rounded border border-slate-700" />
      )}
      {page.translationPairs && page.translationPairs.length > 0 ? (
        <div className="divide-y divide-slate-800 overflow-hidden rounded border border-slate-700">
          {page.translationPairs.map((pr, i) => (
            <div key={i} className="grid gap-2 p-3 md:grid-cols-2">
              <p className="text-sm text-slate-400">{pr.source}</p>
              <p className="text-sm text-slate-100">{pr.target}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-wrap rounded border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-100">
          {page.fullText || '（無文字）'}
        </p>
      )}
    </div>
  )
}
