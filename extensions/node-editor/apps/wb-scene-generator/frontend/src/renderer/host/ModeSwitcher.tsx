import { useRenderStore } from '../store'
import type { ViewMode, DrawMode } from '../types'

const MODES: ViewMode[] = ['top', 'topBillboard', 'iso', 'free3d', '3DMesh']
const DRAWS: DrawMode[] = ['wire', 'color', 'asset']

export function ModeSwitcher(): JSX.Element {
  // Selected individually — `useRenderStore()` with no selector subscribes to
  // the whole store and re-renders on every unrelated update (see RendererSurface.tsx).
  const viewMode = useRenderStore((s) => s.viewMode)
  const drawMode = useRenderStore((s) => s.drawMode)
  const setViewMode = useRenderStore((s) => s.setViewMode)
  const setDrawMode = useRenderStore((s) => s.setDrawMode)
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
