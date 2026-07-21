import { afterEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { resolveSharedGamesRoot } from './runtime.js'

describe('resolveSharedGamesRoot', () => {
  const prev = {
    FORGEAX_PROJECT_ROOT: process.env.FORGEAX_PROJECT_ROOT,
    FORGEAX_HOST_PROJECT_ROOT: process.env.FORGEAX_HOST_PROJECT_ROOT,
    FORGEAX_GAMES_ROOT: process.env.FORGEAX_GAMES_ROOT,
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('maps workbench sandbox to host .forgeax/games', () => {
    delete process.env.FORGEAX_GAMES_ROOT
    delete process.env.FORGEAX_HOST_PROJECT_ROOT
    process.env.FORGEAX_PROJECT_ROOT = '/tmp/instance/.forgeax/workbench/wb-scene-generator'
    expect(resolveSharedGamesRoot()).toBe(resolve('/tmp/instance/.forgeax/games'))
  })

  it('prefers FORGEAX_HOST_PROJECT_ROOT', () => {
    delete process.env.FORGEAX_GAMES_ROOT
    process.env.FORGEAX_PROJECT_ROOT = '/tmp/instance/.forgeax/workbench/wb-scene-generator'
    process.env.FORGEAX_HOST_PROJECT_ROOT = '/tmp/host-root'
    expect(resolveSharedGamesRoot()).toBe(resolve('/tmp/host-root/.forgeax/games'))
  })

  it('uses FORGEAX_GAMES_ROOT when set', () => {
    process.env.FORGEAX_GAMES_ROOT = '/custom/games'
    expect(resolveSharedGamesRoot()).toBe(resolve('/custom/games'))
  })
})
