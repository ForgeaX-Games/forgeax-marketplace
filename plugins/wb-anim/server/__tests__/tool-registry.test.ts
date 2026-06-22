/**
 * AC-20 — wb-anim ToolRegistry contract tests.
 *
 * Verifies that the two animation tool ids migrate correctly:
 *   - anim:generate-spine   registered (success path)
 *   - anim:generate-video   registered (success path)
 *   - character:generate-spine  NOT registered (failure path — not_found)
 *   - character:generate-video  NOT registered (failure path — not_found)
 *
 * Strategy: inject a hand-crafted PluginSnapshot via _setSnapshotForTests so
 * the test hits the real ToolRegistry dispatch logic without touching disk,
 * scanner, or any network. No mocking of ToolRegistry itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  _setSnapshotForTests,
  _resetSnapshotForTests,
  type PluginSnapshot,
} from '../../../../../server/src/plugins/registry'
import {
  callTool,
  listTools,
  _resetToolHandlerCacheForTests,
  _resetConfirmsForTests,
} from '../../../../../server/src/tools/registry'
import { _resetEventBusForTests } from '../../../../../server/src/events/bus'

/** Minimal PluginSnapshot with anim:generate-spine + anim:generate-video. */
function makeAnimSnapshot(): PluginSnapshot {
  return {
    generation: 1,
    loadedAt: Date.now(),
    manifests: [],
    scanErrors: [],
    mergeIssues: [],
    kinds: {
      workbench: [],
      agents: [],
      skills: [],
      cliProviders: [],
      modelBindings: [],
      issues: [],
      tools: [
        {
          pluginId: '@forgeax-plugin/wb-anim',
          layer: 'L0',
          toolId: 'anim:generate-spine',
          exposedToAI: true,
          backendPath: null,
          requestedEnv: [],
          pluginDir: '/fake/wb-anim',
        },
        {
          pluginId: '@forgeax-plugin/wb-anim',
          layer: 'L0',
          toolId: 'anim:generate-video',
          exposedToAI: true,
          backendPath: null,
          requestedEnv: [],
          pluginDir: '/fake/wb-anim',
        },
      ],
    },
  }
}

beforeEach(() => {
  _resetSnapshotForTests()
  _resetToolHandlerCacheForTests()
  _resetConfirmsForTests()
  _resetEventBusForTests()
  _setSnapshotForTests(makeAnimSnapshot())
})

afterEach(() => {
  _resetSnapshotForTests()
  _resetToolHandlerCacheForTests()
  _resetConfirmsForTests()
  _resetEventBusForTests()
})

describe('wb-anim tool registry — success path', () => {
  it('anim:generate-spine is registered in the ToolRegistry', () => {
    const tools = listTools()
    const entry = tools.find((t) => t.id === 'anim:generate-spine')
    expect(entry).toBeDefined()
    expect(entry!.exposedToAI).toBe(true)
  })

  it('anim:generate-video is registered in the ToolRegistry', () => {
    const tools = listTools()
    const entry = tools.find((t) => t.id === 'anim:generate-video')
    expect(entry).toBeDefined()
    expect(entry!.exposedToAI).toBe(true)
  })
})

describe('wb-anim tool registry — failure path (old character ids removed)', () => {
  it('character:generate-spine returns not_found code', async () => {
    const result = await callTool({
      toolId: 'character:generate-spine',
      args: {},
      caller: { kind: 'user' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBeTruthy()
      expect(result.code).toBe('not_found')
    }
  })

  it('character:generate-video returns not_found code', async () => {
    const result = await callTool({
      toolId: 'character:generate-video',
      args: {},
      caller: { kind: 'user' },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBeTruthy()
      expect(result.code).toBe('not_found')
    }
  })
})
