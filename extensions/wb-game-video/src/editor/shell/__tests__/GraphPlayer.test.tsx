import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { GameScenario } from '../../../runtime/schema/graph-schema'
import { GraphPlayer } from '../GraphPlayer'

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
