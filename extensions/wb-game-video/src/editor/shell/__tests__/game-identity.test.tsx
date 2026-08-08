import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphScenario } from '../../persist/graphScenarioStore'

const { assetLibraryCalls } = vi.hoisted(() => ({
  assetLibraryCalls: [] as unknown[][],
}))

vi.mock('../../assets/assetLibraryClient', () => ({
  createKinoAssetLibraryClient: () => ({}),
  useAssetLibrary: (...args: unknown[]) => {
    assetLibraryCalls.push(args)
    return { items: [], loading: false, error: null }
  },
}))
vi.mock('../../assets/AssetLibraryPanel', () => ({
  AssetLibraryPanel: () => <div data-testid="asset-library" />,
}))
vi.mock('../../../styles/injectStyle', () => ({ injectStyleOnce: vi.fn() }))

import { GraphAssetView } from '../GraphAssetView'

describe('editor game identity', () => {
  beforeEach(() => {
    assetLibraryCalls.length = 0
    useGraphScenario.setState({ game: 'handshake-game' })
  })

  it('passes the handshake game from the shared store to asset hooks', () => {
    render(<GraphAssetView />)
    expect(assetLibraryCalls[0]?.[0]).toBe('handshake-game')
  })
})
