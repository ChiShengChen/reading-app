import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  getBook,
  getPageAt,
  countPages,
  addBookmark,
  deleteBookmark,
  getBookmarkAt,
  type Book,
  type Page,
  type Bookmark,
} from '../db/db'
import JpLookup from '../components/JpLookup'
import EnLookup from '../components/EnLookup'

export default function PageView() {
  const { bookId, pageIndex } = useParams()
  const id = Number(bookId)
  const index = Number(pageIndex)

  const [book, setBook] = useState<Book | undefined>()
  const [page, setPage] = useState<Page | undefined>()
  const [total, setTotal] = useState(0)
  const [bookmark, setBookmark] = useState<Bookmark | undefined>()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [b, p, n, bm] = await Promise.all([
        getBook(id),
        getPageAt(id, index),
        countPages(id),
        getBookmarkAt(id, index),
      ])
      if (cancelled) return
      setBook(b)
      setPage(p)
      setTotal(n)
      setBookmark(bm)
    })()
    return () => {
      cancelled = true
    }
  }, [id, index])

  async function toggleBookmark() {
    if (bookmark) {
      await deleteBookmark(bookmark.id)
      setBookmark(undefined)
    } else {
      const bmId = await addBookmark({ bookId: id, pageIndex: index, label: `第 ${index + 1} 頁` })
      setBookmark(await getBookmarkAt(id, index))
      void bmId
    }
  }

  if (!page) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-sm text-slate-500">
        <Link to={`/book/${id}`} className="text-slate-400 hover:text-slate-200">
          ← 返回
        </Link>
        <p className="mt-4">找不到此頁。</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <div className="flex items-center justify-between text-sm">
        <Link to={`/book/${id}`} className="text-slate-400 hover:text-slate-200">
          ← {book?.title ?? '書本'}
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleBookmark}
            className={`rounded px-3 py-1.5 ${
              bookmark
                ? 'bg-amber-500 text-slate-900'
                : 'border border-slate-600 text-slate-300 hover:bg-slate-800'
            }`}
          >
            {bookmark ? '★ 已書籤' : '☆ 加入書籤'}
          </button>
        </div>
      </div>

      <PageImage page={page} />

      <div className="flex items-center justify-between text-sm">
        {index > 0 ? (
          <Link to={`/book/${id}/page/${index - 1}`} className="text-sky-300 hover:underline">
            ← 上一頁
          </Link>
        ) : (
          <span />
        )}
        <span className="text-slate-500">
          {index + 1} / {total}
        </span>
        {index < total - 1 ? (
          <Link to={`/book/${id}/page/${index + 1}`} className="text-sky-300 hover:underline">
            下一頁 →
          </Link>
        ) : (
          <span />
        )}
      </div>

      {/* Japanese click-to-look-up (notes link back to this book/page) */}
      {book?.language === 'ja' && page.ocrRegions.length > 0 && (
        <div className="rounded-lg border border-slate-700 p-4">
          <JpLookup regions={page.ocrRegions} bookId={id} pageIndex={index} />
        </div>
      )}

      {/* English click-to-look-up (ECDICT); notes link back to this book/page */}
      {book?.language === 'en' && page.ocrRegions.length > 0 && (
        <div className="rounded-lg border border-slate-700 p-4">
          <EnLookup regions={page.ocrRegions} bookId={id} pageIndex={index} />
        </div>
      )}

      {/* Translation, if saved */}
      {page.translationPairs && page.translationPairs.length > 0 && (
        <div className="rounded-lg border border-slate-700 p-4">
          <h3 className="mb-2 text-sm font-medium text-slate-300">翻譯（繁體中文）</h3>
          <div className="divide-y divide-slate-800 overflow-hidden rounded border border-slate-700">
            {page.translationPairs.map((p, i) => (
              <div key={i} className="grid gap-2 p-3 md:grid-cols-2">
                <p className="text-sm text-slate-400">{p.source}</p>
                <p className="text-sm text-slate-100">{p.target}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PageImage({ page }: { page: Page }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const bmp = await createImageBitmap(page.imageBlob)
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = bmp.width
      canvas.height = bmp.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      ctx.lineWidth = Math.max(2, bmp.width / 400)
      ctx.strokeStyle = '#38bdf8'
      ctx.fillStyle = 'rgba(56,189,248,0.10)'
      for (const r of page.ocrRegions) {
        ctx.fillRect(r.box.x, r.box.y, r.box.w, r.box.h)
        ctx.strokeRect(r.box.x, r.box.y, r.box.w, r.box.h)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page])

  return <canvas ref={canvasRef} className="w-full rounded border border-slate-700" />
}
