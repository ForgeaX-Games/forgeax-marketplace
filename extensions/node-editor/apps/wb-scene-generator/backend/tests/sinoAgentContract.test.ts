import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import tools from '../src/tool-handlers.js'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const extensionsRoot = resolve(pluginRoot, '..', '..', '..')
const agentRoot = resolve(extensionsRoot, 'agent-sino')

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('Sino Scene Script contract', () => {
  const agentManifest = readJson(resolve(agentRoot, 'forgeax-extension.json'))
  const pluginManifest = readJson(resolve(pluginRoot, 'forgeax-plugin.json'))
  const agent = agentManifest.provides.agent as Record<string, any>
  const contributedTools = new Map<string, Record<string, any>>(
    pluginManifest.contributes.tools.map((tool: Record<string, any>) => [tool.id, tool]),
  )

  it('strongly binds the Scene Generator page to the independent Sino agent', () => {
    const page = pluginManifest.contributes.pages.find(
      (candidate: Record<string, any>) => candidate.id === 'wb-scene-generator',
    )
    expect(page.preferredAgent).toBe('@forgeax-extension/agent-sino')
    expect(agentManifest.version).toBe('0.2.0')
    expect(agent.card.cnTitle).toBe('场景设计师')
    expect(agent.card.enTitle).toBe('Scene Designer')
    expect(agent.multiInstance).toBe(false)
  })

  it('loads only the canonical Scene Script composition skill', () => {
    expect(agent.defaultSkills).toEqual([{
      source: 'plugin',
      pluginId: '@forgeax-extension/wb-scene-generator',
      skillId: 'compose-scene-script',
    }])
    const skillIds = pluginManifest.contributes.skills.map((skill: Record<string, any>) => skill.id)
    expect(skillIds).toContain('compose-scene-script')
    expect(skillIds).not.toContain('compose-sino-scene')
    expect(skillIds).not.toContain('design-scene-brief')
    expect(skillIds).not.toContain('review-scene')
  })

  it('uses a static high-level tool allowlist with visual evidence', () => {
    expect(agent.tools).not.toContain('scene:*')
    expect(agent.tools).toEqual(expect.arrayContaining([
      'scene:script.contracts',
      'scene:script.get',
      'scene:script.validate',
      'scene:script.put',
      'scene:agent.resumeSceneWork',
      'scene:agent.locateSceneTarget',
      'scene:agent.openEditLens',
      'scene:agent.proposeSceneEdit',
      'scene:agent.applySceneEdit',
      'scene:agent.previewSemanticDiff',
      'scene:agent.verifySceneEdit',
      'scene:agent.acceptOrRevertSceneEdit',
      'scene:pipeline.execute',
      'scene:screenshot.capture',
      'scene:screenshot.latest',
    ]))
    for (const toolId of agent.tools as string[]) {
      expect(contributedTools.has(toolId), `${toolId} must be declared by the plugin`).toBe(true)
      expect(tools, `${toolId} must have a backend handler`).toHaveProperty(toolId)
    }
    const exposedTools = [...contributedTools.values()]
      .filter((tool) => tool.exposedToAI)
      .map((tool) => tool.id)
      .sort()
    expect(exposedTools).toEqual([...(agent.tools as string[])].sort())
  })

  it('declares an optional Layout checkpoint payload for transaction lifecycle tools', () => {
    for (const toolId of [
      'scene:agent.applySceneEdit',
      'scene:agent.verifySceneEdit',
      'scene:agent.acceptOrRevertSceneEdit',
    ]) {
      expect(contributedTools.get(toolId)?.args.properties.layout).toEqual(expect.objectContaining({
        type: 'object',
        additionalProperties: true,
      }))
    }
  })

  it('keeps lower-level and external asset bridges outside the AI surface', () => {
    for (const toolId of [
      'scene:authoring.lens',
      'scene:authoring.applyCommands',
      'scene:batteries.list',
      'scene:batteries.get',
      'scene:pipeline.get',
      'scene:pipeline.export',
      'scene:library.useGameTextures',
      'scene:library.publishExternal',
    ]) {
      expect(contributedTools.get(toolId)?.exposedToAI, toolId).toBe(false)
      expect(agent.tools).not.toContain(toolId)
    }
  })

  it('contains no legacy graph-composition or external-agent prompt instructions', () => {
    const prompt = [
      read(resolve(agentRoot, 'persona', 'zh.md')),
      read(resolve(agentRoot, 'persona', 'en.md')),
      read(resolve(agentRoot, 'memory', 'lessons.zh.md')),
      read(resolve(agentRoot, 'memory', 'lessons.en.md')),
      read(resolve(pluginRoot, 'skills', 'compose-scene-script', 'SKILL.md')),
    ].join('\n')
    expect(prompt).not.toMatch(
      /compose-sino-scene|pipeline\.applyBatch|instantiateTemplate|\bin_\d|\bout_\d|\bMira\b|\bDirector\b|asset-requirements|sino-critic/i,
    )
    expect(prompt).toMatch(/Scene Script/)
    expect(prompt).toMatch(/Blockout/)
    expect(prompt).toMatch(/Circulation/)
    expect(prompt).toMatch(/Self-Critique/)
    expect(prompt).toMatch(/Semantic Diff/)
  })
})
