import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { formatBytes } from '../lib/storage'
import { MODEL_ENTRIES, type ModelEntry } from '../lib/models/registry'
import { getMangaOcrModelId, setMangaOcrModel } from '../lib/ocr/recognizers'

export default function Settings() {
  const { capabilities, storage, preferredEngine, setPreferredEngine, backend } = useApp()

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-5">
      <div>
        <h2 className="text-xl font-semibold">設定 · 模型與離線</h2>
        <p className="mt-1 text-sm text-slate-400">兩層運算後端、分語言模型下載與離線管理。</p>
      </div>

      {/* Compute backend (two-layer + WASM fallback override) */}
      <section className="space-y-3 rounded-lg border border-slate-700 p-4">
        <h3 className="text-sm font-medium text-slate-200">運算後端</h3>
        <p className="text-xs text-slate-500">
          偵測到：{capabilities?.hasWebGPU ? 'WebGPU 可用' : '無 WebGPU（將用 WASM）'}；目前生效：
          <span className="text-slate-200"> {backend === 'webgpu' ? 'WebGPU' : 'WASM'}</span>
        </p>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              { v: 'auto', label: '自動' },
              { v: 'webgpu', label: '強制 WebGPU' },
              { v: 'wasm', label: '強制 WASM（退路）' },
            ] as const
          ).map((o) => {
            const disabled = o.v === 'webgpu' && !capabilities?.hasWebGPU
            return (
              <button
                key={o.v}
                disabled={disabled}
                onClick={() => setPreferredEngine(o.v)}
                className={`rounded px-3 py-1.5 ${
                  preferredEngine === o.v
                    ? 'bg-sky-500 text-slate-900'
                    : 'border border-slate-600 text-slate-300 enabled:hover:bg-slate-800'
                } disabled:opacity-40`}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Storage */}
      <section className="space-y-2 rounded-lg border border-slate-700 p-4">
        <h3 className="text-sm font-medium text-slate-200">儲存空間</h3>
        <p className="text-xs text-slate-500">
          永久儲存：
          <span className={storage?.persisted ? 'text-emerald-300' : 'text-amber-300'}>
            {storage?.persisted ? ' 已啟用' : ' 未啟用'}
          </span>
          {storage?.usage !== undefined && (
            <>
              {' '}
              · 已用 {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
            </>
          )}
        </p>
      </section>

      {/* Models */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-slate-200">模型 / 資料</h3>
        {capabilities?.connection.goodForLargeDownload === false && (
          <div className="rounded border border-amber-700 bg-amber-950/30 p-2 text-xs text-amber-200">
            目前網路可能計費 / 慢速（{capabilities.connection.effectiveType ?? '未知'}）。大型模型建議連
            WiFi 再下載。
          </div>
        )}
        <div className="space-y-2">
          {MODEL_ENTRIES.map((m) => (
            <ModelCard
              key={m.id}
              entry={m}
              backend={backend}
              warnLarge={m.large && capabilities?.connection.goodForLargeDownload === false}
            />
          ))}
        </div>
      </section>

      <AdvancedSection />
    </div>
  )
}

/** Advanced overrides — e.g. point manga-ocr at your own complete ONNX export. */
function AdvancedSection() {
  const [model, setModel] = useState(getMangaOcrModelId())
  const [saved, setSaved] = useState(false)

  function save() {
    setMangaOcrModel(model)
    setModel(getMangaOcrModelId())
    setSaved(true)
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-700 p-4">
      <h3 className="text-sm font-medium text-slate-200">進階</h3>
      <label className="block text-xs text-slate-400">
        日文辨識模型 (Hugging Face repo id)
        <p className="mt-0.5 text-slate-500">
          預設已指向一份完整的 manga-ocr ONNX。若要改用你自己轉好的版本
          （見 docs/convert-manga-ocr.md），在此貼上 repo id，例如{' '}
          <span className="text-slate-300">你的帳號/manga-ocr-base-ONNX</span>。留空則回復預設。
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={model}
            onChange={(e) => {
              setModel(e.target.value)
              setSaved(false)
            }}
            placeholder="username/manga-ocr-base-ONNX"
            className="flex-1 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200"
          />
          <button
            onClick={save}
            className="rounded bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-sky-400"
          >
            {saved ? '已儲存 ✓' : '儲存'}
          </button>
        </div>
      </label>
    </section>
  )
}

function ModelCard({
  entry,
  backend,
  warnLarge,
}: {
  entry: ModelEntry
  backend: 'webgpu' | 'wasm'
  warnLarge?: boolean
}) {
  const [cached, setCached] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [ratio, setRatio] = useState<number | undefined>(undefined)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setCached(await entry.isCached())
  }
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function download() {
    if (warnLarge && !confirm(`「${entry.label}」約 ${formatBytes(entry.approxBytes)}，目前非 WiFi，仍要下載？`))
      return
    setBusy(true)
    setError(null)
    setRatio(undefined)
    try {
      await entry.download(backend, (r, m) => {
        setRatio(r)
        setMsg(m)
      })
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setMsg('')
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await entry.remove()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-100">{entry.label}</span>
            <span className="rounded bg-slate-800 px-1.5 text-xs text-slate-400">{entry.scope}</span>
          </div>
          <span className="text-xs text-slate-500">
            約 {formatBytes(entry.approxBytes)} ·{' '}
            {cached === null ? '檢查中…' : cached ? <span className="text-emerald-300">已快取</span> : '未下載'}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          {cached ? (
            <button
              onClick={remove}
              disabled={busy}
              className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 enabled:hover:bg-slate-800 disabled:opacity-50"
            >
              清除
            </button>
          ) : (
            <button
              onClick={download}
              disabled={busy}
              className="rounded bg-sky-500 px-3 py-1.5 text-xs font-medium text-slate-900 enabled:hover:bg-sky-400 disabled:opacity-50"
            >
              {busy ? '下載中…' : '下載'}
            </button>
          )}
        </div>
      </div>

      {busy && (
        <div className="mt-2 space-y-1">
          <div className="h-1.5 overflow-hidden rounded bg-slate-800">
            <div
              className="h-full bg-sky-500 transition-all"
              style={{ width: ratio !== undefined ? `${Math.round(ratio * 100)}%` : '40%' }}
            />
          </div>
          {msg && <p className="text-xs text-slate-500">{msg}</p>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  )
}
