import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { GraphApp } from '../GraphApp'

vi.mock('../editor/bootstrap/GameBootstrap', () => ({
  GameBootstrap: ({ children }: { children: ReactNode }) => <div data-testid="bootstrap">{children}</div>,
}))
vi.mock('../editor/shell/BlueprintLibraryView', () => ({ BlueprintLibraryView: () => <div>blueprint</div> }))
vi.mock('../editor/shell/GraphVideoView', () => ({ GraphVideoView: () => <div>video</div> }))
vi.mock('../editor/shell/GraphAssetView', () => ({ GraphAssetView: () => <div>assets</div> }))
vi.mock('../editor/shell/GraphConfigView', () => ({ GraphConfigView: () => <div>config</div> }))
vi.mock('../editor/shell/GraphPlaySurface', () => ({ GraphPlaySurface: () => <div>play</div> }))
vi.mock('../editor/persist/graphScenarioStore', () => ({
  useGraphScenario: (selector: (state: { graph: { nodes: never[] }; ensureBoot: () => void }) => unknown) => selector({ graph: { nodes: [] }, ensureBoot: vi.fn() }),
}))
vi.mock('../editor/persist/graphViewStore', () => ({
  useGraphView: (selector: (state: { view: string; setView: () => void }) => unknown) => selector({ view: 'graph', setView: vi.fn() }),
  installGraphViewSync: () => vi.fn(),
}))
vi.mock('../editor/persist/gameScope', () => ({ getGameSlug: () => 'demo' }))
vi.mock('../styles/injectStyle', () => ({ injectStyleOnce: vi.fn() }))

afterEach(() => window.history.replaceState({}, '', '/'))

test('wraps only the center pane with bootstrap and leaves the left pane side-effect free', () => {
  window.history.replaceState({}, '', '/?pane=left')
  render(<GraphApp />)
  expect(screen.getByRole('complementary')).toBeTruthy()
  expect(screen.queryByTestId('bootstrap')).toBeNull()
  expect(screen.getByText('调试蓝图')).toBeTruthy()
  expect(screen.getByText('生成视频')).toBeTruthy()
  expect(screen.getByText('上传视频')).toBeTruthy()
  expect(screen.getByRole('button', { name: '新增 蓝图 子项' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '重命名 调试蓝图' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '删除 调试蓝图' })).toBeTruthy()
})

test('wraps the center pane with bootstrap before rendering the main surface', () => {
  window.history.replaceState({}, '', '/?pane=center')
  render(<GraphApp />)
  expect(screen.getByTestId('bootstrap')).toBeTruthy()
  expect(screen.getByText('blueprint')).toBeTruthy()
})
