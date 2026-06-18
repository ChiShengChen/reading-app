import { NavLink, Outlet } from 'react-router-dom'
import { useApp } from '../AppContext'
import { formatBytes } from '../lib/storage'

const tabs = [
  { to: '/', label: '書庫', end: true },
  { to: '/reader', label: '閱讀', end: false },
  { to: '/notebook', label: '筆記本', end: false },
  { to: '/settings', label: '設定', end: false },
]

export default function Layout() {
  const { capabilities, storage } = useApp()

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h1 className="text-lg font-semibold tracking-wide">書影閱讀器</h1>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Badge
            ok={capabilities?.hasWebGPU}
            label={capabilities ? (capabilities.hasWebGPU ? 'WebGPU' : 'WASM 後備') : '偵測中…'}
          />
          <Badge
            ok={storage?.persisted}
            label={storage?.persisted ? '永久儲存' : '一般儲存'}
          />
          {storage?.usage !== undefined && (
            <span className="hidden sm:inline">
              {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
            </span>
          )}
        </div>
      </header>

      <nav className="flex border-b border-slate-800">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `flex-1 py-3 text-center text-sm transition-colors ${
                isActive
                  ? 'border-b-2 border-sky-400 font-medium text-sky-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}

function Badge({ ok, label }: { ok?: boolean; label: string }) {
  const color =
    ok === undefined
      ? 'bg-slate-700 text-slate-300'
      : ok
        ? 'bg-emerald-500/20 text-emerald-300'
        : 'bg-amber-500/20 text-amber-300'
  return <span className={`rounded px-2 py-0.5 ${color}`}>{label}</span>
}
