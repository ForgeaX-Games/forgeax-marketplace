/**
 * visualQueueTrigger —— module-level "生成视觉锚点" pipeline trigger.
 *
 * 当 Reia 调用 reel:generate-visuals，server 把请求投递到 /__reel__/visual-queue，
 * scenarioPersistBoot 的轮询（pollVisualQueue）捡起后调用本文件 triggerVisualFromQueue。
 *
 * 与 forgeQueueTrigger（reel:forge-script）的关键区别：
 *   - forge-script 是"从零锻造一本新剧本"，会 adoptForgedScenario(create-new)，破坏性。
 *   - 本触发器**只对当前 active 剧本做"提取锚点 + 锚点出图"**，绝不替换/新建剧本，
 *     也绝不触碰分镜关键帧（只跑 characterRefPass 的 人 / 景 / 物 三类）。
 *
 * 流程：
 *   Stage A 提取锚点：若 locations / props 为空 → distillLocations / distillProps
 *           （复用 promptForge 模板）写回 store，并按名回填 scene.locationId / shot.propIds。
 *   Stage B 锚点出图：characterRefPass 生成 角色定妆照 + 场景基准图(多角度) + 关键道具图，
 *           回调写回 turnaround / location / prop refImageId（默认跳过已有 ref 的，幂等省钱）。
 */

import { createImageProvider, createTextProvider } from '../llm'
import { characterRefPass } from '../llm/forgePasses'
import { distillCharacters, distillLocations, distillProps } from './forgeDistillSkills'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { useForgeChatStore } from './forgeChatStore'
import { broadcastScenarioAdopt } from '../shell/crossPaneSync'
import type { Character, Location, Prop, Scenario, Scene } from '../scenario/types'

export interface VisualQueueItem {
  /** 'anchors'（默认）= 提取锚点 + 角色/场景/道具出图 */
  scope?: 'anchors'
  /** 可选：目标剧本 id；缺省/不匹配时对当前 active 剧本执行 */
  scenarioId?: string
  /** true = 即使已有 ref 也强制重生（默认 false：跳过已有 ref，幂等省钱） */
  force?: boolean
  createdAt: number
}

let _aborted = false

export function abortVisualQueue(): void {
  _aborted = true
}

/** 名称/别名是否出现在一段文本里（中文子串匹配） */
function mentions(text: string, names: string[]): boolean {
  const t = text.toLowerCase()
  return names.some((n) => n && t.includes(n.toLowerCase()))
}

/** 回填 scene.locationId：仅填补空缺，按场所名出现在场景标题/舞美/画面里匹配。 */
function backfillLocationIds(locations: Location[]): void {
  if (locations.length === 0) return
  const ss = useScenarioStore.getState()
  const scenario = ss.scenario
  for (const [sceneId, sc] of Object.entries(scenario.scenes ?? {})) {
    if (sc.locationId) continue
    const hay = [
      sc.title ?? '',
      sc.background ?? '',
      sc.prompts?.scene ?? '',
      sc.media?.prompt ?? '',
    ].join(' ')
    const hit = locations.find((l) => mentions(hay, [l.name]))
    if (hit) ss.setSceneLocationId(sceneId, hit.id)
  }
}

/** 回填 shot.propIds：仅追加（不删除），按道具名/别名出现在 shot.prompt 或场景文本里匹配。 */
function backfillPropIds(props: Prop[]): void {
  if (props.length === 0) return
  const ss = useScenarioStore.getState()
  const scenario = ss.scenario
  for (const [sceneId, sc] of Object.entries(scenario.scenes ?? {})) {
    const shots = sc.shots ?? []
    if (shots.length === 0) continue
    let changed = false
    const sceneText = [sc.title ?? '', sc.background ?? '', sc.prompts?.scene ?? ''].join(' ')
    const nextShots = shots.map((sh) => {
      const hay = `${sceneText} ${sh.prompt ?? ''}`
      const ids = new Set(sh.propIds ?? [])
      const before = ids.size
      for (const p of props) {
        if (mentions(hay, [p.name, ...(p.aliases ?? [])])) ids.add(p.id)
      }
      if (ids.size === before) return sh
      changed = true
      return { ...sh, propIds: [...ids] }
    })
    if (changed) ss.updateScene(sceneId, { shots: nextShots } as Partial<Scene>)
  }
}

export async function triggerVisualFromQueue(item: VisualQueueItem): Promise<void> {
  _aborted = false
  let scenario: Scenario = useScenarioStore.getState().scenario
  const scenarioId = scenario.id
  const chat = useForgeChatStore.getState()

  chat.appendMessage(scenarioId, {
    role: 'user',
    text: `[智能体提交 · 生成视觉锚点]${
      item.scenarioId && item.scenarioId !== scenarioId
        ? `\n（请求目标 ${item.scenarioId}，当前对 active 剧本「${scenario.title}」执行）`
        : ''
    }`,
  })

  const imgClient = createImageProvider()
  if (imgClient.getProviderName() === 'Mock') {
    chat.appendMessage(scenarioId, {
      role: 'system',
      text: '[视觉] 未配置图像服务（Mock provider），无法出图。请确认宿主图像网关可用。',
    })
    return
  }

  try {
    // ── Stage A: 提取锚点（角色 / 场景 / 道具）—— 仅在缺失时跑 ────────────────
    // 关键修复：screenplay 导入只带场景、没有 characters 字段，旧版只蒸馏场景/道具，
    // 角色永远为空 → 永远没有定妆照。这里把"角色"也纳入蒸馏，从对白发言人 + 画面
    // 线索里反向提取主要人物，再交给 Stage B 出三视图定妆照。
    const hasChar = Object.keys(scenario.characters ?? {}).length > 0
    const hasLoc = Object.keys(scenario.locations ?? {}).length > 0
    const hasProp = Object.keys(scenario.props ?? {}).length > 0
    if (!hasChar || !hasLoc || !hasProp) {
      chat.setPending(scenarioId, {
        reason: 'forging',
        startedAt: Date.now(),
        stages: [{ label: '提取锚点', detail: '从剧本蒸馏角色 / 场景 / 关键道具', at: Date.now() }],
        streamTail: '',
        streamBytes: 0,
        abortable: false,
      })
      const llm = createTextProvider()
      const [chars, locs, props] = await Promise.all([
        hasChar ? Promise.resolve<Character[]>([]) : distillCharacters(llm, scenario),
        hasLoc ? Promise.resolve<Location[]>([]) : distillLocations(llm, scenario),
        hasProp ? Promise.resolve<Prop[]>([]) : distillProps(llm, scenario),
      ])
      if (_aborted) return
      const ss = useScenarioStore.getState()
      for (const c of chars) ss.upsertCharacter(c)
      for (const l of locs) ss.upsertLocation(l)
      for (const p of props) ss.upsertProp(p)
      if (locs.length > 0) backfillLocationIds(locs)
      if (props.length > 0) backfillPropIds(props)
      scenario = useScenarioStore.getState().scenario
      chat.appendMessage(scenarioId, {
        role: 'assistant',
        text: `锚点提取完成 · 新增 ${chars.length} 角色 · ${locs.length} 场景 · ${props.length} 关键道具`,
      })
    }

    if (_aborted) return

    // ── Stage B: 锚点出图（角色定妆照 + 场景基准图(多角度) + 关键道具图）──────
    // 默认跳过已有 ref 的实体（幂等、省 token）；item.force=true 时全量重生。
    const full = useScenarioStore.getState().scenario
    const pick = <T>(
      dict: Record<string, T> | undefined,
      hasRef: (v: T) => boolean,
    ): Record<string, T> => {
      const src = dict ?? {}
      if (item.force) return { ...src }
      const out: Record<string, T> = {}
      for (const [id, v] of Object.entries(src)) if (!hasRef(v)) out[id] = v
      return out
    }
    const passScenario: Scenario = {
      ...full,
      characters: pick(full.characters, (c) => !!(c.turnaroundRefImageId || c.refImageId)),
      locations: pick(full.locations, (l) => !!l.refImageId),
      props: pick(full.props, (p) => !!p.refImageId),
    }

    const charCount = Object.keys(passScenario.characters ?? {}).length
    const locCount = Object.keys(passScenario.locations ?? {}).length
    const propCount = Object.keys(passScenario.props ?? {}).length

    if (charCount === 0 && locCount === 0 && propCount === 0) {
      chat.appendMessage(scenarioId, {
        role: 'assistant',
        text: '视觉锚点已是最新（无待生成的角色 / 场景 / 道具）。如需重生可带 force。',
      })
      return
    }

    chat.setPending(scenarioId, {
      reason: 'forging',
      startedAt: Date.now(),
      stages: [
        {
          label: '生成视觉锚点',
          detail: `${charCount} 角色 · ${locCount} 场所 · ${propCount} 道具`,
          at: Date.now(),
        },
      ],
      streamTail: '',
      streamBytes: 0,
      abortable: false,
    })

    const mediaStore = useMediaStore.getState()
    const scenarioStore = useScenarioStore.getState()
    await characterRefPass({
      scenario: passScenario,
      client: imgClient,
      onCharacterRef: (characterId, result) => {
        const mediaId = mediaStore.ingestDataUrl(result.dataUrl, {
          name: `turnaround-${characterId}.png`,
          promptKind: 'character-ref',
          tags: ['turnaround'],
          humanReadableName: `角色定妆照 · ${characterId}`,
        })
        scenarioStore.setCharacterTurnaroundRef(characterId, mediaId)
      },
      onLocationRef: (locationId, result) => {
        const mediaId = mediaStore.ingestDataUrl(result.dataUrl, {
          name: `loc-ref-${locationId}.png`,
          promptKind: 'location-ref',
          humanReadableName: `场景基准 · ${locationId}`,
        })
        scenarioStore.setLocationRefImage(locationId, mediaId)
      },
      onLocationAngleRef: (locationId, angle, result) => {
        const mediaId = mediaStore.ingestDataUrl(result.dataUrl, {
          name: `loc-${locationId}-${angle.id}.png`,
          promptKind: 'location-ref',
          humanReadableName: `场景角度 · ${locationId} · ${angle.label}`,
        })
        scenarioStore.addLocationAngleRef(locationId, {
          id: angle.id,
          label: angle.label,
          anglePrompt: angle.anglePrompt,
          mediaId,
        })
      },
      onPropRef: (propId, result) => {
        const mediaId = mediaStore.ingestDataUrl(result.dataUrl, {
          name: `prop-ref-${propId}.png`,
          promptKind: 'prop-ref',
          humanReadableName: `道具参考 · ${propId}`,
        })
        scenarioStore.setPropRefImage(propId, mediaId)
      },
      onProgress: (ev) => {
        const kindLabel =
          ev.kind === 'character' ? '角色' : ev.kind === 'location' ? '场所' : '道具'
        useForgeChatStore.getState().appendPendingStage(scenarioId, {
          label: `锚点出图 ${ev.done}/${ev.total}`,
          detail: `${kindLabel} · ${ev.name}`,
        })
      },
    })

    if (_aborted) return

    chat.appendMessage(scenarioId, {
      role: 'assistant',
      text: `视觉锚点生成完成 · ${charCount} 角色定妆照 · ${locCount} 场景基准图 · ${propCount} 道具图`,
    })
    broadcastScenarioAdopt(useScenarioStore.getState().scenario)
  } catch (e) {
    const msg = (e as Error).message ?? String(e)
    chat.appendMessage(scenarioId, { role: 'system', text: `[视觉生成失败] ${msg}` })
  } finally {
    useForgeChatStore.getState().clearPending(scenarioId)
  }
}
