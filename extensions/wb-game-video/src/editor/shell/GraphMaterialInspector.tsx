import { useEffect } from 'react'
import { fxNeedsColor } from '../../runtime/fx/video-fx'
import type { MaterialItem, MaterialKind } from '../video/materialTimelineShared'
import { materialLabel } from '../video/materialTimelineShared'
import { GraphTextStylePicker } from './GraphTextStylePicker'
import { EffectsEditor, isPositionable, isSizable, PositionEditor, SizeEditor, ValueInput } from './editors'
import { ComponentFormFields } from './component-form-fields'
import { SettlementEditor } from './SettlementEditor'
import { skinPositioning, skinDefaultAnchor } from '../../runtime/component-host'
import type { Entity, GameNode, GameScenario, GraphTextStyle, Layout } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import type { QteCue } from '../../runtime/component-host/components/Qte'
import { getComponentManifest } from '../../runtime/registry/component-registry'
import {
  OPTION_XY,
  OVERLAY_XY,
  SUBTITLE_XY,
  applyStyleLockedEventParams,
  componentEventsLocked,
  findElement,
  listAvailableQteOutcomes,
  listComponentEventViews,
  listOptionBranches,
  listQteOutcomeViews,
  listSpawnTemplateOptions,
  nodePlayDurationMs,
  overlayEffects,
  qteElementOfCue,
  styleVariantsFor,
  type QteOutcomeHandle,
  type SettlementSpawn,
} from '../video/graphMaterialOps'

// ── 检视器 ───────────────────────────────────────────────────────────────────
function cuesOfEl(el: { inputs?: Record<string, unknown> } | undefined): QteCue[] | undefined {
  const cues = el?.inputs?.cues
  return Array.isArray(cues) ? (cues as QteCue[]) : undefined
}

/** MaterialKind → overlay child 的 component id（用于按类型查「默认样式方案」里的同类变体）。qte/option 结构性，不接样式方案。 */
const STYLE_COMPONENT: Partial<Record<MaterialKind, string>> = {
  subtitle: 'dialogue',
  overlay: 'floatText',
  filter: 'filter',
  fx: 'fx',
}

function GraphMaterialInspector({
  scenario,
  node,
  item,
  entities,
  variables,
  formulas,
  onPatch,
  onPatchLayout,
  onTiming,
  onResetOverride,
  onRemoveQteCue,
  onAddBranch,
  onSetBranchLabel,
  onSetBranchTarget,
  onSetBranchEffects,
  onSetBranchSpawn,
  onRemoveBranch,
  onSyncChoiceStyleLocked,
  onSetQteOutcomeTarget,
  onSetQteOutcomeEffects,
  onSetQteOutcomeSpawn,
  onAddQteOutcome,
  onRemoveQteOutcome,
}: {
  scenario: GameScenario
  node: GameNode | undefined
  item: MaterialItem | null
  entities: Record<string, Entity> | undefined
  variables: GameScenario['variables']
  formulas: Record<string, Formula> | undefined
  onPatch: (patch: Record<string, unknown>) => void
  onPatchLayout: (patch: Partial<Layout>) => void
  onTiming: (item: MaterialItem, startMs: number, endMs: number) => void
  onResetOverride: (item: MaterialItem) => void
  onRemoveQteCue: (cueId: string) => void
  onAddBranch: () => void
  onSetBranchLabel: (key: string, label: string) => void
  onSetBranchTarget: (key: string, target: string) => void
  onSetBranchEffects: (key: string, effects: import('../../runtime/schema/graph-schema').GraphEffect[]) => void
  onSetBranchSpawn: (key: string, spawn: SettlementSpawn | undefined) => void
  onRemoveBranch: (key: string) => void
  onSyncChoiceStyleLocked: () => void
  onSetQteOutcomeTarget: (handle: QteOutcomeHandle, target: string) => void
  onSetQteOutcomeEffects: (handle: QteOutcomeHandle, effects: import('../../runtime/schema/graph-schema').GraphEffect[]) => void
  onSetQteOutcomeSpawn: (handle: QteOutcomeHandle, spawn: SettlementSpawn | undefined) => void
  onAddQteOutcome: (handle: QteOutcomeHandle) => void
  onRemoveQteOutcome: (handle: QteOutcomeHandle) => void
}): JSX.Element {
  const el = node && item
    ? (item.kind === 'qte' ? qteElementOfCue(scenario, node, item.id) : findElement(scenario, node, item.id))
    : undefined
  const inputs = (el?.inputs ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const qteSkinId = item?.kind === 'qte' && el ? (el.component || 'qte') : 'qte'
  const styleLocksQteEvents = item?.kind === 'qte' && componentEventsLocked(qteSkinId)
  const choiceSkinId = item?.kind === 'option' && el ? el.component : ''
  const styleLocksOptions = item?.kind === 'option' && componentEventsLocked(choiceSkinId)

  // 打开检视器时把脏 events 写回样式锁定值（与皮肤声明 / emit 出口对齐）
  useEffect(() => {
    if (!item || item.kind !== 'qte' || !styleLocksQteEvents) return
    const locked = applyStyleLockedEventParams(inputs, qteSkinId)
    const sameEvents = JSON.stringify(locked.events) === JSON.stringify(inputs.events)
    const sameDefault = (locked.defaultEvent ?? 'fail') === (inputs.defaultEvent ?? 'fail')
    if (!sameEvents || !sameDefault) {
      onPatch({ events: locked.events, defaultEvent: locked.defaultEvent ?? 'fail' })
    }
  }, [item?.kind, item?.id, qteSkinId, styleLocksQteEvents, inputs.events, inputs.defaultEvent, onPatch])

  // 打开检视器时把脏 events 写回样式锁定值（應默/技能条选项数与皮肤对齐）
  useEffect(() => {
    if (!item || item.kind !== 'option' || !styleLocksOptions) return
    const locked = applyStyleLockedEventParams(inputs, choiceSkinId)
    if (JSON.stringify(locked.events) !== JSON.stringify(inputs.events)) {
      onSyncChoiceStyleLocked()
    }
  }, [item?.kind, item?.id, choiceSkinId, styleLocksOptions, inputs.events, onSyncChoiceStyleLocked])

  if (!node || !item) {
    return <div className="gc-inspector-empty"><span>选择时间轴上的素材以编辑属性</span></div>
  }
  const cue = item.kind === 'qte' ? cuesOfEl(el)?.find((c) => c.id === item.id) : undefined
  const overlayFx = item.kind === 'overlay' ? overlayEffects(scenario, node, item.id) : []
  const overlayDisplayCustom = item.kind === 'overlay' && inputs.expr != null
  const branches = item.kind === 'option' ? listOptionBranches(scenario, node) : []
  const qteOutcomes = item.kind === 'qte' ? listQteOutcomeViews(scenario, node) : []
  const qteAvailable = item.kind === 'qte' ? listAvailableQteOutcomes(scenario, node) : []
  const componentEvents = item.kind === 'component' && el
    ? listComponentEventViews(scenario, node, el)
    : []
  const spawnTemplates = (item.kind === 'qte' || item.kind === 'option' || item.kind === 'component')
    ? listSpawnTemplateOptions(scenario)
    : []
  const nodeDurMs = nodePlayDurationMs(node)
  const nodeOptions = scenario.graph.nodes.filter((n) => n.id !== node.id)
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const qteManifest = item.kind === 'qte' ? getComponentManifest(qteSkinId) : undefined
  const qteHasCues = item.kind === 'qte' && (cuesOfEl(el)?.length ?? 0) > 0
  // cues 驱动窗长时元素级 timeoutMs 无效（皮肤走 cue end）；defaultEvent 用下方专用下拉。
  const qteConfigInputs = (qteManifest?.inputs ?? []).filter((i) => {
    if (i.key === 'events' || i.key === 'defaultEvent') return false
    if (qteHasCues && i.key === 'timeoutMs') return false
    return true
  })
  const qteDefaultEventChoices = (
    styleLocksQteEvents
      ? ((applyStyleLockedEventParams(inputs, qteSkinId).events as Array<{ id: string; label?: string }> | undefined) ?? [])
      : ((Array.isArray(inputs.events) ? (inputs.events as Array<{ id: string; label?: string }>) : null)
        ?? qteManifest?.events ?? [])
  )
  const qteLockedEvents = styleLocksQteEvents
    ? ((applyStyleLockedEventParams(inputs, qteSkinId).events as Array<{ id: string; label?: string }> | undefined) ?? qteManifest?.events ?? [])
    : (qteManifest?.events ?? [])
  const qteFirstLabel = qteOutcomes[0]?.label ?? qteLockedEvents[0]?.label ?? '第一档'
  const qteGoodLabel = qteOutcomes.find((o) => o.key === 'good')?.label
    ?? qteLockedEvents.find((e) => e.id === 'good')?.label
    ?? '良好'
  const qtePassLabel = qteOutcomes.find((o) => o.key === 'pass')?.label
    ?? qteLockedEvents.find((e) => e.id === 'pass')?.label
    ?? '完美'

  // 「默认样式方案」里同类型（component 相同）的其它变体——只有 ≥2 个才值得给下拉切（1 个时已经是默认，无需切）。
  const styleComponent = STYLE_COMPONENT[item.kind]
  const styleVariants = styleComponent ? styleVariantsFor(scenario, node, styleComponent) : []
  const currentSkin = el ? el.component : ''
  const currentVariantId = styleVariants.find((v) => {
    if (v.component !== currentSkin) return false
    const vp = Object.fromEntries(Object.entries(v.inputs ?? {}).filter(([k]) => k !== 'component'))
    const cur = Object.fromEntries(Object.entries(inputs).filter(([k]) => k !== 'component'))
    return JSON.stringify(vp) === JSON.stringify(cur)
  })?.id ?? ''

  return (
    <div className="gc-inspector-card">
      <div className="gc-inspector-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>{materialLabel(item.kind)}</span>
        {item.overridden ? (
          <button
            type="button"
            title="已脱离方案跟随，点击清掉本组件差量、改回跟随共享方案"
            onClick={() => onResetOverride(item)}
            style={{ fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}
          >
            ↺ 回连方案
          </button>
        ) : null}
      </div>
      {item.overridden ? (
        <p className="gc-inspector-hint" style={{ marginTop: -6 }}>
          本控件已脱离共享方案跟随；回连后会重新同步方案原型。
        </p>
      ) : null}
      {styleVariants.length > 1 && (
        <label className="gc-field"><span>方案样式</span>
          <select
            value={currentVariantId}
            onChange={(e) => {
              const v = styleVariants.find((x) => x.id === e.target.value)
              if (!v) return
              onPatch({ ...(v.inputs ?? {}) })
            }}
            title="来自节点「默认样式」方案里同类型的其它变体；切换即整体套用该变体（含皮肤）"
          >
            <option value="">（自定义）</option>
            {styleVariants.map((v, i) => (
              <option key={v.id} value={v.id}>{v.note?.trim() || `样式 ${i + 1}`}</option>
            ))}
          </select>
        </label>
      )}
      {item.kind !== 'qte' ? (
        <div className="gc-field-row">
          <label>
            <span>开始</span>
            <input type="number" value={item.startMs} onChange={(e) => onTiming(item, Number(e.target.value), item.endMs)} />
          </label>
          <label>
            <span>结束</span>
            <input type="number" value={item.endMs} onChange={(e) => onTiming(item, item.startMs, Number(e.target.value))} />
          </label>
        </div>
      ) : null}

      {/* 尺寸盒子对所有 kind 通用（Layout.width/height），不按组件类型分支——新组件天然获得该控件。
          字幕/飘字/转场/交互类不读这个盒子（见 isSizable 注释），置灰而不是让它悄悄没反应。 */}
      {el && (
        <div className="gc-field">
          <span>组件尺寸（相对画面）</span>
          <SizeEditor
            width={typeof el.layout?.width === 'number' ? el.layout.width : undefined}
            height={typeof el.layout?.height === 'number' ? el.layout.height : undefined}
            onChange={onPatchLayout}
            disabled={!isSizable(el.component)}
          />
        </div>
      )}

      {item.kind === 'subtitle' && el && (
        <>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables, formulas }}
            excludeKeys={['speaker', 'style', 'x', 'y']}
          />
          <div className="gc-field"><span>样式预设</span>
            <GraphTextStylePicker group="subtitle" value={inputs.style as GraphTextStyle | undefined} onChange={(style) => onPatch({ style })} />
          </div>
          <label className="gc-tsp-check">
            <input type="checkbox" checked={inputs.speaker != null} onChange={(e) => onPatch(e.target.checked ? { speaker: '' } : { speaker: undefined })} />
            <span>显示说话人前缀</span>
          </label>
          {inputs.speaker != null && (
            <label className="gc-field"><span>说话人</span>
              <input value={str(inputs.speaker)} onChange={(e) => onPatch({ speaker: e.target.value })} />
            </label>
          )}
          <PositionEditor
            x={inputs.x as number | undefined}
            y={inputs.y as number | undefined}
            defaultX={SUBTITLE_XY.x}
            defaultY={SUBTITLE_XY.y}
            variant="slider"
            resettable
            onChange={(next) => onPatch(next)}
          />
        </>
      )}

      {item.kind === 'overlay' && el && (
        <>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables, formulas }}
            excludeKeys={['style', 'x', 'y', 'expr']}
          />
          <div className="gc-field"><span>样式预设</span>
            <GraphTextStylePicker group="overlay" value={inputs.style as GraphTextStyle | undefined} onChange={(style) => onPatch({ style })} />
          </div>
          <div className="gc-field"><span>到点效果</span>
            <EffectsEditor value={overlayFx} entities={entities} variables={variables} formulas={formulas} onChange={(effects) => onPatch({ effects })} />
          </div>
          <p className="gc-inspector-hint">飘字出现时把这些效果广播出去（如给 Boss 的 hp 加负值＝扣血）。留空＝纯展示、不改数值。文案里的 {'{v}'} 默认显示第一条效果的数值。</p>
          <label className="gc-tsp-check">
            <input
              type="checkbox"
              checked={overlayDisplayCustom}
              onChange={(e) => onPatch({ expr: e.target.checked ? (typeof inputs.expr === 'string' ? inputs.expr : '0') : undefined })}
            />
            <span>自定义显示数值（默认＝效果值）</span>
          </label>
          {overlayDisplayCustom && (
            <div className="gc-field">
              <span>显示数值</span>
              <ValueInput
                value={typeof inputs.expr === 'string' ? { expr: inputs.expr } : 0}
                entities={entities}
                variables={variables}
                formulas={formulas}
                onChange={(expr) => onPatch({ expr: typeof expr === 'number' ? String(expr) : expr.expr })}
              />
            </div>
          )}
          <PositionEditor
            x={inputs.x as number | undefined}
            y={inputs.y as number | undefined}
            defaultX={OVERLAY_XY.x}
            defaultY={OVERLAY_XY.y}
            onChange={(next) => onPatch(next)}
          />
        </>
      )}

      {item.kind === 'qte' && cue && el && (
        <>
          <label className="gc-field"><span>标签</span>
            <input value={cue.label ?? ''} onChange={(e) => onPatch({ label: e.target.value || undefined })} />
          </label>
          {skinPositioning(qteSkinId) !== 'fixed' && (
            <PositionEditor
              x={cue.x}
              y={cue.y}
              defaultX={skinDefaultAnchor(qteSkinId)?.x ?? 0.5}
              defaultY={skinDefaultAnchor(qteSkinId)?.y ?? 0.55}
              onChange={(next) => onPatch(next)}
            />
          )}
          {/* 配置区 = manifest.inputs（样式锁定时出口只读展示） */}
          {styleLocksQteEvents && qteLockedEvents.length > 0 ? (
            <p className="gc-inspector-hint">
              样式出口（只读）：{qteLockedEvents.map((e) => e.label || e.id).join(' · ')}
            </p>
          ) : null}
          {qteConfigInputs.map((input) => {
            if (input.key === 'perfectMs') {
              return (
                <div key={input.key}>
                  <label className="gc-field">
                    <span>{input.label ?? input.key}</span>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={num(inputs.perfectMs, NaN) >= 0 ? (inputs.perfectMs as number) : ''}
                      placeholder="留空=皮肤内置手感"
                      onChange={(e) => onPatch({
                        perfectMs: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                      })}
                    />
                  </label>
                  <p className="gc-inspector-hint">
                    以命中锚点为中心 ±此毫秒内按下=完美；命中落在显示窗内=良好，窗外/超时=失败。
                  </p>
                </div>
              )
            }
            if (input.valueType === 'number') {
              return (
                <label className="gc-field" key={input.key}>
                  <span>{input.label ?? input.key}</span>
                  <input
                    type="number"
                    value={typeof inputs[input.key] === 'number' ? (inputs[input.key] as number) : ''}
                    onChange={(e) => onPatch({
                      [input.key]: e.target.value === '' ? undefined : Number(e.target.value),
                    })}
                  />
                </label>
              )
            }
            if (input.valueType === 'string') {
              return (
                <label className="gc-field" key={input.key}>
                  <span>{input.label ?? input.key}</span>
                  <input
                    value={str(inputs[input.key])}
                    onChange={(e) => onPatch({ [input.key]: e.target.value || undefined })}
                  />
                </label>
              )
            }
            return null
          })}
          {qteDefaultEventChoices.length > 0 && (
            <label className="gc-field"><span>超时 / 未命中出口</span>
              <select
                value={str(inputs.defaultEvent) || qteDefaultEventChoices.find((e) => e.id === 'fail')?.id || qteDefaultEventChoices[qteDefaultEventChoices.length - 1]!.id}
                onChange={(e) => onPatch({ defaultEvent: e.target.value })}
              >
                {qteDefaultEventChoices.map((e) => (
                  <option key={e.id} value={e.id}>{e.label?.trim() || e.id}</option>
                ))}
              </select>
            </label>
          )}
          {/* 结算区：只配跳转/改数值；候选 = 样式锁定的 events */}
          <SettlementEditor
            branches={qteOutcomes}
            nodeOptions={nodeOptions}
            spawnTemplates={spawnTemplates}
            overlays={scenario.ui?.overlays}
            nodeDurMs={nodeDurMs}
            entities={entities}
            variables={variables}
            formulas={formulas}
            onSetTarget={onSetQteOutcomeTarget}
            onSetEffects={onSetQteOutcomeEffects}
            onSetSpawn={onSetQteOutcomeSpawn}
            removable={() => qteOutcomes.length > 1}
            onRemove={onRemoveQteOutcome}
            addable={{ candidates: qteAvailable.map((c) => ({ key: c.handle, label: c.label })), onAdd: onAddQteOutcome }}
            fallsBackToPassHint={<>未单独配置「{qteGoodLabel}」时，也会按「{qtePassLabel}」结算。</>}
            hint={styleLocksQteEvents
              ? '出口由样式锁定；此处只配跳转与改数值'
              : `默认可配「${qteFirstLabel}」且不跳转；未配「${qteGoodLabel}」时按「${qtePassLabel}」结算`}
          />
          {styleLocksQteEvents ? (
            <>
              <p className="gc-inspector-hint">出现=整段出现（左缘）· 时长=收圈总时长（超过未按任一键＝超时/未命中档）。两者也可在时间轴上直接拖左右缘。</p>
              <div className="gc-field-row">
                <label><span>出现 ms</span>
                  <input type="number" min={0} step={100} value={cue.appearAt ?? 0}
                    onChange={(e) => {
                      const appearAt = Math.max(0, Number(e.target.value) || 0)
                      const durationMs = Math.max(200, (cue.endAt ?? (cue.appearAt ?? 0) + 2600) - (cue.appearAt ?? 0))
                      onPatch({ appearAt, endAt: appearAt + durationMs })
                    }} />
                </label>
                <label><span>时长 ms</span>
                  <input type="number" min={200} step={100} value={Math.max(200, (cue.endAt ?? (cue.appearAt ?? 0) + 2600) - (cue.appearAt ?? 0))}
                    onChange={(e) => {
                      const durationMs = Math.max(200, Number(e.target.value) || 2600)
                      onPatch({ endAt: (cue.appearAt ?? 0) + durationMs })
                    }} />
                </label>
              </div>
            </>
          ) : (
            <>
              <p className="gc-inspector-hint">出现=提示出现（左缘）· 命中=最佳判定时刻（计分锚点，菱形）· 消失=提示撤离（右缘）。三者也可在时间轴上直接拖。</p>
              <div className="gc-field-row">
                <label><span>出现 ms</span>
                  <input type="number" min={0} step={100} value={cue.appearAt ?? 0}
                    onChange={(e) => onPatch({ appearAt: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <label><span>命中 ms</span>
                  <input type="number" min={0} step={100} value={cue.targetAt ?? ''} placeholder="命中锚点"
                    onChange={(e) => onPatch({ targetAt: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </label>
                <label><span>消失 ms</span>
                  <input type="number" min={0} step={100} value={cue.endAt ?? ''} placeholder="自动"
                    onChange={(e) => onPatch({ endAt: e.target.value === '' ? undefined : Number(e.target.value) })} />
                </label>
              </div>
              <label className="gc-field"><span>触发键</span>
                <select value={cue.triggerKey ?? ''} onChange={(e) => onPatch({ triggerKey: e.target.value || undefined })}>
                  <option value="">默认（空格 / Enter / 点击）</option>
                  <option value="Space">Space</option>
                  <option value="Enter">Enter</option>
                  <option value="KeyA">A</option>
                  <option value="KeyD">D</option>
                  <option value="KeyW">W</option>
                  <option value="KeyS">S</option>
                  <option value="ArrowLeft">←</option>
                  <option value="ArrowRight">→</option>
                  <option value="ArrowUp">↑</option>
                  <option value="ArrowDown">↓</option>
                </select>
              </label>
              <label className="gc-field"><span>形态</span>
                <select value={cue.shape ?? 'tap'} onChange={(e) => onPatch({ shape: e.target.value })}>
                  <option value="tap">Tap</option>
                  <option value="hold">Hold</option>
                  <option value="sweep">Sweep</option>
                </select>
              </label>
              {cue.shape === 'hold' && (
                <label className="gc-field"><span>按住时长 ms</span>
                  <input type="number" min={100} value={cue.durationMs ?? 500} onChange={(e) => onPatch({ durationMs: Math.max(100, Number(e.target.value) || 500) })} />
                </label>
              )}
              {cue.shape === 'sweep' && (
                <label className="gc-field"><span>滑动方向</span>
                  <select value={cue.sweepDir ?? 'right'} onChange={(e) => onPatch({ sweepDir: e.target.value })}>
                    <option value="left">左</option><option value="right">右</option><option value="up">上</option><option value="down">下</option>
                  </select>
                </label>
              )}
            </>
          )}
          <button type="button" className="gc-mini-danger" onClick={() => onRemoveQteCue(cue.id)}>删除当前按键点</button>
        </>
      )}

      {item.kind === 'filter' && el && (
        <>
          <p className="gc-inspector-hint">在这段时间内给整帧画面调色，强度 0=原图、1=最强。效果在上方预览实时可见。</p>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables, formulas }}
          />
        </>
      )}

      {item.kind === 'fx' && el && (
        <>
          <p className="gc-inspector-hint">画面特效叠加在视频上，强度 0~1。效果在上方预览实时可见。</p>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables, formulas }}
            excludeKeys={fxNeedsColor(str(inputs.fx) || 'flash') ? undefined : ['color']}
          />
        </>
      )}

      {item.kind === 'option' && el && (
        <>
          <ComponentFormFields
            componentId={el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables, formulas }}
            excludeKeys={['presentation', 'x', 'y', 'timeoutMs', 'defaultEvent', 'events']}
          />
          <PositionEditor
            x={inputs.x as number | undefined}
            y={inputs.y as number | undefined}
            defaultX={OPTION_XY.x}
            defaultY={OPTION_XY.y}
            onChange={(next) => onPatch(next)}
            disabled={!isPositionable(el.component)}
          />
          {!styleLocksOptions && (
            <label className="gc-field"><span>呈现</span>
              <select value={str(inputs.presentation) || 'list'} onChange={(e) => onPatch({ presentation: e.target.value })}>
                <option value="list">清单</option>
                <option value="hotspot">画面热区</option>
              </select>
            </label>
          )}
          <label className="gc-field"><span>倒计时 ms（0=不限时）</span>
            <input type="number" min={0} step={100} value={num(inputs.timeoutMs, 0) || ''} placeholder="不限时"
              onChange={(e) => onPatch({ timeoutMs: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </label>
          {branches.length > 0 && (
            <label className="gc-field"><span>超时出口</span>
              <select
                value={str(inputs.defaultEvent) || branches[0]!.key}
                onChange={(e) => onPatch({ defaultEvent: e.target.value })}
              >
                {branches.map((b) => (
                  <option key={b.key} value={b.key}>{b.label?.trim() || b.key}</option>
                ))}
              </select>
            </label>
          )}
          <SettlementEditor
            branches={branches}
            nodeOptions={nodeOptions}
            spawnTemplates={spawnTemplates}
            overlays={scenario.ui?.overlays}
            nodeDurMs={nodeDurMs}
            entities={entities}
            variables={variables}
            formulas={formulas}
            onSetTarget={onSetBranchTarget}
            onSetEffects={onSetBranchEffects}
            onSetSpawn={onSetBranchSpawn}
            labelEditable={!styleLocksOptions}
            onSetLabel={onSetBranchLabel}
            removable={() => !styleLocksOptions && branches.length > 1}
            onRemove={!styleLocksOptions ? onRemoveBranch : undefined}
            hint={`${branches.length} 条 · 每条选项可独立跳转 / 改数值${styleLocksOptions ? ' · 选项由皮肤决定' : '；默认不跳转'}`}
          />
          {!styleLocksOptions && (
            <button type="button" className="gc-add-branch-btn" onClick={onAddBranch}>＋ 添加选项</button>
          )}
        </>
      )}

      {item.kind === 'component' && el && (
        <>
          <p className="gc-inspector-hint">
            组件 · {item.componentId || el.component}
          </p>
          <PositionEditor
            x={inputs.x as number | undefined}
            y={inputs.y as number | undefined}
            defaultX={0.5}
            defaultY={0.5}
            onChange={(next) => onPatch(next)}
            disabled={!isPositionable(item.componentId || el.component)}
          />
          <ComponentFormFields
            componentId={item.componentId || el.component}
            values={inputs}
            onChange={(next) => onPatch(next)}
            pickers={{ entities, variables, formulas }}
            excludeKeys={['x', 'y', 'events']}
          />
          {componentEvents.length > 0 ? (
            <SettlementEditor
              branches={componentEvents}
              nodeOptions={nodeOptions}
              spawnTemplates={spawnTemplates}
              overlays={scenario.ui?.overlays}
              nodeDurMs={nodeDurMs}
              entities={entities}
              variables={variables}
              formulas={formulas}
              labelColumnWidth={72}
              onSetTarget={onSetBranchTarget}
              onSetEffects={onSetBranchEffects}
              onSetSpawn={onSetBranchSpawn}
              hint={`${componentEvents.length} 条事件 · 跳转 / 改数值 / 显示组件`}
            />
          ) : null}
        </>
      )}
        </div>
      )
}

export { GraphMaterialInspector }

