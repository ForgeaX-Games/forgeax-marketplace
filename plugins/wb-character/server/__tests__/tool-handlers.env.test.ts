/**
 * Gap #2 regression — wb-character handlers must obtain API keys via the
 * per-call `ctx.env` injected by ToolRegistry, not by reaching for the
 * global `process.env`. The registry filters env down to manifest
 * `requestedEnv`; bypassing it would defeat the sandbox / Bus permission
 * layer (see 15-IMPLEMENTATION-COVERAGE.md gap #2).
 *
 * Strategy: spy on the plugin-local `./character-forge` SSOT so we can observe
 * the ctx the dispatch layer forwards. We only need to confirm two things:
 *
 *   1. `ctx.env` reaches the forge handler verbatim (no merge with
 *      process.env, no overrides).
 *   2. `ctx.projectRoot` is derived from the registry-supplied `cwd`,
 *      not from `process.cwd()`.
 *
 * The actual generate-portrait pipeline is not exercised — only the
 * boundary contract between ToolRegistry's ctx and the forge HandlerCtx.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const listSpy = vi.fn()
const getSpy = vi.fn()

vi.mock('../character-forge', () => ({
  listCharacters: (ctx: unknown, slug: string) => {
    listSpy(ctx, slug)
    return { slug, items: [] }
  },
  getCharacter: (ctx: unknown, slug: string, charId: string) => {
    getSpy(ctx, slug, charId)
    return { slug, charId }
  },
  // Other exports aren't reached by these tests; stub as throw to catch drift.
  generatePortrait: () => { throw new Error('not exercised') },
  generateSpriteSheet: () => { throw new Error('not exercised') },
  renameCharacter: () => { throw new Error('not exercised') },
}))

import { tools } from '../tool-handlers'

describe('wb-character tool-handlers — gap #2 sandbox env routing', () => {
  beforeEach(() => {
    listSpy.mockClear()
    getSpy.mockClear()
  })

  it('forwards the registry-supplied env into the forge HandlerCtx', async () => {
    const fakeEnv = { GEMINI_API_KEY: 'forwarded-from-registry', UNRELATED: 'x' }
    await tools['character:list'](
      { slug: 'demo' },
      {
        caller: { kind: 'workbench', threadId: 't1' } as any,
        toolId: 'character:list',
        env: fakeEnv,
        cwd: '/plugin/install/dir',
      },
    )
    expect(listSpy).toHaveBeenCalledTimes(1)
    const ctx = listSpy.mock.calls[0][0] as { env: Record<string, string | undefined>; projectRoot: string }
    expect(ctx.env).toBe(fakeEnv)
    expect(ctx.env.GEMINI_API_KEY).toBe('forwarded-from-registry')
    expect(ctx.projectRoot).toBe('/plugin/install/dir')
  })

  it('does not leak process.env keys that were not in ctx.env', async () => {
    process.env.WB_CHARACTER_PROBE_KEY = 'should-not-leak'
    try {
      await tools['character:get'](
        { slug: 'demo', charId: 'c1' },
        {
          caller: { kind: 'ai', threadId: 't1' } as any,
          toolId: 'character:get',
          env: { GEMINI_API_KEY: 'only-this-key' },
          cwd: '/plugin/install/dir',
        },
      )
      const ctx = getSpy.mock.calls[0][0] as { env: Record<string, string | undefined> }
      expect(ctx.env.WB_CHARACTER_PROBE_KEY).toBeUndefined()
      expect(ctx.env.GEMINI_API_KEY).toBe('only-this-key')
      expect(Object.keys(ctx.env).sort()).toEqual(['GEMINI_API_KEY'])
    } finally {
      delete process.env.WB_CHARACTER_PROBE_KEY
    }
  })

  it('falls back to {} env and process.cwd when no ctx is supplied (test-only path)', async () => {
    await tools['character:list'](
      { slug: 'demo' },
      // simulate a caller that built its own ctx without env/cwd — registry
      // always passes both, so this branch only triggers in unit tests
      { caller: { kind: 'user', threadId: 't1' } as any, toolId: 'character:list' },
    )
    const ctx = listSpy.mock.calls[0][0] as { env: Record<string, string | undefined>; projectRoot: string }
    expect(ctx.env).toEqual({})
    expect(typeof ctx.projectRoot).toBe('string')
    expect(ctx.projectRoot.length).toBeGreaterThan(0)
  })
})
