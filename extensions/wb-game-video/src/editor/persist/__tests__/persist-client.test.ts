import { afterEach, describe, expect, test, vi } from 'vitest'

const client = {
  gamePackage: {
    load: vi.fn(),
    save: vi.fn(),
  },
  versions: {
    supported: vi.fn(),
    create: vi.fn(),
    list: vi.fn(),
    current: vi.fn(),
    loadPackage: vi.fn(),
  },
}

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => client,
}))

afterEach(() => {
  client.gamePackage.load.mockReset()
  client.gamePackage.save.mockReset()
  client.versions.supported.mockReset()
  client.versions.create.mockReset()
  client.versions.list.mockReset()
  client.versions.current.mockReset()
  client.versions.loadPackage.mockReset()
  localStorage.clear()
})

describe('persist client', () => {
  test('loads the host-bound package without deriving a game URL', async () => {
    const project = {
      manifest: {
        mainPackId: 'main',
        packs: { main: { id: 'main', graph: { nodes: [], edges: [] } } },
      },
    }
    client.gamePackage.load.mockResolvedValue({ blueprint: project })
    const { loadStore } = await import('../persist-client')

    await expect(loadStore('query-game')).resolves.toMatchObject({ project })
    expect(client.gamePackage.load).toHaveBeenCalledWith()
  })

  test('propagates a host package load failure instead of treating it as an empty package', async () => {
    client.gamePackage.load.mockRejectedValue(new Error('temporary package read failure'))
    const { loadStore } = await import('../persist-client')

    await expect(loadStore('query-game')).rejects.toThrow('temporary package read failure')
  })

  test('rejects an initialized package whose blueprint is not a library document', async () => {
    client.gamePackage.load.mockResolvedValue({
      project: { id: 'nodia' },
      blueprint: null,
      assetsManifest: { version: 2, assets: [] },
    })
    const { loadStore } = await import('../persist-client')

    await expect(loadStore('query-game')).rejects.toThrow(
      'Host package blueprint is missing or invalid',
    )
  })

  test('saves the blueprint through the host-bound package client', async () => {
    const project = { scenario: {}, manifest: {} }
    client.gamePackage.save.mockResolvedValue({})
    const { saveProject } = await import('../persist-client')

    await expect(saveProject(project as never, 'query-game')).resolves.toEqual({ ok: true })
    expect(client.gamePackage.save).toHaveBeenCalledWith({ blueprint: project })
  })

  test.each(['猫', 'a'])('isolates drafts by the exact accepted game id %s', async (gameId) => {
    const acceptedDraft = { scenario: { accepted: gameId }, manifest: {} }
    const queryDraft = { scenario: { stale: true }, manifest: {} }
    window.history.replaceState({}, '', '/?slug=query-game&game=other-game')
    localStorage.setItem(`wb-game-video:graph:${gameId}:draft`, JSON.stringify(acceptedDraft))
    localStorage.setItem('wb-game-video:graph:query-game:draft', JSON.stringify(queryDraft))
    client.gamePackage.load.mockResolvedValue({
      blueprint: {
        manifest: {
          mainPackId: 'main',
          packs: { main: { id: 'main', graph: { nodes: [], edges: [] } } },
        },
      },
    })
    const { loadStore } = await import('../persist-client')

    await expect(loadStore(gameId)).resolves.toMatchObject({ draft: acceptedDraft })
  })

  test('rejects a missing accepted game id instead of falling back to shared draft storage', async () => {
    localStorage.setItem('wb-game-video:graph:default:draft', JSON.stringify({ stale: true }))
    const { loadStore } = await import('../persist-client')

    await expect(loadStore(undefined as never)).rejects.toThrow('Accepted game id is required')
  })

  test('delegates version operations to the handshake-bound capability', async () => {
    const project = { scenario: {}, manifest: {} }
    const version = {
      tag: 'v猫',
      commitHash: 'abc123',
      createdAt: '2026-07-30T00:00:00.000Z',
      message: 'checkpoint',
    }
    client.versions.supported.mockReturnValue(true)
    client.versions.create.mockResolvedValue(version)
    client.versions.current.mockResolvedValue({ tag: version.tag, commitHash: version.commitHash, dirty: false })
    client.versions.list.mockResolvedValue([version])
    client.versions.loadPackage.mockResolvedValue({ blueprint: project })
    const {
      commitVersion,
      currentVersion,
      listVersions,
      loadVersionProject,
    } = await import('../persist-client')

    await expect(commitVersion('猫', 'checkpoint')).resolves.toMatchObject({
      tag: 'v猫',
      commitHash: 'abc123',
    })
    await expect(currentVersion('猫')).resolves.toEqual({
      tag: 'v猫',
      commitHash: 'abc123',
      dirty: false,
    })
    await expect(listVersions('猫')).resolves.toEqual([version])
    await expect(loadVersionProject('猫', 'v猫')).resolves.toEqual(project)
    expect(client.versions.create).toHaveBeenCalledWith('checkpoint')
    expect(client.versions.current).toHaveBeenCalledWith()
    expect(client.versions.list).toHaveBeenCalledWith()
    expect(client.versions.loadPackage).toHaveBeenCalledWith('v猫')
  })

  test('uses stable version fallbacks when the host omits the capability', async () => {
    client.versions.supported.mockReturnValue(false)
    const {
      commitVersion,
      currentVersion,
      listVersions,
      loadVersionProject,
    } = await import('../persist-client')

    await expect(commitVersion('猫', 'checkpoint')).resolves.toBeNull()
    await expect(currentVersion('猫')).resolves.toEqual({ tag: null, commitHash: null, dirty: false })
    await expect(listVersions('猫')).resolves.toEqual([])
    await expect(loadVersionProject('猫', 'v1')).resolves.toBeNull()
    expect(client.versions.create).not.toHaveBeenCalled()
    expect(client.versions.current).not.toHaveBeenCalled()
    expect(client.versions.list).not.toHaveBeenCalled()
    expect(client.versions.loadPackage).not.toHaveBeenCalled()
  })
})
