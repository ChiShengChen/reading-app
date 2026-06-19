import { useEffect, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import CropTool from '../components/CropTool'
import { blobToBitmap, bitmapToCanvas, cropCanvas, type CropRect } from '../lib/image/preprocess'
import { runOcr } from '../lib/ocr/pipeline'
import { getDetModelSpec, isModelCached } from '../lib/ocr/modelManager'
import { isMangaOcrCached } from '../lib/ocr/recognizers'
import type { OcrLanguage, PipelineProgress, PipelineResult } from '../lib/ocr/types'
import { translateSentences, hasTranslatorApi } from '../lib/translate'
import type {
  EnginePreference,
  TranslateProgress,
  TranslateResult,
} from '../lib/translate'
import { Link } from 'react-router-dom'
import JpLookup from '../components/JpLookup'
import EnLookup from '../components/EnLookup'
import { addNote, createBook, addPage, listBooks, type Book } from '../db/db'
import { canvasToBlob, makeThumbnail } from '../lib/image/preprocess'

type Step = 'pick' | 'crop' | 'running' | 'result'

export default function Reader() {
  const { capabilities, backend } = useApp()
  const [step, setStep] = useState<Step>('pick')
  const [lang, setLang] = useState<OcrLanguage>('en')
  const [source, setSource] = useState<HTMLCanvasElement | null>(null)
  const [progress, setProgress] = useState<PipelineProgress | null>(null)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detCached, setDetCached] = useState(false)
  const [jaCached, setJaCached] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void isModelCached(getDetModelSpec()).then(setDetCached)
    void isMangaOcrCached().then(setJaCached)
  }, [step])

  // Warn before a large JP model download on a metered / unknown connection.
  const showJaDownloadWarning =
    lang === 'ja' && !jaCached && capabilities?.connection.goodForLargeDownload === false

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setResult(null)
    try {
      const bmp = await blobToBitmap(file)
      setSource(bitmapToCanvas(bmp))
      setStep('crop')
    } catch (err) {
      setError(`無法讀取影像：${(err as Error).message}`)
    }
  }

  async function onConfirmCrop(rect: CropRect) {
    if (!source || !capabilities) return
    setStep('running')
    setProgress({ stage: 'preprocess' })
    setError(null)
    try {
      const cropped = cropCanvas(source, rect)
      const res = await runOcr(cropped, lang, backend, setProgress)
      setResult(res)
      setStep('result')
    } catch (err) {
      setError(`OCR 失敗：${(err as Error).message}`)
      setStep('crop')
    }
  }

  function reset() {
    setSource(null)
    setResult(null)
    setProgress(null)
    setError(null)
    setStep('pick')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5">
      <div>
        <h2 className="text-xl font-semibold">閱讀 · 拍照辨識</h2>
        <p className="mt-1 text-sm text-slate-400">
          拍照／上傳 → 框選 → 偵測（PaddleOCR）＋ 辨識（英文 Tesseract／日文 manga-ocr）→
          切句 → 翻譯（Opus-MT／Translator API）。後端：
          <span className="text-slate-200">
            {capabilities ? (backend === 'webgpu' ? ' WebGPU' : ' WASM') : ' 偵測中'}
          </span>
          ；偵測模型：
          <span className={detCached ? 'text-emerald-300' : 'text-amber-300'}>
            {detCached ? '已快取' : '首次 ~4.7MB'}
          </span>
        </p>
      </div>

      {/* Language selector — picks the recognizer (en=Tesseract, ja=manga-ocr). */}
      {(step === 'pick' || step === 'crop') && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">辨識語言</span>
          <div className="inline-flex overflow-hidden rounded border border-slate-600">
            {(['en', 'ja'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-3 py-1.5 ${
                  lang === l ? 'bg-sky-500 text-slate-900' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {l === 'en' ? '英文' : '日文'}
              </button>
            ))}
          </div>
          {lang === 'ja' && (
            <span className={jaCached ? 'text-emerald-300' : 'text-amber-300'}>
              {jaCached ? 'manga-ocr 已快取' : 'manga-ocr 首次 ~440MB'}
            </span>
          )}
        </div>
      )}

      {showJaDownloadWarning && (
        <div className="rounded border border-amber-700 bg-amber-950/30 p-3 text-xs text-amber-200">
          偵測到目前可能是計費 / 慢速網路（{capabilities?.connection.effectiveType ?? '未知'}）。日文模型約
          440MB，建議連上 WiFi 再開始辨識，以免耗用行動數據。
        </div>
      )}

      {error && (
        <div className="rounded border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {step === 'pick' && (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-600 p-12 text-center hover:border-sky-500">
          <span className="text-3xl">📷</span>
          <span className="font-medium text-slate-200">拍照或選擇書頁圖片</span>
          <span className="text-xs text-slate-500">Android 可直接開相機；桌機可選檔案</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPick}
          />
        </label>
      )}

      {step === 'crop' && source && (
        <div className="space-y-3">
          <CropTool source={source} onConfirm={onConfirmCrop} />
          <button onClick={reset} className="text-sm text-slate-400 hover:text-slate-200">
            ← 換一張
          </button>
        </div>
      )}

      {step === 'running' && (
        <ProgressView progress={progress} />
      )}

      {step === 'result' && result && (
        <ResultView result={result} onReset={reset} />
      )}
    </div>
  )
}

const STAGE_LABEL: Record<string, string> = {
  idle: '待機',
  preprocess: '影像前處理',
  'loading-detector': '載入偵測模型',
  detecting: '偵測文字區域',
  'loading-recognizer': '載入辨識引擎',
  recognizing: '辨識文字',
  done: '完成',
  error: '錯誤',
}

function ProgressView({ progress }: { progress: PipelineProgress | null }) {
  const pct = progress?.ratio !== undefined ? Math.round(progress.ratio * 100) : null
  return (
    <div className="space-y-3 rounded-lg border border-slate-700 p-6">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-200">
          {STAGE_LABEL[progress?.stage ?? 'idle'] ?? progress?.stage}
        </span>
        {pct !== null && <span className="text-slate-400">{pct}%</span>}
      </div>
      <div className="h-2 overflow-hidden rounded bg-slate-800">
        <div
          className="h-full bg-sky-500 transition-all"
          style={{ width: pct !== null ? `${pct}%` : '40%' }}
        />
      </div>
      {progress?.message && <p className="text-xs text-slate-500">{progress.message}</p>}
    </div>
  )
}

function ResultView({ result, onReset }: { result: PipelineResult; onReset: () => void }) {
  const { backend } = useApp()
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const apiAvailable = hasTranslatorApi()

  const [enginePref, setEnginePref] = useState<EnginePreference>(apiAvailable ? 'auto' : 'opus-mt')
  const [translating, setTranslating] = useState(false)
  const [transProgress, setTransProgress] = useState<TranslateProgress | null>(null)
  const [trans, setTrans] = useState<TranslateResult | null>(null)
  const [transError, setTransError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    const { processed, regions } = result
    canvas.width = processed.width
    canvas.height = processed.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(processed, 0, 0)
    ctx.lineWidth = Math.max(2, processed.width / 400)
    ctx.font = `${Math.max(14, processed.width / 60)}px system-ui`
    regions.forEach((r, i) => {
      ctx.strokeStyle = '#38bdf8'
      ctx.fillStyle = 'rgba(56,189,248,0.12)'
      ctx.fillRect(r.box.x, r.box.y, r.box.w, r.box.h)
      ctx.strokeRect(r.box.x, r.box.y, r.box.w, r.box.h)
      ctx.fillStyle = '#38bdf8'
      ctx.fillText(String(i + 1), r.box.x + 2, r.box.y + Math.max(14, processed.width / 55))
    })
  }, [result])

  async function onTranslate() {
    if (result.sentences.length === 0) return
    setTranslating(true)
    setTransError(null)
    setTrans(null)
    try {
      const r = await translateSentences(
        result.sentences,
        result.lang,
        enginePref,
        backend,
        setTransProgress,
      )
      setTrans(r)
    } catch (err) {
      setTransError((err as Error).message)
    } finally {
      setTranslating(false)
    }
  }

  return (
    <div className="space-y-4">
      {result.usedFullPageFallback && (
        <div className="rounded border border-amber-700 bg-amber-950/30 p-3 text-xs text-amber-200">
          偵測模型未啟用或未找到區域，已改用「整頁辨識」後備流程（僅英文、僅供端到端驗證）。
          設定正確的偵測模型 URL 後即會走兩階段流程。
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-300">
            偵測區域（{result.regions.length}）
          </h3>
          <canvas ref={overlayRef} className="w-full rounded border border-slate-700" />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-300">
            取出文字 · {result.lang === 'ja' ? '日文' : '英文'} · 共 {result.sentences.length} 句
          </h3>
          <div className="max-h-[420px] space-y-2 overflow-auto">
            {result.regions.length === 0 && (
              <p className="text-sm text-slate-500">沒有取得任何文字。</p>
            )}
            {result.regions.map((r, i) => (
              <div key={i} className="rounded border border-slate-700 bg-slate-900/60 p-2">
                <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                  <span className="rounded bg-slate-700 px-1.5 text-slate-200">{i + 1}</span>
                  <span>偵測 {(r.detScore * 100).toFixed(0)}%</span>
                  <span>辨識 {(r.recScore * 100).toFixed(0)}%</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-slate-100">{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Click-to-look-up + notebook (Phase 4) */}
      {result.regions.length > 0 && (
        <div className="rounded-lg border border-slate-700 p-4">
          {result.lang === 'ja' ? (
            <JpLookup regions={result.regions} />
          ) : (
            <EnLookup regions={result.regions} />
          )}
        </div>
      )}

      {/* Translation (Phase 3) */}
      <div className="space-y-3 rounded-lg border border-slate-700 p-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium text-slate-200">翻譯（→ 繁體中文）</span>
          <label className="flex items-center gap-1 text-slate-400">
            引擎
            <select
              value={enginePref}
              onChange={(e) => setEnginePref(e.target.value as EnginePreference)}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
            >
              <option value="auto">自動{apiAvailable ? '（優先瀏覽器）' : '（Opus-MT）'}</option>
              <option value="opus-mt">Opus-MT（本地）</option>
              {apiAvailable && <option value="translator-api">瀏覽器 Translator API</option>}
            </select>
          </label>
          <button
            onClick={onTranslate}
            disabled={translating || result.sentences.length === 0}
            className="rounded bg-violet-500 px-3 py-1.5 font-medium text-slate-900 enabled:hover:bg-violet-400 disabled:opacity-50"
          >
            {translating ? '翻譯中…' : trans ? '重新翻譯' : '翻譯全部句子'}
          </button>
          {!apiAvailable && (
            <span className="text-xs text-slate-500">此瀏覽器無 Translator API，使用本地 Opus-MT</span>
          )}
        </div>

        {translating && transProgress && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-violet-500 transition-all"
                style={{
                  width:
                    transProgress.ratio !== undefined
                      ? `${Math.round(transProgress.ratio * 100)}%`
                      : '40%',
                }}
              />
            </div>
            <p className="text-xs text-slate-500">
              {transProgress.engine} · {transProgress.message}
            </p>
          </div>
        )}

        {transError && (
          <div className="rounded border border-rose-700 bg-rose-950/40 p-2 text-xs text-rose-200">
            {transError}
          </div>
        )}

        {trans && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-200">
                {trans.engine === 'translator-api' ? '瀏覽器 Translator API' : 'Opus-MT'}
              </span>
              {trans.convertedFromSimplified && (
                <span className="text-slate-500">已由 OpenCC 簡→繁（zh-Hant）</span>
              )}
            </div>
            <div className="divide-y divide-slate-800 overflow-hidden rounded border border-slate-700">
              {trans.pairs.map((p, i) => (
                <SentencePair key={i} source={p.source} target={p.target} lang={result.lang} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Save to library (persistence) */}
      {result.regions.length > 0 && <SaveToLibrary result={result} trans={trans} />}

      <div className="flex gap-2">
        <button
          onClick={onReset}
          className="rounded bg-sky-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-sky-400"
        >
          辨識下一張
        </button>
        <button
          onClick={() => navigator.clipboard?.writeText(result.fullText)}
          className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          複製全部文字
        </button>
      </div>
    </div>
  )
}

/** A source/translation row with a "save sentence to notebook" action. */
function SentencePair({
  source,
  target,
  lang,
}: {
  source: string
  target: string
  lang: 'en' | 'ja'
}) {
  const [saved, setSaved] = useState(false)
  async function save() {
    await addNote({
      sourceType: 'sentence',
      term: source,
      definition: target,
      contextSentence: source,
      tags: [lang],
    })
    setSaved(true)
  }
  return (
    <div className="grid gap-2 p-3 md:grid-cols-[1fr_1fr_auto]">
      <p className="text-sm text-slate-400">{source}</p>
      <p className="text-sm text-slate-100">{target}</p>
      <button
        onClick={save}
        disabled={saved}
        title="存入筆記本"
        className="self-start rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 enabled:hover:bg-slate-800 disabled:opacity-50"
      >
        {saved ? '已存 ✓' : '＋筆記'}
      </button>
    </div>
  )
}

/** Persist the recognized (and optionally translated) page into a book. */
function SaveToLibrary({ result, trans }: { result: PipelineResult; trans: TranslateResult | null }) {
  const [books, setBooks] = useState<Book[]>([])
  const [target, setTarget] = useState<string>('new') // 'new' | book id
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedBookId, setSavedBookId] = useState<number | null>(null)

  useEffect(() => {
    void listBooks().then((b) => {
      setBooks(b)
      // Default to an existing same-language book if present.
      const match = b.find((x) => x.language === result.lang)
      if (match) setTarget(String(match.id))
    })
  }, [result.lang])

  async function save() {
    setSaving(true)
    try {
      const imageBlob = await canvasToBlob(result.processed, 'image/jpeg')
      let bookId: number
      if (target === 'new') {
        const cover = await makeThumbnail(result.processed)
        bookId = await createBook(title.trim() || '未命名書籍', result.lang, cover)
      } else {
        bookId = Number(target)
      }
      const ocrRegions = result.regions.map((r) => ({
        box: r.box,
        text: r.text,
        confidence: r.recScore,
      }))
      await addPage({
        bookId,
        imageBlob,
        ocrRegions,
        fullText: result.fullText,
        translation: trans ? trans.pairs.map((p) => p.target).join('\n') : undefined,
        translationPairs: trans ? trans.pairs : undefined,
      })
      setSavedBookId(bookId)
    } finally {
      setSaving(false)
    }
  }

  if (savedBookId !== null) {
    return (
      <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">
        已存入書庫。
        <Link to={`/book/${savedBookId}`} className="ml-2 underline">
          前往書本
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 p-3 text-sm">
      <span className="font-medium text-slate-200">存入書庫</span>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
      >
        <option value="new">＋ 新書</option>
        {books.map((b) => (
          <option key={b.id} value={b.id}>
            {b.title}（{b.language === 'ja' ? '日' : '英'}）
          </option>
        ))}
      </select>
      {target === 'new' && (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`書名（${result.lang === 'ja' ? '日文' : '英文'}）`}
          className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
        />
      )}
      <button
        onClick={save}
        disabled={saving}
        className="rounded bg-emerald-500 px-3 py-1.5 font-medium text-slate-900 enabled:hover:bg-emerald-400 disabled:opacity-50"
      >
        {saving ? '儲存中…' : '存為一頁'}
      </button>
    </div>
  )
}
