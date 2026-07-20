import { useMemo, useState } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useMediaStore } from '../../media/mediaStore'
import { createImageProvider } from '../../llm/providers/GptImageProvider'
import type { ImageClient } from '../../llm/config/types'
import { getAuthoringHint } from '../../llm/config/visualStylePresets'
import type {
  ConditionClause,
  GameVariable,
  InventoryItem,
  SearchHotspot,
  UIAssetRole,
  UIScreen,
  UIScreenAction,
  UIScreenKind,
  UIScreenSlot,
  UIValueBind,
} from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'
import { makeUIAsset, generateUIAsset } from './uiAssetArt'
import { SCREEN_PRESETS, screenBackgroundPrompt } from './screenPresets'
import { ScreenOverlay } from '../../player/ScreenOverlay'
import {
  ConditionRow,
  EffectListEditor,
  ItemEffectListEditor,
  makeDefaultClause,
} from '../../editor/numeric/NumericEditors'

/**
 * 全屏页面编辑 —— 拆成两个可复用块,供「界面 · 布局」统一 UI 编排器内联使用:
 *   - ScreenConfigPanel: 选中某页时的配置表单(名称/背景/外框/按 kind 玩法绑定);
 *   - ScreenPreviewPane: 单页交互式预览(点击试玩:按钮跳转 / 开箱 / 拾取)。
 * 页面列表 / 新建 / 每页开关 / 总闸都在编排器(HudLayoutEditor)里,与常驻 HUD 同处一栏。
 */

/** 全屏页面新建用的 kind 选项(供统一编排器复用)。 */
export const KIND_OPTIONS: { id: UIScreenKind; label: string }[] = [
  { id: 'inventory', label: SCREEN_PRESETS.inventory.label },
  { id: 'mainMenu', label: SCREEN_PRESETS.mainMenu.label },
  { id: 'chest', label: SCREEN_PRESETS.chest.label },
  { id: 'search', label: SCREEN_PRESETS.search.label },
  { id: 'custom', label: SCREEN_PRESETS.custom.label },
]

const MENU_ACTION_OPTIONS: { id: UIScreenAction['type']; label: string }[] = [
  { id: 'close', label: '继续' },
  { id: 'levelSelect', label: '关卡选择' },
  { id: 'restart', label: '重新开始' },
  { id: 'home', label: '返回主页' },
  { id: 'exit', label: '退出' },
]

/**
 * ScreenConfigPanel —— 单个全屏页面的配置表单。
 * 自取 store,只需传入选中的 screen;放在编排器左栏(列表下方)。
 */
export function ScreenConfigPanel({ screen }: { screen: UIScreen }) {
  const scenario = useScenarioStore((s) => s.scenario)
  const updateUIScreen = useScenarioStore((s) => s.updateUIScreen)
  const upsertUIAsset = useScenarioStore((s) => s.upsertUIAsset)
  const updateUIAsset = useScenarioStore((s) => s.updateUIAsset)

  const client = useMemo<ImageClient>(() => createImageProvider(), [])
  const [busy, setBusy] = useState<null | 'bg' | 'frame'>(null)
  const [err, setErr] = useState<string | null>(null)

  const items = useMemo(() => Object.values(scenario.items ?? {}), [scenario.items])
  const variables = useMemo(() => Object.values(scenario.variables ?? {}), [scenario.variables])
  const sceneOptions = useMemo(
    () => Object.values(scenario.scenes).map((s) => ({ id: s.id, title: s.title })),
    [scenario.scenes],
  )
  const screenOptions = useMemo(
    () => Object.values(scenario.uiScreens ?? {}).map((s) => ({ id: s.id, title: s.name })),
    [scenario.uiScreens],
  )
  const widgetChoices = useMemo(
    () => Object.values(scenario.uiAssets ?? {}).filter((a) => a.mediaId),
    [scenario.uiAssets],
  )

  async function genPart(kind: 'bg' | 'frame'): Promise<void> {
    const role: UIAssetRole = kind === 'bg' ? 'screen-background' : 'screen-frame'
    const prompt =
      kind === 'bg'
        ? screenBackgroundPrompt(screen.kind)
        : 'an empty decorative full-screen UI border overlay, ornate edge trim, clear empty center, nothing in the middle'
    const field = kind === 'bg' ? 'backgroundAssetId' : 'frameAssetId'
    const existingId = kind === 'bg' ? screen.backgroundAssetId : screen.frameAssetId
    setBusy(kind)
    setErr(null)
    try {
      const id = existingId ?? `ui_${screen.id}_${kind}_${Date.now().toString(36)}`
      const asset = makeUIAsset({
        id,
        role,
        name: kind === 'bg' ? `${screen.name}·背景` : `${screen.name}·外框`,
        prompt,
      })
      upsertUIAsset(asset)
      const { mediaId, effectiveMatte, effectiveBlendMode } = await generateUIAsset({
        asset,
        client,
        ctx: {
          worldSynopsis: scenario.synopsis,
          styleHint: getAuthoringHint(scenario.visualStyle, scenario.filmLook) || undefined,
          uiStylePrompt: scenario.uiStyle?.prompt,
        },
      })
      updateUIAsset(id, { mediaId, matte: effectiveMatte, blendMode: effectiveBlendMode })
      updateUIScreen(screen.id, { [field]: id } as Partial<UIScreen>)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(null)
    }
  }

  injectStyleOnce('ui-screen-editor', css)

  return (
    <div className="ks-scred-form">
      <label className="ks-scred-field">
        <span>页面名称</span>
        <input
          type="text"
          value={screen.name}
          onChange={(e) => updateUIScreen(screen.id, { name: e.target.value })}
        />
      </label>
      <div className="ks-scred-field-row">
        <label className="ks-scred-field">
          <span>标题</span>
          <input
            type="text"
            value={screen.title ?? ''}
            placeholder={screen.name}
            onChange={(e) => updateUIScreen(screen.id, { title: e.target.value || undefined })}
          />
        </label>
        <label className="ks-scred-field">
          <span>副标题</span>
          <input
            type="text"
            value={screen.subtitle ?? ''}
            onChange={(e) => updateUIScreen(screen.id, { subtitle: e.target.value || undefined })}
          />
        </label>
      </div>

      <BackgroundBlock
        label="全屏背景"
        url={assetUrl(scenario, screen.backgroundAssetId)}
        busy={busy === 'bg'}
        hasAsset={!!screen.backgroundAssetId}
        onGen={() => genPart('bg')}
      />
      <BackgroundBlock
        label="外框(可选)"
        url={assetUrl(scenario, screen.frameAssetId)}
        busy={busy === 'frame'}
        hasAsset={!!screen.frameAssetId}
        onGen={() => genPart('frame')}
        frame
      />
      {err && <div className="ks-scred-err">{err}</div>}

      <label className="ks-scred-check">
        <input
          type="checkbox"
          checked={screen.dismissible !== false}
          onChange={(e) => updateUIScreen(screen.id, { dismissible: e.target.checked })}
        />
        <span>玩家可关闭(取消 = 强制选择,主菜单常用)</span>
      </label>

      <div className="ks-scred-note">{SCREEN_PRESETS[screen.kind].blurb}</div>

      {/* 玩法绑定 —— 按 kind */}
      {screen.kind === 'chest' && (
        <div className="ks-scred-sub">
          <div className="ks-scred-sub-head">
            <span>宝箱奖励(与数值系统同步)</span>
          </div>
          <div className="ks-scred-sublabel">物品战利品</div>
          {items.length === 0 ? (
            <div className="ks-scred-hint">请先在「背包系统」中创建物品</div>
          ) : (
            <ItemEffectListEditor
              items={items}
              effects={screen.loot ?? []}
              onChange={(loot) => updateUIScreen(screen.id, { loot: loot.length ? loot : undefined })}
            />
          )}
          <div className="ks-scred-sublabel">数值奖励(金币 / 经验…)</div>
          {variables.length === 0 ? (
            <div className="ks-scred-hint">请先在「数值系统」中创建变量</div>
          ) : (
            <EffectListEditor
              variables={variables}
              effects={screen.lootVars ?? []}
              onChange={(lootVars) => updateUIScreen(screen.id, { lootVars: lootVars.length ? lootVars : undefined })}
            />
          )}
        </div>
      )}
      {screen.kind === 'search' && (
        <HotspotEditor
          hotspots={screen.hotspots ?? []}
          items={items}
          onChange={(hotspots) => updateUIScreen(screen.id, { hotspots })}
        />
      )}
      {screen.kind === 'mainMenu' && (
        <MenuActionEditor
          selected={screen.menuActions}
          onChange={(menuActions) => updateUIScreen(screen.id, { menuActions })}
        />
      )}
      {screen.kind === 'custom' && (
        <SlotEditor
          slots={screen.slots ?? []}
          widgetChoices={widgetChoices.map((a) => ({ id: a.id, name: a.name }))}
          sceneOptions={sceneOptions}
          screenOptions={screenOptions.filter((o) => o.id !== screen.id)}
          variables={variables}
          items={items}
          onChange={(slots) => updateUIScreen(screen.id, { slots })}
        />
      )}
    </div>
  )
}

/**
 * ScreenPreviewPane —— 单页交互式预览(所见即玩家所得)。
 * onNavigate:预览里点"打开页面"时,让编排器就地切到目标页,实现点击跳转试玩。
 */
export function ScreenPreviewPane({
  screen,
  onNavigate,
}: {
  screen: UIScreen
  onNavigate?: (id: string) => void
}) {
  const scenario = useScenarioStore((s) => s.scenario)
  const [previewMsg, setPreviewMsg] = useState<string | null>(null)

  const previewOwned = useMemo(
    () => Object.fromEntries(Object.keys(scenario.items ?? {}).map((id) => [id, 1])),
    [scenario.items],
  )
  const previewVars = useMemo(
    () =>
      Object.fromEntries(
        Object.values(scenario.variables ?? {}).map((v) => [v.id, v.initial ?? 0]),
      ),
    [scenario.variables],
  )

  function flashPreview(msg: string): void {
    setPreviewMsg(msg)
    window.setTimeout(() => setPreviewMsg((cur) => (cur === msg ? null : cur)), 1600)
  }
  function handlePreviewAction(action: UIScreenAction): void {
    if (action.type === 'openScreen') {
      if (scenario.uiScreens?.[action.screenId]) {
        onNavigate?.(action.screenId)
        setPreviewMsg(null)
      } else {
        flashPreview('目标页面不存在')
      }
      return
    }
    const labels: Record<UIScreenAction['type'], string> = {
      close: '继续 / 关闭',
      restart: '重新开始',
      home: '返回主页',
      exit: '退出',
      levelSelect: '打开关卡选择(剧情树)',
      jumpScene: '跳到场景',
      openScreen: '打开页面',
      giveItems: '发放物品',
      applyVars: '改变数值',
    }
    flashPreview(`预览:${labels[action.type]}`)
  }

  injectStyleOnce('ui-screen-editor', css)

  return (
    <div className="ks-scred-preview">
      <div className="ks-scred-preview-label">实时预览 · 玩家所见(可点击试玩:按钮跳转 / 开箱 / 拾取)</div>
      <div className="ks-scred-preview-stage">
        <ScreenOverlay
          key={screen.id}
          screen={screen}
          scenario={scenario}
          ownedItems={previewOwned}
          vars={previewVars}
          onClose={() => flashPreview('预览:关闭页面')}
          onAction={handlePreviewAction}
          preview
        />
        {previewMsg && <div className="ks-scred-preview-toast ks-cn">{previewMsg}</div>}
      </div>
    </div>
  )
}

function assetUrl(scenario: ReturnType<typeof useScenarioStore.getState>['scenario'], assetId?: string): string | undefined {
  const mid = assetId ? scenario.uiAssets?.[assetId]?.mediaId : undefined
  return mid ? useMediaStore.getState().entries[mid]?.url : undefined
}

function BackgroundBlock({
  label,
  url,
  busy,
  hasAsset,
  onGen,
  frame,
}: {
  label: string
  url: string | undefined
  busy: boolean
  hasAsset: boolean
  onGen: () => void
  frame?: boolean
}) {
  return (
    <div className="ks-scred-asset">
      <div className="ks-scred-asset-head">
        <span>{label}</span>
        <button type="button" onClick={onGen} disabled={busy}>
          {busy ? '生成中…' : hasAsset ? '重生' : '生成'}
        </button>
      </div>
      <div className={`ks-scred-thumb${frame ? ' is-frame' : ''}`}>
        {url ? <img src={url} alt={label} /> : <span className="ks-scred-noimg">未生成</span>}
      </div>
    </div>
  )
}

/* ── 搜刮热点编辑 ─────────────────────────────────────────── */
function HotspotEditor({
  hotspots,
  items,
  onChange,
}: {
  hotspots: SearchHotspot[]
  items: { id: string; name: string }[]
  onChange: (hs: SearchHotspot[]) => void
}) {
  function add(): void {
    const first = items[0]
    if (!first) return
    onChange([...hotspots, { id: `hs_${Date.now().toString(36)}`, itemId: first.id, x: 0.5, y: 0.5, r: 0.08, count: 1 }])
  }
  function patch(i: number, p: Partial<SearchHotspot>): void {
    onChange(hotspots.map((h, j) => (j === i ? { ...h, ...p } : h)))
  }
  return (
    <div className="ks-scred-sub">
      <div className="ks-scred-sub-head">
        <span>搜刮热点</span>
        <button type="button" onClick={add} disabled={items.length === 0}>
          + 添加
        </button>
      </div>
      {items.length === 0 && <div className="ks-scred-hint">请先在「道具库」中创建物品</div>}
      {hotspots.map((h, i) => (
        <div key={h.id} className="ks-scred-hs">
          <select value={h.itemId} onChange={(e) => patch(i, { itemId: e.target.value })}>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}
              </option>
            ))}
          </select>
          <div className="ks-scred-hs-xy">
            <label>x<input type="number" min={0} max={1} step={0.01} value={h.x} onChange={(e) => patch(i, { x: Number(e.target.value) })} /></label>
            <label>y<input type="number" min={0} max={1} step={0.01} value={h.y} onChange={(e) => patch(i, { y: Number(e.target.value) })} /></label>
            <label>r<input type="number" min={0.02} max={0.5} step={0.01} value={h.r ?? 0.08} onChange={(e) => patch(i, { r: Number(e.target.value) })} /></label>
            <button type="button" className="ks-scred-x" onClick={() => onChange(hotspots.filter((_, j) => j !== i))}>✕</button>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── 主菜单按钮选择 ───────────────────────────────────────── */
function MenuActionEditor({
  selected,
  onChange,
}: {
  selected: UIScreenAction['type'][] | undefined
  onChange: (v: UIScreenAction['type'][]) => void
}) {
  const active = selected ?? MENU_ACTION_OPTIONS.map((o) => o.id)
  function toggle(id: UIScreenAction['type']): void {
    onChange(active.includes(id) ? active.filter((x) => x !== id) : [...active, id])
  }
  return (
    <div className="ks-scred-sub">
      <div className="ks-scred-sub-head">
        <span>菜单按钮</span>
      </div>
      {MENU_ACTION_OPTIONS.map((o) => (
        <label key={o.id} className="ks-scred-check">
          <input type="checkbox" checked={active.includes(o.id)} onChange={() => toggle(o.id)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  )
}

/* ── 自定义 slot 编辑 ─────────────────────────────────────── */
function SlotEditor({
  slots,
  widgetChoices,
  sceneOptions,
  screenOptions,
  variables,
  items,
  onChange,
}: {
  slots: UIScreenSlot[]
  widgetChoices: { id: string; name: string }[]
  sceneOptions: { id: string; title: string }[]
  /** 其它全屏页面(用于按钮"打开页面"实现点击跳转)。 */
  screenOptions: { id: string; title: string }[]
  variables: GameVariable[]
  items: InventoryItem[]
  onChange: (s: UIScreenSlot[]) => void
}) {
  function add(kind: UIScreenSlot['kind']): void {
    onChange([...slots, { id: `slot_${Date.now().toString(36)}`, kind, x: 0.5, y: 0.5, w: 0.2, h: 0.1 }])
  }
  function patch(i: number, p: Partial<UIScreenSlot>): void {
    onChange(slots.map((s, j) => (j === i ? { ...s, ...p } : s)))
  }
  return (
    <div className="ks-scred-sub">
      <div className="ks-scred-sub-head">
        <span>拼装槽位</span>
        <span className="ks-scred-add-slot">
          <button type="button" onClick={() => add('widget')}>+部件</button>
          <button type="button" onClick={() => add('button')}>+按钮</button>
          <button type="button" onClick={() => add('text')}>+文字</button>
        </span>
      </div>
      {slots.map((s, i) => (
        <div key={s.id} className="ks-scred-slot">
          <div className="ks-scred-slot-head">
            <span className="ks-scred-slot-kind">{s.kind === 'widget' ? '部件' : s.kind === 'button' ? '按钮' : '文字'}</span>
            <button type="button" className="ks-scred-x" onClick={() => onChange(slots.filter((_, j) => j !== i))}>✕</button>
          </div>
          {(s.kind === 'button' || s.kind === 'text') && (
            <input
              type="text"
              placeholder="文案"
              value={s.label ?? ''}
              onChange={(e) => patch(i, { label: e.target.value })}
            />
          )}
          {(s.kind === 'widget' || s.kind === 'button') && (
            <select value={s.assetId ?? ''} onChange={(e) => patch(i, { assetId: e.target.value || undefined })}>
              <option value="">— 选择部件图 —</option>
              {widgetChoices.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          {s.kind === 'button' && (
            <SlotActionEditor
              action={s.action}
              sceneOptions={sceneOptions}
              screenOptions={screenOptions}
              variables={variables}
              items={items}
              onChange={(action) => patch(i, { action })}
            />
          )}

          {/* 数值绑定 —— 部件槽可当血条(fill)/数字(number),与 HUD 同一套 */}
          {s.kind === 'widget' && variables.length > 0 && (
            <SlotValueBindEditor
              bind={s.valueBind}
              variables={variables}
              onChange={(valueBind) => patch(i, { valueBind })}
            />
          )}

          {/* 显示条件 —— 数值联动(血量低才显警示、拿到钥匙才显按钮…) */}
          <SlotVisibleEditor
            clauses={s.visibleWhen?.all ?? []}
            variables={variables}
            items={items}
            sceneOptions={sceneOptions}
            onChange={(clauses) => patch(i, { visibleWhen: clauses.length ? { all: clauses } : undefined })}
          />

          <div className="ks-scred-hs-xy">
            <label>x<input type="number" min={0} max={1} step={0.01} value={s.x} onChange={(e) => patch(i, { x: Number(e.target.value) })} /></label>
            <label>y<input type="number" min={0} max={1} step={0.01} value={s.y} onChange={(e) => patch(i, { y: Number(e.target.value) })} /></label>
            <label>w<input type="number" min={0} max={1} step={0.01} value={s.w ?? 0.2} onChange={(e) => patch(i, { w: Number(e.target.value) })} /></label>
            <label>h<input type="number" min={0} max={1} step={0.01} value={s.h ?? 0.1} onChange={(e) => patch(i, { h: Number(e.target.value) })} /></label>
          </div>
        </div>
      ))}
    </div>
  )
}

/** 按钮动作编辑 —— 含跨页跳转(openScreen)、发物品、改数值。 */
function SlotActionEditor({
  action,
  sceneOptions,
  screenOptions,
  variables,
  items,
  onChange,
}: {
  action: UIScreenAction | undefined
  sceneOptions: { id: string; title: string }[]
  screenOptions: { id: string; title: string }[]
  variables: GameVariable[]
  items: InventoryItem[]
  onChange: (a: UIScreenAction) => void
}) {
  const type = action?.type ?? 'close'
  function pick(t: UIScreenAction['type']): void {
    if (t === 'jumpScene') onChange({ type: 'jumpScene', sceneId: sceneOptions[0]?.id ?? '' })
    else if (t === 'openScreen') onChange({ type: 'openScreen', screenId: screenOptions[0]?.id ?? '' })
    else if (t === 'giveItems') onChange({ type: 'giveItems', effects: [] })
    else if (t === 'applyVars') onChange({ type: 'applyVars', effects: [] })
    else onChange({ type: t } as UIScreenAction)
  }
  return (
    <>
      <select value={type} onChange={(e) => pick(e.target.value as UIScreenAction['type'])}>
        <option value="close">继续/关闭</option>
        <option value="openScreen">打开页面(跳转)</option>
        <option value="jumpScene">跳到场景</option>
        <option value="levelSelect">关卡选择</option>
        <option value="giveItems">发放物品</option>
        <option value="applyVars">改变数值</option>
        <option value="restart">重新开始</option>
        <option value="home">返回主页</option>
        <option value="exit">退出</option>
      </select>
      {action?.type === 'jumpScene' && (
        <select value={action.sceneId} onChange={(e) => onChange({ type: 'jumpScene', sceneId: e.target.value })}>
          {sceneOptions.map((sc) => (
            <option key={sc.id} value={sc.id}>{sc.title}</option>
          ))}
        </select>
      )}
      {action?.type === 'openScreen' && (
        <select value={action.screenId} onChange={(e) => onChange({ type: 'openScreen', screenId: e.target.value })}>
          {screenOptions.length === 0 && <option value="">(先建其它页面)</option>}
          {screenOptions.map((sc) => (
            <option key={sc.id} value={sc.id}>{sc.title}</option>
          ))}
        </select>
      )}
      {action?.type === 'giveItems' && (
        <ItemEffectListEditor
          items={items}
          effects={action.effects}
          onChange={(effects) => onChange({ type: 'giveItems', effects })}
        />
      )}
      {action?.type === 'applyVars' && (
        <EffectListEditor
          variables={variables}
          effects={action.effects}
          onChange={(effects) => onChange({ type: 'applyVars', effects })}
        />
      )}
    </>
  )
}

/** 部件槽的数值绑定(fill 血条 / number 数字)。 */
function SlotValueBindEditor({
  bind,
  variables,
  onChange,
}: {
  bind: UIValueBind | undefined
  variables: GameVariable[]
  onChange: (b: UIValueBind | undefined) => void
}) {
  return (
    <div className="ks-scred-bind">
      <select
        value={bind?.varId ?? ''}
        onChange={(e) => {
          const varId = e.target.value
          if (!varId) return onChange(undefined)
          onChange({ varId, kind: bind?.kind ?? 'fill', min: bind?.min, max: bind?.max })
        }}
      >
        <option value="">数值绑定:无</option>
        {variables.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>
      {bind && (
        <select value={bind.kind} onChange={(e) => onChange({ ...bind, kind: e.target.value as 'fill' | 'number' })}>
          <option value="fill">血条填充</option>
          <option value="number">数字显示</option>
        </select>
      )}
      {bind && bind.kind === 'fill' && (
        <>
          <input type="number" title="下限" value={bind.min ?? 0} onChange={(e) => onChange({ ...bind, min: Number(e.target.value) })} />
          <input type="number" title="上限" value={bind.max ?? 100} onChange={(e) => onChange({ ...bind, max: Number(e.target.value) })} />
        </>
      )}
    </div>
  )
}

/** 槽位显示条件编辑(复用数值系统 ConditionRow)。 */
function SlotVisibleEditor({
  clauses,
  variables,
  items,
  sceneOptions,
  onChange,
}: {
  clauses: ConditionClause[]
  variables: GameVariable[]
  items: InventoryItem[]
  sceneOptions: { id: string; title: string }[]
  onChange: (c: ConditionClause[]) => void
}) {
  return (
    <div className="ks-scred-cond">
      {clauses.map((c, i) => (
        <ConditionRow
          key={i}
          clause={c}
          variables={variables}
          sceneOptions={sceneOptions}
          items={items}
          onChange={(nc) => onChange(clauses.map((x, j) => (j === i ? nc : x)))}
          onRemove={() => onChange(clauses.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        className="ks-scred-cond-add"
        onClick={() => onChange([...clauses, makeDefaultClause(variables, sceneOptions)])}
      >
        ＋ 显示条件{clauses.length === 0 ? '(缺省恒显)' : ''}
      </button>
    </div>
  )
}

const css = `
.ks-scred-root { display: flex; width: 100%; height: 100%; min-height: 0; }
.ks-scred-panel { flex: 0 0 340px; overflow-y: auto; padding: 14px 16px; border-right: 1px solid var(--color-border-default); display: flex; flex-direction: column; gap: 12px; }
.ks-scred-add { display: flex; gap: 8px; }
.ks-scred-add select { flex: 1 1 0; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-background-canvas); color: var(--color-text-primary); font: inherit; font-size: 12.5px; }
.ks-scred-add button, .ks-scred-sub-head button { font-size: 11.5px; padding: 5px 12px; border-radius: 999px; cursor: pointer; border: 1px solid color-mix(in srgb, var(--color-brand-primary) 45%, transparent); background: color-mix(in srgb, var(--color-brand-primary) 14%, transparent); color: var(--color-brand-primary); }
.ks-scred-list { display: flex; flex-direction: column; gap: 5px; }
.ks-scred-empty, .ks-scred-hint { font-size: 12px; color: var(--color-text-tertiary); padding: 4px 2px; }
.ks-scred-item { display: flex; align-items: center; gap: 4px; border: 1px solid var(--color-border-subtle); border-radius: 8px; overflow: hidden; padding-left: 8px; }
.ks-scred-item.is-sel { border-color: var(--color-brand-primary); }
.ks-scred-item.is-off .ks-scred-item-name, .ks-scred-item.is-off .ks-scred-item-kind { opacity: 0.42; }
.ks-scred-item-sw { all: unset; cursor: pointer; flex: 0 0 auto; position: relative; width: 26px; height: 15px; border-radius: 999px; background: color-mix(in srgb, var(--color-text-tertiary) 28%, transparent); transition: background .12s; }
.ks-scred-item-sw.is-on { background: color-mix(in srgb, var(--color-brand-primary) 70%, transparent); }
.ks-scred-item-sw-knob { position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: var(--color-text-secondary); transition: transform .12s, background .12s; }
.ks-scred-item-sw.is-on .ks-scred-item-sw-knob { transform: translateX(11px); background: #0c0f08; }
.ks-scred-enable { padding: 6px 8px; border: 1px solid var(--color-border-subtle); border-radius: 8px; background: color-mix(in srgb, var(--color-brand-primary) 5%, transparent); }
.ks-scred-item-btn { all: unset; cursor: pointer; flex: 1 1 0; display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; }
.ks-scred-item-name { font-size: 13px; color: var(--color-text-primary); }
.ks-scred-item-kind { font-size: 10.5px; color: var(--color-text-tertiary); }
.ks-scred-item-del, .ks-scred-x { all: unset; cursor: pointer; padding: 0 8px; color: var(--color-text-tertiary); font-size: 12px; }
.ks-scred-item-del:hover, .ks-scred-x:hover { color: var(--color-status-error, #f87171); }
.ks-scred-form { display: flex; flex-direction: column; gap: 12px; }
.ks-scred-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--color-text-secondary); flex: 1 1 0; }
.ks-scred-field input, .ks-scred-field select, .ks-scred-row select, .ks-scred-row input, .ks-scred-slot input, .ks-scred-slot select, .ks-scred-hs select { padding: 6px 8px; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-background-canvas); color: var(--color-text-primary); font: inherit; font-size: 12.5px; }
.ks-scred-field-row { display: flex; gap: 10px; }
.ks-scred-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-secondary); cursor: pointer; }
.ks-scred-note { font-size: 11.5px; color: var(--color-text-tertiary); line-height: 1.5; }
.ks-scred-asset { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--color-border-subtle); border-radius: 10px; }
.ks-scred-asset-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--color-text-primary); }
.ks-scred-asset-head button:disabled { opacity: 0.5; cursor: default; }
.ks-scred-thumb { width: 100%; aspect-ratio: 16 / 10; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, transparent 0% 50%) 0 / 16px 16px, #111; }
.ks-scred-thumb img { width: 100%; height: 100%; object-fit: cover; }
.ks-scred-thumb.is-frame img { object-fit: contain; }
.ks-scred-noimg { font-size: 11px; color: var(--color-text-tertiary); }
.ks-scred-err { font-size: 12px; color: var(--color-status-error, #f87171); }
.ks-scred-sub { display: flex; flex-direction: column; gap: 7px; padding: 10px; border: 1px solid var(--color-border-subtle); border-radius: 10px; }
.ks-scred-sub-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--color-text-primary); }
.ks-scred-add-slot { display: flex; gap: 5px; }
.ks-scred-row { display: flex; gap: 6px; align-items: center; }
.ks-scred-row select { flex: 1 1 0; }
.ks-scred-row input { width: 62px; }
.ks-scred-hs { display: flex; flex-direction: column; gap: 5px; padding: 6px; border: 1px dashed var(--color-border-subtle); border-radius: 8px; }
.ks-scred-hs-xy { display: flex; gap: 6px; align-items: center; }
.ks-scred-hs-xy label { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--color-text-tertiary); }
.ks-scred-hs-xy input { width: 52px; padding: 4px 6px; border-radius: 6px; border: 1px solid var(--color-border-subtle); background: var(--color-background-canvas); color: var(--color-text-primary); font: inherit; font-size: 12px; }
.ks-scred-slot { display: flex; flex-direction: column; gap: 5px; padding: 7px; border: 1px dashed var(--color-border-subtle); border-radius: 8px; }
.ks-scred-slot-head { display: flex; align-items: center; justify-content: space-between; }
.ks-scred-slot-kind { font-size: 11px; color: var(--color-text-secondary); }
.ks-scred-preview { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.ks-scred-preview-label { flex: 0 0 auto; padding: 8px 14px; font-size: 11.5px; letter-spacing: 0.06em; color: var(--color-text-tertiary); border-bottom: 1px solid var(--color-border-default); }
.ks-scred-preview-stage { flex: 1 1 0; min-height: 0; position: relative; background: #05070c; overflow: hidden; }
.ks-scred-preview-empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--color-text-tertiary); font-size: 13px; }
.ks-scred-preview-toast { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); padding: 7px 16px; border-radius: 999px; background: rgba(12,14,20,.88); border: 1px solid color-mix(in srgb, var(--color-brand-primary) 40%, transparent); color: #f3eee2; font-size: 12.5px; pointer-events: none; z-index: 30; }
.ks-scred-sublabel { font-size: 11px; color: var(--color-text-tertiary); margin-top: 2px; }
.ks-scred-bind { display: flex; flex-wrap: wrap; gap: 6px; }
.ks-scred-bind select { flex: 1 1 90px; padding: 5px 7px; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-background-canvas); color: var(--color-text-primary); font: inherit; font-size: 12px; }
.ks-scred-bind input { width: 56px; padding: 5px 6px; border-radius: 8px; border: 1px solid var(--color-border-subtle); background: var(--color-background-canvas); color: var(--color-text-primary); font: inherit; font-size: 12px; }
.ks-scred-cond { display: flex; flex-direction: column; gap: 5px; }
.ks-scred-cond-add { align-self: flex-start; font-size: 11px; padding: 4px 10px; border-radius: 8px; cursor: pointer; border: 1px dashed var(--color-border-default); background: transparent; color: var(--color-text-secondary); font-family: inherit; }
.ks-scred-cond-add:hover { border-color: var(--color-brand-primary); color: var(--color-brand-primary); }
`
injectStyleOnce('ui-screen-editor', css)
