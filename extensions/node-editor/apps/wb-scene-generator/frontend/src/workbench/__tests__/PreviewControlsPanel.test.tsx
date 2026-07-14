// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { PreviewControlsPanel } from '../PreviewControlsPanel'
import type { BakedHistoryStatusDTO } from '../../renderer/bridge/bakedApi'

const history: BakedHistoryStatusDTO = {
  canUndo: true,
  canRedo: true,
  undoLabel: 'Paint /Layer',
  redoLabel: 'Erase /Layer',
  entries: [{
    id: 'h1',
    label: 'Paint /Layer',
    tool: 'paint',
    createdAt: '2026-06-04T00:00:00.000Z',
    summary: { paths: ['/Layer'], cellDelta: 1 },
  }],
}

function renderPanel(overrides?: Partial<Parameters<typeof PreviewControlsPanel>[0]>) {
  return render(
    <PreviewControlsPanel
      editMode
      editTool="paint"
      brushMode="free"
      showGrid={false}
      editZ={0}
      previewContext={{ editMode: true, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: true }}
      bakedHistory={history}
      selectedLayers={[]}
      onPickTool={vi.fn()}
      onPickBrush={vi.fn()}
      onToggleGrid={vi.fn()}
      onUpdateEditZ={vi.fn()}
      onUndoBakedEdit={vi.fn()}
      onRedoBakedEdit={vi.fn()}
      {...overrides}
    />,
  )
}

describe('PreviewControlsPanel', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => cleanup())

  it('routes baked history buttons through the panel handlers', () => {
    const onUndoBakedEdit = vi.fn()
    const onRedoBakedEdit = vi.fn()
    const { getByRole } = renderPanel({ onUndoBakedEdit, onRedoBakedEdit })

    fireEvent.click(getByRole('button', { name: 'Undo' }))
    fireEvent.click(getByRole('button', { name: 'Redo' }))

    expect(onUndoBakedEdit).toHaveBeenCalledTimes(1)
    expect(onRedoBakedEdit).toHaveBeenCalledTimes(1)
  })
})
