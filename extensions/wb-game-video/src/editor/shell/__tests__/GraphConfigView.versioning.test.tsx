import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GameScenario } from '../../../runtime/schema/graph-schema'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { GraphConfigView } from '../GraphConfigView'

const SCENARIO: GameScenario = {
  version: 'wb-game-video.graph.v1',
  graph: { nodes: [], edges: [] },
}

afterEach(cleanup)

describe('GraphConfigView save capability', () => {
  it('saves without creating a version when the handshake omits versioning', () => {
    const save = vi.fn(() => 0)
    const commit = vi.fn(async () => null)
    useGraphScenario.setState({
      versioningSupported: false,
      graph: SCENARIO.graph,
      meta: {},
      isDraft: false,
      savedTip: '',
      save,
      commit,
    })

    render(
      <GraphConfigView
        tabs={[{ section: 'entities', label: '实体' }]}
        scenario={SCENARIO}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '💾 保存' }))

    expect(save).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '💾 保存' })).toHaveAttribute(
      'title',
      '保存当前内容',
    )
  })

  it('creates a version after saving when the handshake provides versioning', () => {
    const save = vi.fn(() => 0)
    const commit = vi.fn(async () => 'v1')
    useGraphScenario.setState({
      versioningSupported: true,
      graph: SCENARIO.graph,
      meta: {},
      isDraft: false,
      savedTip: '',
      save,
      commit,
    })

    render(
      <GraphConfigView
        tabs={[{ section: 'entities', label: '实体' }]}
        scenario={SCENARIO}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '💾 保存' }))

    expect(commit).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })
})
