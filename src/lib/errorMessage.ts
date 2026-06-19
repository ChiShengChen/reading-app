/** Robustly extract a human-readable message from any thrown value. */
export function errorMessage(err: unknown): string {
  if (err == null) return '未知錯誤（無錯誤訊息）'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message || err.name || String(err)
  if (typeof err === 'object') {
    const o = err as { message?: unknown; toString?: () => string }
    if (typeof o.message === 'string' && o.message) return o.message
    try {
      const s = o.toString?.()
      if (s && s !== '[object Object]') return s
      return JSON.stringify(err)
    } catch {
      return '未知錯誤物件'
    }
  }
  return String(err)
}
