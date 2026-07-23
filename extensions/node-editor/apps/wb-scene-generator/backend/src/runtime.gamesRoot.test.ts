import { afterEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { resolveSharedGamesRoot } from './runtime.js'

describe('resolveSharedGamesRoot', () => {
  const prev = process.env.FORGEAX_PROJECT_ROOT

  afterEach(() => {
    if (prev === undefined) delete process.env.FORGEAX_PROJECT_ROOT
    else process.env.FORGEAX_PROJECT_ROOT = prev
  })

  it('maps workbench sandbox to sibling .forgeax/games (no host env)', () => {
    process.env.FORGEAX_PROJECT_ROOT = '/tmp/instance/.forgeax/workbench/wb-scene-generator'
    expect(resolveSharedGamesRoot()).toBe(resolve('/tmp/instance/.forgeax/games'))
  })

  it('falls back under workspace when not in a workbench sandbox', () => {
    process.env.FORGEAX_PROJECT_ROOT = '/tmp/standalone-ws'
    expect(resolveSharedGamesRoot()).toBe(resolve('/tmp/standalone-ws/.forgeax/games'))
  })
})
