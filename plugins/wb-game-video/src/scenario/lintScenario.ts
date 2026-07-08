import type {
  BranchCondition,
  ConditionClause,
  QTESpec,
  Scenario,
  Scene,
} from './types'
import { detectOrphans } from './reconnectOrphans'

export type LintSeverity = 'error' | 'warn' | 'info'

export interface LintIssue {
  code: string
  severity: LintSeverity
  message: string
  sceneId?: string
  branchId?: string
}

export interface LintReport {
  issues: LintIssue[]
  errorCount: number
  warnCount: number
  infoCount: number
  /** true when errorCount === 0 */
  ok: boolean
}

function push(
  issues: LintIssue[],
  issue: LintIssue,
): void {
  issues.push(issue)
}

function sceneIds(scenario: Scenario): Set<string> {
  return new Set(Object.keys(scenario.scenes))
}

function hasScene(ids: Set<string>, id: string | undefined): boolean {
  return !!id && ids.has(id)
}

function reachableFromRoot(scenario: Scenario): Set<string> {
  const visited = new Set<string>()
  const queue: string[] = []
  if (scenario.rootSceneId && scenario.scenes[scenario.rootSceneId]) {
    queue.push(scenario.rootSceneId)
  }
  while (queue.length > 0) {
    const id = queue.shift()!
    if (visited.has(id)) continue
    visited.add(id)
    const scene = scenario.scenes[id]
    if (!scene) continue
    for (const b of scene.branches ?? []) {
      if (b.targetSceneId && scenario.scenes[b.targetSceneId]) {
        queue.push(b.targetSceneId)
      }
    }
    for (const h of scene.hotspots ?? []) {
      if (h.targetSceneId && scenario.scenes[h.targetSceneId]) {
        queue.push(h.targetSceneId)
      }
    }
    if (scene.boss?.winSceneId && scenario.scenes[scene.boss.winSceneId]) {
      queue.push(scene.boss.winSceneId)
    }
    if (scene.boss?.loseSceneId && scenario.scenes[scene.boss.loseSceneId]) {
      queue.push(scene.boss.loseSceneId)
    }
    for (const cue of scene.qte?.cues ?? []) {
      const fail = cue.slowMo?.failSceneId
      if (fail && scenario.scenes[fail]) queue.push(fail)
    }
    if (scene.entryGate?.redirectSceneId && scenario.scenes[scene.entryGate.redirectSceneId]) {
      queue.push(scene.entryGate.redirectSceneId)
    }
  }
  return visited
}

function endingReachable(scenario: Scenario, reachable: Set<string>): boolean {
  for (const id of reachable) {
    const s = scenario.scenes[id]
    if (!s) continue
    if (s.isEnding) return true
    const branches = s.branches ?? []
    if (branches.length === 0) return true
  }
  return false
}

function lintBranches(
  issues: LintIssue[],
  scenario: Scenario,
  ids: Set<string>,
): void {
  for (const scene of Object.values(scenario.scenes)) {
    for (const branch of scene.branches ?? []) {
      if (!hasScene(ids, branch.targetSceneId)) {
        push(issues, {
          code: 'branch.dangling_target',
          severity: 'error',
          sceneId: scene.id,
          branchId: branch.id,
          message: `分支「${branch.label ?? branch.id}」指向不存在的场景 ${branch.targetSceneId}`,
        })
      }
      lintCondition(issues, scenario, ids, branch.condition, scene.id, branch.id)
      for (const eff of branch.effects ?? []) {
        if ((eff.kind === 'var' || eff.kind === 'flag') && eff.varId && !scenario.variables?.[eff.varId]) {
          push(issues, {
            code: 'branch.unknown_var_effect',
            severity: 'error',
            sceneId: scene.id,
            branchId: branch.id,
            message: `分支副作用引用未知变量 ${eff.varId}`,
          })
        }
        if (eff.kind === 'item' && eff.itemId && !scenario.items?.[eff.itemId]) {
          push(issues, {
            code: 'branch.unknown_item_effect',
            severity: 'error',
            sceneId: scene.id,
            branchId: branch.id,
            message: `分支物品副作用引用未知物品 ${eff.itemId}`,
          })
        }
        if (eff.kind === 'entityStat' && eff.entityId && !scenario.entities?.[eff.entityId]) {
          push(issues, {
            code: 'branch.unknown_entity_effect',
            severity: 'error',
            sceneId: scene.id,
            branchId: branch.id,
            message: `分支副作用引用未知实体 ${eff.entityId}`,
          })
        }
        if (eff.kind === 'status' && eff.statusId && !scenario.statuses?.[eff.statusId]) {
          push(issues, {
            code: 'branch.unknown_status_effect',
            severity: 'error',
            sceneId: scene.id,
            branchId: branch.id,
            message: `分支副作用引用未知状态 ${eff.statusId}`,
          })
        }
      }
    }
  }
}

function lintCondition(
  issues: LintIssue[],
  scenario: Scenario,
  ids: Set<string>,
  condition: BranchCondition | undefined,
  sceneId: string,
  branchId?: string,
): void {
  if (!condition?.all?.length) return
  for (const clause of condition.all) {
    lintClause(issues, scenario, ids, clause, sceneId, branchId)
  }
}

function lintClause(
  issues: LintIssue[],
  scenario: Scenario,
  ids: Set<string>,
  clause: ConditionClause,
  sceneId: string,
  branchId?: string,
): void {
  const base = { sceneId, branchId }
  switch (clause.type) {
    case 'var':
    case 'flag':
      if (!scenario.variables?.[clause.varId]) {
        push(issues, {
          code: 'condition.unknown_var',
          severity: 'error',
          ...base,
          message: `条件引用未知变量 ${clause.varId}`,
        })
      }
      break
    case 'visited':
      if (!hasScene(ids, clause.sceneId)) {
        push(issues, {
          code: 'condition.unknown_scene',
          severity: 'error',
          ...base,
          message: `条件引用未知场景 ${clause.sceneId}`,
        })
      }
      break
    case 'hasItem':
      if (!scenario.items?.[clause.itemId]) {
        push(issues, {
          code: 'condition.unknown_item',
          severity: 'error',
          ...base,
          message: `条件引用未知物品 ${clause.itemId}`,
        })
      }
      break
    case 'hpRatio':
      if (!scenario.entities?.[clause.entityId]) {
        push(issues, {
          code: 'condition.unknown_entity',
          severity: 'error',
          ...base,
          message: `条件引用未知实体 ${clause.entityId}`,
        })
      }
      break
    case 'status':
      if (!scenario.statuses?.[clause.statusId]) {
        push(issues, {
          code: 'condition.unknown_status',
          severity: 'error',
          ...base,
          message: `条件引用未知状态 ${clause.statusId}`,
        })
      }
      if (clause.entityId && !scenario.entities?.[clause.entityId]) {
        push(issues, {
          code: 'condition.unknown_entity',
          severity: 'error',
          ...base,
          message: `状态条件引用未知实体 ${clause.entityId}`,
        })
      }
      break
    case 'score':
      break
    case 'attrCompare':
      for (const entityId of [clause.left, clause.right]) {
        if (!scenario.entities?.[entityId]) {
          push(issues, {
            code: 'condition.unknown_entity',
            severity: 'error',
            ...base,
            message: `属性比较条件引用未知实体 ${entityId}`,
          })
        }
      }
      break
  }
}

function lintQte(
  issues: LintIssue[],
  scenario: Scenario,
  ids: Set<string>,
  scene: Scene,
  qte: QTESpec | undefined,
): void {
  if (!qte) return
  const { perfect, great, good } = qte.window
  if (!(perfect <= great && great <= good)) {
    push(issues, {
      code: 'qte.window_not_monotonic',
      severity: 'error',
      sceneId: scene.id,
      message: `QTE 命中窗口须满足 perfect≤great≤good（当前 ${perfect}/${great}/${good}）`,
    })
  }
  for (const cue of qte.cues ?? []) {
    if (cue.targetAt < 0 || cue.targetAt > scene.durationMs) {
      push(issues, {
        code: 'qte.cue_out_of_range',
        severity: 'warn',
        sceneId: scene.id,
        message: `QTE 节奏点 ${cue.id} 的 targetAt 超出场景时长`,
      })
    }
    const fail = cue.slowMo?.failSceneId
    if (fail && !hasScene(ids, fail)) {
      push(issues, {
        code: 'qte.fail_scene_missing',
        severity: 'error',
        sceneId: scene.id,
        message: `QTE 慢放失败跳转指向不存在的场景 ${fail}`,
      })
    }
    const rate = cue.slowMo?.rate
    if (rate !== undefined && (rate <= 0.05 || rate >= 1)) {
      push(issues, {
        code: 'qte.slowmo_rate_invalid',
        severity: 'warn',
        sceneId: scene.id,
        message: `QTE 慢放倍率须在 (0.05, 1) 内（当前 ${rate}）`,
      })
    }
  }
}

function lintGameplay(
  issues: LintIssue[],
  scenario: Scenario,
  ids: Set<string>,
  scene: Scene,
): void {
  if (scene.kind === 'battle' && scene.boss) {
    const boss = scene.boss
    if (!scenario.entities?.[boss.entityId]) {
      push(issues, {
        code: 'boss.unknown_entity',
        severity: 'error',
        sceneId: scene.id,
        message: `Boss 战引用未知实体 ${boss.entityId}`,
      })
    }
    if (boss.playerEntityId && !scenario.entities?.[boss.playerEntityId]) {
      push(issues, {
        code: 'boss.unknown_player_entity',
        severity: 'error',
        sceneId: scene.id,
        message: `Boss 战玩家实体 ${boss.playerEntityId} 不存在`,
      })
    }
    if (!boss.rounds?.length) {
      push(issues, {
        code: 'boss.no_rounds',
        severity: 'error',
        sceneId: scene.id,
        message: 'Boss 战缺少 rounds[]',
      })
    }
    if (boss.winSceneId && !hasScene(ids, boss.winSceneId)) {
      push(issues, {
        code: 'boss.win_missing',
        severity: 'error',
        sceneId: scene.id,
        message: `Boss 胜利跳转 ${boss.winSceneId} 不存在`,
      })
    }
    if (boss.loseSceneId && !hasScene(ids, boss.loseSceneId)) {
      push(issues, {
        code: 'boss.lose_missing',
        severity: 'error',
        sceneId: scene.id,
        message: `Boss 失败跳转 ${boss.loseSceneId} 不存在`,
      })
    }
    if (boss.perfectFlagVarId && !scenario.variables?.[boss.perfectFlagVarId]) {
      push(issues, {
        code: 'boss.unknown_perfect_flag',
        severity: 'warn',
        sceneId: scene.id,
        message: `Boss 完美通关标记变量 ${boss.perfectFlagVarId} 未注册`,
      })
    }
  }

  for (const hs of scene.hotspots ?? []) {
    if (!hasScene(ids, hs.targetSceneId)) {
      push(issues, {
        code: 'hotspot.target_missing',
        severity: 'error',
        sceneId: scene.id,
        message: `热点 ${hs.id} 指向不存在的场景 ${hs.targetSceneId}`,
      })
    }
  }

  if (scene.entryGate?.redirectSceneId && !hasScene(ids, scene.entryGate.redirectSceneId)) {
    push(issues, {
      code: 'entry_gate.redirect_missing',
      severity: 'error',
      sceneId: scene.id,
      message: `进入门槛改道场景 ${scene.entryGate.redirectSceneId} 不存在`,
    })
  }
  lintCondition(issues, scenario, ids, scene.entryGate?.condition, scene.id)

  for (const eff of scene.onEnterEffects ?? []) {
    if ((eff.kind === 'var' || eff.kind === 'flag') && eff.varId && !scenario.variables?.[eff.varId]) {
      push(issues, {
        code: 'scene.unknown_on_enter_var',
        severity: 'error',
        sceneId: scene.id,
        message: `进入场景副作用引用未知变量 ${eff.varId}`,
      })
    }
    if (eff.kind === 'item' && eff.itemId && !scenario.items?.[eff.itemId]) {
      push(issues, {
        code: 'scene.unknown_on_enter_item',
        severity: 'error',
        sceneId: scene.id,
        message: `进入场景副作用引用未知物品 ${eff.itemId}`,
      })
    }
    if (eff.kind === 'entityStat' && eff.entityId && !scenario.entities?.[eff.entityId]) {
      push(issues, {
        code: 'scene.unknown_on_enter_entity',
        severity: 'error',
        sceneId: scene.id,
        message: `进入场景副作用引用未知实体 ${eff.entityId}`,
      })
    }
    if (eff.kind === 'status' && eff.statusId && !scenario.statuses?.[eff.statusId]) {
      push(issues, {
        code: 'scene.unknown_on_enter_status',
        severity: 'error',
        sceneId: scene.id,
        message: `进入场景副作用引用未知状态 ${eff.statusId}`,
      })
    }
  }
  for (const loot of scene.searchLoot ?? []) {
    if (loot.itemId && !scenario.items?.[loot.itemId]) {
      push(issues, {
        code: 'scene.unknown_loot_item',
        severity: 'error',
        sceneId: scene.id,
        message: `搜寻热点引用未知物品 ${loot.itemId}`,
      })
    }
  }

  lintQte(issues, scenario, ids, scene, scene.qte)
}

function lintMedia(issues: LintIssue[], scene: Scene): void {
  if (scene.durationMs <= 0) {
    push(issues, {
      code: 'scene.duration_invalid',
      severity: 'warn',
      sceneId: scene.id,
      message: '场景 durationMs 应大于 0',
    })
  }
  const media = scene.media
  if (!media) return
  if (media.kind !== 'PLACEHOLDER' && !media.ref?.trim()) {
    push(issues, {
      code: 'media.ref_missing',
      severity: 'warn',
      sceneId: scene.id,
      message: `场景媒体类型为 ${media.kind} 但未绑定 ref（试玩可能只有占位）`,
    })
  }
}

function summarize(issues: LintIssue[]): LintReport {
  let errorCount = 0
  let warnCount = 0
  let infoCount = 0
  for (const i of issues) {
    if (i.severity === 'error') errorCount += 1
    else if (i.severity === 'warn') warnCount += 1
    else infoCount += 1
  }
  return {
    issues,
    errorCount,
    warnCount,
    infoCount,
    ok: errorCount === 0,
  }
}

/**
 * lintScenario —— Scenario JSON 机械质检（确定性、无 LLM）。
 *
 * 覆盖：结构可达性、分支野指针、玩法引用、QTE 窗口、媒体完整性提示。
 * 不阻断保存；供质检面板与 gvid:lint-scenario 共用。
 */
export function lintScenario(scenario: Scenario): LintReport {
  const issues: LintIssue[] = []
  const ids = sceneIds(scenario)

  if (!scenario.rootSceneId || !scenario.scenes[scenario.rootSceneId]) {
    push(issues, {
      code: 'root.missing',
      severity: 'error',
      message: `rootSceneId「${scenario.rootSceneId ?? '(空)'}」不存在`,
    })
  }

  lintBranches(issues, scenario, ids)

  const reachable = reachableFromRoot(scenario)
  for (const id of ids) {
    if (!reachable.has(id)) {
      const s = scenario.scenes[id]
      push(issues, {
        code: 'graph.unreachable',
        severity: 'warn',
        sceneId: id,
        message: `场景「${s?.title ?? id}」从起点不可达（孤儿节点）`,
      })
    }
  }

  if (reachable.size > 0 && !endingReachable(scenario, reachable)) {
    push(issues, {
      code: 'graph.no_ending',
      severity: 'error',
      message: '从起点可达的子图里没有结局（无出边且未标 isEnding 的可达节点）',
    })
  }

  for (const orphan of detectOrphans(scenario)) {
    push(issues, {
      code: 'graph.dangling_branch',
      severity: 'warn',
      sceneId: orphan.sceneId,
      message: `场景「${orphan.title}」出边断链（无有效分支且非结局）`,
    })
  }

  for (const scene of Object.values(scenario.scenes)) {
    lintGameplay(issues, scenario, ids, scene)
    lintMedia(issues, scene)

    if (scene.episodeId && scenario.episodes?.length) {
      const ep = scenario.episodes.find((e) => e.id === scene.episodeId)
      if (!ep) {
        push(issues, {
          code: 'episode.unknown',
          severity: 'warn',
          sceneId: scene.id,
          message: `场景引用未知剧集 ${scene.episodeId}`,
        })
      }
    }
    for (const cid of scene.characterIds ?? []) {
      if (!scenario.characters?.[cid]) {
        push(issues, {
          code: 'scene.unknown_character',
          severity: 'warn',
          sceneId: scene.id,
          message: `场景引用未知角色 ${cid}`,
        })
      }
    }
    if (scene.locationId && !scenario.locations?.[scene.locationId]) {
      push(issues, {
        code: 'scene.unknown_location',
        severity: 'warn',
        sceneId: scene.id,
        message: `场景引用未知场所 ${scene.locationId}`,
      })
    }
  }

  for (const ent of Object.values(scenario.entities ?? {})) {
    if (ent.maxHp <= 0) {
      push(issues, {
        code: 'entity.invalid_max_hp',
        severity: 'warn',
        message: `实体「${ent.name}」maxHp 应大于 0`,
      })
    }
  }

  return summarize(issues)
}
