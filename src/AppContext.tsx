import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { detectCapabilities, type Capabilities, type ComputeBackend } from './lib/capabilities'
import { requestPersistentStorage, type StorageStatus } from './lib/storage'
import { getSettings, db, type Settings } from './db/db'

type EnginePref = Settings['preferredEngine']

interface AppState {
  capabilities: Capabilities | null
  storage: StorageStatus | null
  ready: boolean
  /** User preference: auto / force webgpu / force wasm. */
  preferredEngine: EnginePref
  setPreferredEngine: (e: EnginePref) => void
  /** Effective backend after applying preference to detected capabilities. */
  backend: ComputeBackend
}

const AppContext = createContext<AppState>({
  capabilities: null,
  storage: null,
  ready: false,
  preferredEngine: 'auto',
  setPreferredEngine: () => {},
  backend: 'wasm',
})

function resolveBackend(pref: EnginePref, caps: Capabilities | null): ComputeBackend {
  if (!caps) return 'wasm'
  if (pref === 'wasm') return 'wasm' // explicit WASM fallback
  if (pref === 'webgpu') return caps.hasWebGPU ? 'webgpu' : 'wasm'
  return caps.backend // auto
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [storage, setStorage] = useState<StorageStatus | null>(null)
  const [preferredEngine, setPreferredEngineState] = useState<EnginePref>('auto')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [caps, store, settings] = await Promise.all([
        detectCapabilities(),
        requestPersistentStorage(),
        getSettings(),
      ])
      if (cancelled) return
      setCapabilities(caps)
      setStorage(store)
      setPreferredEngineState(settings.preferredEngine)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function setPreferredEngine(e: EnginePref) {
    setPreferredEngineState(e)
    void db.settings.update('app', { preferredEngine: e })
  }

  return (
    <AppContext.Provider
      value={{
        capabilities,
        storage,
        ready,
        preferredEngine,
        setPreferredEngine,
        backend: resolveBackend(preferredEngine, capabilities),
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp(): AppState {
  return useContext(AppContext)
}
