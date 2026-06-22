/**
 * AC-20 — wb-skill ToolRegistry contract tests.
 *
 * Verifies that the vfx tool id migrates correctly:
 *   - skill:generate-vfx    registered (success path)
 *   - character:generate-vfx  NOT registered (failure path — not_found)
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

/** Minimal PluginSnapshot with skill:generate-vfx. */
function makeSkillSnapshot(): PluginSnapshot {
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
          pluginId: '@forgeax-plugin/wb-skill',
          layer: 'L0',
          toolId: 'skill:generate-vfx',
          exposedToAI: true,
          backendPath: null,
          requestedEnv: [],
          pluginDir: '/fake/wb-skill',
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
  _setSnapshotForTests(makeSkillSnapshot())
})

afterEach(() => {
  _resetSnapshotForTests()
  _resetToolHandlerCacheForTests()
  _resetConfirmsForTests()
  _resetEventBusForTests()
})

describe('wb-skill tool registry — success path', () => {
  it('skill:generate-vfx is registered in the ToolRegistry', () => {
    const tools = listTools()
    const entry = tools.find((t) => t.id === 'skill:generate-vfx')
    expect(entry).toBeDefined()
    expect(entry!.exposedToAI).toBe(true)
  })
})

describe('wb-skill tool registry — failure path (old character id removed)', () => {
  it('character:generate-vfx returns not_found code', async () => {
    const result = await callTool({
      toolId: 'character:generate-vfx',
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
