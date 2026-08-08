import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { GameScenario } from '../../../runtime/schema/graph-schema'
import { GraphPlayer } from '../GraphPlayer'
import { useGraphScenario } from '../../persist/graphScenarioStore'

const hostClient = vi.hoisted(() => ({
  context: {
    gameId: 'test-game',
    endpoints: { gamePackage: 'https://host.test/__workbench__/v1/games/test-game/package' },
  },
  extension: {
    fetch: vi.fn(),
    url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\//, '')}`),
  },
  tool: { call: vi.fn() },
}))

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => hostClient,
  ExtensionResponseError: class ExtensionResponseError extends Error {
    constructor(readonly status: number, message: string) {
      super(message)
    }
  },
  readExtensionJson: vi.fn(),
}))

const SCENARIO: GameScenario = {
  version: 'wb-game-video.graph.v1',
  graph: {
    nodes: [{
      id: 'intro',
      type: 'perf',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [],
      data: {
        name: 'Intro',
        media: { kind: 'video', ref: 'stable-video-id' },
      },
    }],
    edges: [],
  },
}

describe('GraphPlayer missing video handling', () => {
  it('retries once before showing the stable id and clears it on loadedmetadata', () => {
    useGraphScenario.setState({ game: 'test-game' })
    const { container } = render(<GraphPlayer scenario={SCENARIO} />)
    const video = container.querySelector('video')
    expect(video).toBeTruthy()

    fireEvent.error(video!)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.error(video!)
    expect(screen.getByRole('status')).toHaveTextContent('stable-video-id')

    fireEvent.loadedMetadata(video!)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
