import { useRenderStore } from '../store'
import type { ViewMode, DrawMode } from '../types'

const MODES: ViewMode[] = ['top', 'topBillboard', 'iso', 'free3d']
const DRAWS: DrawMode[] = ['wire', 'color', 'asset']

export function ModeSwitcher(): JSX.Element {
  const { viewMode, drawMode, setViewMode, setDrawMode } = useRenderStore()
  return (
    <div style={{ display: 'flex', gap: 8, padding: 6 }}>
      {MODES.map((m) => (
        <button key={m} aria-pressed={viewMode === m} onClick={() => setViewMode(m)}>
          {m}
        </button>
      ))}
      <span style={{ width: 12 }} />
      {DRAWS.map((d) => (
        <button key={d} aria-pressed={drawMode === d} onClick={() => setDrawMode(d)}>
          {d}
        </button>
      ))}
    </div>
  )
}
