import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { GraphApp } from '../GraphApp'

const ensureBoot = vi.hoisted(() => vi.fn())

vi.mock('../editor/bootstrap/GameBootstrap', () => ({
  GameBootstrap: ({ children, onBoot }: { children: ReactNode; onBoot: (gameId: string) => void }) => (
    <div data-testid="bootstrap">
      <button type="button" onClick={() => onBoot('猫')}>accept handshake</button>
      {children}
    </div>
  ),
}))
vi.mock('../editor/shell/BlueprintLibraryView', () => ({ BlueprintLibraryView: () => <div>blueprint</div> }))
vi.mock('../editor/shell/GraphVideoView', () => ({ GraphVideoView: () => <div>video</div> }))
vi.mock('../editor/shell/GraphAssetView', () => ({ GraphAssetView: () => <div>assets</div> }))
vi.mock('../editor/shell/GraphConfigView', () => ({ GraphConfigView: () => <div>config</div> }))
vi.mock('../editor/shell/GraphPlaySurface', () => ({ GraphPlaySurface: () => <div>play</div> }))
vi.mock('../editor/persist/graphScenarioStore', () => ({
  useGraphScenario: (selector: (state: { graph: { nodes: never[] }; ensureBoot: typeof ensureBoot }) => unknown) => selector({ graph: { nodes: [] }, ensureBoot }),
}))
vi.mock('../editor/persist/graphViewStore', () => ({
  useGraphView: (selector: (state: { view: string; setView: () => void }) => unknown) => selector({ view: 'graph', setView: vi.fn() }),
  installGraphViewSync: () => vi.fn(),
}))
vi.mock('../styles/injectStyle', () => ({ injectStyleOnce: vi.fn() }))

afterEach(() => {
  ensureBoot.mockReset()
  window.history.replaceState({}, '', '/')
})

test('wraps only the center pane with bootstrap and leaves the left pane side-effect free', () => {
  window.history.replaceState({}, '', '/?pane=left')
  render(<GraphApp />)
  expect(screen.getByRole('complementary')).toBeTruthy()
  expect(screen.queryByTestId('bootstrap')).toBeNull()
})

test('wraps the center pane with bootstrap before rendering the main surface', () => {
  window.history.replaceState({}, '', '/?pane=center&slug=query-game&game=other-game')
  render(<GraphApp />)
  expect(screen.getByTestId('bootstrap')).toBeTruthy()
  expect(screen.getByText('blueprint')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'accept handshake' }))
  expect(ensureBoot).toHaveBeenCalledWith('猫', expect.any(Object))
})
