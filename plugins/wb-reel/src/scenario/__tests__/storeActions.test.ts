import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario } from '../demoScenario'

/**
 * scenarioStore · StoryGraph 相关 action 契约
 *
 *   setScenePos(sceneId, pos)        —— 拖拽落点写回 scene.pos
 *   addScene(scene, options?)        —— 新增场景，可选 linkFrom={id, branchKind, label}
 *   removeScene(sceneId)             —— 删除场景，连带清理别处对它的 branch
 *   relinkBranch(sceneId, branchId, newTarget)  —— 改 branch.targetSceneId
 */

function reset(): void {
  useScenarioStore.setState({
    scenario: getDemoScenario(),
    selectedSceneId: 'intro',
    selection: { kind: 'scene', sceneId: 'intro' },
    mode: 'editor',
  })
  useScenarioStore.temporal.getState().clear()
}

describe('scenarioStore · StoryGraph actions', () => {
  beforeEach(reset)
  afterEach(reset)

  describe('setScenePos', () => {
    it('写入 scene.pos', () => {
      useScenarioStore.getState().setScenePos('intro', { x: 100, y: 50 })
      expect(useScenarioStore.getState().scenario.scenes['intro']?.pos).toEqual(
        { x: 100, y: 50 },
      )
    })

    it('不存在的 sceneId 不会崩溃，也不会改 store', () => {
      const before = useScenarioStore.getState().scenario
      useScenarioStore.getState().setScenePos('ghost', { x: 1, y: 1 })
      expect(useScenarioStore.getState().scenario).toBe(before)
    })

    it('多次调用各自覆盖（最后一次胜出）', () => {
      useScenarioStore.getState().setScenePos('intro', { x: 1, y: 1 })
      useScenarioStore.getState().setScenePos('intro', { x: 9, y: 9 })
      expect(useScenarioStore.getState().scenario.scenes['intro']?.pos).toEqual(
        { x: 9, y: 9 },
      )
    })
  })

  describe('pinAllScenePositions', () => {
    // 辅助：塞一个**无 pos**的 scene 进 store（demo 里所有 scene 都有 pos，
    // 不单独加个没 pos 的就测不到"把 pos 从 undefined 写进来"的路径）
    function seedUnpinnedScenes(): void {
      const add = useScenarioStore.getState().addScene
      add({
        id: 'free_a',
        title: 'Free A',
        media: { kind: 'PLACEHOLDER' as const },
        durationMs: 6000,
        dialogue: [],
        branches: [],
      })
      add({
        id: 'free_b',
        title: 'Free B',
        media: { kind: 'PLACEHOLDER' as const },
        durationMs: 6000,
        dialogue: [],
        branches: [],
      })
      // 清掉这两步污染 zundo 的历史，让后续 "no-op" 断言干净
      useScenarioStore.temporal.getState().clear()
    }

    it('把所有未 pin 的节点冻结在给定位置（用于拖前快照，防止其他节点乱跳）', () => {
      seedUnpinnedScenes()
      useScenarioStore.getState().pinAllScenePositions({
        free_a: { x: 10, y: 20 },
        free_b: { x: 200, y: 20 },
      })
      const scenes = useScenarioStore.getState().scenario.scenes
      expect(scenes['free_a']?.pos).toEqual({ x: 10, y: 20 })
      expect(scenes['free_b']?.pos).toEqual({ x: 200, y: 20 })
    })

    it('已有 pos 的 scene 保留不动（尊重作者历史落点，不被重新 pin 刷回）', () => {
      seedUnpinnedScenes()
      // intro 已有 pos=(80,200)；尝试把它刷成 (0,0) 应当失败
      useScenarioStore
        .getState()
        .pinAllScenePositions({
          intro: { x: 0, y: 0 },
          free_a: { x: 99, y: 99 },
        })
      expect(
        useScenarioStore.getState().scenario.scenes['intro']?.pos,
      ).toEqual({ x: 80, y: 200 })
      expect(
        useScenarioStore.getState().scenario.scenes['free_a']?.pos,
      ).toEqual({ x: 99, y: 99 })
    })

    it('全部已 pin 时 no-op（不污染 zundo 历史）', () => {
      // demo 里所有 scene 都已有 pos，正好拿来测 no-op
      const before = useScenarioStore.getState().scenario
      useScenarioStore
        .getState()
        .pinAllScenePositions({ intro: { x: 9, y: 9 } })
      expect(useScenarioStore.getState().scenario).toBe(before)
    })

    it('positions 里没给的 scene 也保留原样（不会把 pos 置 undefined）', () => {
      seedUnpinnedScenes()
      useScenarioStore.getState().pinAllScenePositions({ free_a: { x: 7, y: 7 } })
      const scenes = useScenarioStore.getState().scenario.scenes
      expect(scenes['free_a']?.pos).toEqual({ x: 7, y: 7 })
      // free_b 未在 positions 里，pos 仍 undefined
      expect(scenes['free_b']?.pos).toBeUndefined()
    })
  })

  describe('addScene', () => {
    it('插入新场景，并出现在 scenes 表中', () => {
      const newScene = {
        id: 'newone',
        title: '新场景',
        media: { kind: 'PLACEHOLDER' as const },
        durationMs: 6000,
        dialogue: [],
        branches: [],
      }
      useScenarioStore.getState().addScene(newScene)
      expect(
        useScenarioStore.getState().scenario.scenes['newone'],
      ).toBeDefined()
    })

    it('options.linkFrom 自动给来源场景挂一条 branch', () => {
      const newScene = {
        id: 'after_intro',
        title: '02 · 餐厅',
        media: { kind: 'PLACEHOLDER' as const },
        durationMs: 6000,
        dialogue: [],
        branches: [],
      }
      useScenarioStore.getState().addScene(newScene, {
        linkFrom: { sceneId: 'intro', kind: 'auto', label: '过场' },
      })
      const intro = useScenarioStore.getState().scenario.scenes['intro']
      expect(
        intro?.branches.find((b) => b.targetSceneId === 'after_intro'),
      ).toBeDefined()
    })

    it('id 冲突：保持原场景，不覆盖', () => {
      const original = useScenarioStore.getState().scenario.scenes['intro']
      const dupe = {
        id: 'intro',
        title: 'EVIL DUPE',
        media: { kind: 'PLACEHOLDER' as const },
        durationMs: 1,
        dialogue: [],
        branches: [],
      }
      useScenarioStore.getState().addScene(dupe)
      expect(useScenarioStore.getState().scenario.scenes['intro']).toBe(
        original,
      )
    })
  })

  describe('removeScene', () => {
    it('从 scenes 表中删掉场景', () => {
      useScenarioStore.getState().removeScene('pry')
      expect(useScenarioStore.getState().scenario.scenes['pry']).toBeUndefined()
    })

    it('其他场景对它的 branch 也会被清掉', () => {
      // demo 中应该至少存在一条指向 'pry' 的 branch（来自 intro 或别处）
      const stateBefore = useScenarioStore.getState().scenario
      const refsBefore = countBranchRefs(stateBefore.scenes, 'pry')
      // 只测有 ref 的情况；demo 应该满足
      if (refsBefore === 0) return
      useScenarioStore.getState().removeScene('pry')
      const stateAfter = useScenarioStore.getState().scenario
      expect(countBranchRefs(stateAfter.scenes, 'pry')).toBe(0)
    })

    it('禁止删 rootSceneId（保护剧本完整性）', () => {
      const root = useScenarioStore.getState().scenario.rootSceneId
      useScenarioStore.getState().removeScene(root)
      expect(
        useScenarioStore.getState().scenario.scenes[root],
      ).toBeDefined()
    })

    it('不存在的 sceneId 不会崩溃', () => {
      expect(() =>
        useScenarioStore.getState().removeScene('ghost'),
      ).not.toThrow()
    })

    it('删除中间节点时，前驱 branch 自动穿连到被删节点的主后继', () => {
      // demo: intro --b-pry--> pry --b-pry-end--> ending_neutral
      const before = useScenarioStore.getState().scenario
      const introBefore = before.scenes['intro']!
      const pryBranch = introBefore.branches.find((b) => b.targetSceneId === 'pry')
      expect(pryBranch).toBeDefined()

      useScenarioStore.getState().removeScene('pry')

      const after = useScenarioStore.getState().scenario
      // pry 已删
      expect(after.scenes['pry']).toBeUndefined()
      // intro 保留原 branch 数（不是"删光入边"，是"重定向"）
      const introAfter = after.scenes['intro']!
      expect(introAfter.branches.length).toBe(introBefore.branches.length)
      // 原本指向 pry 的那条 branch 现在指向 pry 的第一条后继（ending_neutral）
      const rewritten = introAfter.branches.find((b) => b.id === pryBranch!.id)
      expect(rewritten?.targetSceneId).toBe('ending_neutral')
    })

    it('末端节点（无后继）删除时，入边直接被移除', () => {
      // ending_neutral 是末端（无 branches）
      const before = useScenarioStore.getState().scenario
      const pryBefore = before.scenes['pry']!
      const hadEdgeToEnding = pryBefore.branches.some(
        (b) => b.targetSceneId === 'ending_neutral',
      )
      expect(hadEdgeToEnding).toBe(true)

      useScenarioStore.getState().removeScene('ending_neutral')

      const after = useScenarioStore.getState().scenario
      expect(after.scenes['ending_neutral']).toBeUndefined()
      // pry 中指向 ending_neutral 的 branch 被移除
      const pryAfter = after.scenes['pry']!
      expect(
        pryAfter.branches.some((b) => b.targetSceneId === 'ending_neutral'),
      ).toBe(false)
    })

    it('穿连时避免自环：若主后继 === 前驱，该条 branch 直接丢弃', () => {
      // 构造：A -> B, B -> A（回流）。删 B 时 A 中原本 ->B 的 branch 若重定向为 A
      // 就产生自环，必须丢弃。
      useScenarioStore.setState({
        scenario: {
          ...getDemoScenario(),
          rootSceneId: 'A',
          scenes: {
            A: {
              id: 'A',
              title: 'A',
              media: { kind: 'PLACEHOLDER' },
              durationMs: 5000,
              dialogue: [],
              branches: [{ id: 'ab', kind: 'auto', targetSceneId: 'B' }],
            },
            B: {
              id: 'B',
              title: 'B',
              media: { kind: 'PLACEHOLDER' },
              durationMs: 5000,
              dialogue: [],
              branches: [{ id: 'ba', kind: 'auto', targetSceneId: 'A' }],
            },
          },
        },
        selectedSceneId: 'A',
      })

      useScenarioStore.getState().removeScene('B')
      const A = useScenarioStore.getState().scenario.scenes['A']!
      // 不应留有自环 branch
      expect(A.branches.some((b) => b.targetSceneId === 'A')).toBe(false)
      expect(A.branches.some((b) => b.targetSceneId === 'B')).toBe(false)
    })
  })

  describe('relinkBranch', () => {
    it('改 branch.targetSceneId', () => {
      const intro = useScenarioStore.getState().scenario.scenes['intro']!
      const firstBranch = intro.branches[0]
      if (!firstBranch) return
      // 必须 link 到一个真实存在的场景
      const someTarget = Object.keys(
        useScenarioStore.getState().scenario.scenes,
      ).find((id) => id !== 'intro' && id !== firstBranch.targetSceneId)
      if (!someTarget) return

      useScenarioStore.getState().relinkBranch('intro', firstBranch.id, someTarget)
      const after = useScenarioStore.getState().scenario.scenes['intro']
      expect(
        after?.branches.find((b) => b.id === firstBranch.id)?.targetSceneId,
      ).toBe(someTarget)
    })

    it('newTarget 不存在时被拒绝（原 branch 不变）', () => {
      const intro = useScenarioStore.getState().scenario.scenes['intro']!
      const b = intro.branches[0]
      if (!b) return
      const before = b.targetSceneId
      useScenarioStore.getState().relinkBranch('intro', b.id, 'ghost-target')
      const after = useScenarioStore.getState().scenario.scenes['intro']
      expect(
        after?.branches.find((x) => x.id === b.id)?.targetSceneId,
      ).toBe(before)
    })
  })

  describe('resetLayout', () => {
    it('清掉所有 scene.pos', () => {
      // 先给每个 scene 都打上 pos
      const ids = Object.keys(useScenarioStore.getState().scenario.scenes)
      for (const id of ids) {
        useScenarioStore.getState().setScenePos(id, { x: 100, y: 100 })
      }
      useScenarioStore.getState().resetLayout()
      const after = useScenarioStore.getState().scenario.scenes
      for (const id of ids) {
        expect(after[id]?.pos).toBeUndefined()
      }
    })

    it('入历史栈 —— 一次重置 = 一笔可撤销操作', () => {
      useScenarioStore.getState().setScenePos('intro', { x: 1, y: 1 })
      useScenarioStore.temporal.getState().clear()
      useScenarioStore.getState().resetLayout()
      expect(useScenarioStore.temporal.getState().pastStates.length).toBe(1)
    })

    it('全部 pos 都已是空时是 no-op（不再入历史栈）', () => {
      // 先 reset 一次让所有 pos 清掉，再 clear history，再 reset 一次（应是 no-op）
      useScenarioStore.getState().resetLayout()
      useScenarioStore.temporal.getState().clear()
      useScenarioStore.getState().resetLayout()
      expect(useScenarioStore.temporal.getState().pastStates.length).toBe(0)
    })
  })

  describe('与 zundo 的配合', () => {
    it('setScenePos 入历史栈（拖拽完成后是一笔可撤销操作）', () => {
      useScenarioStore.getState().setScenePos('intro', { x: 1, y: 1 })
      expect(useScenarioStore.temporal.getState().pastStates.length).toBe(1)
    })

    it('removeScene 入历史栈', () => {
      useScenarioStore.getState().removeScene('pry')
      expect(useScenarioStore.temporal.getState().pastStates.length).toBe(1)
    })

    it('addScene 入历史栈', () => {
      useScenarioStore.getState().addScene({
        id: 'x',
        title: 'x',
        media: { kind: 'PLACEHOLDER' as const },
        durationMs: 1000,
        dialogue: [],
        branches: [],
      })
      expect(useScenarioStore.temporal.getState().pastStates.length).toBe(1)
    })

    it('relinkBranch 入历史栈', () => {
      const intro = useScenarioStore.getState().scenario.scenes['intro']!
      const b = intro.branches[0]
      if (!b) return
      const someTarget = Object.keys(
        useScenarioStore.getState().scenario.scenes,
      ).find((id) => id !== 'intro' && id !== b.targetSceneId)
      if (!someTarget) return
      useScenarioStore.getState().relinkBranch('intro', b.id, someTarget)
      expect(useScenarioStore.temporal.getState().pastStates.length).toBe(1)
    })
  })
})

function countBranchRefs(
  scenes: Record<string, { branches: { targetSceneId: string }[] }>,
  targetId: string,
): number {
  let n = 0
  for (const sc of Object.values(scenes)) {
    for (const b of sc.branches) {
      if (b.targetSceneId === targetId) n++
    }
  }
  return n
}

// ─────────────────────────────────────────────────────────
// v3 · Shot 级 actions（setSceneShotKeyframe / updateShot）
// ─────────────────────────────────────────────────────────
//
// 这些 action 是分镜化的核心写入点：
//   · setSceneShotKeyframe —— 生图管线/shot 重生按钮写回 keyframeMediaRef
//     + keyShot 时同步 scene.media.ref（Player/StoryTree 代表帧）
//   · updateShot —— 用户在 PromptTabs 改 framing/prompt/cameraHint 的 patch 写入
//
// 使用 loadScenario 提前构造 v3 scene，避免依赖 migrate 的兜底数据形状。
describe('scenarioStore · shot-level actions', () => {
  beforeEach(reset)
  afterEach(reset)

  function loadSceneWithShots(): void {
    useScenarioStore.getState().loadScenario({
      schemaVersion: 3,
      id: 'sc',
      rootSceneId: 's1',
      scenes: {
        s1: {
          id: 's1',
          title: 's1',
          durationMs: 5000,
          media: { kind: 'IMAGE_PROMPT', prompt: 'scene prompt' },
          dialogue: [],
          branches: [],
          keyShotId: 'sh_01',
          shots: [
            { id: 'sh_01', order: 0, framing: 'wide', prompt: 'wide p' },
            { id: 'sh_02', order: 1, framing: 'close', prompt: 'close p' },
          ],
        },
      },
    } as never)
  }

  describe('setSceneShotKeyframe', () => {
    it('写入目标 shot.keyframeMediaRef（非 keyShot 不动 scene.media.ref）', () => {
      loadSceneWithShots()
      useScenarioStore.getState().setSceneShotKeyframe('s1', 'sh_02', 'media-b')
      const s = useScenarioStore.getState().scenario.scenes['s1']!
      expect(s.shots?.find((sh) => sh.id === 'sh_02')?.keyframeMediaRef).toBe(
        'media-b',
      )
      // sh_02 非 keyShot → scene.media.ref 保持不变
      expect(s.media.ref).toBeUndefined()
    })

    it('keyShot 同步 scene.media.ref（Player/StoryTree 代表帧）', () => {
      loadSceneWithShots()
      useScenarioStore.getState().setSceneShotKeyframe('s1', 'sh_01', 'media-a')
      const s = useScenarioStore.getState().scenario.scenes['s1']!
      expect(s.shots?.find((sh) => sh.id === 'sh_01')?.keyframeMediaRef).toBe(
        'media-a',
      )
      expect(s.media.ref).toBe('media-a')
    })

    it('未知 shotId —— no-op，state 引用不变', () => {
      loadSceneWithShots()
      const before = useScenarioStore.getState().scenario.scenes['s1']!
      useScenarioStore
        .getState()
        .setSceneShotKeyframe('s1', 'sh_ghost', 'media-x')
      const after = useScenarioStore.getState().scenario.scenes['s1']!
      expect(after).toBe(before)
    })
  })

  describe('updateShot', () => {
    it('patch framing / prompt / cameraHint', () => {
      loadSceneWithShots()
      useScenarioStore.getState().updateShot('s1', 'sh_02', {
        framing: 'pov',
        prompt: 'new prompt',
        cameraHint: 'handheld',
      })
      const shot = useScenarioStore
        .getState()
        .scenario.scenes['s1']!.shots?.find((sh) => sh.id === 'sh_02')
      expect(shot?.framing).toBe('pov')
      expect(shot?.prompt).toBe('new prompt')
      expect(shot?.cameraHint).toBe('handheld')
      // order / id 不被改
      expect(shot?.order).toBe(1)
      expect(shot?.id).toBe('sh_02')
    })

    it('未知 sceneId / shotId —— no-op', () => {
      loadSceneWithShots()
      const before = useScenarioStore.getState().scenario
      useScenarioStore.getState().updateShot('ghost', 'sh_01', { prompt: 'x' })
      useScenarioStore.getState().updateShot('s1', 'sh_ghost', { prompt: 'x' })
      expect(useScenarioStore.getState().scenario).toBe(before)
    })
  })

  describe('addShot / removeShot', () => {
    it('addShot 默认末尾追加，重排 order 0..n-1', () => {
      loadSceneWithShots()
      const id = useScenarioStore.getState().addShot('s1', {
        framing: 'insert',
        prompt: 'insert prompt',
      })
      expect(id).toBeTruthy()
      const shots = useScenarioStore.getState().scenario.scenes['s1']!.shots!
      expect(shots).toHaveLength(3)
      expect(shots[2]?.id).toBe(id)
      expect(shots[2]?.framing).toBe('insert')
      expect(shots.map((sh) => sh.order)).toEqual([0, 1, 2])
    })

    it('addShot 带 insertAfterShotId 插在指定 shot 后', () => {
      loadSceneWithShots()
      const id = useScenarioStore.getState().addShot('s1', undefined, 'sh_01')
      const shots = useScenarioStore.getState().scenario.scenes['s1']!.shots!
      expect(shots.map((sh) => sh.id)).toEqual(['sh_01', id, 'sh_02'])
      expect(shots.map((sh) => sh.order)).toEqual([0, 1, 2])
    })

    it('removeShot 删除非 key shot，order 连续重排', () => {
      loadSceneWithShots()
      useScenarioStore.getState().removeShot('s1', 'sh_02')
      const scene = useScenarioStore.getState().scenario.scenes['s1']!
      expect(scene.shots).toHaveLength(1)
      expect(scene.keyShotId).toBe('sh_01')
    })

    it('removeShot 删 keyShot → keyShotId 回退到 shots[0]', () => {
      loadSceneWithShots()
      useScenarioStore.getState().removeShot('s1', 'sh_01')
      const scene = useScenarioStore.getState().scenario.scenes['s1']!
      expect(scene.keyShotId).toBe('sh_02')
    })
  })

  describe('splitShot', () => {
    it('在 shot 内切点处切成两段；duration 不丢；新段 id 不同', () => {
      loadSceneWithShots()
      // sh_01 没写 start/end → 按 order 比例均分：total=5000, shots=2 → sh_01 [0,2500]
      const newId = useScenarioStore.getState().splitShot('s1', 'sh_01', 1000)
      expect(newId).toBeTruthy()
      const shots = useScenarioStore.getState().scenario.scenes['s1']!.shots!
      expect(shots).toHaveLength(3)
      const left = shots.find((sh) => sh.id === 'sh_01')!
      const right = shots.find((sh) => sh.id === newId!)!
      expect(left.startMs).toBe(0)
      expect(left.endMs).toBe(1000)
      expect(right.startMs).toBe(1000)
      expect(right.endMs).toBe(2500)
      // order 连续 0..2
      expect(shots.map((sh) => sh.order).sort()).toEqual([0, 1, 2])
    })

    it('切点在边界或之外 → no-op，返回 null', () => {
      loadSceneWithShots()
      expect(useScenarioStore.getState().splitShot('s1', 'sh_01', 0)).toBeNull()
      expect(useScenarioStore.getState().splitShot('s1', 'sh_01', 99999)).toBeNull()
    })
  })

  describe('compactShotsLeft', () => {
    it('把所有 shot 的 startMs/endMs 按 order 紧挨排', () => {
      useScenarioStore.getState().loadScenario({
        schemaVersion: 3,
        id: 'sc',
        rootSceneId: 's1',
        scenes: {
          s1: {
            id: 's1',
            title: 's1',
            durationMs: 10000,
            media: { kind: 'IMAGE_PROMPT', prompt: '' },
            dialogue: [],
            branches: [],
            keyShotId: 'sh_01',
            shots: [
              { id: 'sh_01', order: 0, framing: 'wide', prompt: 'a', startMs: 1000, endMs: 2000 },
              { id: 'sh_02', order: 1, framing: 'medium', prompt: 'b', startMs: 5000, endMs: 6500 },
              { id: 'sh_03', order: 2, framing: 'close', prompt: 'c', startMs: 8000, endMs: 8500 },
            ],
          },
        },
      } as never)
      useScenarioStore.getState().compactShotsLeft('s1')
      const shots = useScenarioStore.getState().scenario.scenes['s1']!.shots!
      expect(shots.map((s) => [s.startMs, s.endMs])).toEqual([
        [0, 1000],
        [1000, 2500],
        [2500, 3000],
      ])
    })
  })
})

// ─────────────────────────────────────────────────────────
// v3.1 · 音频 clip actions
// ─────────────────────────────────────────────────────────
describe('scenarioStore · audio actions', () => {
  beforeEach(reset)
  afterEach(reset)

  function loadSceneWithAudio(): void {
    useScenarioStore.getState().loadScenario({
      schemaVersion: 3,
      id: 'sc',
      rootSceneId: 's1',
      scenes: {
        s1: {
          id: 's1',
          title: 's1',
          durationMs: 10000,
          media: { kind: 'IMAGE_PROMPT', prompt: '' },
          dialogue: [],
          branches: [],
          audio: [
            { id: 'aud_001', role: 'bgm', ref: 'm1', startMs: 0, durationMs: 4000 },
          ],
        },
      },
    } as never)
  }

  it('addAudioClip 追加到末尾', () => {
    loadSceneWithAudio()
    useScenarioStore.getState().addAudioClip('s1', {
      id: 'aud_002',
      role: 'sfx',
      ref: 'm2',
      startMs: 2000,
      durationMs: 500,
    })
    const audio = useScenarioStore.getState().scenario.scenes['s1']!.audio!
    expect(audio).toHaveLength(2)
    expect(audio[1]?.id).toBe('aud_002')
  })

  it('updateAudioClip 能 patch 音量 / label / durationMs', () => {
    loadSceneWithAudio()
    useScenarioStore.getState().updateAudioClip('s1', 'aud_001', {
      volume: 0.4,
      label: '主题曲',
      durationMs: 3500,
    })
    const clip = useScenarioStore
      .getState()
      .scenario.scenes['s1']!.audio!.find((c) => c.id === 'aud_001')!
    expect(clip.volume).toBe(0.4)
    expect(clip.label).toBe('主题曲')
    expect(clip.durationMs).toBe(3500)
  })

  it('splitAudioClip 对源素材入点顺延（offset 相接）', () => {
    loadSceneWithAudio()
    const newId = useScenarioStore
      .getState()
      .splitAudioClip('s1', 'aud_001', 1500)
    expect(newId).toBeTruthy()
    const audio = useScenarioStore.getState().scenario.scenes['s1']!.audio!
    const left = audio.find((c) => c.id === 'aud_001')!
    const right = audio.find((c) => c.id === newId!)!
    expect(left.durationMs).toBe(1500)
    expect(right.startMs).toBe(1500)
    expect(right.durationMs).toBe(2500)
    expect(right.offsetMs).toBe(1500)
  })

  it('removeAudioClip 直接剔除', () => {
    loadSceneWithAudio()
    useScenarioStore.getState().removeAudioClip('s1', 'aud_001')
    expect(useScenarioStore.getState().scenario.scenes['s1']!.audio).toEqual([])
  })
})

describe('scenarioStore · scene asset library', () => {
  beforeEach(reset)
  afterEach(reset)

  function loadEmptyScene(): void {
    useScenarioStore.getState().loadScenario({
      schemaVersion: 3,
      id: 'sc',
      rootSceneId: 's1',
      scenes: {
        s1: {
          id: 's1',
          title: 's1',
          durationMs: 10000,
          media: { kind: 'IMAGE_PROMPT', prompt: '' },
          dialogue: [],
          branches: [],
        },
      },
    } as never)
  }

  it('addSceneImage 追加去重', () => {
    loadEmptyScene()
    const api = useScenarioStore.getState()
    api.addSceneImage('s1', 'media_a')
    api.addSceneImage('s1', 'media_b')
    api.addSceneImage('s1', 'media_a')
    expect(useScenarioStore.getState().scenario.scenes['s1']!.sceneImages).toEqual([
      'media_a',
      'media_b',
    ])
  })

  it('removeSceneImage 剔除指定 id', () => {
    loadEmptyScene()
    const api = useScenarioStore.getState()
    api.addSceneImage('s1', 'media_a')
    api.addSceneImage('s1', 'media_b')
    api.removeSceneImage('s1', 'media_a')
    expect(useScenarioStore.getState().scenario.scenes['s1']!.sceneImages).toEqual([
      'media_b',
    ])
  })

  it('reorderSceneImages 丢弃脏 id 并按给定顺序排列', () => {
    loadEmptyScene()
    const api = useScenarioStore.getState()
    api.addSceneImage('s1', 'a')
    api.addSceneImage('s1', 'b')
    api.addSceneImage('s1', 'c')
    api.reorderSceneImages('s1', ['c', 'a', 'ghost', 'b'])
    expect(useScenarioStore.getState().scenario.scenes['s1']!.sceneImages).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('视频资产 actions 与图像对称', () => {
    loadEmptyScene()
    const api = useScenarioStore.getState()
    api.addSceneVideo('s1', 'v1')
    api.addSceneVideo('s1', 'v2')
    api.reorderSceneVideos('s1', ['v2', 'v1'])
    api.removeSceneVideo('s1', 'v1')
    expect(useScenarioStore.getState().scenario.scenes['s1']!.sceneVideos).toEqual([
      'v2',
    ])
  })
})

/*
 * v6.6 · 角色音色锚点 (CharacterVoiceAnchor) 写入路径.
 *
 * 用例覆盖:
 *   1. 全新写入 -> 字段完整, savedAt 自动填
 *   2. 部分 patch -> merge 旧值, 不丢已存在字段
 *   3. 传 undefined / 空 voiceType -> 视为清空, voiceAnchor 应被删
 *   4. 不存在的角色 id -> 静默 noop, 不抛错
 */
describe('scenarioStore · setCharacterVoiceAnchor', () => {
  beforeEach(reset)

  function ensureCharacter(id: string): void {
    useScenarioStore.getState().upsertCharacter({
      id,
      name: 'Test Character',
      prompt: '',
    })
  }

  it('首次写入 -> 字段全部落到 voiceAnchor, savedAt 自动填', () => {
    ensureCharacter('c1')
    useScenarioStore.getState().setCharacterVoiceAnchor('c1', {
      voiceType: 'BV001_streaming',
      label: '通用女声',
      sampleText: '你好',
      speedRatio: 1.1,
      sampleMediaId: 'm-abc',
    })
    const ch = useScenarioStore.getState().scenario.characters?.['c1']
    expect(ch?.voiceAnchor?.voiceType).toBe('BV001_streaming')
    expect(ch?.voiceAnchor?.sampleMediaId).toBe('m-abc')
    expect(typeof ch?.voiceAnchor?.savedAt).toBe('number')
  })

  it('部分 patch 会 merge 进已有 voiceAnchor', () => {
    ensureCharacter('c1')
    const api = useScenarioStore.getState()
    api.setCharacterVoiceAnchor('c1', {
      voiceType: 'BV001_streaming',
      label: '通用女声',
      sampleText: '你好',
      sampleMediaId: 'm-abc',
    })
    api.setCharacterVoiceAnchor('c1', {
      voiceType: 'BV001_streaming',
      sampleText: '另一段试听',
    })
    const va = useScenarioStore.getState().scenario.characters?.['c1']?.voiceAnchor
    expect(va?.sampleText).toBe('另一段试听')
    expect(va?.label).toBe('通用女声')
    expect(va?.sampleMediaId).toBe('m-abc')
  })

  it('传 undefined -> 清空 voiceAnchor', () => {
    ensureCharacter('c1')
    const api = useScenarioStore.getState()
    api.setCharacterVoiceAnchor('c1', {
      voiceType: 'BV001_streaming',
    })
    expect(useScenarioStore.getState().scenario.characters?.['c1']?.voiceAnchor).toBeDefined()
    api.setCharacterVoiceAnchor('c1', undefined)
    expect(useScenarioStore.getState().scenario.characters?.['c1']?.voiceAnchor).toBeUndefined()
  })

  it('voiceType 空字符串 -> 视作清空', () => {
    ensureCharacter('c1')
    const api = useScenarioStore.getState()
    api.setCharacterVoiceAnchor('c1', { voiceType: 'BV001_streaming' })
    api.setCharacterVoiceAnchor('c1', { voiceType: '' })
    expect(useScenarioStore.getState().scenario.characters?.['c1']?.voiceAnchor).toBeUndefined()
  })

  it('不存在的 character.id -> noop, 不抛', () => {
    expect(() => {
      useScenarioStore.getState().setCharacterVoiceAnchor('ghost', {
        voiceType: 'BV001_streaming',
      })
    }).not.toThrow()
  })
})

/*
 * 图像视图「小游戏选择池」—— toggleEnabledMinigame 写入路径。
 *
 * 用例覆盖:
 *   1. toggle 一个 id -> enabledMinigameIds 含该 id
 *   2. 再 toggle 同一个 id -> 被移除（回到不含）
 *   3. toggle 两个不同 id -> 都在数组里
 */
describe('scenarioStore · toggleEnabledMinigame', () => {
  beforeEach(reset)
  afterEach(reset)

  it('toggle 一个 id -> 加入 enabledMinigameIds', () => {
    useScenarioStore.getState().toggleEnabledMinigame('magical-witch')
    expect(
      useScenarioStore.getState().scenario.enabledMinigameIds,
    ).toContain('magical-witch')
  })

  it('再次 toggle 同一个 id -> 移除（不再含）', () => {
    const api = useScenarioStore.getState()
    api.toggleEnabledMinigame('magical-witch')
    api.toggleEnabledMinigame('magical-witch')
    expect(
      useScenarioStore.getState().scenario.enabledMinigameIds,
    ).not.toContain('magical-witch')
  })

  it('toggle 两个不同 id -> 都在数组里', () => {
    const api = useScenarioStore.getState()
    api.toggleEnabledMinigame('magical-witch')
    api.toggleEnabledMinigame('trailmaster')
    const ids = useScenarioStore.getState().scenario.enabledMinigameIds ?? []
    expect(ids).toContain('magical-witch')
    expect(ids).toContain('trailmaster')
  })
})
