import { useCallback, useEffect, useRef, useState } from 'react'
import type { CropRect } from '../lib/image/preprocess'

interface Props {
  /** Source image already drawn onto a canvas (natural-pixel resolution). */
  source: HTMLCanvasElement
  onConfirm: (rect: CropRect) => void
}

interface DragState {
  startX: number
  startY: number
  curX: number
  curY: number
}

/**
 * Manual adjustable crop. Drag to select a region in display space; we map it
 * back to natural pixels. Tight crops drive recognition quality (Critical
 * Rule #3), so the user can refine before running OCR. Default = whole image.
 */
export default function CropTool({ source, onConfirm }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [sel, setSel] = useState<CropRect | null>(null)
  const [displayScale, setDisplayScale] = useState(1)

  // Render the source into the visible canvas, scaled to fit container width.
  useEffect(() => {
    const canvas = imgRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const maxW = wrap.clientWidth || source.width
    const scale = Math.min(1, maxW / source.width)
    canvas.width = source.width
    canvas.height = source.height
    canvas.style.width = `${source.width * scale}px`
    canvas.style.height = `${source.height * scale}px`
    canvas.getContext('2d')!.drawImage(source, 0, 0)
    setDisplayScale(scale)
    setSel(null)
  }, [source])

  const toNatural = useCallback(
    (clientX: number, clientY: number) => {
      const rect = imgRef.current!.getBoundingClientRect()
      const x = (clientX - rect.left) / displayScale
      const y = (clientY - rect.top) / displayScale
      return {
        x: Math.max(0, Math.min(source.width, x)),
        y: Math.max(0, Math.min(source.height, y)),
      }
    },
    [displayScale, source.width, source.height],
  )

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toNatural(e.clientX, e.clientY)
    setDrag({ startX: p.x, startY: p.y, curX: p.x, curY: p.y })
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = toNatural(e.clientX, e.clientY)
    setDrag({ ...drag, curX: p.x, curY: p.y })
  }
  const onPointerUp = () => {
    if (!drag) return
    const x = Math.min(drag.startX, drag.curX)
    const y = Math.min(drag.startY, drag.curY)
    const w = Math.abs(drag.curX - drag.startX)
    const h = Math.abs(drag.curY - drag.startY)
    setDrag(null)
    setSel(w > 8 && h > 8 ? { x, y, w, h } : null)
  }

  const live = drag
    ? {
        x: Math.min(drag.startX, drag.curX),
        y: Math.min(drag.startY, drag.curY),
        w: Math.abs(drag.curX - drag.startX),
        h: Math.abs(drag.curY - drag.startY),
      }
    : sel

  return (
    <div className="space-y-3">
      <div ref={wrapRef} className="relative inline-block max-w-full touch-none select-none">
        <canvas
          ref={imgRef}
          className="block cursor-crosshair rounded border border-slate-700"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {live && live.w > 0 && (
          <div
            className="pointer-events-none absolute border-2 border-sky-400 bg-sky-400/10"
            style={{
              left: live.x * displayScale,
              top: live.y * displayScale,
              width: live.w * displayScale,
              height: live.h * displayScale,
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          className="rounded bg-sky-500 px-3 py-1.5 font-medium text-slate-900 hover:bg-sky-400"
          onClick={() =>
            onConfirm(sel ?? { x: 0, y: 0, w: source.width, h: source.height })
          }
        >
          {sel ? '裁切並辨識' : '辨識整張'}
        </button>
        {sel && (
          <button
            className="rounded border border-slate-600 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
            onClick={() => setSel(null)}
          >
            清除選取
          </button>
        )}
        <span className="text-slate-500">
          {sel
            ? `選取 ${Math.round(sel.w)}×${Math.round(sel.h)} px`
            : '拖曳框選文字區域，或直接辨識整張'}
        </span>
      </div>
    </div>
  )
}
