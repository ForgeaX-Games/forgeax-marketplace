import { describe, expect, it, vi } from 'vitest'
import {
  pickBatchTasksFromScenario,
  runWithConcurrency,
} from '../batchImageGen'
import { migrateScenarioToLatest } from '../../scenario/schemaMigrate'
import type { Scenario, Scene } from '../../scenario/types'

/**
 * 并发调度器契约 —— 这是"批量生图"按钮的引擎。
 *
 * 真实场景需求：8 个场景，并发 4，单个失败不连带其他、能拿到所有结果（成功+失败）。
 *
 * 不要在这里测 ImageClient —— 调度器是纯函数，跟 LLM 无关。
 */
describe('runWithConcurrency', () => {
  it('并发数 = N：同时在飞的 worker 数量永不超 N', async () => {
    const concurrency = 3
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 12 }, (_, i) => i)

    const res = await runWithConcurrency(items, async (i) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return i * 2
    }, { concurrency })

    expect(peak).toBe(concurrency)
    expect(res.ok).toEqual(items.map((i) => i * 2))
    expect(res.failed).toEqual([])
  })

  it('单个失败不连带其他 —— 失败收到 failures，成功收到 ok', async () => {
    const items = ['a', 'b', 'c', 'd']

    const res = await runWithConcurrency(
      items,
      async (item) => {
        if (item === 'b' || item === 'd') throw new Error(`boom-${item}`)
        return `ok-${item}`
      },
      { concurrency: 2 },
    )

    expect(res.ok).toContain('ok-a')
    expect(res.ok).toContain('ok-c')
    expect(res.ok).toHaveLength(2)
    expect(res.failed).toHaveLength(2)
    expect(res.failed.map((f) => f.item).sort()).toEqual(['b', 'd'])
    expect(res.failed[0]?.error.message).toMatch(/boom-/)
  })

  it('onProgress 在每个任务结束时调用 —— done 单调递增、total 不变', async () => {
    const items = [1, 2, 3, 4, 5]
    const calls: { done: number; total: number }[] = []

    await runWithConcurrency(
      items,
      async (i) => {
        await new Promise((r) => setTimeout(r, 1))
        return i
      },
      {
        concurrency: 2,
        onProgress: (done, total) => calls.push({ done, total }),
      },
    )

    expect(calls).toHaveLength(items.length)
    // 严格单调递增
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!.done).toBeGreaterThan(calls[i - 1]!.done)
    }
    expect(calls.every((c) => c.total === items.length)).toBe(true)
    expect(calls[calls.length - 1]!.done).toBe(items.length)
  })

  it('空数组：立刻返回，0 调用 worker', async () => {
    const worker = vi.fn()
    const res = await runWithConcurrency([], worker, { concurrency: 4 })
    expect(res.ok).toEqual([])
    expect(res.failed).toEqual([])
    expect(worker).not.toHaveBeenCalled()
  })

  it('concurrency=1：完全串行执行（顺序一致）', async () => {
    const items = [10, 20, 30]
    const order: number[] = []
    await runWithConcurrency(
      items,
      async (i) => {
        order.push(i)
        await new Promise((r) => setTimeout(r, 1))
        order.push(i * 100)
        return i
      },
      { concurrency: 1 },
    )
    // 串行：每个完整执行完才到下一个 → start/end 配对
    expect(order).toEqual([10, 1000, 20, 2000, 30, 3000])
  })

  it('concurrency 超过 items 数时不会卡死 —— 直接全发', async () => {
    const items = [1, 2]
    const res = await runWithConcurrency(items, async (i) => i + 100, {
      concurrency: 10,
    })
    expect(res.ok.sort()).toEqual([101, 102])
  })
})

// ─────────────────────────────────────────────────────────
// pickBatchTasksFromScenario · v3 shot 级任务产出
// ─────────────────────────────────────────────────────────

function makeScene(partial: Partial<Scene> & { id: string }): Scene {
  const base: Scene = {
    id: partial.id,
    title: partial.title ?? partial.id,
    durationMs: 5000,
    media: partial.media ?? { kind: 'IMAGE_PROMPT', prompt: 'scene-level' },
    dialogue: [],
    branches: [],
  }
  return { ...base, ...partial }
}

function makeScenario(scenes: Scene[]): Scenario {
  const rec: Record<string, Scene> = {}
  for (const s of scenes) rec[s.id] = s
  return migrateScenarioToLatest({
    schemaVersion: 2,
    title: 'sc-test',
    id: 'sc-test',
    defaultCharMs: 60,
    rootSceneId: scenes[0]?.id ?? '',
    scenes: rec,
  } as Scenario)
}

describe('pickBatchTasksFromScenario (v3 shot 级)', () => {
  it('单镜兜底：没 shots 的 scene 经 migrate 后产出 1 个 task，使用 prompts.scene', () => {
    const sc = makeScenario([
      makeScene({
        id: 's1',
        prompts: { scene: 'wide-shot prompt' },
      }),
    ])
    const tasks = pickBatchTasksFromScenario(sc)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.sceneId).toBe('s1')
    expect(tasks[0]!.isKeyShot).toBe(true)
    expect(tasks[0]!.prompt).toBe('wide-shot prompt')
    // 迁移路径给的默认 shotId
    expect(tasks[0]!.shotId).toBe('sh_01')
  })

  it('多镜 scene：按 shots.length 展开；每镜带独立 prompt + isKeyShot 标记', () => {
    const sc = makeScenario([
      makeScene({
        id: 's1',
        prompts: { scene: 'scene fallback' },
        keyShotId: 'sh_02',
        shots: [
          { id: 'sh_01', order: 0, framing: 'wide', prompt: 'wide prompt' },
          { id: 'sh_02', order: 1, framing: 'close', prompt: 'close prompt' },
          { id: 'sh_03', order: 2, framing: 'medium', prompt: '' },
        ],
      }),
    ])
    const tasks = pickBatchTasksFromScenario(sc)
    expect(tasks).toHaveLength(3)
    expect(tasks.map((t) => t.shotId)).toEqual(['sh_01', 'sh_02', 'sh_03'])
    expect(tasks.find((t) => t.shotId === 'sh_01')!.prompt).toBe('wide prompt')
    expect(tasks.find((t) => t.shotId === 'sh_02')!.prompt).toBe('close prompt')
    // sh_03 无 prompt → 回退 scene fallback
    expect(tasks.find((t) => t.shotId === 'sh_03')!.prompt).toBe(
      'scene fallback',
    )
    // keyShot 只有 sh_02
    expect(tasks.find((t) => t.shotId === 'sh_02')!.isKeyShot).toBe(true)
    expect(tasks.find((t) => t.shotId === 'sh_01')!.isKeyShot).toBe(false)
  })

  it('skipReadyShots 按 sceneId::shotId 过滤 —— 已完成的 shot 不再产出', () => {
    const sc = makeScenario([
      makeScene({
        id: 's1',
        prompts: { scene: 'p1' },
        shots: [
          { id: 'sh_01', order: 0, framing: 'wide', prompt: 'a' },
          { id: 'sh_02', order: 1, framing: 'close', prompt: 'b' },
        ],
      }),
      makeScene({
        id: 's2',
        prompts: { scene: 'p2' },
        shots: [
          { id: 'sh_01', order: 0, framing: 'medium', prompt: 'c' },
        ],
      }),
    ])
    const skip = new Set(['s1::sh_01', 's2::sh_01'])
    const tasks = pickBatchTasksFromScenario(sc, skip)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.sceneId).toBe('s1')
    expect(tasks[0]!.shotId).toBe('sh_02')
  })

  it('完全无 prompt 的 shot —— 跳过（不连累 batch 任务列表）', () => {
    // 手工构造不走 migrate 的 scene（shots 有但 prompt 空，scene prompt 也空）
    const scene: Scene = {
      id: 's1',
      title: 's1',
      durationMs: 5000,
      media: { kind: 'IMAGE_PROMPT' },
      dialogue: [],
      branches: [],
      shots: [
        { id: 'sh_01', order: 0, framing: 'wide', prompt: '' },
      ],
      keyShotId: 'sh_01',
    }
    const tasks = pickBatchTasksFromScenario({
      schemaVersion: 3,
      title: 's',
      id: 's',
      defaultCharMs: 60,
      rootSceneId: 's1',
      scenes: { s1: scene },
    } as Scenario)
    expect(tasks).toEqual([])
  })

  it('Σ tasks === Σ shots across scenes（忽略空 prompt 的兜底）', () => {
    const sc = makeScenario([
      makeScene({
        id: 's1',
        prompts: { scene: 'p' },
        shots: [
          { id: 'sh_01', order: 0, framing: 'wide', prompt: 'a' },
          { id: 'sh_02', order: 1, framing: 'close', prompt: 'b' },
        ],
      }),
      makeScene({ id: 's2', prompts: { scene: 'q' } }),
      makeScene({
        id: 's3',
        prompts: { scene: 'r' },
        shots: [
          { id: 'sh_01', order: 0, framing: 'wide', prompt: 'x' },
          { id: 'sh_02', order: 1, framing: 'medium', prompt: 'y' },
          { id: 'sh_03', order: 2, framing: 'close', prompt: 'z' },
        ],
      }),
    ])
    const totalShots = Object.values(sc.scenes).reduce(
      (acc, scene) => acc + (scene.shots?.length ?? 0),
      0,
    )
    const tasks = pickBatchTasksFromScenario(sc)
    expect(tasks).toHaveLength(totalShots)
    expect(totalShots).toBe(2 + 1 + 3)
  })
})
