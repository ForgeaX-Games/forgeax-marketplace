import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { VersionPicker } from '../VersionPicker'

afterEach(cleanup)

describe('VersionPicker', () => {
  it('selects the loaded version and requests a different history entry', () => {
    const loadVersion = vi.fn(async () => undefined)
    useGraphScenario.setState({
      versioningSupported: true,
      currentTag: 'v1',
      gameVersions: [
        { tag: 'v2', commitHash: 'hash-2', createdAt: '2026-07-30T02:00:00.000Z', message: 'v2' },
        { tag: 'v1', commitHash: 'hash-1', createdAt: '2026-07-30T01:00:00.000Z', message: 'v1' },
      ],
      isDraft: false,
      loadVersion,
      refreshVersions: vi.fn(async () => undefined),
    })

    render(<VersionPicker />)
    const select = screen.getByTitle('载入某个历史版本到编辑器（不改历史；保存后新增一版）')
    expect(select).toHaveValue('v1')

    fireEvent.change(select, { target: { value: 'v2' } })
    expect(loadVersion).toHaveBeenCalledWith('v2')
  })

  it('stays hidden when the handshake omits the versions capability', () => {
    useGraphScenario.setState({
      versioningSupported: false,
      currentTag: null,
      gameVersions: [],
    })

    const { container } = render(<VersionPicker />)

    expect(container).toBeEmptyDOMElement()
  })
})
