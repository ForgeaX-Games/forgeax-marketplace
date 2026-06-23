import { useShellStore, type ShellTab, type ForgeView, type ImageSection } from '../shell/shellStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useForgeStudioStore, STUDIO_TABS, type StudioTab } from '../forge/studio/forgeStudioStore'
import { injectStyleOnce } from '../styles/injectStyle'
import { SceneMiniMap } from '../storytree/SceneMiniMap'

/**
 * ReelSidebar —— wb-reel 嵌入 forgeax-studio 的 split-pane 模式下, 渲染在
 * 左侧 sidebar (pane=left) iframe 内的全部 UI.
 *
 * 设计目标 (2026-05-29 作者反馈):
 *   1. 风格与总工程一致 (forgeax 深色 + lime brand + 中性 elevation, 见 global.css)
 *   2. 线性创作引导: 文档 → FORGE/PLAYER 一级 → 视图 (剧本/图像/剧情树) 二级 →
 *      段子 (梗概/人物关系/角色设定/大纲/详细剧本) 三级
 *   3. PLAYER 不再是"全屏切换", 只是把内容区切成 Player 试玩, sidebar 仍然在场
 *
 * 层级结构:
 *   ┌─ 文档头 (剧本标题, 场景计数)
 *   ├─────────────────────────────────────────────────
 *   ├─ Section · 锻造视图 (剧本 / 图像 / 剧情树)
 *   ├─────────────────────────────────────────────────
 *   ├─ Section · 段子 (5 段)                       [仅 script 视图下显示]
 *   ├─ Section · 图像分区 (风格 / 参考图 / UI)      [仅 image 视图下显示]
 *   ├─────────────────────────────────────────────────
 *   └─ 底部状态栏 (当前视图说明)
 *
 * 跨 iframe 同步策略 (后续阶段): sidebar 的 setActiveTab/setForgeView/setTab
 * 调用先写本地 store, 再通过 BroadcastChannel 广播到 pane=center 那边的 iframe.
 * 当前阶段先做单 iframe 视觉; 跨 pane 同步留给下一步.
 */

const TAB_DEFS: Array<{ id: ShellTab; label: string; hint: string }> = [
  { id: 'forge',  label: 'FORGE',  hint: '剧本锻造工作台 · 在中央内容区编辑/查看' },
]

const VIEW_DEFS: Array<{ id: ForgeView; label: string; hint: string }> = [
  { id: 'script', label: '剧本',   hint: '小说家工作板 · 5 段切换' },
  { id: 'image',  label: '视觉',   hint: '风格 / 导演 / 参考图 / 界面 / 小游戏 · 视觉基准' },
  { id: 'tree',   label: '剧情树', hint: '可视化剧情树 · 节点详情编辑' },
  // 「素材库」不再是独立 pill —— 从剧情树节点详情「时间轴上方」的醒目按钮进入,
  //   它跟随当前选中节点 (与剧情树共用同一套节点选择, 不再各自一份)。
]

/**
 * 「图像」视图下的一级分区（与「剧本」视图下「段子」三级同样式）。
 * 2026-06：把原本堆在内容区的 风格 / 参考图 / UI 三块切换提到边栏。
 */
const IMAGE_SECTION_DEFS: Array<{ id: ImageSection; label: string; hint: string }> = [
  { id: 'style', label: '美术风格', hint: '视觉风格基调 · VISUAL STYLE' },
  { id: 'director', label: '导演风格', hint: '导演流派 · 运镜/剪辑/色彩基调' },
  { id: 'refs',  label: '参考图库', hint: '角色 / 场所 / 道具 参考图流水线' },
  { id: 'ui',    label: '界面风格', hint: '游戏化 UI 风格 · 按钮/字幕条/HUD' },
  { id: 'minigame', label: '小游戏库', hint: '预选小游戏池 · 剧情树剪辑时可用' },
]

export function ReelSidebar() {
  const activeTab = useShellStore((s) => s.activeTab)
  const setActiveTab = useShellStore((s) => s.setActiveTab)
  const forgeView = useShellStore((s) => s.forgeView)
  const setForgeView = useShellStore((s) => s.setForgeView)
  const imageSection = useShellStore((s) => s.imageSection)
  const setImageSection = useShellStore((s) => s.setImageSection)
  const setImportOpen = useShellStore((s) => s.setImportOpen)
  const studioTab = useForgeStudioStore((s) => s.tab)
  const setStudioTab = useForgeStudioStore((s) => s.setTab)
  const title = useScenarioStore((s) => s.scenario.title)
  const sceneCount = useScenarioStore((s) => Object.keys(s.scenario.scenes).length)
  // 视觉分区「是否已生效」指示灯的数据源 —— 纯展示, 不改任何生成逻辑。
  // 逐项订阅稳定切片(避免 selector 返回新对象导致的快照抖动), 在渲染体里组装。
  const visualStyle = useScenarioStore((s) => s.scenario.visualStyle)
  const directorStyle = useScenarioStore((s) => s.scenario.directorStyle)
  const uiPrompt = useScenarioStore((s) => s.scenario.uiStyle?.prompt ?? '')
  const minigameCount = useScenarioStore((s) => s.scenario.enabledMinigameIds?.length ?? 0)
  const characters = useScenarioStore((s) => s.scenario.characters)
  const locations = useScenarioStore((s) => s.scenario.locations)
  const propsMap = useScenarioStore((s) => s.scenario.props)
  const hasRefs =
    Object.values(characters ?? {}).some(
      (c) => !!c.turnaroundRefImageId || !!c.refImageId,
    ) ||
    Object.values(locations ?? {}).some((l) => !!l.refImageId) ||
    Object.values(propsMap ?? {}).some((p) => !!p.refImageId)
  const sectionEnabled: Record<ImageSection, boolean> = {
    style: !!visualStyle,
    director: !!directorStyle,
    refs: hasRefs,
    ui: !!uiPrompt.trim(),
    minigame: minigameCount > 0,
  }

  return (
    <aside className="rs-sidebar" aria-label="Reel 工作板">
      <header className="rs-doc">
        <div className="rs-doc-title">影游工坊</div>
        <div className="rs-doc-name" title={title || '未命名剧本'}>
          {title || '未命名剧本'}
        </div>
        <div className="rs-doc-meta">
          <span className="rs-doc-meta-num">{sceneCount}</span>
          <span className="rs-doc-meta-label">场景</span>
        </div>
      </header>

      <Section>
        <PillGroup>
          {VIEW_DEFS.map((v) => (
            <PillButton
              key={v.id}
              active={forgeView === v.id}
              onClick={() => setForgeView(v.id)}
              hint={v.hint}
            >
              {v.label}
            </PillButton>
          ))}
        </PillGroup>
      </Section>

      {forgeView === 'script' && (
        <Section label="段子">
          <RowGroup>
            {STUDIO_TABS.map((s) => (
              <RowButton
                key={s.id}
                active={studioTab === s.id}
                onClick={() => setStudioTab(s.id as StudioTab)}
                hint={s.hint}
                indented
              >
                {s.label}
              </RowButton>
            ))}
          </RowGroup>
          {/*
           * 「导入完整剧本」—— 仅「剧本」视图、紧跟段子列表下方的次要入口
           * (作者反馈: 不重要, 别太显眼)。触发 shellStore.importOpen, 经
           * crossPaneSync 镜像到 center pane 由 ForgeStudio 渲染模态本体。
           */}
          <button
            type="button"
            className="rs-import-link"
            onClick={() => setImportOpen(true)}
            title="粘贴或上传你写好的完整剧本，严格按原文解析成剧情树（不经过对话，不改写原文）"
          >
            <span className="rs-import-ico" aria-hidden>
              ↥
            </span>
            导入完整剧本
          </button>
        </Section>
      )}

      {forgeView === 'image' && (
        <Section label="视觉分区">
          <RowGroup>
            {IMAGE_SECTION_DEFS.map((s) => {
              const on = sectionEnabled[s.id]
              return (
                <RowButton
                  key={s.id}
                  active={imageSection === s.id}
                  onClick={() => setImageSection(s.id)}
                  hint={s.hint}
                  indented
                  trailing={
                    <span
                      className={`rs-row-status${on ? ' is-on' : ''}`}
                      title={on ? '已启用 · 该模块当前会被应用' : '未启用 · 进入并配置后才会应用'}
                      aria-label={on ? '已启用' : '未启用'}
                    >
                      <span className="rs-row-status-dot" aria-hidden />
                      <span className="rs-row-status-text">{on ? '已启用' : '未启用'}</span>
                    </span>
                  }
                >
                  {s.label}
                </RowButton>
              )
            })}
          </RowGroup>
        </Section>
      )}

      {/*
       * 节点连线图 —— 剧情树 与 素材库 共用同一套 (2026-06-15 作者反馈"切到素材库
       *   节点就消失了, 没通用"): 素材库跟随选中节点, 故在 assets 视图也保留此列表,
       *   点节点只切换选中(不跳回剧情树), 由 SceneMiniMap 按 forgeView 区分行为。
       */}
      {(forgeView === 'tree' || forgeView === 'assets') && (
        <div className="rs-tree-rail">
          <SceneMiniMap />
        </div>
      )}

      {forgeView !== 'tree' && forgeView !== 'assets' && (
        <footer className="rs-foot">
          <span className="rs-foot-dot" aria-hidden />
          <span className="rs-foot-text">
            {forgeView === 'script'
              ? `编辑中 · ${STUDIO_TABS.find((t) => t.id === studioTab)?.label ?? ''}`
              : `视觉 · ${IMAGE_SECTION_DEFS.find((t) => t.id === imageSection)?.label ?? ''}`}
          </span>
        </footer>
      )}

    </aside>
  )
}

/* ─── primitives ─────────────────────────────────────────────────── */

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="rs-section">
      {label ? <div className="rs-section-label">{label}</div> : null}
      {children}
    </section>
  )
}

function PillGroup({ children }: { children: React.ReactNode }) {
  return <div className="rs-pill-group">{children}</div>
}

function PillButton({
  active,
  onClick,
  hint,
  children,
}: {
  active: boolean
  onClick: () => void
  hint?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`rs-pill${active ? ' is-active' : ''}`}
      aria-pressed={active}
      title={hint}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <div className="rs-row-group" role="list">{children}</div>
}

function RowButton({
  active,
  onClick,
  hint,
  indented,
  trailing,
  children,
}: {
  active: boolean
  onClick: () => void
  hint?: string
  indented?: boolean
  trailing?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="listitem"
      className={`rs-row${active ? ' is-active' : ''}${indented ? ' is-indented' : ''}`}
      aria-pressed={active}
      title={hint}
      onClick={onClick}
    >
      {indented && <span className="rs-row-rail" aria-hidden />}
      <span className="rs-row-label">{children}</span>
      {trailing}
    </button>
  )
}

/* ─── styles ─────────────────────────────────────────────────────── */

const css = `
.rs-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-background-elevated);
  color: var(--color-text-primary);
  overflow: hidden;
  border-right: 1px solid var(--color-border-default);
  font-family: var(--font-sans);
}

/* 文档头 */
.rs-doc {
  flex-shrink: 0;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  display: flex;
  align-items: center;
  gap: 8px;
}
.rs-doc-title {
  flex: 0 0 auto;
  font-size: 15px;
  font-weight: 700;
  color: #d4ff48;
  line-height: normal;
  white-space: nowrap;
}
/* 剧本名标签 —— 与「N 场景」同款胶囊, 放在左侧 (标题之后)。
   名字可能较长 → 可收缩 + 省略号, 不挤掉右侧场景数。 */
.rs-doc-name {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 140px;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: rgba(212,255,72,0.08);
  border: 1px solid rgba(212,255,72,0.28);
  color: #d4ff48;
  font-size: 11px;
  font-weight: 700;
  line-height: normal;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rs-doc-meta {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--radius-pill);
  background: rgba(212,255,72,0.08);
  border: 1px solid rgba(212,255,72,0.28);
  font-family: var(--font-mono);
}
.rs-doc-meta-num {
  font-size: 10px;
  font-weight: 700;
  color: #d4ff48;
  font-variant-numeric: tabular-nums;
}
.rs-doc-meta-label {
  font-size: 10px;
  color: #d4ff48;
  font-weight: 700;
  letter-spacing: 0;
}

/* Section 容器 */
.rs-section {
  flex-shrink: 0;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--color-border-default);
}
.rs-section:last-of-type {
  flex: 1 1 0;
  min-height: 0;
  border-bottom: none;
}
/* tree 视图下节点列表才是要撑高的主体, 视图切换段回到自然高度 */
.rs-sidebar:has(.rs-tree-rail) .rs-section:last-of-type {
  flex: 0 0 auto;
  border-bottom: 1px solid var(--color-border-default);
}
.rs-section-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--color-text-tertiary);
  padding: 0 2px 6px;
}

/* 剧情树节点列表 —— 占满段子区下方剩余空间, 内部自己滚动 */
.rs-tree-rail {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border-default);
}

/* Pill (一级 FORGE/PLAYER 切换 —— 两个等宽胶囊) */
.rs-pill-group {
  display: flex;
  gap: 1px;
  padding: 2px;
  background: var(--color-background-base);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-pill);
}
.rs-pill {
  flex: 1;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.4px;
  background: transparent;
  border: none;
  border-radius: var(--radius-pill);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: color var(--motion-duration-instant) var(--motion-ease-standard),
              background var(--motion-duration-instant) var(--motion-ease-standard);
  font-family: inherit;
}
.rs-pill:hover:not(.is-active) {
  color: var(--color-text-primary);
}
.rs-pill.is-active {
  background: color-mix(in srgb, var(--color-brand-primary) 18%, var(--color-background-elevated));
  color: var(--color-brand-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
}

/* Row (二级/三级 列表项) */
.rs-row-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.rs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 10px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background var(--motion-duration-instant) var(--motion-ease-standard),
              color var(--motion-duration-instant) var(--motion-ease-standard);
  position: relative;
}
.rs-row:hover:not(.is-active) {
  background: var(--color-interaction-hover);
  color: var(--color-text-primary);
}
.rs-row.is-active {
  background: var(--color-interaction-selected-brand);
  color: var(--color-text-primary);
}
.rs-row.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  background: var(--color-brand-primary);
  border-radius: 0 1px 1px 0;
}
.rs-row.is-indented {
  padding-left: 24px;
  font-size: 12px;
  color: var(--color-text-secondary);
}
.rs-row.is-indented .rs-row-rail {
  position: absolute;
  left: 14px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--color-divider-subtle);
}
.rs-row.is-indented.is-active .rs-row-rail {
  background: color-mix(in srgb, var(--color-brand-primary) 50%, transparent);
}
.rs-row-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 视觉分区「是否生效」指示灯 —— 纯展示, 不可点 (作者: 只想一眼看到哪个模块已生效)。
   未启用: 中性弱化点 + 弱文字; 已启用: 品牌 lime 实心点 + 微光 + 提亮文字。 */
.rs-row-status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 1px 6px 1px 5px;
  border-radius: var(--radius-pill, 999px);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.4;
  color: var(--color-text-tertiary);
  background: color-mix(in srgb, var(--color-text-tertiary) 12%, transparent);
}
.rs-row-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
  opacity: 0.7;
}
.rs-row-status.is-on {
  color: var(--color-brand-primary);
  background: color-mix(in srgb, var(--color-brand-primary) 16%, transparent);
}
.rs-row-status.is-on .rs-row-status-dot {
  background: var(--color-brand-primary);
  opacity: 1;
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-brand-primary) 70%, transparent);
}

/* 底部状态栏 */
.rs-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-default);
  background: var(--color-background-base);
  font-size: 11px;
  color: var(--color-text-tertiary);
}
.rs-foot-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-brand-primary);
  box-shadow: 0 0 6px color-mix(in srgb, var(--color-brand-primary) 50%, transparent);
}
.rs-foot-text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 「导入完整剧本」—— 段子列表下方的次要入口, 小号低调 (作者反馈: 不重要)。
   不抢眼: 默认中性弱化文字色, hover 才轻微提亮, 不用品牌色填充。 */
.rs-import-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 6px 0 0 10px;
  padding: 2px 4px;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: color var(--motion-duration-instant) var(--motion-ease-standard);
}
.rs-import-link:hover {
  color: var(--color-text-secondary);
}
.rs-import-ico {
  font-size: 11px;
  line-height: 1;
}
`
injectStyleOnce('reel-sidebar', css)
