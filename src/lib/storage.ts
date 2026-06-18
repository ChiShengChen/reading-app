/** Persistent-storage helpers — protect large model caches from eviction. */

export interface StorageStatus {
  persisted: boolean
  /** Estimated bytes used / quota, when available. */
  usage?: number
  quota?: number
}

/**
 * Request persistent storage. Should be called early at startup (ideally after
 * a user gesture on some browsers). Idempotent.
 */
export async function requestPersistentStorage(): Promise<StorageStatus> {
  let persisted = false
  if (navigator.storage?.persisted) {
    persisted = await navigator.storage.persisted()
  }
  if (!persisted && navigator.storage?.persist) {
    persisted = await navigator.storage.persist()
  }

  let usage: number | undefined
  let quota: number | undefined
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate()
    usage = est.usage
    quota = est.quota
  }

  return { persisted, usage, quota }
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}
