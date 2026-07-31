import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createViteWorkbenchPlugin } from '@forgeax/workbench-host/vite'
import { createDevWorkbenchHost } from './dev-host'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('development Vite adapter', () => {
  it('refuses to construct in production mode', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(() => createViteWorkbenchPlugin({} as never)).toThrow(
        'development-only',
      )
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })

  it('rejects a game directory symlink that escapes the local workspace', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'wb-game-video-dev-host-'))
    const gamesRoot = join(fixtureRoot, 'games')
    const outsideRoot = mkdtempSync(join(tmpdir(), 'wb-game-video-outside-'))
    temporaryRoots.push(fixtureRoot, outsideRoot)
    mkdirSync(gamesRoot)
    symlinkSync(outsideRoot, join(gamesRoot, 'escaped-game'), 'dir')

    const host = createDevWorkbenchHost({
      extensionRoot: resolve(import.meta.dirname, '..'),
      gamesRoot,
    })

    await expect(
      host.componentFile('escaped-game', 'panel.js'),
    ).rejects.toThrow('Game workspace was not found')
  })
})
