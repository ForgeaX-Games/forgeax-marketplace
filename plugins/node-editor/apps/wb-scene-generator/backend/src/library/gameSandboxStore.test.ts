import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const broadcast = vi.fn()

vi.mock('../routes/ws.js', () => ({
  broadcastToClients: (...args: unknown[]) => broadcast(...args),
}))

vi.mock('../runtime.js', () => ({
  getActiveProjectDir: async () => join(tmpdir(), 'game-sandbox-test-project'),
}))

describe('gameSandboxStore watcher', () => {
  let sandboxDir: string

  beforeEach(async () => {
    broadcast.mockClear()
    vi.resetModules()
    sandboxDir = join(tmpdir(), `game-sandbox-watcher-${Date.now()}`)
    mkdirSync(join(sandboxDir, 'blobs'), { recursive: true })
    writeFileSync(join(sandboxDir, 'index.json'), '[]', 'utf-8')
  })

  afterEach(async () => {
    const mod = await import('./gameSandboxStore.js')
    mod._resetGameSandboxWatcherForTests()
    rmSync(sandboxDir, { recursive: true, force: true })
  })

  it('broadcasts library:changed when index.json is updated after bind', async () => {
    const mod = await import('./gameSandboxStore.js')
    await mod.setGameTexturesDir(sandboxDir)

    writeFileSync(
      join(sandboxDir, 'index.json'),
      JSON.stringify([{ assetName: 'grass', assetType: 'tile', sha256: 'abc', file: 'blobs/abc.png', mimeType: 'image/png', sizeBytes: 1 }]),
      'utf-8',
    )

    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ event: 'library:changed' }))
    }, { timeout: 1000 })
  })

  it('still broadcasts when bound BEFORE the sandbox dir exists (2D publishToGame creates it later)', async () => {
    // Real-world order: scene:library.useGameTextures binds the path before the
    // 2D app's first publishToGame creates the textures dir. Previously watch()
    // threw ENOENT and was swallowed → no live refresh ever.
    const lateDir = join(tmpdir(), `game-sandbox-late-${Date.now()}`)
    rmSync(lateDir, { recursive: true, force: true })

    const mod = await import('./gameSandboxStore.js')
    await mod.setGameTexturesDir(lateDir) // dir does not exist yet

    // Simulate the 2D publish landing an index.json into the (now-created) dir.
    mkdirSync(join(lateDir, 'blobs'), { recursive: true })
    writeFileSync(
      join(lateDir, 'index.json'),
      JSON.stringify([{ assetName: 'sand', assetType: 'tile', sha256: 'def', file: 'blobs/def.png', mimeType: 'image/png', sizeBytes: 1 }]),
      'utf-8',
    )

    await vi.waitFor(() => {
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ event: 'library:changed' }))
    }, { timeout: 3000 }) // covers the 1.5s mtime-poll fallback if fs.watch misses

    mod._resetGameSandboxWatcherForTests()
    rmSync(lateDir, { recursive: true, force: true })
  })
})
