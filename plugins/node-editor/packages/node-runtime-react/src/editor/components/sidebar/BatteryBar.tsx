// 💡 电池选择栏（竖向版）：
//   ─ 大标签（左侧 rail，点击跳转到右侧对应分组）
//   ─ 小标签（手风琴二级，多个可同时展开 / 收起；点 + 号可展开覆盖层平铺全部电池）
//   ─ 电池条目（叶子）：图标 + 名称单行列表
// 整列纵向滚动；右侧 4px 把手可拖拽调整电池栏宽度（localStorage 持久化）
// 横向滚动相关旧逻辑（attachBatteryBarHScrollWheel / hScroll smooth refs / cards-scroll-map / tabs-scroll-left）已整体移除。
//
// Develop 用手风琴（大标签 → 小标签 → 电池行）；Templates 大标签=父分类，其下直接平铺模板卡片。
// 右键菜单 / 星标 / 开发记录角标 / Tooltip / 拖拽到画布 等核心交互全部保留。
//
// 忠实移植说明（faithful port）：模板分类目录列表原由 app 级 apiService.getTemplateCategories()
// 拉取，属多项目 chrome，已在通用编辑器中剥离；templateCategories 保留为空数组，
// templates 渲染分支因此仅由通用电池数据驱动（batteryFilterMode 默认恒为 'develop'）。
import { useState, useMemo, useRef, useLayoutEffect, useEffect, memo, useCallback } from 'react'
import { usePipelineStore } from '../../stores/index.js'
import { useUIStore } from '../../stores/index.js'
import { formatIdAsLabel, getBatteryTagLine, getBatteryTypeColor } from '../../utils/batteryLabels.js'
import type { Battery } from '../../types.js'
import { useNodeTooltip, TooltipPortal } from '../canvas/nodeTooltip.js'
import type { BatteryTooltipState } from '../canvas/nodeTooltip.js'
import DevNoteModal from './DevNoteModal.js'
import { getEditorTransport, peekEditorTransport } from '../../transport/index.js'
import './BatteryBar.css'
import {
  BATTERY_BAR_WIDTH_DEFAULT,
  BATTERY_BAR_WIDTH_MIN,
  BATTERY_BAR_WIDTH_MAX,
  readActiveBigLabels,
  writeActiveBigLabels,
  readCollapsedSmallMap,
  writeCollapsedSmallMap,
  readVScrollMap,
  writeVScrollSlot,
  vScrollKey,
  smallGroupKey,
  parseSmallGroupKey,
  readBigLabelOrder,
  writeBigLabelOrder,
} from './batteryBarStorage.js'
import {
  type CatalogBattery,
  isTemplateBattery,
  catalogBatteryKey,
  getBigLabel,
  getTemplateSubfolder,
  getTemplateSmallLabel,
  getSmallLabel,
  formatBigLabel,
  formatBigLabelRailText,
  formatBigLabelRailRest,
  compareBigLabel,
  formatSmallLabel,
  applyOrder,
  sortSmallLabels,
  sortBatteriesInGroup,
} from './batteryGrouping.js'

// Width is intentionally NOT persisted: the battery bar resets to its default
// on every reload, and drag changes stay local to the session.

// 合成大标签 + 小标签：固定钉在大标签栏顶端，专门收录用户收藏的电池。
const FAVORITES_BIG = '__favorites__'
const FAVORITES_SMALL = 'favorites'

// 合成大标签：文本预设栏。钉在收藏之后，展示已保存的 Panel 文本预设；
// 条目可拖入画布生成预填文字的 text_panel 节点（行为与电池一致）。
const PRESETS_BIG = '__presets__'

// 右键「删除」/ 行内删除按钮开放范围：
//   ─ 用户保存的提示词（prompt:* 且 builtin !== true）
//   ─ 用户模板（成组模板电池且 builtin === false）
//   ─ Develop「GROUPS」标签下的成组电池（groups/<cat>，本地电池目录可增删）
// 预设提示词 / 预设模板 builtin=true 一律不可删；普通 op 不可删。
// 注意：'group' 删除会物理删除本地电池目录里的文件，且仅在 transport 暴露
// deleteGroupTemplate 路由时由调用方启用（见 canDeleteGroups 闸门）。
type DeletableKind =
  | { kind: 'prompt'; promptId: string }
  | { kind: 'template'; groupId: string }
  | { kind: 'group'; groupId: string }
  | null

function getDeletableKind(battery: Battery): DeletableKind {
  if (battery.nodeType === 'prompt' && battery.id.startsWith('prompt:')) {
    return battery.builtin === true ? null : { kind: 'prompt', promptId: battery.id.slice('prompt:'.length) }
  }
  if (isTemplateBattery(battery)) {
    return battery.builtin === false ? { kind: 'template', groupId: battery.id } : null
  }
  // 非模板的成组电池 → Develop「GROUPS」标签项，可删本地电池目录文件。
  if (battery.type === 'group') {
    return { kind: 'group', groupId: battery.id }
  }
  return null
}

function parseFavoriteBatteryJson(batteryJson: string): Battery | null {
  try {
    const parsed = JSON.parse(batteryJson) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const battery = parsed as Battery
    if (typeof battery.id !== 'string' || typeof battery.name !== 'string') return null
    return battery
  } catch {
    return null
  }
}

// ── 文本预设面板（嵌在大标签栏「预设」列下） ──────────────────────────────────
// 展示已保存的文本预设（内置 + 用户，来自后端双源），支持拖拽到画布生成预填文字
// 的 text_panel 节点；用户预设可删除，内置预设只读。拖拽载荷沿用旧实现
// （application/battery + application/preset-text），由 useCanvasDrop 消费。
interface PresetsRailPanelProps {
  batteries: Battery[]
  langMode: string
}

/** Inline close (×) icon — the package is intentionally lucide-free. */
function PresetXIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ── Rail pictogram 图标（替代 ⭐ / 🔖 emoji，lucide-free，走 currentColor） ──
// 收藏 / 预设是两个合成大标签，rail 上原先用彩色 emoji 当图标，与其余文字标签
// 风格割裂。改为描边 SVG，统一由 .bb-rail-icon shell 承载（配色继承按钮 color）。

/** 收藏（星形轮廓）图标。 */
function FavoritesRailIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2.6 15.09 8.86 22 9.87 17 14.74 18.18 21.62 12 18.37 5.82 21.62 7 14.74 2 9.87 8.91 8.86 12 2.6" />
    </svg>
  )
}

/** 预设（书签轮廓）图标。 */
function PresetsRailIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3.6h12a1 1 0 0 1 1 1v16.2l-7-4.3-7 4.3V4.6a1 1 0 0 1 1-1Z" />
    </svg>
  )
}

/** Develop ⇄ Templates 模式切换图标：上下双箭头（swap），随模式高亮由按钮 color 决定。 */
function ModeToggleRailIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="7 8 4 5 1 8" transform="translate(4 1)" />
      <path d="M8 6v8a4 4 0 0 0 4 4" />
      <polyline points="13 16 16 19 19 16" transform="translate(0 -1)" />
      <path d="M16 18V10a4 4 0 0 0-4-4" />
    </svg>
  )
}

/** 展开 / 收起电池栏的小三角（chevron）。collapsed=true 指向右（展开），否则指向左（收起）。 */
function CollapseRailIcon({ collapsed, size = 15 }: { collapsed: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {collapsed ? <polyline points="9 5 16 12 9 19" /> : <polyline points="15 5 8 12 15 19" />}
    </svg>
  )
}

/** 已收藏标记：实心黄色五角星（电池/模板被加入收藏后展示）。 */
function FavoriteStarIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#f5c518" stroke="none" aria-hidden="true">
      <polygon points="12 2.6 15.09 8.86 22 9.87 17 14.74 18.18 21.62 12 18.37 5.82 21.62 7 14.74 2 9.87 8.91 8.86 12 2.6" />
    </svg>
  )
}

const PresetsRailPanel = memo(function PresetsRailPanel({ batteries, langMode }: PresetsRailPanelProps) {
  const textPresets = useUIStore((s) => s.textPresets)
  const removeTextPreset = useUIStore((s) => s.removeTextPreset)
  const en = langMode === 'en'

  // 拖拽开始：stopPropagation 阻止冒泡到父级 draggable 容器（避免其取消拖拽）。
  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, text: string) => {
    e.stopPropagation()
    const textPanelBattery = batteries.find((b) => b.id === 'text_panel')
    if (!textPanelBattery) {
      console.warn('[PresetsRailPanel] text_panel battery not found in registry')
      return
    }
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData('application/battery', JSON.stringify(textPanelBattery))
    e.dataTransfer.setData('application/preset-text', text)
  }, [batteries])

  if (textPresets.length === 0) {
    return (
      <div className="bb-presets-empty">
        {en
          ? 'No presets. Click the bookmark on a text panel to save one.'
          : '暂无预设。在文本面板右上角点击书签按钮保存。'}
      </div>
    )
  }

  return (
    <div className="bb-presets-panel">
      {textPresets.map((preset) => (
        <div
          key={preset.id}
          className={`bb-preset-item${preset.builtin ? ' bb-preset-item--builtin' : ''}`}
          draggable
          onDragStart={(e) => handleDragStart(e, preset.text)}
          title={preset.text}
        >
          <div className="bb-preset-body">
            {preset.title && (
              <div className="bb-preset-title">
                {preset.builtin && (
                  <span className="bb-preset-badge" aria-hidden>
                    {en ? 'Built-in' : '内置'}
                  </span>
                )}
                <span className="bb-preset-title-text">{preset.title}</span>
              </div>
            )}
            <div className="bb-preset-text">{preset.text}</div>
          </div>
          {!preset.builtin && (
            <button
              type="button"
              className="bb-preset-delete"
              onClick={(e) => { e.stopPropagation(); removeTextPreset(preset.id) }}
              title={en ? 'Delete preset' : '删除此预设'}
            >
              <PresetXIcon size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
})

// ── 电池条目（单行列表）：图标 + 名称 + 星标/记录角标 ────────────────────────
interface BatteryRowProps {
  battery: Battery
  langMode: string
  stars: number
  devNoteCount: number
  showDevNoteCount: boolean
  /** 该电池/模板是否已被收藏（展示黄色五角星标记）。 */
  isFavorite: boolean
  /** 右键菜单当前指向本行：保持模板预览图的悬浮放大态（不缩回）。 */
  isContextActive?: boolean
  /** Templates mode renders a large golden-ratio preview image + wrapping name. */
  templateMode?: boolean
  onDragStart: (e: React.DragEvent, battery: Battery) => void
  onContextMenu: (e: React.MouseEvent, battery: Battery) => void
  /** When set, renders an inline (hover) delete button that calls this with the row's battery. */
  onDelete?: (battery: Battery) => void
}

const BatteryRow = memo(function BatteryRow({
  battery,
  langMode,
  stars,
  devNoteCount,
  showDevNoteCount,
  isFavorite,
  isContextActive = false,
  templateMode = false,
  onDragStart,
  onContextMenu,
  onDelete,
}: BatteryRowProps) {
  const { tooltip, showDelayed, hide, trackMouse } = useNodeTooltip(800)

  const displayName = langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
  const displayDesc = langMode === 'zh'
    ? (battery.description || battery.name)
    : (battery.descriptionEn || battery.description || displayName)

  const handleMouseEnter = useCallback(() => {
    showDelayed({
      title: displayName,
      icon: battery.iconSvg,
      subtitle: battery.version ? `v${battery.version}` : undefined,
      tagLine: getBatteryTagLine(battery.type, battery.category),
      tagLineColor: getBatteryTypeColor(battery.type),
      description: displayDesc,
    } satisfies BatteryTooltipState)
  }, [battery, displayName, displayDesc, showDelayed])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, battery)
  }, [battery, onContextMenu])

  // 名称右侧 meta（星 + 角标）：只有星 > 0 或开启角标才渲染，避免空列占位
  const showStars = stars > 0
  const showCount = showDevNoteCount && devNoteCount > 0
  const hasMeta = showStars || showCount
  const cappedStars = Math.min(stars, 9)   // 行内宽度有限，最多显示 9 颗

  if (templateMode) {
    return (
      <div
        className={`battery-row battery-row--template${isContextActive ? ' battery-row--context-active' : ''}`}
        draggable
        onDragStart={e => onDragStart(e, battery)}
        onMouseEnter={handleMouseEnter}
        onMouseMove={trackMouse}
        onMouseLeave={hide}
        onContextMenu={handleContextMenu}
      >
        <span className="battery-row-thumb">
          {battery.iconPng
            ? <img className="battery-row-thumb-img" src={battery.iconPng} alt={displayName} draggable={false} />
            : <span className="battery-row-thumb-empty">
                <span className="battery-row-thumb-empty-glyph" aria-hidden>🖼</span>
                <span className="battery-row-thumb-empty-text">{langMode === 'en' ? 'No preview' : '无预览图'}</span>
              </span>
          }
          {isFavorite && (
            <span className="battery-row-fav-star battery-row-fav-star--thumb" title={langMode === 'en' ? 'Favorited' : '已收藏'}>
              <FavoriteStarIcon size={16} />
            </span>
          )}
        </span>
        <span className="battery-row-template-body">
          <span className="battery-row-template-name">{displayName}</span>
          {hasMeta && (
            <span className="battery-row-meta">
              {showStars && <span className="battery-row-stars">{'★'.repeat(cappedStars)}</span>}
              {showCount && <span className="battery-row-note-count">{devNoteCount}</span>}
            </span>
          )}
        </span>
        {tooltip && <TooltipPortal tooltip={tooltip} />}
      </div>
    )
  }

  return (
    <div
      className="battery-row"
      draggable
      onDragStart={e => onDragStart(e, battery)}
      onMouseEnter={handleMouseEnter}
      onMouseMove={trackMouse}
      onMouseLeave={hide}
      onContextMenu={handleContextMenu}
    >
      <span className="battery-row-icon">
        {battery.iconSvg
          ? <span className="battery-row-icon-svg" dangerouslySetInnerHTML={{ __html: battery.iconSvg }} />
          : <span className="battery-row-icon-fallback">⚡</span>
        }
      </span>
      <span className="battery-row-name">{displayName}</span>
      {isFavorite && (
        <span className="battery-row-fav-star" title={langMode === 'en' ? 'Favorited' : '已收藏'}>
          <FavoriteStarIcon size={12} />
        </span>
      )}
      {hasMeta && (
        <span className="battery-row-meta">
          {showStars && <span className="battery-row-stars">{'★'.repeat(cappedStars)}</span>}
          {showCount && <span className="battery-row-note-count">{devNoteCount}</span>}
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          className="battery-row-delete"
          title={langMode === 'en' ? 'Delete this group battery' : '删除此 group 电池'}
          aria-label={langMode === 'en' ? 'Delete this group battery' : '删除此 group 电池'}
          draggable={false}
          onMouseDown={e => e.stopPropagation()}
          onDragStart={e => { e.preventDefault(); e.stopPropagation() }}
          onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(battery) }}
        >
          <PresetXIcon size={12} />
        </button>
      )}
      {tooltip && <TooltipPortal tooltip={tooltip} />}
    </div>
  )
})

interface ContextMenuState {
  x: number
  y: number
  battery: Battery
}

interface DevNoteTarget {
  id: string
  name: string
}

function BatteryBar() {
  const { batteries, categories, batteryOrder, saveBatteryOrder } = usePipelineStore()
  const langMode = useUIStore((s) => s.langMode)
  const batteryStars = useUIStore((s) => s.batteryStars)
  const batteryDevNotes = useUIStore((s) => s.batteryDevNotes)
  const showDevNoteCount = useUIStore((s) => s.showDevNoteCount)
  const favoriteBatteries = useUIStore((s) => s.favoriteBatteries)
  const addFavoriteBattery = useUIStore((s) => s.addFavoriteBattery)
  const removeFavoriteBattery = useUIStore((s) => s.removeFavoriteBattery)
  const removePrompt = useUIStore((s) => s.removePrompt)
  const removeUserTemplate = useUIStore((s) => s.removeUserTemplate)
  const removeGroupBattery = useUIStore((s) => s.removeGroupBattery)
  // 多项目：当前激活项目类型（用于按 projectTypes 过滤）
  const activeProjectType = useUIStore((s) => s.activeProjectType)
  // Develop / Templates 切换：Toolbar 与 rail 底部切换按钮共用同一 store 动作。
  const batteryFilterMode = useUIStore((s) => s.batteryFilterMode)
  const setBatteryFilterMode = useUIStore((s) => s.setBatteryFilterMode)
  // searchQuery 当前由画布双击搜索浮层（CanvasSearchPopover）驱动，BatteryBar 内部不再有写入入口；
  // 这里仍订阅状态用于显示搜索结果计数 / 切换扁平搜索视图。setter 暂未使用但保留预留接口。
  const [searchQuery, setSearchQuery] = useState('')
  void setSearchQuery
  const [focusedBigLabel, setFocusedBigLabel] = useState<string | null>(() => readActiveBigLabels()[0] ?? null)
  // 收藏 / 预设属「收藏视图」，其余大标签属「电池视图」。视图由当前 focused 大标签决定。
  const isCollectionLabel = useCallback(
    (label: string) => label === FAVORITES_BIG || label === PRESETS_BIG,
    [],
  )
  const railView: 'batteries' | 'collection' =
    focusedBigLabel && isCollectionLabel(focusedBigLabel) ? 'collection' : 'batteries'
  // 小标签折叠集合：按大标签维度独立存储已收起的小标签（默认全部展开）
  const [collapsedSmallLabels, setCollapsedSmallLabels] = useState<Record<string, string[]>>(readCollapsedSmallMap)
  // Templates 大标签的空占位目录：扫 batteries/templates/ 子目录（即便尚无模板电池），
  // 让空分类也显示。注意用 listTemplateOnlyCategories（templates/），而非
  // listTemplateCategories（那是 groups/ 保存分类，会混入 111/222）。
  const [templateCategories, setTemplateCategories] = useState<string[]>([])

  useEffect(() => {
    if (batteryFilterMode !== 'templates') return
    void getEditorTransport().api.listTemplateOnlyCategories()
      .then((cats) => setTemplateCategories([...cats]))
      .catch(() => setTemplateCategories([]))
  }, [batteryFilterMode])

  // ── 右键菜单状态 ────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)

  // ── 开发记录弹窗状态（多实例：同一电池只保留一个）
  const [devNoteTargets, setDevNoteTargets] = useState<DevNoteTarget[]>([])

  // ── 大标签拖拽排序状态 ──────────────────────────────────────────────────
  const [dragBigLabel, setDragBigLabel] = useState<string | null>(null)
  const [dragOverBigLabel, setDragOverBigLabel] = useState<string | null>(null)
  // 大标签顺序持久化到浏览器（localStorage），develop / templates 各存各的桶。
  const [bigLabelOrder, setBigLabelOrder] = useState<string[]>(() => readBigLabelOrder(batteryFilterMode))
  useEffect(() => {
    setBigLabelOrder(readBigLabelOrder(batteryFilterMode))
  }, [batteryFilterMode])
  const [isRailExpanded, setIsRailExpanded] = useState(false)
  const [isRailExpansionSuppressed, setIsRailExpansionSuppressed] = useState(false)
  // 电池栏整体收起 / 展开（会话态，不持久化，与宽度一致刷新即恢复默认展开）。
  const [isCollapsed, setIsCollapsed] = useState(false)

  // 本栏「浮在画布之上」，画布占满整行不随本栏开闭回流；把本栏实测宽度发布到
  // `--bb-current-width`（挂在根上），供组内视图导航栏右移到本栏右侧、避免被遮挡。
  const asideRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const el = asideRef.current
    if (!el) return
    const publish = () => {
      document.documentElement.style.setProperty('--bb-current-width', `${el.offsetWidth}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.documentElement.style.removeProperty('--bb-current-width')
    }
  }, [])

  // ── 小标签拖拽排序状态 ──────────────────────────────────────────────────
  const [dragSmallLabel, setDragSmallLabel] = useState<string | null>(null)
  const [dragOverSmallLabel, setDragOverSmallLabel] = useState<string | null>(null)

  // ── 小标签展开覆盖层（+ 号点开后，绝对定位的多列网格平铺该小标签全部电池） ─
  const [expandedSmallLabel, setExpandedSmallLabel] = useState<string | null>(null)
  const [overlayStyle, setOverlayStyle] = useState<React.CSSProperties | null>(null)

  // ── DOM refs ────────────────────────────────────────────────────────────
  const scrollerRef = useRef<HTMLDivElement>(null)         // 整体纵向滚动容器
  const smallHeaderRefs = useRef<Record<string, HTMLDivElement | null>>({})  // 每个小标签头部 DOM（用于覆盖层定位）
  const bigSectionRefs = useRef<Record<string, HTMLDivElement | null>>({})    // 每个大标签内容分组 DOM（用于 rail 跳转）
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedBigLabelRef = useRef<string | null>(focusedBigLabel)
  const bigLabelsRef = useRef<string[]>([])
  // ── 越界滚动跨视图：电池视图滚到底再向下 → 切到收藏视图；收藏视图滚到顶再向上 → 回电池视图。
  //    两视图仍各自独立（互不滚过），只是用「越界滚动」连通。累加越界量到阈值才切，避免误触。
  //    为「无缝」：跨界后接管 wheel（非 passive，preventDefault + 手动驱动 scrollTop），
  //    绕开浏览器在边界处的 wheel latching（否则同一手势越界后必须先移动鼠标才能继续滚）。
  const overscrollAccumRef = useRef(0)
  // 越界切视图后，强制把新视图定位到指定边（top / bottom），覆盖该视图保存的滚动位置。
  const forcedScrollEdgeRef = useRef<'top' | 'bottom' | null>(null)
  // 接管期：在此时间戳之前，wheel 全部由我们手动驱动（每次滚动延长，停顿后归还原生）。
  const transitionUntilRef = useRef(0)
  // 刚切视图、强制定位尚未应用前置真：由强制定位 effect 消费后再启动手动驱动循环。
  const transitionPendingRef = useRef(false)
  const pendingDeltaRef = useRef(0)
  const flushRafRef = useRef<number | null>(null)

  useEffect(() => {
    focusedBigLabelRef.current = focusedBigLabel
  }, [focusedBigLabel])

  // ── 宽度拖拽 ─────────────────────────────────────────────────────────────
  // Always starts at the default (no localStorage restore) per product
  // decision: refresh = default width.
  const [width, setWidth] = useState<number>(BATTERY_BAR_WIDTH_DEFAULT)
  const widthRef = useRef<number>(width)
  useEffect(() => { widthRef.current = width }, [width])

  const onResizeMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widthRef.current
    document.body.classList.add('bb-resizing')
    const onMove = (m: MouseEvent) => {
      const next = Math.max(BATTERY_BAR_WIDTH_MIN, Math.min(BATTERY_BAR_WIDTH_MAX, startW + (m.clientX - startX)))
      setWidth(next)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('bb-resizing')
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // ── 纵向滚动持久化 ──────────────────────────────────────────────────────
  // 两个视图各自独立的滚动位置（互不干扰），故把视图维度拼进 key。
  const scrollKey = useMemo(
    () => `${vScrollKey(searchQuery)}::${railView}`,
    [searchQuery, railView]
  )

  // 接管期手动驱动循环：把累积的 wheel delta 持续写入 scrollTop，直到停顿超时归还原生滚动。
  const ensureFlushLoop = useCallback(() => {
    if (flushRafRef.current != null) return
    const step = () => {
      const el = scrollerRef.current
      if (!el) { flushRafRef.current = null; return }
      if (pendingDeltaRef.current !== 0) {
        const max = Math.max(0, el.scrollHeight - el.clientHeight)
        el.scrollTop = Math.min(max, Math.max(0, el.scrollTop + pendingDeltaRef.current))
        pendingDeltaRef.current = 0
      }
      flushRafRef.current = Date.now() < transitionUntilRef.current
        ? requestAnimationFrame(step)
        : null
    }
    flushRafRef.current = requestAnimationFrame(step)
  }, [])

  // 切换大标签 / 搜索语境时恢复滚动位置（双 rAF 确保 DOM 已渲染）。
  // 越界切视图时 forcedScrollEdgeRef 指定边，优先于保存位置（保证滚动连续感）。
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const map = readVScrollMap()
    const saved = map[scrollKey] ?? 0
    const apply = () => {
      const s = scrollerRef.current
      if (!s) return
      const max = Math.max(0, s.scrollHeight - s.clientHeight)
      const forced = forcedScrollEdgeRef.current
      if (forced) {
        forcedScrollEdgeRef.current = null
        s.scrollTop = forced === 'bottom' ? max : 0
      } else {
        s.scrollTop = Math.min(Math.max(0, saved), max)
      }
      // 强制定位（越界切视图）落定后，再启动手动驱动循环，让同一 wheel 手势无缝续滚。
      if (transitionPendingRef.current) {
        transitionPendingRef.current = false
        ensureFlushLoop()
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(apply))
  }, [scrollKey, ensureFlushLoop])

  const syncFocusedBigLabelFromScroll = useCallback(() => {
    const labels = bigLabelsRef.current
    if (searchQuery || labels.length === 0) return
    const scroller = scrollerRef.current
    if (!scroller) return

    // 右侧列表按大标签 section 顺序渲染；滚动顶部进入哪个 section，左侧 rail 就高亮哪个大标签。
    const markerTop = scroller.scrollTop + 4
    let nextFocused = labels[0] ?? null
    for (const label of labels) {
      const section = bigSectionRefs.current[label]
      if (!section) continue
      if (section.offsetTop <= markerTop) nextFocused = label
      else break
    }

    if (nextFocused && focusedBigLabelRef.current !== nextFocused) {
      focusedBigLabelRef.current = nextFocused
      setFocusedBigLabel(nextFocused)
      writeActiveBigLabels([nextFocused])
    }
  }, [searchQuery])

  const persistScroll = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    syncFocusedBigLabelFromScroll()
    if (scrollSaveTimerRef.current != null) clearTimeout(scrollSaveTimerRef.current)
    scrollSaveTimerRef.current = setTimeout(() => {
      scrollSaveTimerRef.current = null
      const s = scrollerRef.current
      if (s) writeVScrollSlot(scrollKey, s.scrollTop)
    }, 120)
  }, [scrollKey, syncFocusedBigLabelFromScroll])

  useEffect(() => () => {
    if (scrollSaveTimerRef.current != null) clearTimeout(scrollSaveTimerRef.current)
    if (flushRafRef.current != null) cancelAnimationFrame(flushRafRef.current)
  }, [])

  // ── 小标签展开覆盖层定位（点 + 号后从该小标签头下方展开到容器底部） ────
  useLayoutEffect(() => {
    if (!expandedSmallLabel || !scrollerRef.current) {
      setOverlayStyle(null)
      return
    }
    const scroller = scrollerRef.current
    const headerEl = smallHeaderRefs.current[expandedSmallLabel]
    if (!headerEl) {
      setOverlayStyle(null)
      return
    }
    // 用 getBoundingClientRect 差值取 header 底部位置（避坑 2026-03-17：不要 offsetTop+gap 累加）
    const calc = () => {
      const sRect = scroller.getBoundingClientRect()
      const hRect = headerEl.getBoundingClientRect()
      const top = hRect.bottom - sRect.top + scroller.scrollTop
      setOverlayStyle({
        position: 'absolute',
        left: 0,
        right: 0,
        top,
        bottom: 0,
      })
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [expandedSmallLabel])

  const resolveSmallLabel = useCallback((b: Battery) => {
    return batteryFilterMode === 'templates' ? getTemplateSubfolder(b) : getSmallLabel(b)
  }, [batteryFilterMode])

  // ── 派生：大标签列表（原始） ─────────────────────────────────────────────
  const rawBigLabels = useMemo(() => {
    if (batteryFilterMode === 'templates') {
      // 大标签来自：(1) batteries/templates/ 下的所有目录（含空占位目录，
      // 经 listTemplateOnlyCategories 取得）；(2) 真正的模板电池自身的分类。
      // 绝不混入 listTemplateCategories()——那是 groups/ 保存分类（111/222）。
      const templateBatteries = batteries.filter(b => isTemplateBattery(b))
      const tags = new Set<string>([
        ...templateCategories,
        ...templateBatteries.map(b => b.category || getBigLabel(b)),
      ])
      // Templates 模式同样钉一个「收藏」入口（模板收藏入口），位于 rail 底部。
      // 预设（文本预设）与模板无关，不在此模式出现。
      return [FAVORITES_BIG, ...[...tags].sort()]
    }

    const tsTags: string[] = []
    const otherTags: string[] = []
    const seenTs = new Set<string>()
    const seenOther = new Set<string>()

    const matchesProjectType = (b: Battery): boolean => {
      if (!activeProjectType) return true
      const types = (b as CatalogBattery).projectTypes
      if (!types || types.length === 0) return true
      if (types.includes('both')) return true
      return types.includes(activeProjectType)
    }

    if (categories.length > 0) {
      const visibleBigTags = new Set(
        batteries.filter(b => b.type === 'ts' && matchesProjectType(b) && !b.paletteHidden)
          .map(b => getBigLabel(b))
      )
      categories.forEach(c => {
        if (c.type !== 'ts') return
        if (!visibleBigTags.has(c.bigTag)) return
        if (seenTs.has(c.bigTag)) return
        seenTs.add(c.bigTag)
        tsTags.push(c.bigTag)
      })
    } else {
      batteries.filter(b => b.type === 'ts' && matchesProjectType(b) && !b.paletteHidden).forEach(b => {
        const label = getBigLabel(b)
        if (seenTs.has(label)) return
        seenTs.add(label)
        tsTags.push(label)
      })
    }

    batteries.forEach(b => {
      if (b.type === 'ts') return
      if (isTemplateBattery(b)) return
      if (b.paletteHidden) return
      if (!matchesProjectType(b)) return
      const label = getBigLabel(b)
      if (seenOther.has(label)) return
      seenOther.add(label)
      otherTags.push(label)
    })

    return [FAVORITES_BIG, PRESETS_BIG, ...tsTags.sort(compareBigLabel), ...otherTags.sort(compareBigLabel)]
  }, [batteries, categories, activeProjectType, batteryFilterMode, templateCategories])

  // 应用持久化排序后的大标签列表（用于渲染），收藏 + 预设始终钉顶
  const bigLabels = useMemo(() => {
    const ordered = applyOrder(bigLabelOrder, rawBigLabels)
    const pinned = [FAVORITES_BIG, PRESETS_BIG].filter(label => ordered.includes(label))
    let result = pinned.length === 0
      ? [...ordered]
      : [...pinned, ...ordered.filter(label => !pinned.includes(label))]
    // Prompts 大标签固定钉在 GROUPS 之下（与 GROUPS 同为底部品牌标签）。
    if (result.includes('prompt') && result.includes('groups')) {
      result = result.filter(label => label !== 'prompt')
      result.splice(result.indexOf('groups') + 1, 0, 'prompt')
    }
    return result
  }, [rawBigLabels, bigLabelOrder])

  // ── 双视图拆分：收藏 / 预设 归「收藏视图」，其余电池大标签归「电池视图」。
  //    两个视图各自一个独立滚动容器（互不滚过），rail 底部钉住收藏/预设按钮。
  const collectionLabels = useMemo(
    () => bigLabels.filter(isCollectionLabel),
    [bigLabels, isCollectionLabel],
  )
  const batteryLabels = useMemo(
    () => bigLabels.filter(label => !isCollectionLabel(label)),
    [bigLabels, isCollectionLabel],
  )
  // 仅当前视图内的大标签参与滚动联动（rail 高亮 / 恢复滚动位置）。
  const activeViewLabels = railView === 'collection' ? collectionLabels : batteryLabels

  useEffect(() => {
    bigLabelsRef.current = activeViewLabels
  }, [activeViewLabels])

  // ── 越界滚动跨视图：到达边界后继续同向滚动，累加到阈值即切到相邻视图并定位到对边。 ──
  const switchOverscrollView = useCallback((target: 'batteries' | 'collection', edge: 'top' | 'bottom') => {
    const targetLabel = target === 'collection'
      ? collectionLabels[0]
      : batteryLabels[batteryLabels.length - 1]
    if (!targetLabel) return
    setExpandedSmallLabel(null)
    forcedScrollEdgeRef.current = edge
    transitionPendingRef.current = true
    focusedBigLabelRef.current = targetLabel
    setFocusedBigLabel(targetLabel)
    writeActiveBigLabels([targetLabel])
  }, [collectionLabels, batteryLabels])

  // 非 passive 的 wheel 监听：跨界时 preventDefault 并手动驱动滚动，绕开浏览器 wheel latching，
  // 实现「越界后同一手势无需移动鼠标即可无缝续滚到下一视图」。
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const TRANSITION_MS = 220
    const OVERSCROLL_THRESHOLD = 120

    const onWheel = (e: WheelEvent) => {
      if (searchQuery) return
      const now = Date.now()

      // 接管期：手动消费所有 wheel（preventDefault + 累积 delta 交给 rAF 写 scrollTop）。
      if (now < transitionUntilRef.current) {
        e.preventDefault()
        pendingDeltaRef.current += e.deltaY
        transitionUntilRef.current = now + TRANSITION_MS
        if (!transitionPendingRef.current) ensureFlushLoop()
        return
      }

      const max = Math.max(0, el.scrollHeight - el.clientHeight)
      const atBottom = el.scrollTop >= max - 1
      const atTop = el.scrollTop <= 1

      if (e.deltaY > 0 && railView === 'batteries' && atBottom && collectionLabels.length > 0) {
        e.preventDefault()
        overscrollAccumRef.current = Math.max(0, overscrollAccumRef.current) + e.deltaY
        if (overscrollAccumRef.current >= OVERSCROLL_THRESHOLD) {
          overscrollAccumRef.current = 0
          transitionUntilRef.current = now + TRANSITION_MS
          switchOverscrollView('collection', 'top')
        }
      } else if (e.deltaY < 0 && railView === 'collection' && atTop && batteryLabels.length > 0) {
        e.preventDefault()
        overscrollAccumRef.current = Math.min(0, overscrollAccumRef.current) + e.deltaY
        if (overscrollAccumRef.current <= -OVERSCROLL_THRESHOLD) {
          overscrollAccumRef.current = 0
          transitionUntilRef.current = now + TRANSITION_MS
          switchOverscrollView('batteries', 'bottom')
        }
      } else {
        overscrollAccumRef.current = 0
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [searchQuery, railView, collectionLabels, batteryLabels, switchOverscrollView, ensureFlushLoop, isCollapsed])

  const fuzzyMatch = (b: Battery, query: string): boolean => {
    if (!query.trim()) return true
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    const fields = [
      b.id,
      b.name,
      b.description ?? '',
      b.category,
      ...(b.tags ?? []),
      ...(b.tagLabels ?? []),
    ].map(f => f.toLowerCase())
    return tokens.every(token => fields.some(field => field.includes(token)))
  }

  const matchesProjectType = useCallback((b: Battery): boolean => {
    if (!activeProjectType) return true
    const types = (b as CatalogBattery).projectTypes
    if (!types || types.length === 0) return true
    if (types.includes('both')) return true
    return types.includes(activeProjectType)
  }, [activeProjectType])

  const visibleBatteries = useMemo(() => {
    let result = batteries.filter(b => !b.paletteHidden)
    if (batteryFilterMode === 'templates') {
      result = result.filter(b => isTemplateBattery(b))
    } else {
      result = result.filter(b => !isTemplateBattery(b))
    }
    return result.filter(matchesProjectType)
  }, [batteries, batteryFilterMode, matchesProjectType])

  const searchBatteries = useMemo(
    () => visibleBatteries.filter(b => fuzzyMatch(b, searchQuery)),
    [visibleBatteries, searchQuery]
  )

  const searchResultCount = useMemo(() => {
    if (!searchQuery) return 0
    return searchBatteries.length
  }, [searchBatteries, searchQuery])

  const getRawSmallLabelsForBig = useCallback((bigLabel: string): string[] => {
    if (bigLabel === FAVORITES_BIG) return [FAVORITES_SMALL]
    if (bigLabel === PRESETS_BIG) return [] // presets render via a dedicated panel, not battery sub-groups
    if (batteryFilterMode === 'templates') {
      const seen = new Set<string>()
      const result: string[] = []
      visibleBatteries
        .filter(b => isTemplateBattery(b) && b.category === bigLabel)
        .forEach(b => {
          const small = getTemplateSubfolder(b)
          if (seen.has(small)) return
          seen.add(small)
          result.push(small)
        })
      return result.sort()
    }

    const catEntry = categories.find(c => c.bigTag === bigLabel)
    if (catEntry) return [...catEntry.smallTags].sort()
    const seen = new Set<string>()
    const result: string[] = []
    visibleBatteries
      .filter(b => getBigLabel(b) === bigLabel)
      .forEach(b => {
        const small = getSmallLabel(b)
        if (seen.has(small)) return
        seen.add(small)
        result.push(small)
      })
    return result.sort()
  }, [batteryFilterMode, categories, visibleBatteries])

  const groupBatteriesBySmall = useCallback((items: Battery[], bigLabel: string | null): Record<string, Battery[]> => {
    const groups: Record<string, Battery[]> = {}
    items.forEach(b => {
      const small = bigLabel === FAVORITES_BIG ? FAVORITES_SMALL : resolveSmallLabel(b)
      if (!groups[small]) groups[small] = []
      groups[small].push(b)
    })
    for (const [small, groupItems] of Object.entries(groups)) {
      groups[small] = sortBatteriesInGroup(groupItems, bigLabel, small)
    }
    return groups
  }, [resolveSmallLabel])

  const getBatteriesForBig = useCallback((bigLabel: string): Battery[] => {
    if (bigLabel === PRESETS_BIG) return [] // presets are not batteries; rendered separately
    if (bigLabel === FAVORITES_BIG) {
      const byId = new Map(visibleBatteries.map(b => [b.id, b]))
      return [...favoriteBatteries]
        .sort((a, b) => a.addedAt - b.addedAt)
        .map(f => byId.get(f.batteryId) ?? parseFavoriteBatteryJson(f.batteryJson))
        .filter((b): b is Battery => Boolean(b))
        // 收藏按当前模式分流：模板收藏只在 Templates 模式显示（格式同模板），
        // 普通电池收藏只在 Develop 模式显示，互不串栏。
        .filter(b => (batteryFilterMode === 'templates') === isTemplateBattery(b))
        .filter(matchesProjectType)
    }
    return visibleBatteries.filter(b => {
      const big = batteryFilterMode === 'templates'
        ? (b.category || getBigLabel(b))
        : getBigLabel(b)
      return big === bigLabel
    })
  }, [batteryFilterMode, favoriteBatteries, matchesProjectType, visibleBatteries])

  const getSmallLabelsToRender = useCallback((bigLabel: string, groupedBySmall: Record<string, Battery[]>): string[] => {
    const rawSmallLabels = getRawSmallLabelsForBig(bigLabel)
    const allSmall = new Set([...rawSmallLabels, ...Object.keys(groupedBySmall)])
    const sorted = sortSmallLabels([...allSmall], bigLabel)
    return applyOrder(batteryOrder.smallLabels[bigLabel] ?? [], sorted)
  }, [batteryOrder.smallLabels, getRawSmallLabelsForBig])

  const searchGroupedBySmall = useMemo(
    () => groupBatteriesBySmall(searchBatteries, null),
    [groupBatteriesBySmall, searchBatteries]
  )

  const searchSmallLabelsToRender = useMemo(
    () => sortSmallLabels(Object.keys(searchGroupedBySmall), null),
    [searchGroupedBySmall]
  )

  const expandedOverlayItems = useMemo(() => {
    if (!expandedSmallLabel) return []
    const parsed = parseSmallGroupKey(expandedSmallLabel)
    if (!parsed) return []
    if (parsed.bigLabel === '__search__') return searchGroupedBySmall[parsed.smallLabel] ?? []
    const grouped = groupBatteriesBySmall(getBatteriesForBig(parsed.bigLabel), parsed.bigLabel)
    return grouped[parsed.smallLabel] ?? []
  }, [expandedSmallLabel, getBatteriesForBig, groupBatteriesBySmall, searchGroupedBySmall])

  // 覆盖层是否正在展示「收藏」小组（收藏视图内不重复显示五角星）。
  const expandedOverlayIsFavorites = useMemo(() => {
    if (!expandedSmallLabel) return false
    return parseSmallGroupKey(expandedSmallLabel)?.bigLabel === FAVORITES_BIG
  }, [expandedSmallLabel])

  // 小标签默认展开；集合记录被用户显式收起的项（入集合=收起，出集合=展开）
  const isSmallOpen = useCallback(
    (openKey: string, smallLabel: string) => !(collapsedSmallLabels[openKey] ?? []).includes(smallLabel),
    [collapsedSmallLabels],
  )

  const toggleSmallOpen = useCallback((openKey: string, smallLabel: string) => {
    setCollapsedSmallLabels(prev => {
      const cur = new Set(prev[openKey] ?? [])
      if (cur.has(smallLabel)) cur.delete(smallLabel)
      else cur.add(smallLabel)
      const next = { ...prev, [openKey]: [...cur] }
      writeCollapsedSmallMap(next)
      return next
    })
    // 切换某个小标签的开合时，若它正处于覆盖层展开态，则一并收起覆盖层
    setExpandedSmallLabel(prev => (prev === smallGroupKey(openKey, smallLabel) ? null : prev))
  }, [])

  // ── 大标签 rail 点击：始终跳转到该组最前端 ───────────────────────────────
  const handleRailBigLabelClick = (label: string) => {
    setIsCollapsed(false)
    setIsRailExpanded(false)
    setIsRailExpansionSuppressed(true)
    setFocusedBigLabel(label)
    writeActiveBigLabels([label])
    setExpandedSmallLabel(null)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const s = scrollerRef.current
      const section = bigSectionRefs.current[label]
      if (!s || !section) return
      const max = Math.max(0, s.scrollHeight - s.clientHeight)
      s.scrollTop = Math.min(Math.max(0, section.offsetTop), max)
    }))
  }

  const handleRailMouseEnter = () => {
    // 收起态下不整列展开 rail（避免悬浮覆盖压住标签文字），仅各标签自身 hover 高亮。
    if (isCollapsed) return
    if (!isRailExpansionSuppressed) setIsRailExpanded(true)
  }

  const handleRailMouseLeave = () => {
    setIsRailExpanded(false)
    setIsRailExpansionSuppressed(false)
  }

  const handleScrollerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 点击空白处收起覆盖层
    if (e.target === e.currentTarget) setExpandedSmallLabel(null)
  }

  // ── 拖拽排序：大标签 ─────────────────────────────────────────────────────
  const handleTabDragStart = (e: React.DragEvent, label: string) => {
    e.stopPropagation()
    setDragBigLabel(label)
    e.dataTransfer.setData('application/tab-reorder', label)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleTabDragEnd = () => {
    setDragBigLabel(null)
    setDragOverBigLabel(null)
  }

  const handleTabDragOver = (e: React.DragEvent, label: string) => {
    if (!e.dataTransfer.types.includes('application/tab-reorder')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverBigLabel !== label) setDragOverBigLabel(label)
  }

  const handleTabDragLeave = () => setDragOverBigLabel(null)

  const handleTabDrop = (e: React.DragEvent, targetLabel: string) => {
    if (!e.dataTransfer.types.includes('application/tab-reorder')) return
    e.preventDefault()
    const sourceLabel = dragBigLabel
    if (!sourceLabel || sourceLabel === targetLabel) return
    const newOrder = [...bigLabels]
    const fromIdx = newOrder.indexOf(sourceLabel)
    const toIdx = newOrder.indexOf(targetLabel)
    if (fromIdx === -1 || toIdx === -1) return
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, sourceLabel)
    // 持久化到浏览器（按模式分桶），并同步内存 store（小标签排序仍走 store）。
    writeBigLabelOrder(batteryFilterMode, newOrder)
    setBigLabelOrder(newOrder)
    saveBatteryOrder({ bigLabels: newOrder, smallLabels: batteryOrder.smallLabels })
    setDragBigLabel(null)
    setDragOverBigLabel(null)
  }

  // ── 拖拽排序：小标签 ─────────────────────────────────────────────────────
  const handleGroupDragStart = (e: React.DragEvent, small: string) => {
    e.stopPropagation()
    setDragSmallLabel(small)
    e.dataTransfer.setData('application/group-reorder', small)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleGroupDragEnd = () => {
    setDragSmallLabel(null)
    setDragOverSmallLabel(null)
  }

  const handleGroupDragOver = (e: React.DragEvent, small: string) => {
    if (!e.dataTransfer.types.includes('application/group-reorder')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverSmallLabel !== small) setDragOverSmallLabel(small)
  }

  const handleGroupDragLeave = () => setDragOverSmallLabel(null)

  const handleGroupDrop = (e: React.DragEvent, bigLabel: string, smallLabelsInSection: string[], targetSmall: string) => {
    if (!e.dataTransfer.types.includes('application/group-reorder')) return
    e.preventDefault()
    const sourceSmall = dragSmallLabel
    if (!sourceSmall || sourceSmall === targetSmall) return
    const newOrder = [...smallLabelsInSection]
    const fromIdx = newOrder.indexOf(sourceSmall)
    const toIdx = newOrder.indexOf(targetSmall)
    if (fromIdx === -1 || toIdx === -1) return
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, sourceSmall)
    saveBatteryOrder({
      bigLabels: batteryOrder.bigLabels,
      smallLabels: { ...batteryOrder.smallLabels, [bigLabel]: newOrder },
    })
    setDragSmallLabel(null)
    setDragOverSmallLabel(null)
  }

  // ── 电池行：拖入画布 ─────────────────────────────────────────────────────
  // stopPropagation 防止冒泡到父级 .bb-small-section 的 onDragStart（小标签拖排），
  // 否则 handleGroupDragStart 会把 effectAllowed 覆盖为 'move'，画布 onDrop 不触发
  const handleDragStart = (e: React.DragEvent, battery: Battery) => {
    e.stopPropagation()
    e.dataTransfer.setData('application/battery', JSON.stringify(battery))
    e.dataTransfer.effectAllowed = 'copy'
  }

  // ── 右键菜单 ────────────────────────────────────────────────────────────
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const handleRowContextMenu = useCallback((e: React.MouseEvent, battery: Battery) => {
    setContextMenu({ x: e.clientX, y: e.clientY, battery })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // 视口边界钳制：菜单贴近右/下边缘时上翻、左移，避免被视口或状态栏裁掉。
  useLayoutEffect(() => {
    if (!contextMenu) return
    const el = contextMenuRef.current
    if (!el) return
    const { offsetWidth: w, offsetHeight: h } = el
    const margin = 8
    let left = contextMenu.x
    let top = contextMenu.y
    if (left + w > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - w - margin)
    if (top + h > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - h - margin)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const handler = () => closeContextMenu()
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [contextMenu, closeContextMenu])

  const handleContextMenuAddFavorite = useCallback(() => {
    if (!contextMenu) return
    addFavoriteBattery(contextMenu.battery)
    closeContextMenu()
  }, [contextMenu, addFavoriteBattery, closeContextMenu])

  const handleContextMenuRemoveFavorite = useCallback(() => {
    if (!contextMenu) return
    removeFavoriteBattery(contextMenu.battery.id)
    closeContextMenu()
  }, [contextMenu, removeFavoriteBattery, closeContextMenu])

  const contextMenuIsFavorite = contextMenu
    ? favoriteBatteries.some((f) => f.batteryId === contextMenu.battery.id)
    : false

  // 当前 transport 是否支持删除 GROUPS 成组电池（暴露 deleteGroupTemplate 路由）。
  // 不支持时（如尚未实现该路由的 app）隐藏 group 删除入口，避免点了无反应。
  //
  // 关键：左栏在自己的挂载 useEffect 里才 configureEditorTransport，而 React 的
  // effect 自底向上执行 —— 本组件首帧渲染（含 useMemo）早于父级配置 transport。
  // 旧实现用抛错的 getEditorTransport() + useMemo([]) 会在首帧 catch 成 false 并
  // 永久锁死，导致 dev server 干净重启后删除入口整体消失。改用非抛错的
  // peekEditorTransport()，并在下一 tick（父 effect 配好 transport 之后）复查一次。
  const [canDeleteGroups, setCanDeleteGroups] = useState<boolean>(
    () => peekEditorTransport()?.api.supportsDeleteGroupBattery === true,
  )
  useEffect(() => {
    if (canDeleteGroups) return
    const id = setTimeout(() => {
      setCanDeleteGroups(peekEditorTransport()?.api.supportsDeleteGroupBattery === true)
    }, 0)
    return () => clearTimeout(id)
  }, [canDeleteGroups])

  // 删除一个 group 成组电池（带确认）：物理删除本地电池目录文件，成功后刷新目录。
  const deleteGroupName = useCallback((battery: Battery) => (
    langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
  ), [langMode])
  const confirmAndRemoveGroup = useCallback((groupId: string, name: string) => {
    const msg = langMode === 'en'
      ? `Delete group battery "${name}" from the local battery directory? This removes the files on disk and cannot be undone.`
      : `从本地电池目录删除 group 电池「${name}」？该操作会删除磁盘上的文件，且不可撤销。`
    if (typeof window !== 'undefined' && !window.confirm(msg)) return
    removeGroupBattery(groupId)
  }, [langMode, removeGroupBattery])

  // 当前右键目标是否为可删除的用户内容（用户提示词 / 用户模板 / GROUPS 成组电池）。
  const rawContextMenuDeletable = contextMenu ? getDeletableKind(contextMenu.battery) : null
  // group 删除受 transport 能力闸门约束；其余（prompt/template）不受影响。
  const contextMenuDeletable = rawContextMenuDeletable?.kind === 'group' && !canDeleteGroups
    ? null
    : rawContextMenuDeletable

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenu) return
    const deletable = getDeletableKind(contextMenu.battery)
    if (deletable?.kind === 'prompt') removePrompt(deletable.promptId)
    else if (deletable?.kind === 'template') removeUserTemplate(deletable.groupId)
    else if (deletable?.kind === 'group' && canDeleteGroups) {
      confirmAndRemoveGroup(deletable.groupId, deleteGroupName(contextMenu.battery))
    }
    closeContextMenu()
  }, [contextMenu, removePrompt, removeUserTemplate, canDeleteGroups, confirmAndRemoveGroup, deleteGroupName, closeContextMenu])

  // 行内删除按钮回调（仅 GROUPS 行启用）：稳定引用，供所有行复用，保持 BatteryRow memo 命中。
  const handleRowDelete = useCallback((battery: Battery) => {
    confirmAndRemoveGroup(battery.id, deleteGroupName(battery))
  }, [confirmAndRemoveGroup, deleteGroupName])

  // 已收藏电池/模板的 id 集合：行内用来决定是否渲染黄色五角星标记。
  const favoriteIds = useMemo(
    () => new Set(favoriteBatteries.map((f) => f.batteryId)),
    [favoriteBatteries],
  )

  const handleContextMenuDevNote = useCallback(() => {
    if (!contextMenu) return
    const battery = contextMenu.battery
    const displayName = langMode === 'zh' ? battery.name : (battery.nameEn || formatIdAsLabel(battery.id))
    setDevNoteTargets(prev => {
      if (prev.some(t => t.id === battery.id)) return prev
      return [...prev, { id: battery.id, name: displayName }]
    })
    closeContextMenu()
  }, [contextMenu, langMode, closeContextMenu])

  // 渲染单个 rail 大标签按钮（电池组 / 收藏组共用）
  const renderRailButton = (label: string) => {
    const isActive = focusedBigLabel === label
    const fullLabel = formatBigLabel(label)
    const railText = formatBigLabelRailText(label)
    const railRest = formatBigLabelRailRest(label)
    const isFavorites = label === FAVORITES_BIG
    const isPresets = label === PRESETS_BIG
    const isIconButton = isFavorites || isPresets
    return (
      <button
        key={label}
        type="button"
        className={[
          'bb-rail-button',
          `tab-${label}`,
          isFavorites ? 'bb-rail-button--favorites' : '',
          isPresets ? 'bb-rail-button--presets' : '',
          isIconButton ? 'bb-rail-button--icon' : '',
          isActive ? 'active' : '',
          dragBigLabel === label ? 'tab-dragging' : '',
          dragOverBigLabel === label && dragBigLabel !== label ? 'tab-drag-over' : '',
        ].filter(Boolean).join(' ')}
        aria-label={fullLabel}
        aria-current={isActive ? 'true' : undefined}
        draggable
        onDragStart={e => handleTabDragStart(e, label)}
        onDragEnd={handleTabDragEnd}
        onDragOver={e => handleTabDragOver(e, label)}
        onDragLeave={handleTabDragLeave}
        onDrop={e => handleTabDrop(e, label)}
        onClick={() => handleRailBigLabelClick(label)}
      >
        {isIconButton ? (
          <span className="bb-rail-icon" aria-hidden>
            {isFavorites ? <FavoritesRailIcon /> : <PresetsRailIcon />}
          </span>
        ) : (
          <>
            <span className="bb-rail-button-short">{railText}</span>
            {railRest && <span className="bb-rail-button-rest">{railRest}</span>}
          </>
        )}
      </button>
    )
  }

  // 渲染单个电池条目（普通列表 + 覆盖层共用）
  // inFavoritesView：处于「收藏」视图内时不再重复显示黄色五角星（语境已表明已收藏）。
  const renderBatteryRow = (battery: Battery, inFavoritesView = false) => (
    <BatteryRow
      key={catalogBatteryKey(battery)}
      battery={battery}
      langMode={langMode}
      stars={batteryStars[battery.id] ?? 0}
      devNoteCount={batteryDevNotes[battery.id]?.length ?? 0}
      showDevNoteCount={showDevNoteCount}
      isFavorite={!inFavoritesView && favoriteIds.has(battery.id)}
      isContextActive={contextMenu?.battery.id === battery.id}
      templateMode={batteryFilterMode === 'templates'}
      onDragStart={handleDragStart}
      onContextMenu={handleRowContextMenu}
      onDelete={canDeleteGroups && getDeletableKind(battery)?.kind === 'group' ? handleRowDelete : undefined}
    />
  )

  // 大标签名称叠在分组分割线上：默认白色，带品牌色的大标签沿用其 rail 配色（tab-*）。
  // 收藏视图的「收藏」组自带同名小标签头，省略大标签标题避免重复。
  const renderBigSectionTitle = (bigLabel: string, index: number) => {
    if (bigLabel === FAVORITES_BIG) return null
    return (
      <div className={`bb-big-content-title tab-${bigLabel}${index === 0 ? ' bb-big-content-title--first' : ''}`}>
        {formatBigLabel(bigLabel)}
      </div>
    )
  }

  // 渲染单个小标签手风琴分组（Develop 与 Templates 共用，保证两模式小标签 UX 一致）
  const renderSmallSection = (
    bigLabel: string,
    smallLabel: string,
    items: Battery[],
    smallLabelsInSection: string[],
  ) => {
    const groupKey = smallGroupKey(bigLabel, smallLabel)
    const isOpen = isSmallOpen(bigLabel, smallLabel)
    const isExpandedOverlay = expandedSmallLabel === groupKey
    return (
      <div
        key={groupKey}
        className={[
          'bb-small-section',
          isOpen ? 'bb-small-section--open' : '',
          isExpandedOverlay ? 'bb-small-section--overlay' : '',
          dragSmallLabel === smallLabel ? 'group-dragging' : '',
          dragOverSmallLabel === smallLabel && dragSmallLabel !== smallLabel ? 'group-drag-over' : '',
        ].filter(Boolean).join(' ')}
        draggable
        onDragStart={e => handleGroupDragStart(e, smallLabel)}
        onDragEnd={handleGroupDragEnd}
        onDragOver={e => handleGroupDragOver(e, smallLabel)}
        onDragLeave={handleGroupDragLeave}
        onDrop={e => handleGroupDrop(e, bigLabel, smallLabelsInSection, smallLabel)}
      >
        <div
          className="bb-small-header"
          ref={el => { smallHeaderRefs.current[groupKey] = el }}
        >
          <button
            className="bb-small-toggle"
            onClick={() => toggleSmallOpen(bigLabel, smallLabel)}
          >
            <span className={`bb-chevron bb-chevron--sm${isOpen ? ' bb-chevron--open' : ''}`} aria-hidden>▶</span>
            <span className="bb-small-text">
              {smallLabel === FAVORITES_SMALL
                ? 'Favorites'
                : batteryFilterMode === 'templates'
                  ? formatIdAsLabel(smallLabel)
                  : formatSmallLabel(smallLabel)}
            </span>
            <span className="bb-small-count">{items.length}</span>
          </button>
        </div>

        {isOpen && !isExpandedOverlay && (
          <div className="bb-row-list">
            {items.length === 0 && (
              <div className="battery-empty-small">
                {smallLabel === FAVORITES_SMALL ? 'No favorites' : (langMode === 'en' ? 'No batteries' : '暂无电池')}
              </div>
            )}
            {items.map(b => renderBatteryRow(b, bigLabel === FAVORITES_BIG))}
          </div>
        )}
      </div>
    )
  }

  // 渲染单个大标签内容分组（电池视图 / 收藏视图共用；预设走专用面板）
  const renderBigSection = (bigLabel: string, index: number) => {
    if (bigLabel === PRESETS_BIG) {
      return (
        <div
          key={bigLabel}
          className={`bb-big-content-section${index > 0 ? ' bb-big-content-section--separated' : ''}`}
          ref={el => { bigSectionRefs.current[bigLabel] = el }}
        >
          {renderBigSectionTitle(bigLabel, index)}
          <PresetsRailPanel batteries={batteries} langMode={langMode} />
        </div>
      )
    }
    const groupedBySmall = groupBatteriesBySmall(getBatteriesForBig(bigLabel), bigLabel)
    const smallLabelsToRender = getSmallLabelsToRender(bigLabel, groupedBySmall)

    // Templates（非收藏）：与 Develop 一致地按小标签分组——目录结构为
    // `templates/{大标签}/{小标签}/{模板}/…` 的模板进小标签手风琴；扁平
    // `templates/{大标签}/{模板}/…`（子目录名即卡片名，无独立小标签）直接平铺卡片。
    if (batteryFilterMode === 'templates' && bigLabel !== FAVORITES_BIG) {
      const allItems = getBatteriesForBig(bigLabel)
      const flatItems: Battery[] = []
      const nestedBySmall: Record<string, Battery[]> = {}
      for (const b of allItems) {
        const small = getTemplateSmallLabel(b)
        if (small === null) flatItems.push(b)
        else (nestedBySmall[small] ??= []).push(b)
      }
      const sortedFlat = sortBatteriesInGroup(flatItems, bigLabel, '')
      const nestedLabels = applyOrder(
        batteryOrder.smallLabels[bigLabel] ?? [],
        sortSmallLabels(Object.keys(nestedBySmall), bigLabel),
      )
      for (const k of Object.keys(nestedBySmall)) {
        nestedBySmall[k] = sortBatteriesInGroup(nestedBySmall[k], bigLabel, k)
      }
      const isEmpty = sortedFlat.length === 0 && nestedLabels.length === 0
      return (
        <div
          key={bigLabel}
          className={`bb-big-content-section${index > 0 ? ' bb-big-content-section--separated' : ''}`}
          ref={el => { bigSectionRefs.current[bigLabel] = el }}
        >
          {isEmpty && (
            <div className="battery-empty-small">
              {langMode === 'en' ? 'No templates' : '暂无模板'}
            </div>
          )}
          {!isEmpty && renderBigSectionTitle(bigLabel, index)}
          {sortedFlat.length > 0 && (
            <div className="bb-row-list bb-row-list--templates-flat">
              {sortedFlat.map(b => renderBatteryRow(b))}
            </div>
          )}
          {nestedLabels.map(smallLabel =>
            renderSmallSection(bigLabel, smallLabel, nestedBySmall[smallLabel] ?? [], nestedLabels),
          )}
        </div>
      )
    }

    return (
      <div
        key={bigLabel}
        className={`bb-big-content-section${index > 0 ? ' bb-big-content-section--separated' : ''}`}
        ref={el => { bigSectionRefs.current[bigLabel] = el }}
      >
        {smallLabelsToRender.length === 0 && (
          <div className="battery-empty-small">
            {batteryFilterMode === 'templates'
              ? (langMode === 'en' ? 'No templates' : '暂无模板')
              : (langMode === 'en' ? 'No batteries' : '暂无电池')}
          </div>
        )}
        {smallLabelsToRender.length > 0 && renderBigSectionTitle(bigLabel, index)}
        {smallLabelsToRender.map(smallLabel =>
          renderSmallSection(bigLabel, smallLabel, groupedBySmall[smallLabel] ?? [], smallLabelsToRender),
        )}
      </div>
    )
  }

  return (
    <aside
      ref={asideRef}
      className={`battery-bar battery-bar--vertical${batteryFilterMode === 'templates' ? ' mode-templates' : ''}${isCollapsed ? ' battery-bar--collapsed' : ''}`}
      style={isCollapsed ? undefined : { width, minWidth: width }}
    >
      {/* 搜索结果计数（仅在搜索时显示） */}
      {!isCollapsed && searchQuery && (
        <div className="search-result-count">
          {searchResultCount > 0
            ? (langMode === 'en' ? `Found ${searchResultCount} node(s)` : `找到 ${searchResultCount} 个节点`)
            : (langMode === 'en' ? 'No matching nodes' : '未找到匹配节点')}
        </div>
      )}

      {/* ── Develop / Templates：竖向手风琴（大标签 → 小标签 → 电池行） ─── */}
      <div className="bb-body">
        {bigLabels.length > 0 && (
          <>
            {/* 展开态下 nav 脱离文档流（绝对定位覆盖右侧），用占位元素保留 32px 槽位，
                确保右侧 .bb-scroller 宽度不因 rail 展开而变化（不挤压、不回流）。 */}
            {isRailExpanded && <div className="bb-big-rail-spacer" aria-hidden />}
            <nav
              className={`bb-big-rail${isRailExpanded ? ' bb-big-rail--expanded' : ''}`}
              aria-label={langMode === 'en' ? 'Battery categories' : '电池大标签'}
              onMouseEnter={handleRailMouseEnter}
              onMouseLeave={handleRailMouseLeave}
            >
              <div className="bb-rail-group bb-rail-group--batteries">
                {batteryLabels.map(renderRailButton)}
              </div>
              <div className="bb-rail-group bb-rail-group--collection">
                <button
                  type="button"
                  className="bb-rail-button bb-rail-button--icon bb-rail-button--collapse"
                  aria-label={isCollapsed
                    ? (langMode === 'en' ? 'Expand battery list' : '展开电池栏')
                    : (langMode === 'en' ? 'Collapse battery list' : '收起电池栏')}
                  title={isCollapsed
                    ? (langMode === 'en' ? 'Expand' : '展开电池栏')
                    : (langMode === 'en' ? 'Collapse' : '收起电池栏')}
                  onClick={() => setIsCollapsed(c => !c)}
                >
                  <span className="bb-rail-icon" aria-hidden>
                    <CollapseRailIcon collapsed={isCollapsed} />
                  </span>
                </button>
                <button
                  type="button"
                  className={`bb-rail-button bb-rail-button--icon bb-rail-button--mode${batteryFilterMode === 'templates' ? ' is-templates' : ''}`}
                  aria-label={langMode === 'en'
                    ? (batteryFilterMode === 'templates' ? 'Switch to Develop' : 'Switch to Templates')
                    : (batteryFilterMode === 'templates' ? '切换到开发模式' : '切换到模板模式')}
                  title={langMode === 'en'
                    ? (batteryFilterMode === 'templates' ? 'Templates · click for Develop' : 'Develop · click for Templates')
                    : (batteryFilterMode === 'templates' ? '模板模式 · 点击切换开发' : '开发模式 · 点击切换模板')}
                  onClick={() => setBatteryFilterMode(batteryFilterMode === 'templates' ? 'develop' : 'templates')}
                >
                  <span className="bb-rail-icon" aria-hidden>
                    <ModeToggleRailIcon />
                  </span>
                </button>
                {collectionLabels.map(renderRailButton)}
              </div>
            </nav>
          </>
        )}

        {!isCollapsed && (
        <div
          className={`bb-scroller bb-scroller--${railView}${expandedSmallLabel ? ' bb-scroller--has-overlay' : ''}`}
          ref={scrollerRef}
          onScroll={persistScroll}
          onClick={handleScrollerClick}
        >
          {bigLabels.length === 0 && (
            <div className="battery-empty">
              {batteryFilterMode === 'templates'
                ? (langMode === 'en' ? 'No templates' : '暂无模板')
                : (langMode === 'en' ? 'No batteries' : '暂无电池')}
            </div>
          )}

          {searchQuery && batteryFilterMode === 'templates' && (
            <div className="bb-row-list bb-row-list--templates-flat">
              {searchBatteries.length === 0 && (
                <div className="battery-empty-small">
                  {langMode === 'en' ? 'No templates' : '暂无模板'}
                </div>
              )}
              {searchBatteries.map(b => renderBatteryRow(b))}
            </div>
          )}

          {searchQuery && batteryFilterMode !== 'templates' && (
            <div className="bb-small-list">
              {searchSmallLabelsToRender.length === 0 && (
                <div className="battery-empty-small">
                  {langMode === 'en' ? 'No batteries' : '暂无电池'}
                </div>
              )}
              {searchSmallLabelsToRender.map(smallLabel => {
                const sectionKey = '__search__'
                const groupKey = smallGroupKey(sectionKey, smallLabel)
                const items = searchGroupedBySmall[smallLabel] ?? []
                const isOpen = isSmallOpen(sectionKey, smallLabel)
                const isExpandedOverlay = expandedSmallLabel === groupKey
                return (
                  <div
                    key={groupKey}
                    className={[
                      'bb-small-section',
                      isOpen ? 'bb-small-section--open' : '',
                      isExpandedOverlay ? 'bb-small-section--overlay' : '',
                      dragSmallLabel === smallLabel ? 'group-dragging' : '',
                      dragOverSmallLabel === smallLabel && dragSmallLabel !== smallLabel ? 'group-drag-over' : '',
                    ].filter(Boolean).join(' ')}
                    draggable
                    onDragStart={e => handleGroupDragStart(e, smallLabel)}
                    onDragEnd={handleGroupDragEnd}
                    onDragOver={e => handleGroupDragOver(e, smallLabel)}
                    onDragLeave={handleGroupDragLeave}
                    onDrop={e => handleGroupDrop(e, sectionKey, searchSmallLabelsToRender, smallLabel)}
                  >
                    <div
                      className="bb-small-header"
                      ref={el => { smallHeaderRefs.current[groupKey] = el }}
                    >
                      <button
                        className="bb-small-toggle"
                        onClick={() => toggleSmallOpen(sectionKey, smallLabel)}
                      >
                        <span className={`bb-chevron bb-chevron--sm${isOpen ? ' bb-chevron--open' : ''}`} aria-hidden>▶</span>
                        <span className="bb-small-text">
                          {smallLabel === FAVORITES_SMALL
                            ? 'Favorites'
                            : formatSmallLabel(smallLabel)}
                        </span>
                        <span className="bb-small-count">{items.length}</span>
                      </button>
                    </div>

                    {isOpen && !isExpandedOverlay && (
                      <div className="bb-row-list">
                        {items.length === 0 && (
                          <div className="battery-empty-small">
                            {smallLabel === FAVORITES_SMALL ? 'No favorites' : (langMode === 'en' ? 'No batteries' : '暂无电池')}
                          </div>
                        )}
                        {items.map(b => renderBatteryRow(b))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!searchQuery && activeViewLabels.map((bigLabel, index) => renderBigSection(bigLabel, index))}

          {!searchQuery && activeViewLabels.length === 0 && railView === 'collection' && (
            <div className="battery-empty-small">
              {langMode === 'en' ? 'Empty' : '暂无内容'}
            </div>
          )}

          {/* 小标签 + 号展开覆盖层：从该小标签头部下方铺到容器底部，多列网格平铺该组全部电池 */}
          {expandedSmallLabel && overlayStyle && (
            <div
              className="bb-expanded-overlay"
              style={overlayStyle}
              onClick={e => e.stopPropagation()}
            >
              <div className="bb-expanded-overlay-grid">
                {expandedOverlayItems.map(b => renderBatteryRow(b, expandedOverlayIsFavorites))}
                {expandedOverlayItems.length === 0 && (
                  <div className="battery-empty-small">
                    {langMode === 'en' ? 'No batteries' : '暂无电池'}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* 右侧拖拽宽度把手 */}
      {!isCollapsed && (
        <div
          className="bb-resize-handle"
          onMouseDown={onResizeMouseDown}
          title={langMode === 'en' ? 'Drag to resize' : '拖动调整宽度'}
        />
      )}

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="battery-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          {contextMenuIsFavorite ? (
            <div className="battery-context-menu-item" onClick={handleContextMenuRemoveFavorite}>
              ⭐ Remove from Favorites
            </div>
          ) : (
            <div className="battery-context-menu-item" onClick={handleContextMenuAddFavorite}>
              ⭐ Add to Favorites
            </div>
          )}
          <div className="battery-context-menu-item" onClick={handleContextMenuDevNote}>
            📝 Dev Notes
          </div>
          {contextMenuDeletable && (
            <div
              className="battery-context-menu-item battery-context-menu-item--danger"
              onClick={handleContextMenuDelete}
            >
              🗑 {langMode === 'en'
                ? (contextMenuDeletable.kind === 'prompt'
                    ? 'Delete prompt'
                    : contextMenuDeletable.kind === 'group' ? 'Delete group battery' : 'Delete template')
                : (contextMenuDeletable.kind === 'prompt'
                    ? '删除此提示词'
                    : contextMenuDeletable.kind === 'group' ? '删除此 group 电池' : '删除此模板')}
            </div>
          )}
        </div>
      )}

      {/* 开发记录弹窗（多实例，每个电池独立一个，按 index 错开位置） */}
      {devNoteTargets.map((target, idx) => (
        <DevNoteModal
          key={target.id}
          batteryId={target.id}
          batteryName={target.name}
          index={idx}
          onClose={() => setDevNoteTargets(prev => prev.filter(t => t.id !== target.id))}
        />
      ))}
    </aside>
  )
}

export default BatteryBar
