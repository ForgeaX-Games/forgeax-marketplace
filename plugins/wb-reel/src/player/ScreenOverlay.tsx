import { useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useMediaStore } from '../media/mediaStore'
import type {
  Scenario,
  UIScreen,
  UIScreenAction,
  UIScreenSlot,
  UIValueBind,
  SearchHotspot,
} from '../scenario/types'
import { evaluateCondition, type ItemState, type VarState } from './conditionEval'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * ScreenOverlay · 全屏 UI 页面运行时(v11)
 * ─────────────────────────────────────────────────────────────────────────
 * 仿《底特律:变人》类深度互动影游的整页 UI。按 screen.kind 渲染:
 *   - inventory:真背包(读 ownedItems + scenario.items 出网格,查看/丢弃)。
 *   - mainMenu :主菜单按钮(继续/关卡选择/重开/主页/退出)。
 *   - chest    :开宝箱(点击开启 → 发 loot,一次性)。
 *   - search   :搜刮页(整页热点点击拾取,搜打撤)。
 *   - custom   :自定义 slot 拼装(装饰部件 + 按钮 + 动作)。
 *
 * 背景/外框图走 UI 部件(scenario.uiAssets)。玩法副作用(发物品/改数值/导航)
 * 一律通过 onAction 派发给 Player 统一 apply(纯展示组件,自身不改运行时状态)。
 */
export interface ScreenOverlayProps {
  screen: UIScreen
  scenario: Scenario
  ownedItems: ItemState
  vars: VarState
  /** 已访问场景(供 slot visibleWhen 的 visited 条件求值)。 */
  visitedSceneIds?: readonly string[]
  /** 关闭本页(续播)。 */
  onClose: () => void
  /** 动作派发(发物品/改数值/导航/开别的页面等)。 */
  onAction: (action: UIScreenAction) => void
  /** 编辑器预览:内联渲染(不 portal),按钮不产生真实副作用。 */
  preview?: boolean
}

const MENU_LABELS: Record<UIScreenAction['type'], string> = {
  close: '继续',
  restart: '重新开始',
  home: '返回主页',
  exit: '退出',
  levelSelect: '关卡选择',
  jumpScene: '前往',
  openScreen: '打开',
  giveItems: '领取',
  applyVars: '确认',
}

const DEFAULT_MENU_ACTIONS: UIScreenAction['type'][] = [
  'close',
  'levelSelect',
  'restart',
  'home',
  'exit',
]

function useAssetUrl(scenario: Scenario, assetId: string | undefined): string | undefined {
  const mid = assetId ? scenario.uiAssets?.[assetId]?.mediaId : undefined
  return useMediaStore((s) => (mid ? s.entries[mid]?.url : undefined))
}

export function ScreenOverlay(props: ScreenOverlayProps) {
  injectStyleOnce('player-screen-overlay', CSS)
  const { screen, scenario, preview } = props
  const bgUrl = useAssetUrl(scenario, screen.backgroundAssetId)
  const frameUrl = useAssetUrl(scenario, screen.frameAssetId)
  const dismissible = screen.dismissible !== false
  const title = screen.title?.trim() || screen.name

  const body = (
    <div className={`ks-scr${preview ? ' is-preview' : ''}`} role="dialog" aria-label={title}>
      {bgUrl ? (
        <div className="ks-scr-bg" style={{ backgroundImage: `url(${bgUrl})` }} aria-hidden />
      ) : (
        <div className="ks-scr-bg is-fallback" aria-hidden />
      )}
      <div className="ks-scr-scrim" aria-hidden />

      <header className="ks-scr-head">
        <div className="ks-scr-head-text">
          <div className="ks-scr-title ks-cn">{title}</div>
          {screen.subtitle && <div className="ks-scr-sub ks-mono">{screen.subtitle}</div>}
        </div>
        {dismissible && (
          <button type="button" className="ks-scr-close" onClick={props.onClose} aria-label="关闭">
            ✕
          </button>
        )}
      </header>

      <div className="ks-scr-body">
        {screen.kind === 'inventory' && <InventoryScreen {...props} />}
        {screen.kind === 'mainMenu' && <MainMenuScreen {...props} />}
        {screen.kind === 'chest' && <ChestScreen {...props} />}
        {screen.kind === 'search' && <SearchScreen {...props} />}
        {screen.kind === 'custom' && <CustomScreen {...props} />}
      </div>

      {frameUrl && <img className="ks-scr-frame" src={frameUrl} alt="" aria-hidden draggable={false} />}
    </div>
  )

  if (preview) return body
  return createPortal(body, document.body)
}

/* ── 背包 ────────────────────────────────────────────────── */
function InventoryScreen({ scenario, ownedItems, onAction }: ScreenOverlayProps) {
  const entries = useMediaStore((s) => s.entries)
  const [sel, setSel] = useState<string | null>(null)
  const owned = useMemo(
    () =>
      Object.entries(ownedItems)
        .filter(([, n]) => n > 0)
        .map(([id, n]) => ({ id, count: n, item: scenario.items?.[id] }))
        .filter((x) => x.item),
    [ownedItems, scenario.items],
  )
  const selected = sel ? scenario.items?.[sel] : undefined
  const selCount = sel ? ownedItems[sel] ?? 0 : 0

  if (owned.length === 0) {
    return <div className="ks-scr-empty ks-cn">背包空空如也</div>
  }
  return (
    <div className="ks-scr-inv">
      <div className="ks-scr-grid">
        {owned.map(({ id, count, item }) => {
          const url = item!.iconMediaId ? entries[item!.iconMediaId]?.url : undefined
          return (
            <button
              key={id}
              type="button"
              className={`ks-scr-cell${sel === id ? ' is-sel' : ''}`}
              onClick={() => setSel(id)}
            >
              {url ? <img src={url} alt={item!.name} /> : <span className="ks-scr-cell-ph">◈</span>}
              {count > 1 && <span className="ks-scr-cell-cnt">{count}</span>}
              <span className="ks-scr-cell-name ks-cn">{item!.name}</span>
            </button>
          )
        })}
      </div>
      {selected && (
        <aside className="ks-scr-detail">
          <div className="ks-scr-detail-name ks-cn">{selected.name}</div>
          {selected.desc && <div className="ks-scr-detail-desc ks-cn">{selected.desc}</div>}
          <div className="ks-scr-detail-count ks-mono">持有 ×{selCount}</div>
          <button
            type="button"
            className="ks-scr-btn is-danger"
            onClick={() => onAction({ type: 'giveItems', effects: [{ itemId: sel!, op: 'take', count: 1 }] })}
          >
            丢弃 1 件
          </button>
        </aside>
      )}
    </div>
  )
}

/* ── 主菜单 ──────────────────────────────────────────────── */
function MainMenuScreen({ screen, onAction, onClose }: ScreenOverlayProps) {
  const actions = screen.menuActions && screen.menuActions.length > 0 ? screen.menuActions : DEFAULT_MENU_ACTIONS
  return (
    <div className="ks-scr-menu">
      {actions.map((t) => (
        <button
          key={t}
          type="button"
          className={`ks-scr-menu-btn${t === 'exit' ? ' is-danger' : ''}`}
          onClick={() => (t === 'close' ? onClose() : onAction({ type: t } as UIScreenAction))}
        >
          {MENU_LABELS[t]}
        </button>
      ))}
    </div>
  )
}

/* ── 开宝箱 ──────────────────────────────────────────────── */
function ChestScreen({ screen, scenario, vars, onAction, onClose }: ScreenOverlayProps) {
  const alreadyOpened = screen.openedVarId ? (vars[screen.openedVarId] ?? 0) !== 0 : false
  const [opened, setOpened] = useState(alreadyOpened)
  const loot = screen.loot ?? []

  const lootVars = screen.lootVars ?? []
  function open(): void {
    if (opened) return
    if (loot.length > 0) onAction({ type: 'giveItems', effects: loot })
    // 数值奖励(金币/经验等)与物品并行发放,复用数值系统 VarEffect。
    const varFx = [...lootVars]
    if (screen.openedVarId) varFx.push({ varId: screen.openedVarId, op: 'set', value: 1 })
    if (varFx.length > 0) onAction({ type: 'applyVars', effects: varFx })
    setOpened(true)
  }

  if (!opened) {
    return (
      <div className="ks-scr-chest">
        <button type="button" className="ks-scr-chest-open" onClick={open}>
          开启宝箱
        </button>
      </div>
    )
  }
  return (
    <div className="ks-scr-chest">
      <div className="ks-scr-chest-title ks-cn">获得</div>
      {loot.length === 0 && lootVars.length === 0 ? (
        <div className="ks-scr-empty ks-cn">空空如也…</div>
      ) : (
        <div className="ks-scr-loot">
          {loot.map((eff, i) => {
            const item = scenario.items?.[eff.itemId]
            return (
              <div key={`${eff.itemId}-${i}`} className="ks-scr-loot-row ks-cn">
                <span className="ks-scr-loot-name">{item?.name ?? eff.itemId}</span>
                <span className="ks-scr-loot-cnt ks-mono">×{eff.count ?? 1}</span>
              </div>
            )
          })}
          {lootVars.map((eff, i) => {
            const v = scenario.variables?.[eff.varId]
            return (
              <div key={`v-${eff.varId}-${i}`} className="ks-scr-loot-row ks-cn">
                <span className="ks-scr-loot-name">{v?.name ?? eff.varId}</span>
                <span className="ks-scr-loot-cnt ks-mono">
                  {eff.op === 'add' ? `${eff.value >= 0 ? '+' : ''}${eff.value}` : `=${eff.value}`}
                </span>
              </div>
            )
          })}
        </div>
      )}
      <button type="button" className="ks-scr-btn" onClick={onClose}>
        收下
      </button>
    </div>
  )
}

/* ── 搜刮页 ──────────────────────────────────────────────── */
function SearchScreen({ screen, scenario, onAction, onClose }: ScreenOverlayProps) {
  const entries = useMediaStore((s) => s.entries)
  const [collected, setCollected] = useState<Set<string>>(new Set())
  const hotspots = screen.hotspots ?? []
  const remaining = hotspots.filter((h) => !collected.has(h.id))

  function pick(h: SearchHotspot): void {
    if (collected.has(h.id)) return
    onAction({ type: 'giveItems', effects: [{ itemId: h.itemId, op: 'give', count: h.count ?? 1 }] })
    setCollected((s) => new Set(s).add(h.id))
  }

  return (
    <div className="ks-scr-search">
      {hotspots.map((h) => {
        if (collected.has(h.id)) return null
        const item = scenario.items?.[h.itemId]
        const url = item?.iconMediaId ? entries[item.iconMediaId]?.url : undefined
        const sizePct = Math.max(4, (h.r ?? 0.06) * 100)
        return (
          <button
            key={h.id}
            type="button"
            className="ks-scr-spot"
            style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: `${sizePct}%`, paddingBottom: `${sizePct}%` }}
            onClick={() => pick(h)}
            title={item?.name ?? h.label ?? '搜刮'}
          >
            <span className="ks-scr-spot-ring" aria-hidden />
            {url && <img className="ks-scr-spot-icon" src={url} alt="" aria-hidden />}
          </button>
        )
      })}
      <div className="ks-scr-search-foot">
        <span className="ks-scr-search-left ks-mono">剩余 {remaining.length}</span>
        <button type="button" className="ks-scr-btn" onClick={onClose}>
          {remaining.length === 0 ? '完成' : '撤离'}
        </button>
      </div>
    </div>
  )
}

/* ── 自定义 slot 拼装 ─────────────────────────────────────── */
function CustomScreen({ screen, scenario, ownedItems, vars, visitedSceneIds, onAction, onClose }: ScreenOverlayProps) {
  const entries = useMediaStore((s) => s.entries)
  const ctx = useMemo(
    () => ({ vars, visitedSceneIds: new Set(visitedSceneIds ?? []), ownedItems }),
    [vars, visitedSceneIds, ownedItems],
  )
  // 按 visibleWhen 过滤(数值联动:血量低才显警示图标等),再按 z 叠放。
  const slots = [...(screen.slots ?? [])]
    .filter((s) => evaluateCondition(s.visibleWhen, ctx))
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
  return (
    <div className="ks-scr-custom">
      {slots.map((slot) => (
        <SlotView
          key={slot.id}
          slot={slot}
          entries={entries}
          scenario={scenario}
          vars={vars}
          onAction={onAction}
          onClose={onClose}
        />
      ))}
    </div>
  )
}

/** 把绑定变量归一化成 0~1(血条填充);镜像 HudLayer.valueRatio。 */
function slotValueRatio(bind: UIValueBind, scenario: Scenario, vars: VarState): number {
  const def = scenario.variables?.[bind.varId]
  const raw = vars[bind.varId] ?? def?.initial ?? 0
  const min = bind.min ?? def?.min ?? 0
  const max = bind.max ?? def?.max ?? 100
  if (max <= min) return 0
  return Math.max(0, Math.min(1, (raw - min) / (max - min)))
}

function SlotView({
  slot,
  entries,
  scenario,
  vars,
  onAction,
  onClose,
}: {
  slot: UIScreenSlot
  entries: ReturnType<typeof useMediaStore.getState>['entries']
  scenario: Scenario
  vars: VarState
  onAction: (a: UIScreenAction) => void
  onClose: () => void
}) {
  const mid = slot.assetId ? scenario.uiAssets?.[slot.assetId]?.mediaId : undefined
  const url = mid ? entries[mid]?.url : undefined
  const style: React.CSSProperties = {
    left: `${slot.x * 100}%`,
    top: `${slot.y * 100}%`,
    width: slot.w ? `${slot.w * 100}%` : undefined,
    height: slot.h ? `${slot.h * 100}%` : undefined,
    zIndex: slot.z ?? 0,
  }
  const bind = slot.valueBind
  const ratio = bind?.kind === 'fill' ? slotValueRatio(bind, scenario, vars) : null
  const numberText = bind?.kind === 'number' ? String(Math.round(vars[bind.varId] ?? 0)) : null
  const imgStyle: CSSProperties =
    ratio != null ? { clipPath: `inset(0 ${(1 - ratio) * 100}% 0 0)` } : {}

  if (slot.kind === 'text') {
    return (
      <div className="ks-scr-slot ks-scr-slot-text ks-cn" style={style}>
        {numberText != null ? numberText : slot.label}
      </div>
    )
  }
  if (slot.kind === 'button') {
    return (
      <button
        type="button"
        className="ks-scr-slot ks-scr-slot-btn"
        style={style}
        onClick={() => (slot.action ? (slot.action.type === 'close' ? onClose() : onAction(slot.action)) : undefined)}
      >
        {url && <img src={url} alt="" aria-hidden />}
        {slot.label && <span className="ks-cn">{slot.label}</span>}
      </button>
    )
  }
  return (
    <div className="ks-scr-slot ks-scr-slot-widget" style={style}>
      {url && <img src={url} alt="" aria-hidden style={imgStyle} />}
      {numberText != null && <span className="ks-scr-slot-num ks-mono">{numberText}</span>}
    </div>
  )
}

const CSS = `
.ks-scr{position:fixed;inset:0;z-index:110;display:flex;flex-direction:column;
  color:#f3eee2;overflow:hidden;animation:ks-scr-in .24s ease-out;}
.ks-scr.is-preview{position:absolute;z-index:1;}
@keyframes ks-scr-in{from{opacity:0}to{opacity:1}}
.ks-scr-bg{position:absolute;inset:0;background-size:cover;background-position:center;z-index:0;}
.ks-scr-bg.is-fallback{background:radial-gradient(120% 100% at 50% 0%,#1a2030,#05070c);}
.ks-scr-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(4,6,10,.55),rgba(4,6,10,.35) 40%,rgba(4,6,10,.7));z-index:1;}
.ks-scr-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;z-index:5;}
.ks-scr-head{position:relative;z-index:3;display:flex;align-items:flex-start;justify-content:space-between;
  padding:22px 28px 10px;}
.ks-scr-title{font-size:26px;font-weight:700;letter-spacing:.02em;text-shadow:0 2px 12px rgba(0,0,0,.6);}
.ks-scr-sub{font-size:10px;letter-spacing:.32em;color:rgba(255,255,255,.55);margin-top:4px;}
.ks-scr-close{all:unset;cursor:pointer;width:34px;height:34px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;font-size:16px;
  background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18);color:#fff;}
.ks-scr-close:hover{background:rgba(255,123,61,.85);border-color:transparent;}
.ks-scr-body{position:relative;z-index:3;flex:1 1 0;min-height:0;display:flex;padding:8px 28px 24px;overflow:auto;}
.ks-scr-empty{margin:auto;color:rgba(255,255,255,.55);font-size:15px;}

/* 背包 */
.ks-scr-inv{display:flex;gap:18px;width:100%;}
.ks-scr-grid{flex:1 1 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));
  gap:12px;align-content:start;}
.ks-scr-cell{all:unset;cursor:pointer;position:relative;aspect-ratio:1/1;border-radius:12px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px;box-sizing:border-box;}
.ks-scr-cell:hover{border-color:rgba(255,210,120,.6);background:rgba(255,210,120,.08);}
.ks-scr-cell.is-sel{border-color:rgba(255,200,90,.95);box-shadow:0 0 0 2px rgba(255,200,90,.4);}
.ks-scr-cell img{width:64%;height:64%;object-fit:contain;}
.ks-scr-cell-ph{font-size:26px;color:rgba(255,255,255,.35);}
.ks-scr-cell-name{font-size:11px;line-height:1.1;text-align:center;color:rgba(255,255,255,.82);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}
.ks-scr-cell-cnt{position:absolute;right:5px;top:5px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;
  background:#ffca5a;color:#1a1408;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;}
.ks-scr-detail{flex:0 0 240px;background:rgba(10,12,18,.7);border:1px solid rgba(255,255,255,.1);
  border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px;height:max-content;}
.ks-scr-detail-name{font-size:17px;font-weight:600;}
.ks-scr-detail-desc{font-size:13px;line-height:1.6;color:rgba(255,255,255,.72);}
.ks-scr-detail-count{font-size:11px;letter-spacing:.1em;color:rgba(255,255,255,.5);}

/* 通用按钮 */
.ks-scr-btn{all:unset;cursor:pointer;text-align:center;padding:9px 18px;border-radius:10px;
  background:rgba(255,200,90,.92);color:#1a1408;font-weight:600;font-size:14px;margin-top:6px;}
.ks-scr-btn:hover{background:#ffd57a;}
.ks-scr-btn.is-danger{background:rgba(251,113,133,.9);color:#fff;}
.ks-scr-btn.is-danger:hover{background:#fb7185;}

/* 主菜单 */
.ks-scr-menu{margin:auto 0 auto 8px;display:flex;flex-direction:column;gap:12px;min-width:240px;}
.ks-scr-menu-btn{all:unset;cursor:pointer;padding:13px 24px;border-radius:12px;font-size:16px;font-weight:600;
  background:rgba(14,16,22,.6);border:1px solid rgba(255,255,255,.14);color:#f3eee2;
  backdrop-filter:blur(6px);transition:.16s;}
.ks-scr-menu-btn:hover{background:rgba(255,123,61,.9);border-color:transparent;color:#fff;transform:translateX(4px);}
.ks-scr-menu-btn.is-danger{color:rgba(251,113,133,.9);}
.ks-scr-menu-btn.is-danger:hover{background:rgba(251,113,133,.9);color:#fff;}

/* 宝箱 */
.ks-scr-chest{margin:auto;display:flex;flex-direction:column;align-items:center;gap:16px;}
.ks-scr-chest-open{all:unset;cursor:pointer;padding:16px 40px;border-radius:14px;font-size:19px;font-weight:700;
  color:#1a1408;background:linear-gradient(180deg,#ffe08a,#ffb347);box-shadow:0 8px 30px rgba(255,180,60,.5);
  animation:ks-scr-pulse 1.6s ease-in-out infinite;}
@keyframes ks-scr-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.ks-scr-chest-title{font-size:15px;letter-spacing:.2em;color:rgba(255,220,150,.9);}
.ks-scr-loot{display:flex;flex-direction:column;gap:8px;min-width:220px;}
.ks-scr-loot-row{display:flex;justify-content:space-between;gap:16px;padding:8px 14px;border-radius:10px;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,210,120,.3);}
.ks-scr-loot-name{font-size:14px;}
.ks-scr-loot-cnt{color:#ffca5a;font-weight:700;}

/* 搜刮 */
.ks-scr-search{position:relative;flex:1 1 0;width:100%;}
.ks-scr-spot{all:unset;cursor:zoom-in;position:absolute;transform:translate(-50%,-50%);height:0;border-radius:999px;}
.ks-scr-spot-ring{position:absolute;inset:0;border-radius:999px;box-shadow:0 0 0 2px rgba(255,214,120,.5) inset;
  background:radial-gradient(circle,rgba(255,214,120,.18),transparent 70%);transition:.2s;}
.ks-scr-spot:hover .ks-scr-spot-ring{box-shadow:0 0 0 3px rgba(255,214,120,.95) inset,0 0 26px 6px rgba(255,200,90,.5);}
.ks-scr-spot-icon{position:absolute;left:50%;top:50%;width:60%;height:60%;object-fit:contain;transform:translate(-50%,-50%);opacity:.9;}
.ks-scr-search-foot{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:space-between;
  padding:10px 4px;}
.ks-scr-search-left{color:rgba(255,255,255,.65);font-size:12px;}

/* 自定义 slot */
.ks-scr-custom{position:relative;flex:1 1 0;width:100%;}
.ks-scr-slot{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;}
.ks-scr-slot-widget{position:relative;}
.ks-scr-slot-widget img{width:100%;height:100%;object-fit:contain;}
.ks-scr-slot-num{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-weight:700;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.7);font-size:clamp(14px,3vw,32px);}
.ks-scr-slot-text{font-size:16px;color:#f3eee2;text-shadow:0 2px 8px rgba(0,0,0,.6);white-space:nowrap;}
.ks-scr-slot-btn{all:unset;cursor:pointer;gap:6px;padding:8px 16px;border-radius:10px;
  background:rgba(14,16,22,.6);border:1px solid rgba(255,255,255,.18);color:#f3eee2;}
.ks-scr-slot-btn:hover{background:rgba(255,123,61,.9);border-color:transparent;color:#fff;}
.ks-scr-slot-btn img{max-width:40px;max-height:40px;object-fit:contain;}
`
