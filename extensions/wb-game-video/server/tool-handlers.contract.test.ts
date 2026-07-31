import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeNodiaDemo } from '../src/editor/demo/demo'
import tools from './tool-handlers'

const extensionDir = resolve(import.meta.dirname, '..')
const roots: string[] = []

function gameRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'wb-game-video-tools-'))
  roots.push(root)
  return root
}

function arrivalCtx(cwd: string, gameId = 'contract-game') {
  return {
    caller: { kind: 'test' },
    toolId: 'test',
    cwd,
    extensionDir,
    gameId,
  }
}

function forgeaxCtx(projectRoot: string, game = 'contract-game') {
  return {
    caller: { kind: 'test' },
    toolId: 'test',
    cwd: extensionDir,
    projectRoot,
    game,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('host tool context contract', () => {
  it('persists blueprint.json under ctx.cwd and ignores title for versioning', async () => {
    const cwd = gameRoot()
    const project = makeNodiaDemo()

    const result = await tools['wb-game-video:save-graph'](
      { project, title: 'must not create a snapshot' },
      arrivalCtx(cwd),
    )

    expect(result).toEqual({ ok: true, versions: [], gameSlug: 'contract-game' })
    expect(JSON.parse(
      readFileSync(
        resolve(cwd, 'blueprint.json'),
        'utf8',
      ),
    )).toEqual(project)
  })

  it('rejects save-graph data that combines subProcess and subFlowPack', async () => {
    const cwd = gameRoot()
    const project = makeNodiaDemo()
    const main = project.manifest.packs[project.manifest.mainPackId]!
    const container = main.graph.nodes.find((node) => node.id === 'a_my')!
    container.data = { ...container.data, subFlowPack: { id: 'reusable' } }

    const result = await tools['wb-game-video:save-graph']({ project }, arrivalCtx(cwd))

    expect(result.ok).toBe(false)
    expect(result.errors?.some((error) => error.includes('subProcess 与 subFlowPack 不能同时存在'))).toBe(true)
    expect(existsSync(resolve(cwd, 'blueprint.json'))).toBe(false)
  })

  it('resolves packaged videos from ctx.extensionDir rather than the project cwd', async () => {
    const cwd = gameRoot()

    const result = await tools['wb-game-video:list-videos']({}, arrivalCtx(cwd))

    expect(result.error).toBeUndefined()
    expect(result.videos).toContain('idle01')
    expect(result.videos.length).toBeGreaterThan(10)
  })

  it('lists packaged videos in ForgeaX without requiring a bound game', async () => {
    const result = await tools['wb-game-video:list-videos'](
      {},
      {
        caller: { kind: 'test' },
        toolId: 'test',
        cwd: extensionDir,
        projectRoot: gameRoot(),
      },
    )

    expect(result.error).toBeUndefined()
    expect(result.videos).toContain('idle01')
  })

  it('adapts ForgeaX projectRoot + game + extension cwd into the same roots', async () => {
    const projectRoot = gameRoot()
    const expectedGameRoot = resolve(projectRoot, '.forgeax', 'games', '中文游戏')
    const project = makeNodiaDemo()

    const saved = await tools['wb-game-video:save-graph'](
      { project, gameSlug: '中文游戏' },
      forgeaxCtx(projectRoot, '中文游戏'),
    )
    const videos = await tools['wb-game-video:list-videos'](
      {},
      forgeaxCtx(projectRoot, '中文游戏'),
    )

    expect(saved).toEqual({ ok: true, versions: [], gameSlug: '中文游戏' })
    expect(JSON.parse(readFileSync(resolve(expectedGameRoot, 'blueprint.json'), 'utf8')))
      .toEqual(project)
    expect(videos.videos).toContain('idle01')
  })

  it.each(['中', 'a'])('accepts safe single-character game id %s', async (gameId) => {
    const cwd = gameRoot()
    const result = await tools['wb-game-video:save-graph'](
      { project: makeNodiaDemo(), gameSlug: gameId },
      arrivalCtx(cwd, gameId),
    )

    expect(result).toEqual({ ok: true, versions: [], gameSlug: gameId })
  })

  it.each(['', '.', '..', 'a/b', 'a\\b'])(
    'rejects unsafe bound game id %j',
    async (gameId) => {
      const result = await tools['wb-game-video:save-graph'](
        { project: makeNodiaDemo() },
        arrivalCtx(gameRoot(), gameId),
      )

      expect(result.ok).toBe(false)
    },
  )

  it('rejects an explicit gameSlug that differs from the host-bound id', async () => {
    const result = await tools['wb-game-video:save-graph'](
      { project: makeNodiaDemo(), gameSlug: 'other' },
      arrivalCtx(gameRoot(), 'bound'),
    )

    expect(result.ok).toBe(false)
  })

  it('never falls back to .forgeax/active-game.json without a host binding', async () => {
    const projectRoot = gameRoot()
    mkdirSync(resolve(projectRoot, '.forgeax'), { recursive: true })
    writeFileSync(
      resolve(projectRoot, '.forgeax', 'active-game.json'),
      JSON.stringify({ slug: 'legacy-active' }),
    )

    const result = await tools['wb-game-video:save-graph'](
      { project: makeNodiaDemo() },
      {
        caller: { kind: 'test' },
        toolId: 'test',
        cwd: projectRoot,
        extensionDir,
      },
    )

    expect(result.ok).toBe(false)
    expect(existsSync(
      resolve(projectRoot, '.forgeax', 'games', 'legacy-active', 'blueprint.json'),
    )).toBe(false)
  })
})
