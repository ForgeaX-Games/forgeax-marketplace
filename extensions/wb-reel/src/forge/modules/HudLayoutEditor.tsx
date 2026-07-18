import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useMediaStore } from '../../media/mediaStore'
import { isModuleEnabled } from '../../scenario/moduleFlags'
import { injectStyleOnce } from '../../styles/injectStyle'
import type {
  ConditionClause,
  HudElement,
  UIAsset,
  UIBlendMode,
  UIScreenKind,
} from '../../scenario/types'
import { UI_ROLE_PRESETS, uiBlendModeToCss } from './uiAssetArt'
import { ConditionRow, makeDefaultClause } from '../../editor/numeric/NumericEditors'
import { KIND_OPTIONS, ScreenConfigPanel, ScreenPreviewPane } from './UIScreenEditor'
import { SCREEN_PRESETS, makeUIScreen } from './screenPresets'

const BLEND_LABELS: Record<UIBlendMode, string> = {
  normal: '正常',
  screen: '滤色 screen',
  multiply: '相乘 multiply',
  overlay: '叠加 overlay',
  'hard-light': '强光 hard-light',
  lighten: '变亮 lighten',
  add: '相加 add',
}

/** 编排器里的统一选中项:一条常驻 HUD 元素 或 一个全屏页面。 */
type LaySel = { type: 'hud'; id: string } | { type: 'screen'; id: string } | null

/**
 * HudLayoutEditor —— 「界面 · 布局」= 统一 UI 编排器(游戏 UI 编排器)。
 *
 * 一个列表里用「＋」把各种 UI 都加进来、统一编排:
 *   - 常驻 HUD:UI 部件绑成 scenario.hud 的 HudElement(锚点拖拽 / 混合 / 数值填充 / 条件显隐),
 *     运行时由 Player 顶层 HudLayer 跨场常驻渲染;
 *   - 全屏页面:真背包 / 游戏化主界面 / 开宝箱 / 搜刮页等整页 UI(每页独立开关 + 数值联动 +
 *     按钮点击跳转,预览可就地试玩)。总闸 uiScreen 一键关掉整套全屏页面(剧情树不受影响)。
 *
 * 选中 HUD → 右侧样帧舞台拖拽摆位 + 属性;选中页面 → 右侧交互式整页预览。
 */
export function HudLayoutEditor() {
  const scenario = useScenarioStore((s) => s.scenario)
  const uiAssets = scenario.uiAssets
  const hud = scenario.hud
  const addHudElement = useScenarioStore((s) => s.addHudElement)
  const updateHudElement = useScenarioStore((s) => s.updateHudElement)
  const removeHudElement = useScenarioStore((s) => s.removeHudElement)
  const upsertUIScreen = useScenarioStore((s) => s.upsertUIScreen)
  const updateUIScreen = useScenarioStore((s) => s.updateUIScreen)
  const removeUIScreen = useScenarioStore((s) => s.removeUIScreen)
  const setModuleEnabled = useScenarioStore((s) => s.setModuleEnabled)

  const assetList = useMemo(
    () => Object.values(uiAssets ?? {}).filter((a) => !!a.mediaId),
    [uiAssets],
  )
  const hudList = hud ?? []
  const screenList = useMemo(() => Object.values(scenario.uiScreens ?? {}), [scenario.uiScreens])
  const screensEnabled = isModuleEnabled(
    { modules: scenario.modules, uiScreens: scenario.uiScreens },
    'uiScreen',
  )

  const varList = useMemo(() => Object.values(scenario.variables ?? {}), [scenario.variables])
  const itemList = useMemo(() => Object.values(scenario.items ?? {}), [scenario.items])
  const sceneOptions = useMemo(
    () => Object.values(scenario.scenes ?? {}).map((s) => ({ id: s.id, title: s.title ?? s.id })),
    [scenario.scenes],
  )

  const [sel, setSel] = useState<LaySel>(
    hudList[0] ? { type: 'hud', id: hudList[0].id } : screenList[0] ? { type: 'screen', id: screenList[0].id } : null,
  )
  const [addOpen, setAddOpen] = useState(false)
  const [newKind, setNewKind] = useState<UIScreenKind>('inventory')

  const selHud = sel?.type === 'hud' ? hudList.find((h) => h.id === sel.id) ?? null : null
  const selScreen = sel?.type === 'screen' ? scenario.uiScreens?.[sel.id] ?? null : null

  function addFromAsset(asset: UIAsset): void {
    const id = `hud_${Date.now().toString(36)}`
    const el: HudElement = {
      id,
      uiAssetId: asset.id,
      anchor: asset.defaultAnchor ?? { x: 0.5, y: 0.1, scale: 16 },
      blendMode: asset.blendMode,
      valueBind: asset.valueBind,
    }
    addHudElement(el)
    setSel({ type: 'hud', id })
    setAddOpen(false)
  }
  function addScreen(kind: UIScreenKind): void {
    const id = `screen_${kind}_${Date.now().toString(36)}`
    upsertUIScreen(makeUIScreen({ id, kind }))
    if (!screensEnabled) setModuleEnabled('uiScreen', true)
    setSel({ type: 'screen', id })
    setAddOpen(false)
  }
  function delHud(id: string): void {
    removeHudElement(id)
    if (sel?.type === 'hud' && sel.id === id) setSel(null)
  }
  function delScreen(id: string): void {
    removeUIScreen(id)
    if (sel?.type === 'screen' && sel.id === id) setSel(null)
  }

  injectStyleOnce('hud-layout-editor', css)

  return (
    <div className="ks-lay-root">
      <aside className="ks-lay-panel">
        <div className="ks-lay-addbar">
          <button
            type="button"
            className="ks-lay-addbtn"
            onClick={() => setAddOpen((v) => !v)}
          >
            ＋ 添加 UI
          </button>
        </div>

        {addOpen && (
          <div className="ks-lay-addmenu">
            <div className="ks-lay-addgroup-h">常驻 HUD(叠在画面上)</div>
            {assetList.length === 0 ? (
              <div className="ks-lay-addempty">先在「UI 部件」生成部件(血条 / 技能框…)</div>
            ) : (
              assetList.map((a) => (
                <button key={a.id} type="button" className="ks-lay-additem" onClick={() => addFromAsset(a)}>
                  <HudThumb asset={a} size={22} />
                  <span className="ks-lay-additem-name">{a.name}</span>
                </button>
              ))
            )}
            <div className="ks-lay-addgroup-h">全屏页面(整页 UI + 玩法)</div>
            <div className="ks-lay-addkinds">
              {KIND_OPTIONS.map((o) => (
                <button key={o.id} type="button" className="ks-lay-addkind" onClick={() => addScreen(o.id)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ks-lay-list">
          {/* 常驻 HUD 组 */}
          <div className="ks-lay-group-h">
            <span>常驻 HUD</span>
            <span className="ks-lay-group-cnt">{hudList.length}</span>
          </div>
          {hudList.length === 0 ? (
            <div className="ks-lay-empty">＋ 添加 → 常驻 HUD(主角血条 / 技能框…)</div>
          ) : (
            hudList.map((el) => {
              const asset = uiAssets?.[el.uiAssetId]
              const on = sel?.type === 'hud' && sel.id === el.id
              return (
                <div key={el.id} className={`ks-lay-item${on ? ' is-sel' : ''}`}>
                  <button type="button" className="ks-lay-item-btn" onClick={() => setSel({ type: 'hud', id: el.id })}>
                    {asset ? <HudThumb asset={asset} size={22} /> : <span className="ks-hudedit-thumb-ph">◱</span>}
                    <span className="ks-lay-item-name">{asset?.name ?? '(部件已删除)'}</span>
                    <span className="ks-lay-item-tag">HUD</span>
                  </button>
                  <button type="button" className="ks-lay-item-del" onClick={() => delHud(el.id)} title="删除">✕</button>
                </div>
              )
            })
          )}

          {/* 全屏页面组 */}
          <div className="ks-lay-group-h">
            <span>全屏页面</span>
            <button
              type="button"
              className={`ks-lay-master${screensEnabled ? ' is-on' : ''}`}
              role="switch"
              aria-checked={screensEnabled}
              title={screensEnabled ? '全屏页面总闸:开(点击整套关闭)' : '全屏页面总闸:关(点击开启)'}
              onClick={() => setModuleEnabled('uiScreen', !screensEnabled)}
            >
              <span className="ks-lay-master-knob" />
            </button>
          </div>
          {screenList.length === 0 ? (
            <div className="ks-lay-empty">＋ 添加 → 全屏页面(背包 / 主界面 / 宝箱 / 搜刮)</div>
          ) : (
            screenList.map((s) => {
              const on = s.enabled !== false
              const cur = sel?.type === 'screen' && sel.id === s.id
              return (
                <div key={s.id} className={`ks-lay-item${cur ? ' is-sel' : ''}${on && screensEnabled ? '' : ' is-off'}`}>
                  <button
                    type="button"
                    className={`ks-lay-item-sw${on ? ' is-on' : ''}`}
                    role="switch"
                    aria-checked={on}
                    title={on ? '这一页:开(点击关闭,试玩时跳过)' : '这一页:关(点击开启)'}
                    onClick={() => updateUIScreen(s.id, { enabled: !on })}
                  >
                    <span className="ks-lay-item-sw-knob" />
                  </button>
                  <button type="button" className="ks-lay-item-btn" onClick={() => setSel({ type: 'screen', id: s.id })}>
                    <span className="ks-lay-item-name">{s.name}</span>
                    <span className="ks-lay-item-tag is-screen">{SCREEN_PRESETS[s.kind].label}</span>
                  </button>
                  <button type="button" className="ks-lay-item-del" onClick={() => delScreen(s.id)} title="删除">✕</button>
                </div>
              )
            })
          )}
        </div>

        {/* 选中项的配置 */}
        {selHud && (
          <div className="ks-lay-config">
            <HudDetail
              key={selHud.id}
              el={selHud}
              asset={selHud.uiAssetId ? uiAssets?.[selHud.uiAssetId] : undefined}
              variables={varList}
              items={itemList}
              sceneOptions={sceneOptions}
              onChange={(patch) => updateHudElement(selHud.id, patch)}
              onRemove={() => delHud(selHud.id)}
            />
          </div>
        )}
        {selScreen && (
          <div className="ks-lay-config">
            <ScreenConfigPanel key={selScreen.id} screen={selScreen} />
          </div>
        )}
      </aside>

      <section className="ks-lay-main">
        {selHud ? (
          <div className="ks-lay-stage-wrap">
            <div className="ks-hudedit-stage-head">样帧摆位(拖动选中元素移动)</div>
            <HudStage
              hud={hudList}
              uiAssets={uiAssets ?? {}}
              selectedId={selHud.id}
              onSelect={(id) => setSel({ type: 'hud', id })}
              onMove={(id, x, y) => updateHudElement(id, { anchor: patchAnchor(hudList, id, { x, y }) })}
            />
          </div>
        ) : selScreen ? (
          <ScreenPreviewPane
            key={selScreen.id}
            screen={selScreen}
            onNavigate={(id) => setSel({ type: 'screen', id })}
          />
        ) : (
          <div className="ks-lay-main-empty">从左侧「＋ 添加 UI」加入常驻 HUD 或全屏页面,再选中编排</div>
        )}
      </section>
    </div>
  )
}

/** 局部改锚点：合并现有 anchor（保留 scale）。 */
function patchAnchor(
  hud: HudElement[],
  id: string,
  patch: Partial<{ x: number; y: number; scale: number }>,
): { x: number; y: number; scale?: number } {
  const cur = hud.find((h) => h.id === id)?.anchor ?? { x: 0.5, y: 0.5 }
  return { ...cur, ...patch }
}

function HudThumb({ asset, size }: { asset: UIAsset; size: number }) {
  const url = useMediaStore((s) => (asset.mediaId ? s.entries[asset.mediaId]?.url : undefined))
  if (!url) return <span className="ks-hudedit-thumb-ph" style={{ width: size, height: size }}>◱</span>
  return (
    <span className="ks-hudedit-thumb" style={{ width: size, height: size }}>
      <img
        src={url}
        alt={asset.name}
        draggable={false}
        style={{ width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: uiBlendModeToCss(asset.blendMode) as CSSProperties['mixBlendMode'] }}
      />
    </span>
  )
}

/** 样帧舞台 —— 背景 + 全部 HUD 叠层;选中项可拖动改锚点。 */
function HudStage({
  hud,
  uiAssets,
  selectedId,
  onSelect,
  onMove,
}: {
  hud: HudElement[]
  uiAssets: Record<string, UIAsset>
  selectedId: string | null
  onSelect: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
}) {
  const bgUrl = useAnySceneBackground()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<string | null>(null)

  function onPointerDown(e: React.PointerEvent, id: string): void {
    e.preventDefault()
    onSelect(id)
    dragRef.current = id
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent): void {
    const id = dragRef.current
    if (!id || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    onMove(id, round2(x), round2(y))
  }
  function endDrag(): void {
    dragRef.current = null
  }

  return (
    <div
      className="ks-hudedit-stage"
      ref={stageRef}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      {bgUrl ? (
        <img className="ks-hudedit-stage-bg" src={bgUrl} alt="样帧" draggable={false} />
      ) : (
        <div className="ks-hudedit-stage-bgph">生成任意场景图后显示样帧</div>
      )}
      {hud.map((el) => {
        const asset = uiAssets[el.uiAssetId]
        if (!asset) return null
        return (
          <HudStageItem
            key={el.id}
            el={el}
            asset={asset}
            selected={el.id === selectedId}
            onPointerDown={(e) => onPointerDown(e, el.id)}
          />
        )
      })}
    </div>
  )
}

function HudStageItem({
  el,
  asset,
  selected,
  onPointerDown,
}: {
  el: HudElement
  asset: UIAsset
  selected: boolean
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const url = useMediaStore((s) => (asset.mediaId ? s.entries[asset.mediaId]?.url : undefined))
  const anchor = el.anchor ?? { x: 0.5, y: 0.5 }
  const scale = anchor.scale ?? asset.defaultAnchor?.scale ?? 16
  const style: CSSProperties = {
    left: `${anchor.x * 100}%`,
    top: `${anchor.y * 100}%`,
    height: `${scale}%`,
  }
  return (
    <div
      className={`ks-hudedit-ov${selected ? ' is-sel' : ''}`}
      style={style}
      onPointerDown={onPointerDown}
    >
      {url ? (
        <img
          src={url}
          alt={asset.name}
          draggable={false}
          style={{ height: '100%', width: 'auto', mixBlendMode: uiBlendModeToCss(el.blendMode ?? asset.blendMode) as CSSProperties['mixBlendMode'] }}
        />
      ) : (
        <span className="ks-hudedit-ov-ph">◱</span>
      )}
    </div>
  )
}

function HudDetail({
  el,
  asset,
  variables,
  items,
  sceneOptions,
  onChange,
  onRemove,
}: {
  el: HudElement
  asset: UIAsset | undefined
  variables: import('../../scenario/types').GameVariable[]
  items: import('../../scenario/types').InventoryItem[]
  sceneOptions: { id: string; title: string }[]
  onChange: (patch: Partial<Omit<HudElement, 'id'>>) => void
  onRemove: () => void
}) {
  const anchor = el.anchor ?? { x: 0.5, y: 0.5, scale: 16 }
  const bind = el.valueBind
  const clauses = el.visibleWhen?.all ?? []

  function setAnchor(patch: Partial<{ x: number; y: number; scale: number }>): void {
    onChange({ anchor: { ...anchor, ...patch } })
  }
  function setClauses(next: ConditionClause[]): void {
    onChange({ visibleWhen: next.length ? { all: next } : undefined })
  }

  return (
    <div className="ks-hudedit-detail-scroll">
      <div className="ks-hudedit-detail-head">
        <span className="ks-hudedit-detail-name">{asset?.name ?? '(素材已删除)'}</span>
        <button type="button" className="ks-hudedit-del" onClick={onRemove}>
          删除
        </button>
      </div>
      {asset && (
        <div className="ks-hudedit-detail-role">
          {UI_ROLE_PRESETS[asset.role]?.label ?? asset.role}
        </div>
      )}

      <div className="ks-hudedit-row2">
        <label className="ks-hudedit-field">
          <span>横向 {Math.round((anchor.x ?? 0.5) * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={anchor.x ?? 0.5}
            onChange={(e) => setAnchor({ x: Number(e.target.value) })}
          />
        </label>
        <label className="ks-hudedit-field">
          <span>纵向 {Math.round((anchor.y ?? 0.5) * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={anchor.y ?? 0.5}
            onChange={(e) => setAnchor({ y: Number(e.target.value) })}
          />
        </label>
      </div>

      <label className="ks-hudedit-field">
        <span>大小(画面高度 {Math.round(anchor.scale ?? 16)}%)</span>
        <input
          type="range"
          min={4}
          max={60}
          step={1}
          value={anchor.scale ?? 16}
          onChange={(e) => setAnchor({ scale: Number(e.target.value) })}
        />
      </label>

      <label className="ks-hudedit-field">
        <span>叠加混合(blend)</span>
        <select
          className="ks-hudedit-input"
          value={el.blendMode ?? asset?.blendMode ?? 'normal'}
          onChange={(e) => onChange({ blendMode: e.target.value as UIBlendMode })}
        >
          {(Object.keys(BLEND_LABELS) as UIBlendMode[]).map((b) => (
            <option key={b} value={b}>
              {BLEND_LABELS[b]}
            </option>
          ))}
        </select>
      </label>

      <label className="ks-hudedit-field">
        <span>叠放层级 z(大在上)</span>
        <input
          type="number"
          className="ks-hudedit-input"
          value={el.z ?? 0}
          onChange={(e) => onChange({ z: Number(e.target.value) || 0 })}
        />
      </label>

      {/* 数值绑定 —— 血条填充(fill) / 数字(number) */}
      <div className="ks-hudedit-sub">数值绑定(实时更新)</div>
      <div className="ks-hudedit-row2">
        <label className="ks-hudedit-field">
          <span>绑定变量</span>
          <select
            className="ks-hudedit-input"
            value={bind?.varId ?? ''}
            onChange={(e) => {
              const varId = e.target.value
              if (!varId) return onChange({ valueBind: undefined })
              onChange({ valueBind: { varId, kind: bind?.kind ?? 'fill', min: bind?.min, max: bind?.max } })
            }}
          >
            <option value="">不绑定</option>
            {variables.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        {bind && (
          <label className="ks-hudedit-field">
            <span>映射方式</span>
            <select
              className="ks-hudedit-input"
              value={bind.kind}
              onChange={(e) => onChange({ valueBind: { ...bind, kind: e.target.value as 'fill' | 'number' } })}
            >
              <option value="fill">血条填充</option>
              <option value="number">数字显示</option>
            </select>
          </label>
        )}
      </div>
      {bind && bind.kind === 'fill' && (
        <div className="ks-hudedit-row2">
          <label className="ks-hudedit-field">
            <span>下限 min</span>
            <input
              type="number"
              className="ks-hudedit-input"
              value={bind.min ?? 0}
              onChange={(e) => onChange({ valueBind: { ...bind, min: Number(e.target.value) } })}
            />
          </label>
          <label className="ks-hudedit-field">
            <span>上限 max</span>
            <input
              type="number"
              className="ks-hudedit-input"
              value={bind.max ?? 100}
              onChange={(e) => onChange({ valueBind: { ...bind, max: Number(e.target.value) } })}
            />
          </label>
        </div>
      )}

      {/* 显示条件 —— 复用分支条件求值(战斗中才显血条等) */}
      <div className="ks-hudedit-sub">显示条件(缺省恒显)</div>
      {clauses.map((c, i) => (
        <ConditionRow
          key={i}
          clause={c}
          variables={variables}
          sceneOptions={sceneOptions}
          items={items}
          onChange={(nc) => setClauses(clauses.map((x, j) => (j === i ? nc : x)))}
          onRemove={() => setClauses(clauses.filter((_, j) => j !== i))}
        />
      ))}
      {clauses.length === 0 && <div className="ks-hudedit-inline-empty">无条件 · 始终显示</div>}
      <button
        type="button"
        className="ks-hudedit-addcond"
        onClick={() => setClauses([...clauses, makeDefaultClause(variables, sceneOptions)])}
      >
        ＋ 显示条件
      </button>
    </div>
  )
}

/** 取任意一个已有场景背景做样帧。 */
function useAnySceneBackground(): string | undefined {
  const scenes = useScenarioStore((s) => s.scenario.scenes)
  const entries = useMediaStore((s) => s.entries)
  return useMemo(() => {
    for (const sc of Object.values(scenes ?? {})) {
      const ref = sc.media?.ref
      if (ref && entries[ref]?.url) return entries[ref].url
    }
    return undefined
  }, [scenes, entries])
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const css = `
/* ── 统一 UI 编排器(布局)外壳 ── */
.ks-lay-root { display: flex; width: 100%; height: 100%; min-height: 0; }
.ks-lay-panel { flex: 0 0 320px; width: 320px; min-width: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 12px; border-right: 1px solid var(--color-border-default); }
.ks-lay-addbar { display: flex; }
.ks-lay-addbtn { flex: 1 1 0; padding: 8px 12px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 12.5px; font-weight: 700; border: 1px solid color-mix(in srgb, var(--color-brand-primary) 50%, transparent); background: color-mix(in srgb, var(--color-brand-primary) 14%, transparent); color: var(--color-brand-primary); }
.ks-lay-addbtn:hover { background: color-mix(in srgb, var(--color-brand-primary) 22%, transparent); }
.ks-lay-addmenu { display: flex; flex-direction: column; gap: 3px; padding: 8px; border: 1px solid var(--color-border-subtle); border-radius: 10px; max-height: 300px; overflow: auto; }
.ks-lay-addgroup-h { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; color: var(--color-text-secondary); padding: 6px 2px 2px; }
.ks-lay-addempty { font-size: 11px; color: var(--color-text-tertiary); padding: 2px 2px 4px; }
.ks-lay-additem { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; border: 1px solid transparent; background: transparent; color: var(--color-text-secondary); cursor: pointer; font-size: 12px; text-align: left; font-family: inherit; }
.ks-lay-additem:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.ks-lay-additem-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ks-lay-addkinds { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px; }
.ks-lay-addkind { padding: 5px 11px; border-radius: 999px; cursor: pointer; font-family: inherit; font-size: 12px; border: 1px solid var(--color-border-subtle); background: var(--color-background-base); color: var(--color-text-secondary); }
.ks-lay-addkind:hover { color: var(--color-brand-primary); border-color: color-mix(in srgb, var(--color-brand-primary) 45%, transparent); }
.ks-lay-list { display: flex; flex-direction: column; gap: 4px; }
.ks-lay-group-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; padding: 4px 2px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border-subtle); }
.ks-lay-group-cnt { font-size: 10px; color: var(--color-text-tertiary); font-weight: 600; }
.ks-lay-empty { font-size: 11.5px; color: var(--color-text-tertiary); padding: 6px 2px; line-height: 1.5; }
.ks-lay-item { display: flex; align-items: center; gap: 4px; border: 1px solid var(--color-border-subtle); border-radius: 8px; overflow: hidden; padding-left: 6px; }
.ks-lay-item.is-sel { border-color: var(--color-brand-primary); background: color-mix(in srgb, var(--color-brand-primary) 8%, transparent); }
.ks-lay-item.is-off .ks-lay-item-name, .ks-lay-item.is-off .ks-lay-item-tag { opacity: 0.42; }
.ks-lay-item-sw, .ks-lay-master { all: unset; cursor: pointer; flex: 0 0 auto; position: relative; width: 26px; height: 15px; border-radius: 999px; background: color-mix(in srgb, var(--color-text-tertiary) 28%, transparent); transition: background .12s; }
.ks-lay-item-sw.is-on, .ks-lay-master.is-on { background: color-mix(in srgb, var(--color-brand-primary) 70%, transparent); }
.ks-lay-item-sw-knob, .ks-lay-master-knob { position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: var(--color-text-secondary); transition: transform .12s, background .12s; }
.ks-lay-item-sw.is-on .ks-lay-item-sw-knob, .ks-lay-master.is-on .ks-lay-master-knob { transform: translateX(11px); background: #0c0f08; }
.ks-lay-item-btn { all: unset; cursor: pointer; flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 7px 8px; }
.ks-lay-item-name { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; color: var(--color-text-primary); }
.ks-lay-item-tag { flex: 0 0 auto; font-size: 9.5px; font-weight: 700; padding: 1px 6px; border-radius: 5px; color: #8fb3ff; background: color-mix(in srgb, #8fb3ff 16%, transparent); }
.ks-lay-item-tag.is-screen { color: var(--color-brand-primary); background: color-mix(in srgb, var(--color-brand-primary) 16%, transparent); }
.ks-lay-item-del { all: unset; cursor: pointer; padding: 0 8px; color: var(--color-text-tertiary); font-size: 12px; }
.ks-lay-item-del:hover { color: var(--color-status-danger, #f87171); }
.ks-lay-config { border-top: 1px solid var(--color-border-default); padding-top: 10px; }
.ks-lay-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.ks-lay-main-empty { flex: 1 1 0; display: flex; align-items: center; justify-content: center; color: var(--color-text-tertiary); font-size: 13px; padding: 24px; text-align: center; }
.ks-lay-stage-wrap { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; padding: 14px; gap: 8px; overflow: auto; }
.ks-hudedit-root { display: flex; height: 100%; min-height: 0; flex: 1 1 0; }
.ks-hudedit-list {
  flex: 0 1 200px; width: 200px; min-width: 150px;
  border-right: 1px solid var(--color-border-default);
  display: flex; flex-direction: column; min-height: 0;
}
.ks-hudedit-list-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border-subtle);
}
.ks-hudedit-add {
  width: 22px; height: 22px; border-radius: 6px;
  border: 1px solid var(--color-border-default); background: var(--color-background-base);
  color: var(--color-text-primary); cursor: pointer; font-size: 14px; line-height: 1;
}
.ks-hudedit-add:hover:not(:disabled) { border-color: var(--color-brand-primary); color: var(--color-brand-primary); }
.ks-hudedit-add:disabled { opacity: 0.4; cursor: default; }
.ks-hudedit-addmenu {
  display: flex; flex-direction: column; gap: 2px; padding: 6px;
  border-bottom: 1px solid var(--color-border-subtle); max-height: 240px; overflow: auto;
}
.ks-hudedit-additem {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px;
  border: 1px solid transparent; background: transparent; color: var(--color-text-secondary);
  cursor: pointer; font-size: 12px; text-align: left; font-family: inherit;
}
.ks-hudedit-additem:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.ks-hudedit-addname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ks-hudedit-ul { list-style: none; margin: 0; padding: 6px; overflow: auto; flex: 1 1 0; min-height: 0; }
.ks-hudedit-li {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border-radius: 8px; border: 1px solid transparent;
  background: transparent; color: var(--color-text-secondary);
  cursor: pointer; font-size: 12.5px; text-align: left; font-family: inherit;
}
.ks-hudedit-li:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.ks-hudedit-li.is-sel {
  background: var(--color-interaction-selected-brand); color: var(--color-text-primary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
}
.ks-hudedit-li-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ks-hudedit-thumb { flex-shrink: 0; border-radius: 6px; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; background: #12151d; }
.ks-hudedit-thumb-ph { flex-shrink: 0; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; color: var(--color-text-tertiary); border: 1px dashed var(--color-border-subtle); border-radius: 6px; font-size: 13px; }
.ks-hudedit-empty { padding: 16px; color: var(--color-text-tertiary); font-size: 12px; text-align: center; line-height: 1.6; }

.ks-hudedit-stage-wrap { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; padding: 14px; gap: 8px; border-right: 1px solid var(--color-border-default); overflow: auto; }
.ks-hudedit-stage-head { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; color: var(--color-text-secondary); }
.ks-hudedit-stage {
  position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden;
  background: #07090e; border: 1px solid var(--color-border-default); touch-action: none;
}
.ks-hudedit-stage-bg { width: 100%; height: 100%; object-fit: cover; }
.ks-hudedit-stage-bgph { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--color-text-tertiary); font-size: 11.5px; }
.ks-hudedit-ov { position: absolute; transform: translate(-50%, -50%); cursor: grab; display: flex; align-items: center; justify-content: center; }
.ks-hudedit-ov:active { cursor: grabbing; }
.ks-hudedit-ov.is-sel { outline: 1.5px dashed color-mix(in srgb, var(--color-brand-primary) 80%, transparent); outline-offset: 3px; }
.ks-hudedit-ov img { display: block; pointer-events: none; }
.ks-hudedit-ov-ph { color: #888; font-size: 18px; }

.ks-hudedit-detail { flex: 0 1 320px; width: 320px; min-width: 240px; overflow: hidden; display: flex; flex-direction: column; }
.ks-hudedit-detail-scroll { overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.ks-hudedit-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ks-hudedit-detail-name { font-size: 14px; font-weight: 600; color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ks-hudedit-detail-role { font-size: 11px; color: var(--color-text-tertiary); margin-top: -6px; }
.ks-hudedit-del {
  padding: 4px 10px; border-radius: 999px; flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--color-status-danger, #f87171) 45%, transparent);
  background: transparent; color: var(--color-status-danger, #f87171); font-size: 11px; cursor: pointer; font-family: inherit;
}
.ks-hudedit-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ks-hudedit-field { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--color-text-tertiary); }
.ks-hudedit-input {
  width: 100%; box-sizing: border-box; padding: 7px 9px; font-size: 12.5px;
  color: var(--color-text-primary); background: var(--color-background-base);
  border: 1px solid var(--color-border-subtle); border-radius: 8px; font-family: inherit;
}
.ks-hudedit-sub { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; color: var(--color-text-secondary); margin-top: 4px; }
.ks-hudedit-inline-empty { font-size: 11px; color: var(--color-text-tertiary); padding: 2px 0; }
.ks-hudedit-addcond {
  align-self: flex-start; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-family: inherit;
  border: 1px dashed var(--color-border-default); background: transparent; color: var(--color-text-secondary); font-size: 12px;
}
.ks-hudedit-addcond:hover { border-color: var(--color-brand-primary); color: var(--color-brand-primary); }
`
injectStyleOnce('hud-layout-editor', css)
