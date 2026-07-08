import { useState } from 'react'

import { useScenarioStore } from '../scenario/scenarioStore'
import { VIDEO_CLIPS, UI_SCHEMES, getVideoClip, builtinMediaIdForClip, clipIdFromMediaRef } from '../scenario/gameAssetCatalog'
import { CALC_TYPE_CATALOG, calcTypeMethod, type CalcTypeId } from '../scenario/calcTypes'
import {
  branchOutcomeLabels,
  formatSettlementTime,
  listPerformanceSettlements,
} from '../scenario/performanceSettlement'
import { useShellStore } from '../shell/shellStore'
import { injectStyleOnce } from '../styles/injectStyle'
import { BranchGateEditor } from '../editor/numeric/NumericEditors'
import { resolveInteraction } from '../player/choiceTiming'
import type { BossRound, Branch, ChoiceSpec, Effect, EntityStatEffect, GameVariable, QTESpec, Scenario, Scene, VarEffect } from '../scenario/types'
import type { ChoiceUi, DecisionFireAt, HudPreset, MediaPlayMode, QteKind, QteUi } from '../scenario/gameplayTypes'

/**
 * BlueprintGameplayPanel —— 蓝图视图右侧「玩法字段」可视化编辑面板(v9 M8)。
 *
 * 选中蓝图节点后出现，按 Scene.kind 上色，让作者直接编辑玩法骨架(无需手写 JSON):
 *   - 场景类别(kind)：story/battle/qte/choice，切换即给节点重新上色;
 *   - 限时选择(decision)：模式 + 倒计时 + 提示文案;
 *   - Boss 战(kind=battle)：Boss/玩家实体、胜负跳转、完美 flag、回合列表(增删/伤害);
 *
 * 不含：子流程返回点 / AI 视频生成 / ext 扩展属性 —— 前者属叙事热点子图，
 * 后两者走资产板与对话侧 Nodia，不在蓝图玩法右栏编辑。
 *
 * 与时间轴的分工（同一 Scenario SSOT，双视图）：
 *   - 蓝图右栏：节点骨架 —— clip 绑定、calcType、optType、分支条件/跳转/effects、
 *     进入属性、剧情标记、Boss 骨架；结算列表只读预览 +「视频编辑」跳转。
 *   - 视频 Tab 时间轴 · 组件详情：窗口时刻、飘字/QTE/字幕/选项的表现与坐标 —
 *     选中时间轴 clip 后在 MaterialInspector 编辑（CatalogTabs）。
 *
 * 全部经 scenarioStore.updateScene 落同一 Scenario(SSOT)——蓝图、剧情树、运行时
 * 立刻同步。缺省字段不写，保持旧剧本零回归。
 */
function isTimedChoice(choice: ChoiceSpec | undefined): boolean {
  return choice?.timed === true
}

/** 交互类型下拉的四档值 —— 由 presence 派生（不落库）。 */
type InteractionOpt = 'none' | 'static' | 'timed' | 'qte'

function newQteSpec(): QTESpec {
  return {
    cues: [],
    tolerance: { perfect: 80, great: 160, good: 280 },
    score: { perfect: 100, great: 60, good: 25, miss: -30 },
  }
}

/** 读某组 effects 里 hp entityStat 的伤害绝对值（0 = 无）。 */
function hpEffectValue(effects: Effect[] | undefined): number {
  const hp = (effects ?? []).find(
    (e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp',
  )
  return hp ? Math.abs(hp.value) : 0
}

function firstEntityId(scenario: Scenario, kind: 'boss' | 'player'): string {
  return Object.values(scenario.entities ?? {}).find((e) => e.kind === kind)?.id ?? `ent-${kind}`
}

function withHpEffect(effects: Effect[] | undefined, scenario: Scenario, target: 'boss' | 'player', value: number, idPrefix: string): Effect[] {
  const entityId = firstEntityId(scenario, target)
  const effect: EntityStatEffect = {
    id: `${idPrefix}-${target}-hp`,
    kind: 'entityStat',
    entityId,
    stat: 'hp',
    op: 'add',
    value: -Math.abs(Number.isFinite(value) ? value : 0),
  }
  const list = effects ?? []
  return list.some((e) => e.kind === 'entityStat' && e.stat === 'hp')
    ? list.map((e) => (e.kind === 'entityStat' && e.stat === 'hp' ? effect : e))
    : [effect, ...list]
}

export function BlueprintGameplayPanel({ onCollapse }: { onCollapse?: () => void }) {
  injectStyleOnce('bp-gameplay-panel', PANEL_CSS)
  const scenario = useScenarioStore((s) => s.scenario)
  const selectedSceneId = useScenarioStore((s) => s.selectedSceneId)
  const updateScene = useScenarioStore((s) => s.updateScene)
  const upsertVariable = useScenarioStore((s) => s.upsertVariable)

  const scene = scenario.scenes[selectedSceneId]
  if (!scene) return null
  const activeScene = scene

  const interaction = resolveInteraction(scene)
  const panelKind =
    interaction.type === 'boss'
      ? 'battle'
      : interaction.type === 'qte'
        ? 'qte'
        : interaction.type === 'choice'
          ? 'choice'
          : 'story'
  const clip = getVideoClip(clipIdFromMediaRef(scene.media?.ref))
  const sceneIds = Object.keys(scenario.scenes)
  const entityEntries = Object.entries(scenario.entities ?? {})
  const bossEntities = entityEntries.filter(([, e]) => e.kind === 'boss')
  const playerEntities = entityEntries.filter(([, e]) => e.kind === 'player')
  const flagVars = Object.values(scenario.variables ?? {}).filter((v) => v.kind === 'flag')
  const numberVars = Object.values(scenario.variables ?? {}).filter((v) => v.kind === 'number')
  const items = Object.values(scenario.items ?? {})
  const choiceBranches = scene.branches.filter((b) => b.kind === 'choice')
  const qteBranches = scene.branches.filter((b) => b.kind === 'qte_pass' || b.kind === 'qte_fail')
  const isCalcNode = Boolean(scene.calc)
  const isQteNode = interaction.type === 'qte'
  const gateBranches = isCalcNode
    ? scene.branches.filter((b) => b.kind !== 'auto')
    : isQteNode
      ? qteBranches
      : choiceBranches
  const qteCues = scene.qte?.cues ?? []
  const battleParryMultiCue =
    isQteNode && scene.qte?.ui === 'battleParry' && qteCues.length > 1
  const timedChoice = isTimedChoice(scene.choice)
  const sceneTitles = scenario.scenes

  // 当前交互形态投影成下拉四档值（presence 派生）。
  const interactionOpt: InteractionOpt =
    interaction.type === 'qte'
      ? 'qte'
      : interaction.type === 'choice'
        ? scene.choice?.timed
          ? 'timed'
          : 'static'
        : 'none'

  /** 切换交互形态 —— 互斥写入 qte / choice（boss/calc 由各自区块管理）。 */
  function setInteractionOpt(v: InteractionOpt): void {
    if (v === 'none') {
      updateScene(selectedSceneId, {
        choice: undefined,
        qte: undefined,
        branches: activeScene.branches.map((branch) =>
          branch.kind === 'choice' ? { ...branch, kind: 'auto' } : branch,
        ),
      })
      return
    }
    if (v === 'qte') {
      updateScene(selectedSceneId, {
        qte: activeScene.qte ?? newQteSpec(),
        choice: undefined,
        calc: undefined,
      })
      return
    }
    const cur: ChoiceSpec = activeScene.choice ?? { prompt: '请选择' }
    updateScene(selectedSceneId, {
      choice: { ...cur, timed: v === 'timed' },
      qte: undefined,
      calc: undefined,
    })
  }

  /** 局部更新 choice（仅当已是 choice 形态时）。 */
  function setChoice(patch: Partial<ChoiceSpec>): void {
    const cur: ChoiceSpec = activeScene.choice ?? {}
    updateScene(selectedSceneId, { choice: { ...cur, ...patch } })
  }

  /** 局部更新 qte（仅当已是 qte 形态时）。 */
  function setQte(patch: Partial<QTESpec>): void {
    const cur: QTESpec = activeScene.qte ?? newQteSpec()
    updateScene(selectedSceneId, { qte: { ...cur, ...patch } })
  }

  function setRounds(rounds: BossRound[]): void {
    if (!activeScene.boss) return
    updateScene(selectedSceneId, { boss: { ...activeScene.boss, rounds } })
  }

  function setChoiceUi(choiceUi: ChoiceUi): void {
    setChoice({ ui: choiceUi === 'default' ? undefined : choiceUi })
  }

  function setQteUi(qteUi: QteUi): void {
    setQte({ ui: qteUi === 'default' ? undefined : qteUi })
  }

  function defaultChoiceTarget(): string {
    return Object.keys(scenario.scenes).find((id) => id !== selectedSceneId) ?? selectedSceneId
  }

  function addChoiceBranch(): void {
    const id = `choice-${Date.now().toString(36)}`
    updateScene(selectedSceneId, {
      choice: activeScene.choice ?? { prompt: '请选择' },
      qte: undefined,
      calc: undefined,
      branches: [
        ...activeScene.branches,
        {
          id,
          kind: 'choice',
          label: `选项 ${choiceBranches.length + 1}`,
          targetSceneId: defaultChoiceTarget(),
        },
      ],
    })
  }

  function removeChoiceBranch(branchId: string): void {
    const branches = activeScene.branches.filter((b) => b.id !== branchId)
    const hasChoice = branches.some((b) => b.kind === 'choice')
    updateScene(selectedSceneId, {
      branches,
      choice: hasChoice ? activeScene.choice : undefined,
    })
  }

  return (
    <div className={`ks-bgp ks-kind-${panelKind}`} data-testid="bp-gameplay-panel">
      <div className="ks-bgp-head">
        <div className="ks-bgp-head-main">
          <span className="ks-bgp-title">{scene.title || selectedSceneId}</span>
          <span className="ks-bgp-sub">玩法字段</span>
        </div>
        {onCollapse && (
          <button
            type="button"
            className="ks-bgp-collapse"
            aria-label="收起配置"
            title="收起"
            onClick={onCollapse}
          >
            收起 ›
          </button>
        )}
      </div>

      <div className="ks-bgp-content">
      {/* 演出 —— 对齐原型「演出」组：演出编号取自「视频」固定库 */}
      <section className="ks-bgp-sec">
        <label className="ks-bgp-lbl" title="当前节点引用的视频片段与播放方式。">演出</label>
        <div className="ks-bgp-field">
          <span className="ks-bgp-fk" title="绑定到该节点的视频片段；无则表示纯逻辑或占位节点。">演出编号</span>
          <select
            className="ks-bgp-input"
            value={clipIdFromMediaRef(scene.media?.ref) ?? ''}
            onChange={(e) => {
              const clipId = e.target.value || undefined
              const picked = clipId ? getVideoClip(clipId) : undefined
              const ref = clipId ? builtinMediaIdForClip(clipId) : undefined
              updateScene(selectedSceneId, {
                media: ref ? { kind: 'VIDEO', ref } : { kind: 'PLACEHOLDER' },
                durationMs: picked?.durMs ?? scene.durationMs,
              })
            }}
          >
            <option value="">无</option>
            {VIDEO_CLIPS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="ks-bgp-field">
          <span className="ks-bgp-fk" title="视频片段库里的类型信息，只读展示。">视频类型</span>
          <span className="ks-bgp-fv">{clip?.type ?? '—'}</span>
        </div>
        {clip && (
          <div className="ks-bgp-field">
            <span className="ks-bgp-fk" title="单次播放或循环播放；loop 常用于待机/探索场合。">演出方式</span>
            <select
              className="ks-bgp-input"
              value={scene.mediaPlayMode ?? (clip.type === 'loop' ? 'loop' : 'once')}
              onChange={(e) =>
                updateScene(selectedSceneId, {
                  mediaPlayMode:
                    (e.target.value as MediaPlayMode) === 'once'
                      ? undefined
                      : (e.target.value as MediaPlayMode),
                })
              }
            >
              <option value="once">单次</option>
              <option value="loop">循环</option>
            </select>
          </div>
        )}
        <div className="ks-bgp-field">
          <span className="ks-bgp-fk" title="来自视频片段库的时长信息，只读展示。">演出时长</span>
          <span className="ks-bgp-fv">
            {clip?.durMs != null ? `${Math.round(clip.durMs / 1000)}s` : '—'}
          </span>
        </div>
      </section>

      {/* 界面 —— HUD 方案取自左栏「界面」固定库（UI_SCHEMES），二者同源 */}
      <section className="ks-bgp-sec">
        <label className="ks-bgp-lbl" title="该节点播放时叠加的 HUD 方案，例如战斗界面、探索界面或隐藏界面。">界面</label>
        <div className="ks-bgp-field">
          <span className="ks-bgp-fk" title="只控制显示层，不等同于节点的玩法逻辑。">HUD 方案</span>
          <select
            className="ks-bgp-input"
            value={scene.hudPreset ?? 'main'}
            onChange={(e) =>
              updateScene(selectedSceneId, {
                hudPreset:
                  (e.target.value as HudPreset) === 'main'
                    ? undefined
                    : (e.target.value as HudPreset),
              })
            }
          >
            {UI_SCHEMES.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        {/* HUD 方案说明：main/battle/explore/hidden/narrative（叙事主界面，国风四维 HUD） */}
      </section>

      <CalcSection
        scene={scene}
        clip={clip}
        durationMs={scene.durationMs}
        onCalcType={(calcType) =>
          updateScene(selectedSceneId, {
            calc: calcType ? { calcType } : undefined,
            ...(calcType ? { qte: undefined, choice: undefined } : {}),
          })
        }
        onOpenVideo={() => useShellStore.getState().setForgeView('video')}
      />

      {/* 选项 —— 与「计算类型=无」互斥；选中计算类型后本组自动隐藏 */}
      {!isCalcNode && (
      <section className="ks-bgp-sec">
        <label className="ks-bgp-lbl" title="配置该节点是否弹出选项、倒计时或 QTE；实际去向由 choice / qte 分支连线决定。">
          {isQteNode ? 'QTE 交互' : '选项'}
        </label>
        {interaction.type === 'choice' && (
          <p className="ks-bgp-hint">
            窗口时间、提示文案、清单/热区呈现、热区坐标 → 在视频 Tab 时间轴选中「选项」控件编辑。
          </p>
        )}
        <div className="ks-bgp-field">
          <span className="ks-bgp-fk">类型</span>
          <select
            className="ks-bgp-input"
            value={interactionOpt}
            onChange={(e) => setInteractionOpt(e.target.value as InteractionOpt)}
          >
            <option value="none">无（场景结束出选项）</option>
            <option value="static">不限时选项</option>
            <option value="timed">限时选项</option>
            <option value="qte">QTE</option>
          </select>
        </div>

        {isQteNode ? (
          <>
            <p className="ks-bgp-hint">
              视频 Tab：「QTE 按键点」轨编辑各次按键的时刻/坐标；「QTE 窗口」轨编辑整段生效时段与超时（不是选项清单）。
            </p>
            {battleParryMultiCue ? (
              <p className="ks-bgp-hint ks-bgp-hint-warn">
                已配置 {qteCues.length} 个按键点：「战斗防反按键」仅支持单 cue，试玩将自动改用默认 QTE 圆点（与时间轴坐标一致）。
              </p>
            ) : scene.qte?.ui === 'battleParry' && qteCues.length === 1 ? (
              <p className="ks-bgp-hint">
                试玩为 A/B 墨章防反 UI，圆点位置与时间轴 cue 坐标无关；要按坐标试玩请改「默认 QTE 按钮」。
              </p>
            ) : null}
            <div className="ks-bgp-field">
              <span className="ks-bgp-fk">QTE 类型</span>
              <select
                className="ks-bgp-input"
                value={scene.qte?.template ?? 'timing'}
                onChange={(e) => setQte({ template: e.target.value as QteKind })}
              >
                <option value="parry">防反 QTE</option>
                <option value="timing">精准时点</option>
                <option value="mash">快速连打</option>
                <option value="sequence">方向序列</option>
                <option value="sweep">摇杆划动</option>
              </select>
            </div>
            <div className="ks-bgp-field">
              <span className="ks-bgp-fk">QTE UI</span>
              <select
                className="ks-bgp-input"
                value={scene.qte?.ui ?? 'default'}
                onChange={(e) => setQteUi(e.target.value as QteUi)}
              >
                <option value="default">默认 QTE 按钮</option>
                <option value="battleParry">战斗防反按键</option>
                <option value="inkKou">叩 · 国风</option>
              </select>
            </div>
            <div className="ks-bgp-field">
              <span className="ks-bgp-fk">整段限时</span>
              <input
                className="ks-bgp-input"
                type="number"
                min={500}
                step={500}
                placeholder="超时 ms"
                value={scene.qte?.window?.timeoutMs ?? ''}
                onChange={(e) => {
                  const timeoutMs = e.target.value ? Number(e.target.value) : undefined
                  const win = { ...(scene.qte?.window ?? {}) }
                  if (timeoutMs == null) delete win.timeoutMs
                  else win.timeoutMs = timeoutMs
                  setQte({ window: Object.keys(win).length > 0 ? win : undefined })
                }}
              />
            </div>
            {qteCues.length > 0 ? (
              <div className="ks-bgp-qte-cues">
                <span className="ks-bgp-fk">按键点（只读）</span>
                <ul className="ks-bgp-qte-cue-list">
                  {[...qteCues]
                    .sort((a, b) => a.appearAt - b.appearAt)
                    .map((c) => (
                      <li key={c.id}>
                        <code>{c.id}</code>
                        <span>
                          {c.appearAt}–{c.targetAt} ms
                          {c.label ? ` · ${c.label}` : ''}
                        </span>
                      </li>
                    ))}
                </ul>
                <p className="ks-bgp-hint">
                  判定针对<strong>整段 QTE</strong>：全部按键点完成后汇总 pass/good/fail，由下方「QTE 通过 / 失败」分支的
                  qteOutcome 决定跳转（不是逐个 cue 单独分支）。
                </p>
              </div>
            ) : (
              <p className="ks-bgp-hint">尚未配置按键点 —— 绑定视频后在时间轴添加 QTE 控件。</p>
            )}
          </>
        ) : interaction.type === 'choice' ? (
          <>
            <div className="ks-bgp-field">
              <span className="ks-bgp-fk">按钮样式</span>
              <select
                className="ks-bgp-input"
                value={scene.choice?.ui ?? 'default'}
                onChange={(e) => setChoiceUi(e.target.value as ChoiceUi)}
              >
                <option value="default">默认选择卡片</option>
                <option value="battleSkillBar">战斗技能栏</option>
                <option value="inkYingMo">应默 · 国风</option>
              </select>
            </div>
            {timedChoice && (
              <>
                <div className="ks-bgp-field">
                  <span className="ks-bgp-fk">倒计时</span>
                  <input
                    className="ks-bgp-input"
                    type="number"
                    min={500}
                    step={500}
                    placeholder="倒计时 ms"
                    value={scene.choice?.window?.timeoutMs ?? ''}
                    onChange={(e) => {
                      const timeoutMs = e.target.value ? Number(e.target.value) : undefined
                      const win = { ...(scene.choice?.window ?? {}) }
                      if (timeoutMs == null) delete win.timeoutMs
                      else win.timeoutMs = timeoutMs
                      setChoice({ window: Object.keys(win).length > 0 ? win : undefined })
                    }}
                  />
                </div>
                <div className="ks-bgp-field">
                  <span className="ks-bgp-fk">超时默认</span>
                  <select
                    className="ks-bgp-input"
                    value={scene.choice?.defaultBranchId ?? ''}
                    onChange={(e) =>
                      setChoice({ defaultBranchId: e.target.value || undefined })
                    }
                  >
                    <option value="">超时默认走第一项</option>
                    {choiceBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label ?? sceneTitles[b.targetSceneId]?.title ?? b.targetSceneId}
                      </option>
                    ))}
                    {scene.choice?.defaultBranchId &&
                      !choiceBranches.some((b) => b.id === scene.choice?.defaultBranchId) && (
                        <option value={scene.choice.defaultBranchId}>
                          {scene.choice.defaultBranchId}
                        </option>
                      )}
                  </select>
                </div>
              </>
            )}
            <div className="ks-bgp-field">
              <span className="ks-bgp-fk">跳转时点</span>
              <select
                className="ks-bgp-input"
                value={scene.choice?.fireAt ?? 'on_pick'}
                onChange={(e) => setChoice({ fireAt: e.target.value as DecisionFireAt })}
              >
                <option value="on_pick">选完立即跳转</option>
                <option value="video_end">等视频结束再跳转</option>
              </select>
            </div>
          </>
        ) : null}
      </section>
      )}

      <section className="ks-bgp-sec">
        <div className="ks-bgp-vidhead">
          <label className="ks-bgp-lbl" title="每个选项/出边的条件、跳转与状态变化。">分支</label>
          {!isCalcNode && !isQteNode && (
            <button type="button" className="ks-bgp-linkbtn" onClick={addChoiceBranch}>
              + 添加选项
            </button>
          )}
        </div>
        {gateBranches.length === 0 ? (
          <p className="ks-bgp-hint">
            {isCalcNode
              ? '当前计算节点没有可编辑的出向分支。'
              : isQteNode
                ? '当前节点没有 QTE 通过/失败分支（demo 攻击前摇应有 qte_pass ×2 + qte_fail）。'
                : '当前节点没有 choice 分支。'}
          </p>
        ) : (
          <div className="ks-bgp-branches">
            {gateBranches.map((branch) => (
              <BranchGateEditor
                key={branch.id}
                branch={branch}
                scenario={scenario}
                variables={Object.values(scenario.variables ?? {})}
                items={items}
                onPatch={(patch) =>
                  updateScene(selectedSceneId, {
                    branches: activeScene.branches.map((b) => (b.id === branch.id ? { ...b, ...patch } : b)),
                  })
                }
                onRemove={
                  !isCalcNode && branch.kind === 'choice'
                    ? () => removeChoiceBranch(branch.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <NumericAttrsSection
        scenario={scenario}
        effects={scene.onEnterEffects ?? []}
        numberVars={numberVars}
        onChange={(next) =>
          updateScene(selectedSceneId, { onEnterEffects: next.length ? next : undefined })
        }
        onCreateVariable={(name) => {
          const id = uniqueVariableId(scenario.variables ?? {}, name)
          upsertVariable({ id, name, kind: 'number', initial: 0 })
          return id
        }}
      />

      {/* Boss 战（仅 battle） */}
      {scene.boss && (
        <section className="ks-bgp-sec">
          <label className="ks-bgp-lbl" title="配置 Boss 实体、胜负去向和回合伤害。">Boss 战</label>
          {bossEntities.length === 0 ? (
            <p className="ks-bgp-hint">先在剧本里登记 kind=&apos;boss&apos; 的实体</p>
          ) : (
            <>
              <select
                className="ks-bgp-input"
                value={scene.boss?.entityId ?? ''}
                onChange={(e) =>
                  updateScene(selectedSceneId, {
                    boss: {
                      entityId: e.target.value,
                      rounds: scene.boss?.rounds ?? [],
                      playerEntityId: scene.boss?.playerEntityId,
                      winSceneId: scene.boss?.winSceneId,
                      loseSceneId: scene.boss?.loseSceneId,
                      perfectFlagVarId: scene.boss?.perfectFlagVarId,
                    },
                  })
                }
              >
                <option value="">选择 Boss 实体…</option>
                {bossEntities.map(([id, e]) => (
                  <option key={id} value={id}>
                    {e.name}
                  </option>
                ))}
              </select>

              {scene.boss?.entityId && (
                <>
                  <SceneSelect
                    label="胜利跳转"
                    value={scene.boss.winSceneId}
                    sceneIds={sceneIds}
                    onChange={(v) =>
                      updateScene(selectedSceneId, { boss: { ...scene.boss!, winSceneId: v } })
                    }
                  />
                  <SceneSelect
                    label="失败跳转"
                    value={scene.boss.loseSceneId}
                    sceneIds={sceneIds}
                    onChange={(v) =>
                      updateScene(selectedSceneId, { boss: { ...scene.boss!, loseSceneId: v } })
                    }
                  />
                  {playerEntities.length > 0 && (
                    <select
                      className="ks-bgp-input"
                      value={scene.boss.playerEntityId ?? ''}
                      onChange={(e) =>
                        updateScene(selectedSceneId, {
                          boss: { ...scene.boss!, playerEntityId: e.target.value || undefined },
                        })
                      }
                    >
                      <option value="">玩家实体（默认取第一个 player）</option>
                      {playerEntities.map(([id, e]) => (
                        <option key={id} value={id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {flagVars.length > 0 && (
                    <select
                      className="ks-bgp-input"
                      value={scene.boss.perfectFlagVarId ?? ''}
                      onChange={(e) =>
                        updateScene(selectedSceneId, {
                          boss: { ...scene.boss!, perfectFlagVarId: e.target.value || undefined },
                        })
                      }
                    >
                      <option value="">完美通关 flag（解锁隐藏结局）</option>
                      {flagVars.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* 回合列表 */}
                  <div className="ks-bgp-rounds">
                    {(scene.boss.rounds ?? []).map((r, i) => (
                      <div key={r.id} className="ks-bgp-round">
                        <input
                          className="ks-bgp-input ks-bgp-round-label"
                          type="text"
                          placeholder={`回合${i + 1} 招式名`}
                          value={r.label ?? ''}
                          onChange={(e) =>
                            setRounds(
                              scene.boss!.rounds.map((x) =>
                                x.id === r.id ? { ...x, label: e.target.value || undefined } : x,
                              ),
                            )
                          }
                        />
                        <input
                          className="ks-bgp-input ks-bgp-round-dmg"
                          type="number"
                          title="命中→Boss 伤害"
                          placeholder="→Boss"
                          value={hpEffectValue(r.hitEffects)}
                          onChange={(e) =>
                            setRounds(
                              scene.boss!.rounds.map((x) =>
                                x.id === r.id
                                  ? { ...x, hitEffects: withHpEffect(x.hitEffects, scenario, 'boss', Number(e.target.value) || 0, `${x.id}-hit`) }
                                  : x,
                              ),
                            )
                          }
                        />
                        <input
                          className="ks-bgp-input ks-bgp-round-dmg"
                          type="number"
                          title="失手→玩家 伤害"
                          placeholder="→我"
                          value={hpEffectValue(r.missEffects)}
                          onChange={(e) =>
                            setRounds(
                              scene.boss!.rounds.map((x) =>
                                x.id === r.id
                                  ? { ...x, missEffects: withHpEffect(x.missEffects, scenario, 'player', Number(e.target.value) || 0, `${x.id}-miss`) }
                                  : x,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className="ks-bgp-round-del"
                          title="删除回合"
                          onClick={() => setRounds(scene.boss!.rounds.filter((x) => x.id !== r.id))}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="ks-bgp-add"
                      onClick={() =>
                        setRounds([
                          ...(scene.boss?.rounds ?? []),
                          {
                            id: `r${Date.now().toString(36)}`,
                            hitEffects: withHpEffect([], scenario, 'boss', 25, `r${Date.now().toString(36)}-hit`),
                            missEffects: withHpEffect([], scenario, 'player', 20, `r${Date.now().toString(36)}-miss`),
                          },
                        ])
                      }
                    >
                      + 添加回合
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      <SceneFlagsSection
        flags={scene.setFlags ?? []}
        flagVars={flagVars}
        onChange={(next) => updateScene(selectedSceneId, { setFlags: next.length ? next : undefined })}
      />
      </div>
    </div>
  )
}

function SceneFlagsSection({
  flags,
  flagVars,
  onChange,
}: {
  flags: string[]
  flagVars: { id: string; name: string }[]
  onChange: (next: string[]) => void
}) {
  if (flagVars.length === 0 && flags.length === 0) return null

  function patch(i: number, flagId: string): void {
    const next = flags.slice()
    next[i] = flagId
    onChange(next.filter(Boolean))
  }

  return (
    <section className="ks-bgp-sec">
      <label className="ks-bgp-lbl" title="进入该节点时记下的剧情状态，供后续分支条件使用。">剧情标记</label>
      {flags.map((flagId, i) => (
        <div key={`${flagId}-${i}`} className="ks-bgp-row">
          <select
            className="ks-bgp-input"
            value={flagId}
            onChange={(e) => patch(i, e.target.value)}
          >
            <option value="">选择标记…</option>
            {flagVars.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            {flagId && !flagVars.some((v) => v.id === flagId) && (
              <option value={flagId}>{flagId}</option>
            )}
          </select>
          <button
            type="button"
            className="ks-bgp-round-del"
            onClick={() => onChange(flags.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      {flagVars.length > 0 && (
        <button type="button" className="ks-bgp-add" onClick={() => onChange([...flags, ''])}>
          + 添加标记
        </button>
      )}
    </section>
  )
}

function CalcSection({
  scene,
  clip,
  durationMs,
  onCalcType,
  onOpenVideo,
}: {
  scene: Scene
  clip: ReturnType<typeof getVideoClip>
  durationMs: number
  onCalcType: (calcType: CalcTypeId | '') => void
  onOpenVideo: () => void
}) {
  const outcomes = branchOutcomeLabels(scene)
  const settlements = listPerformanceSettlements(scene)
  const calcType = scene.calc?.calcType
  const method = calcTypeMethod(calcType)
  const totalMs = clip?.durMs ?? durationMs
  const timelinePct = (atMs: number) =>
    totalMs > 0 ? Math.max(0, Math.min(100, (atMs / totalMs) * 100)) : 0
  const settlementLabel = calcType ? '结算飘字' : '演出飘字'

  return (
    <section className="ks-bgp-sec">
      <label className="ks-bgp-lbl" title="隐藏计算规则；结算时刻与飘字在视频时间轴编辑。">
        计算
      </label>
      <div className="ks-bgp-field">
        <span className="ks-bgp-fk">计算类型</span>
        <select
          className="ks-bgp-input"
          value={calcType ?? ''}
          title={method}
          onChange={(e) => onCalcType((e.target.value || '') as CalcTypeId | '')}
        >
          <option value="">无</option>
          {CALC_TYPE_CATALOG.map((entry) => (
            <option key={entry.id} value={entry.id} title={entry.method}>
              {entry.id}
            </option>
          ))}
          {calcType && !CALC_TYPE_CATALOG.some((c) => c.id === calcType) && (
            <option value={calcType}>{calcType}</option>
          )}
        </select>
      </div>
      {calcType && (
        <div className="ks-bgp-field">
          <span className="ks-bgp-fk">判定结果</span>
          <span className={`ks-bgp-fv${outcomes.length >= 2 ? '' : ' ks-bgp-fv-muted'}`}>
            {outcomes.length >= 2 ? outcomes.join(' / ') : '无'}
          </span>
        </div>
      )}
      {(calcType || settlements.length > 0) && (
        <>
          {!calcType && settlements.length > 0 ? (
            <p className="ks-bgp-hint">纯表现飘字，不参与计算分支；时刻与文案在视频 Tab 时间轴编辑。</p>
          ) : null}
          <div className="ks-bgp-field ks-bgp-field--stack">
            <span className="ks-bgp-fk">{settlementLabel}</span>
            {settlements.length === 0 ? (
              <span className="ks-bgp-fv ks-bgp-fv-muted">无</span>
            ) : (
              <div className="ks-bgp-settle-timeline">
                <div className="ks-bgp-settle-track">
                  {settlements.map((row, i) => (
                    <span
                      key={row.id}
                      className="ks-bgp-settle-mark"
                      style={{ left: `${timelinePct(row.atMs).toFixed(1)}%` }}
                      title={`${formatSettlementTime(row.atMs)} · ${row.displayText}`}
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
                <div className="ks-bgp-settle-scale">
                  <span>0s</span>
                  <span>{settlements.length}</span>
                  <span>{formatSettlementTime(totalMs)}</span>
                </div>
              </div>
            )}
          </div>
          {settlements.length > 0 && (
            <div className="ks-bgp-settle-list">
              {settlements.map((row, i) => (
                <div key={row.id} className="ks-bgp-settle-row">
                  <span className="ks-bgp-settle-idx">{i + 1}</span>
                  <span className="ks-bgp-settle-cell">{formatSettlementTime(row.atMs)}</span>
                  <span className="ks-bgp-settle-cell">
                    {row.damage != null ? row.damage : row.displayText || '—'}
                  </span>
                  <span className="ks-bgp-settle-cell">
                    {row.xPct}%, {row.yPct}%
                  </span>
                </div>
              ))}
            </div>
          )}
          {clip && (
            <button type="button" className="ks-bgp-linkbtn" onClick={onOpenVideo}>
              视频编辑 →
            </button>
          )}
        </>
      )}
    </section>
  )
}

type NumericAttrOp = 'add' | 'sub' | 'set'

type AttributeOption =
  | { key: string; label: string; kind: 'var'; varId: string }
  | { key: string; label: string; kind: 'entityStat'; entityId: string; stat: 'hp' }

function attributeOptions(scenario: Scenario, numberVars: GameVariable[]): AttributeOption[] {
  const variableOptions: AttributeOption[] = numberVars.map((v) => ({
    key: `var:${v.id}`,
    label: v.name || v.id,
    kind: 'var',
    varId: v.id,
  }))
  const entityOptions: AttributeOption[] = Object.values(scenario.entities ?? {}).map((e) => ({
    key: `entity:${e.id}:hp`,
    label: `${e.name || e.id} · HP`,
    kind: 'entityStat',
    entityId: e.id,
    stat: 'hp',
  }))
  return [...variableOptions, ...entityOptions]
}

function attributeKey(effect: VarEffect | EntityStatEffect): string {
  return effect.kind === 'var'
    ? `var:${effect.varId}`
    : `entity:${effect.entityId}:${effect.stat}`
}

function fallbackAttributeOption(effect: VarEffect | EntityStatEffect, scenario: Scenario): AttributeOption {
  if (effect.kind === 'var') {
    return {
      key: `var:${effect.varId}`,
      label: scenario.variables?.[effect.varId]?.name ?? effect.varId,
      kind: 'var',
      varId: effect.varId,
    }
  }
  return {
    key: `entity:${effect.entityId}:hp`,
    label: `${scenario.entities?.[effect.entityId]?.name ?? effect.entityId} · HP`,
    kind: 'entityStat',
    entityId: effect.entityId,
    stat: 'hp',
  }
}

function NumericAttrsSection({
  scenario,
  effects,
  numberVars,
  onChange,
  onCreateVariable,
}: {
  scenario: Scenario
  effects: Effect[]
  numberVars: GameVariable[]
  onChange: (next: Effect[]) => void
  onCreateVariable: (name: string) => string
}) {
  const [newName, setNewName] = useState('')
  const options = attributeOptions(scenario, numberVars)
  const attrEffects = effects.filter((e): e is VarEffect | EntityStatEffect =>
    e.kind === 'var' || (e.kind === 'entityStat' && e.stat === 'hp'),
  )
  const otherEffects = effects.filter((e) => !attrEffects.includes(e as VarEffect | EntityStatEffect))

  function addExisting(): void {
    const first = options[0]
    if (!first) return
    onChange([...effects, effectFromAttribute(`attr-${Date.now().toString(36)}`, first.key, 'add', 1, options)])
  }

  function addNew(): void {
    const name = newName.trim()
    if (!name) return
    const varId = onCreateVariable(name)
    onChange([...effects, { id: `var-${Date.now().toString(36)}`, kind: 'var', varId, op: 'add', value: 1 }])
    setNewName('')
  }

  function patch(id: string, next: VarEffect | EntityStatEffect): void {
    onChange([...otherEffects, ...attrEffects.map((e) => (e.id === id ? next : e))])
  }

  return (
    <section className="ks-bgp-sec">
      <label className="ks-bgp-lbl" title="进入该节点时结算的数值变化，试玩运行时会真实生效。">属性</label>
      {attrEffects.length === 0 && (
        <p className="ks-bgp-hint">暂无节点属性；可从全局数值和实体 HP 中选择。</p>
      )}
      {attrEffects.length > 0 && (
        <div className="ks-bgp-stats">
          {attrEffects.map((effect) => (
            <NumericAttrRow
              key={effect.id}
              effect={effect}
              options={options.some((o) => o.key === attributeKey(effect)) ? options : [...options, fallbackAttributeOption(effect, scenario)]}
              onChange={(next) => patch(effect.id, next)}
              onRemove={() => onChange([...otherEffects, ...attrEffects.filter((e) => e.id !== effect.id)])}
            />
          ))}
        </div>
      )}
      {options.length > 0 && (
        <button type="button" className="ks-bgp-add" onClick={addExisting}>
          + 添加属性
        </button>
      )}
      <div className="ks-bgp-row">
        <input
          className="ks-bgp-input"
          type="text"
          placeholder="新增属性名，如 士气"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addNew()
            }
          }}
        />
        <button type="button" className="ks-bgp-add ks-bgp-add--inline" onClick={addNew}>
          新建
        </button>
      </div>
    </section>
  )
}

function NumericAttrRow({
  effect,
  options,
  onChange,
  onRemove,
}: {
  effect: VarEffect | EntityStatEffect
  options: AttributeOption[]
  onChange: (next: VarEffect | EntityStatEffect) => void
  onRemove: () => void
}) {
  const op = numericAttrOp(effect)
  const amount = numericAttrAmount(effect)
  const selected = attributeKey(effect)
  const once = effect.kind === 'var' ? !!effect.once : false
  return (
    <div className="ks-bgp-stat-row">
      <select
        className="ks-bgp-input"
        value={selected}
        onChange={(e) => onChange(effectFromAttribute(effect.id, e.target.value, op, amount, options, effect.kind === 'var' ? once : undefined))}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        className="ks-bgp-input"
        value={op}
        onChange={(e) => onChange(effectFromAttribute(effect.id, selected, e.target.value as NumericAttrOp, amount, options, effect.kind === 'var' ? once : undefined))}
      >
        <option value="add">加</option>
        <option value="sub">减</option>
        <option value="set">初始</option>
      </select>
      <input
        className="ks-bgp-input"
        type="number"
        value={amount}
        onChange={(e) => onChange(effectFromAttribute(effect.id, selected, op, Number(e.target.value), options, effect.kind === 'var' ? once : undefined))}
      />
      {effect.kind === 'var' ? (
        <label className="ks-bgp-once" title="仅首次进入该节点时生效">
          <input
            type="checkbox"
            checked={once}
            onChange={(e) => onChange(effectFromAttribute(effect.id, selected, op, amount, options, e.target.checked))}
          />
          首次
        </label>
      ) : (
        <span className="ks-bgp-once-spacer" aria-hidden />
      )}
      <button type="button" className="ks-bgp-round-del" title="删除属性" onClick={onRemove}>
        ✕
      </button>
    </div>
  )
}

function numericAttrOp(effect: VarEffect | EntityStatEffect): NumericAttrOp {
  if (effect.op === 'set') return 'set'
  return effect.value < 0 ? 'sub' : 'add'
}

function numericAttrAmount(effect: VarEffect | EntityStatEffect): number {
  return effect.op === 'add' ? Math.abs(effect.value) : effect.value
}

function effectFromAttribute(
  id: string,
  optionKey: string,
  op: NumericAttrOp,
  rawValue: number,
  options: AttributeOption[],
  once?: boolean,
): VarEffect | EntityStatEffect {
  const option = options.find((o) => o.key === optionKey) ?? options[0]
  const value = Number.isFinite(rawValue) ? rawValue : 0
  const nextValue = op === 'set' ? value : op === 'sub' ? -Math.abs(value) : Math.abs(value)
  if (!option || option.kind === 'var') {
    return {
      id,
      kind: 'var',
      varId: option?.kind === 'var' ? option.varId : '',
      op: op === 'set' ? 'set' : 'add',
      value: nextValue,
      once: once || undefined,
    }
  }
  return {
    id,
    kind: 'entityStat',
    entityId: option.entityId,
    stat: option.stat,
    op: op === 'set' ? 'set' : 'add',
    value: nextValue,
  }
}

function uniqueVariableId(existing: Record<string, GameVariable>, name: string): string {
  const ascii = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const stem = ascii ? `var-${ascii}` : `var-${Date.now().toString(36)}`
  let id = stem
  let i = 2
  while (existing[id]) {
    id = `${stem}-${i}`
    i += 1
  }
  return id
}

function SceneSelect({
  label,
  value,
  sceneIds,
  onChange,
}: {
  label: string
  value: string | undefined
  sceneIds: string[]
  onChange: (v: string | undefined) => void
}) {
  const scenario = useScenarioStore((s) => s.scenario)
  return (
    <select
      className="ks-bgp-input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{label}…</option>
      {sceneIds.map((id) => (
        <option key={id} value={id}>
          {scenario.scenes[id]?.title ?? id}
        </option>
      ))}
    </select>
  )
}

const PANEL_CSS = `
.ks-bgp {
  position: absolute;
  top: 12px; right: 12px; bottom: 12px;
  width: 450px;
  z-index: 12;
  display: flex; flex-direction: column; gap: 14px;
  padding: 16px;
  overflow: hidden; /* 自身不滚动；滚动交给内容区，标题栏常驻顶部 */
  background: rgba(12, 14, 22, 0.92);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,255,255,0.1);
  border-left: 3px solid var(--ks-kind, rgba(255,255,255,0.3));
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  color: rgba(255,255,255,0.9);
  font-size: 13px;
}
/* kind 主题色（与蓝图节点上色一致） */
.ks-bgp.ks-kind-story  { --ks-kind: #94a3b8; }
.ks-bgp.ks-kind-battle { --ks-kind: #ef4444; }
.ks-bgp.ks-kind-qte    { --ks-kind: #22d3ee; }
.ks-bgp.ks-kind-choice { --ks-kind: #f59e0b; }
.ks-bgp-head {
  flex: none; /* 常驻顶部，不随内容滚动 */
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.ks-bgp-head-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ks-bgp-collapse {
  all: unset;
  flex-shrink: 0;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--ks-kind, rgba(255,255,255,0.7));
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  transition: color .12s ease, background .12s ease;
}
.ks-bgp-collapse:hover { color: #fff; background: rgba(255,255,255,0.14); }
.ks-bgp-title { font-size: 15px; font-weight: 600; color: #fff; }
.ks-bgp-sub { font-size: 11px; letter-spacing: 0.18em; color: var(--ks-kind); }
/* 内容区：独占剩余高度并单独滚动（标题栏固定），各分块之间留出间距 */
.ks-bgp-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
}
/* 每个分块（演出 / 界面 / 选项 / 分支…）= 一张卡片，清晰分隔 */
.ks-bgp-sec {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 12px 13px;
  background: rgba(255,255,255,0.028);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
}
/* 分块标题：前置一条主题色竖条（分块视觉锚点，颜色随节点类型），加粗提亮 */
.ks-bgp-lbl {
  position: relative;
  padding-left: 11px;
  font-size: 12px; font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255,255,255,0.86);
}
.ks-bgp-lbl::before {
  content: '';
  position: absolute; left: 0; top: 50%;
  transform: translateY(-50%);
  width: 3px; height: 12px; border-radius: 2px;
  background: var(--ks-kind, #f59e0b);
}
.ks-bgp-hint { font-size: 11px; color: rgba(255,255,255,0.45); margin: 0; }
.ks-bgp-input {
  width: 100%;
  padding: 6px 8px;
  background: rgba(0,0,0,0.4);
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 6px;
  color: #fff; font-size: 12px;
  box-sizing: border-box;
}
.ks-bgp-row { display: flex; gap: 6px; }
/* 标签 + 控件成行（演出编号 / 视频类型 / 演出方式 / 演出时长 / HUD 方案） */
.ks-bgp-field { display: grid; grid-template-columns: 68px minmax(0, 1fr); align-items: center; gap: 8px; }
.ks-bgp-field .ks-bgp-input { width: 100%; }
.ks-bgp-fk { font-size: 12px; color: rgba(255,255,255,0.55); }
.ks-bgp-fv { font-size: 12px; color: #fff; text-align: right; font-variant-numeric: tabular-nums; }
.ks-bgp-rounds { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.ks-bgp-round { display: grid; grid-template-columns: 1fr 56px 56px 24px; gap: 4px; align-items: center; }
.ks-bgp-round-del {
  background: none; border: none; color: rgba(248,113,113,0.8);
  cursor: pointer; font-size: 13px; padding: 0;
}
.ks-bgp-add {
  padding: 6px; border-radius: 6px; cursor: pointer;
  background: rgba(255,255,255,0.06);
  border: 1px dashed rgba(255,255,255,0.22);
  color: rgba(255,255,255,0.75); font-size: 12px;
}
.ks-bgp-linkbtn {
  background: none;
  border: none;
  color: var(--ks-kind, rgba(255,255,255,0.7));
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}
.ks-bgp-linkbtn:hover { color: #fff; }
.ks-bgp-check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: rgba(255,255,255,0.82); cursor: pointer; }
.ks-bgp-hotspot-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.1);
}
.ks-bgp-hotspot-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ks-bgp-hotspot-title { color: #fff; font-size: 12px; font-weight: 600; }
.ks-bgp-hotspot-target {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255,255,255,0.42);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
}
.ks-bgp-mini { flex: 1; display: flex; flex-direction: column; gap: 3px; }
.ks-bgp-mini span { font-size: 10px; color: rgba(255,255,255,0.45); }
.ks-bgp-hotspot-remove { align-self: flex-start; font-size: 12px; }

/* ── 计算 / 结算只读预览 ─────────────────────────────── */
.ks-bgp-fv-muted { color: rgba(255,255,255,0.42); }
.ks-bgp-field--stack { align-items: start; }
.ks-bgp-field--stack .ks-bgp-fv-muted { text-align: left; }
.ks-bgp-settle-timeline { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.ks-bgp-settle-track {
  position: relative;
  height: 18px;
  border-radius: 999px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.12);
}
.ks-bgp-settle-mark {
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 16px;
  height: 16px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: color-mix(in srgb, var(--ks-kind, #22d3ee) 70%, #000);
  border: 1px solid rgba(255,255,255,0.35);
}
.ks-bgp-settle-scale {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: rgba(255,255,255,0.45);
}
.ks-bgp-settle-list { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
.ks-bgp-settle-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 4px;
  align-items: center;
  font-size: 11px;
}
.ks-bgp-settle-idx {
  color: var(--ks-kind, rgba(255,255,255,0.65));
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.ks-bgp-settle-cell { color: rgba(255,255,255,0.78); font-variant-numeric: tabular-nums; }

/* ── 数值属性 ─────────────────────────────────────────── */
.ks-bgp-stats { display: flex; flex-direction: column; gap: 6px; }
.ks-bgp-stat-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 52px 58px 44px 24px;
  gap: 4px;
  align-items: center;
}
.ks-bgp-once {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: rgba(255,255,255,0.62);
  white-space: nowrap;
  cursor: pointer;
}
.ks-bgp-once input { margin: 0; }
.ks-bgp-once-spacer { width: 44px; }
.ks-bgp-add--inline { flex: none; padding: 6px 12px; }
.ks-bgp-vidhead { display: flex; align-items: center; justify-content: space-between; }
.ks-bgp-hint-warn { color: #fbbf24; }
.ks-bgp-qte-cues { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.ks-bgp-qte-cue-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: rgba(255,255,255,0.78);
}
.ks-bgp-qte-cue-list li {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.4fr);
  gap: 8px;
  align-items: baseline;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
}
.ks-bgp-qte-cue-list code {
  font-size: 10px;
  color: var(--ks-kind, #22d3ee);
  overflow: hidden;
  text-overflow: ellipsis;
}
`
