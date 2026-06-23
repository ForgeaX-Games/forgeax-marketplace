import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from 'zustand'
import { useScenarioStore } from '../scenario/scenarioStore'
import {
  exportHistoryJson,
  importHistoryFromJson,
  listScenarioHistory,
  loadScenarioFromHistory,
  removeScenarioFromHistory,
} from '../scenario/scenarioPersistBoot'
import {
  defaultExportFilename,
  triggerDownload,
} from '../scenario/scenarioTransfer'
import type { PersistedItem } from '../scenario/scenarioPersist'
import { useShellStore, type ForgeView } from '../shell/shellStore'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * TopBar —— 黑曜石玻璃顶栏：左侧 Logo & 剧本名，中间二 Tab 切换，右侧动作组。
 *
 * Tab 语义（顶栏只保留两个高阶分区）：
 *   FORGE   · 剧本锻造工作台（内含 剧本对话 / 参考图 / 剧情树 三个二级视图）
 *   PLAYER  · 全屏试玩
 *
 * 二级视图（剧本/图像/剧情树）的切换在 ForgeTab.tsx 内完成，本组件不展示。
 *
 * 兼容性：scenarioStore.mode 仍保留为 'editor' | 'player'，但由 activeTab 派生：
 *   - activeTab === 'player' → mode = 'player'
 *   - 否则 → mode = 'editor'
 * 旧调用点（PlayerMenu.setMode('editor'), etc.）通过 App 层的 effect 反向同步。
 */
const VIEW_DEFS: { id: ForgeView; label: string; hint: string }[] = [
  { id: 'script', label: '剧本', hint: '剧本编辑 · 对话/分支/QTE' },
  { id: 'image', label: '视觉', hint: '风格 / 导演 / 参考图 / 界面 / 小游戏 · 视觉基准' },
  { id: 'tree', label: '剧情树', hint: '可视化剧情树 · 节点详情' },
]

export function TopBar() {
  const forgeView = useShellStore((s) => s.forgeView)
  const setForgeView = useShellStore((s) => s.setForgeView)
  const setActiveTab = useShellStore((s) => s.setActiveTab)
  const title = useScenarioStore((s) => s.scenario.title)
  const sceneCount = useScenarioStore(
    (s) => Object.keys(s.scenario.scenes).length,
  )
  const newScenario = useScenarioStore((s) => s.newScenario)

  /**
   * ➕ 新的故事 ——
   *   当前剧本会通过 scenarioPersistBoot 的订阅自动落盘（新剧 id 变化
   *   不会覆盖旧条目），所以点 + 等于「归档当前 + 开一张白纸」。
   *   只有当前场景非空（有对话、QTE、角色之一）时才弹确认框，避免打断
   *   刚打开页面还没动过的作者。
   */
  function handleNewStory(): void {
    const scn = useScenarioStore.getState().scenario
    const hasContent =
      Object.keys(scn.characters ?? {}).length > 0 ||
      Object.keys(scn.locations ?? {}).length > 0 ||
      Object.values(scn.scenes).some(
        (s) =>
          (s.dialogue?.length ?? 0) > 0 ||
          (s.qte?.cues?.length ?? 0) > 0 ||
          (s.branches?.length ?? 0) > 0 ||
          (s.media?.prompt ?? '').trim().length > 0,
      )
    if (hasContent) {
      const ok = window.confirm(
        `开始新的故事？\n\n当前「${scn.title}」会保存到历史，可在右上「历史 ▾」中找回。`,
      )
      if (!ok) return
    }
    newScenario()
    // 切到 FORGE tab，让作者从头开始
    setActiveTab('forge')
  }

  // 历史栈快照（订阅 zundo 暴露的 vanilla store）—— 只取 length，避免无谓 re-render
  const pastCount = useStore(
    useScenarioStore.temporal,
    (s) => s.pastStates.length,
  )
  const futureCount = useStore(
    useScenarioStore.temporal,
    (s) => s.futureStates.length,
  )

  function doUndo(): void {
    useScenarioStore.temporal.getState().undo()
  }
  function doRedo(): void {
    useScenarioStore.temporal.getState().redo()
  }

  /**
   * "重置 UI 状态"救火按钮 ——
   *
   * 真实场景：作者偶发遇到 UI 卡死（黑屏 / Tab 点不动 / 抽屉收不起），原因多半是
   * shellStore 持久态被脏值污染（旧分支切换、第三方扩展、devtools 误调）。一行
   * 救火脚本是
   *   useShellStore.getState().setActiveTab('forge')
   * 但作者不会、也不该去开控制台。
   *
   * 这个按钮：
   *   1. 清掉 reel-studio:shell:v1 这条 localStorage（拔脏值）
   *   2. 把内存里的 shellStore 拉回 forge / tree 默认
   *   3. 关掉所有抽屉/浮层（inspectorOpen / sceneDetailOpen / promptFloaterOpen）
   *   4. 不动 scenarioStore —— 剧本数据/历史/资产都不能丢
   *   5. 不动 zundo undo/redo 栈 —— 撤销链是宝贵资产
   *
   * 不刷新页面：纯前端 reset，避免重新 boot 流程的不确定性（很多 hydrate 链会跑两遍）.
   * 如果 reset 后仍异常，作者可以手动 F5 + 这个按钮再点一次（按钮逻辑是幂等的）.
   */
  function handleResetUiState(): void {
    const ok = window.confirm(
      'UI 卡住了？这一键会:\n' +
        '  · 关掉所有抽屉/浮层\n' +
        '  · 把视图拉回 FORGE › 剧情树\n' +
        '  · 清掉 UI 偏好缓存（不影响剧本/历史/资产）\n\n' +
        '继续？',
    )
    if (!ok) return
    try {
      window.localStorage.removeItem('reel-studio:shell:v1')
    } catch {
      /* privacy mode 下静默：内存里的 setState 仍然能救场 */
    }
    useShellStore.setState({
      activeTab: 'forge',
      forgeView: 'tree',
      inspectorOpen: false,
      sceneDetailOpen: false,
      stageSceneId: null,
      sceneExpanded: false,
      promptFloaterOpen: false,
      selectedShotId: null,
      focusIntent: null,
      forgeProgress: null,
    })
  }

  // 全局 Cmd+Z / Cmd+Shift+Z（Win 上 Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）。
  // 输入框聚焦时让浏览器原生撤销（避免编辑文本时撤销跑到剧本上）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 去重：独立运行时时间轴工具条也挂了同款 ⌘Z 监听（同一 window）。
      // 谁先处理谁 preventDefault，另一个见 defaultPrevented 即跳过，避免撤销两步。
      if (e.defaultPrevented) return
      const tgt = e.target as HTMLElement | null
      const tag = tgt?.tagName
      const editable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (tgt?.isContentEditable ?? false)
      if (editable) return

      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        doUndo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        doRedo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="ks-topbar ks-glass">
      <div className="ks-topbar-left">
        <div className="rs-logo">
          <span className="rs-logo-mark" />
          <span className="rs-logo-text">REEL · STUDIO</span>
        </div>
        <div className="ks-divider" />
        <div className="ks-doc">
          <div className="ks-doc-title-row">
            <div className="ks-doc-title ks-cn" title={title}>{title}</div>
            <button
              type="button"
              className="ks-doc-new-btn"
              onClick={handleNewStory}
              title="新的故事 · 当前会保存进历史"
              aria-label="新的故事"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" width="14" height="14">
                <path
                  d="M8 3v10M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <div className="ks-doc-meta ks-mono">
            {sceneCount} SCENES · INTERACTIVE FMV
          </div>
        </div>
      </div>

      <nav className="ks-mode-switch" aria-label="视图切换">
        {VIEW_DEFS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`ks-mode-tab ${forgeView === v.id ? 'is-active' : ''}`}
            onClick={() => setForgeView(v.id)}
            title={v.hint}
          >
            <span className="ks-tab-dot" />
            {v.label}
          </button>
        ))}
      </nav>

      <div className="ks-topbar-right">
        <div className="ks-history-group" role="group" aria-label="编辑历史">
          <button
            type="button"
            className="ks-action ks-history-btn"
            onClick={doUndo}
            disabled={pastCount === 0}
            title={`撤销 (⌘Z) · 还可撤 ${pastCount} 步`}
          >
            <span className="ks-history-arrow">↶</span>
            <span className="ks-history-count ks-mono">{pastCount}</span>
          </button>
          <button
            type="button"
            className="ks-action ks-history-btn"
            onClick={doRedo}
            disabled={futureCount === 0}
            title={`重做 (⌘⇧Z) · 还可重做 ${futureCount} 步`}
          >
            <span className="ks-history-arrow">↷</span>
            <span className="ks-history-count ks-mono">{futureCount}</span>
          </button>
        </div>
        <ScenarioHistoryDropdown />
        <button
          type="button"
          className="ks-action ks-reset-ui-btn"
          onClick={handleResetUiState}
          title={
            'UI 救火 · 卡住/抽屉收不起/Tab 点不动时点这里\n' +
            '只清 UI 偏好（视图、抽屉开关），不动剧本/历史/资产/撤销栈'
          }
          aria-label="重置 UI 状态"
        >
          <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>⟲</span>
          <span style={{ marginLeft: 4 }}>救火</span>
        </button>
      </div>

    </header>
  )
}


/**
 * 剧本历史下拉 ——
 *   - 显示 localStorage 里的剧本快照（按 updatedAt desc）
 *   - 点击切换：调用 loadScenarioFromHistory 把对应 scenario 灌回 store
 *   - 每项有 ✕ 删除（带确认；不删 active）
 *
 * 触发时机：每次 scenario 变化 debounce 1.5s 落盘 → 这里下次打开就能看到
 *
 * 真实需求：作者刷新浏览器后，剧情树和图都没了 → 这是补救入口。
 */
function ScenarioHistoryDropdown() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<PersistedItem[]>([])
  const [anchorRect, setAnchorRect] = useState<{
    top: number
    right: number
    left: number
    bottom: number
  } | null>(null)
  const currentId = useScenarioStore((s) => s.scenario.id)
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [exportingPkgId, setExportingPkgId] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState<string>('')

  function refresh(): void {
    setItems(listScenarioHistory())
  }

  useEffect(() => {
    if (!open) return
    refresh()
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    function update(): void {
      const el = btnRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setAnchorRect({
        top: r.top,
        right: r.right,
        left: r.left,
        bottom: r.bottom,
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function handlePick(id: string): void {
    if (id === currentId) {
      setOpen(false)
      return
    }
    const ok = loadScenarioFromHistory(id)
    if (!ok) {
      alert('加载历史失败：条目可能已损坏')
    }
    setOpen(false)
  }

  function handleDelete(e: React.MouseEvent, id: string, title: string): void {
    e.stopPropagation()
    if (id === currentId) {
      alert('当前正在编辑这份剧本，请先切到别的版本再删')
      return
    }
    if (!window.confirm(`从历史里移除「${title}」？\n（不影响当前编辑，但找不回了）`)) {
      return
    }
    removeScenarioFromHistory(id)
    refresh()
  }

  function handleExport(): void {
    const json = exportHistoryJson()
    const ok = triggerDownload(defaultExportFilename(), json)
    if (!ok) {
      alert('当前环境不支持下载文件，请手动复制 localStorage')
    }
  }

  async function handleExportPackage(
    e: React.MouseEvent,
    item: PersistedItem,
  ): Promise<void> {
    e.stopPropagation()
    if (exportingPkgId) return
    setExportingPkgId(item.id)
    setExportProgress('扫描引用…')
    try {
      const { exportScenarioPackage } = await import(
        '../scenario/pkg/exportScenarioPackage'
      )
      const { loadDialoguePref } = await import(
        '../editor/timeline/dialoguePref'
      )
      const result = await exportScenarioPackage(item.scenario, {
        mode: 'playback',
        includeSubtitles: loadDialoguePref(),
        onProgress: (p) => {
          if (p.phase === 'collect') {
            setExportProgress(`扫描到 ${p.total} 个引用…`)
          } else if (p.phase === 'resolve') {
            setExportProgress(`抓取资产 ${p.resolved} / ${p.total}`)
          } else if (p.phase === 'pack') {
            setExportProgress('压缩打包…')
          }
        },
      })
      const { triggerBlobDownload } = await import(
        '../scenario/scenarioTransfer'
      )
      const ok = triggerBlobDownload(result.filename, result.blob)
      if (!ok) {
        alert('当前环境不支持下载文件')
        return
      }
      const sizeMb = (result.blob.size / 1048576).toFixed(1)
      const s = result.manifest.stats
      let msg = `已导出 ${result.filename}（所见即所得）\n${sizeMb} MiB · ${s.packedBlobs} 份资产`
      if (result.manifest.includedScenes) {
        msg += ` · ${result.manifest.includedScenes.length} 个场景`
        const dropped = result.manifest.droppedScenes?.length ?? 0
        if (dropped > 0) msg += `（跳过 ${dropped} 个孤岛）`
      }
      if (s.externalKept > 0) {
        msg += ` · ${s.externalKept} 个外链（需联网加载）`
      }
      if (s.missingCells > 0) {
        msg += `\n⚠ ${s.missingCells} 个引用的原始素材已丢失`
      }
      if (s.failedCells > 0) {
        msg += `\n⚠ ${s.failedCells} 个引用抓取失败`
      }
      alert(msg)
    } catch (err) {
      console.error('[reelpkg export] failed:', err)
      alert(`导出失败：${(err as Error).message}`)
    } finally {
      setExportingPkgId(null)
      setExportProgress('')
    }
  }

  function handleImportClick(): void {
    fileInputRef.current?.click()
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const raw = typeof reader.result === 'string' ? reader.result : ''
      const res = importHistoryFromJson(raw)
      if (!res.ok) {
        alert(`导入失败：${res.error ?? '未知错误'}`)
        return
      }
      refresh()
      alert(
        `导入成功：新增 ${res.addedCount ?? 0} 条，当前历史共 ${res.totalCount ?? 0} 条。`,
      )
    }
    reader.onerror = () => alert('读取文件失败')
    reader.readAsText(file)
  }

  return (
    <div className="ks-hist-dd" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="ks-action ks-hist-btn-top"
        onClick={() => setOpen((o) => !o)}
        title="刷新不丢 · 点击查看以前锻造过的剧本"
      >
        历史 ▾
      </button>
      {open && anchorRect && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              className="ks-hist-panel ks-hist-panel-portal"
              style={{
                top: Math.round(anchorRect.bottom + 8),
                right: Math.round(window.innerWidth - anchorRect.right),
              }}
              role="menu"
            >
              {items.length === 0 ? (
                <div className="ks-hist-empty">
                  <div>还没有历史记录</div>
                  <div
                    className="ks-faint"
                    style={{ marginTop: 4, fontSize: 10 }}
                  >
                    锻造剧本后约 1.5s 会自动写入；刷新页面也不丢
                  </div>
                </div>
              ) : (
                <ul className="ks-hist-list">
                  {items.map((it) => {
                    const active = it.id === currentId
                    const sceneCount = Object.keys(
                      it.scenario.scenes ?? {},
                    ).length
                    return (
                      <li
                        key={it.id}
                        className={`ks-hist-item ${active ? 'is-active' : ''}`}
                        onClick={() => handlePick(it.id)}
                      >
                        <div className="ks-hist-item-row">
                          <div className="ks-hist-item-title ks-cn">
                            {it.title}
                          </div>
                          {active && (
                            <span className="ks-hist-active-badge ks-mono">
                              当前
                            </span>
                          )}
                        </div>
                        <div className="ks-hist-item-meta ks-mono">
                          <span>{sceneCount} scenes</span>
                          <span style={{ marginLeft: 10 }}>
                            {formatRelativeTime(it.updatedAt)}
                          </span>
                          <button
                            type="button"
                            className="ks-hist-pkg"
                            onClick={(e) => void handleExportPackage(e, it)}
                            disabled={exportingPkgId !== null}
                            title={
                              exportingPkgId === it.id
                                ? exportProgress || '打包中…'
                                : '导出完整剧本包（.reelpkg，含所有图像/视频/音频）'
                            }
                            aria-label="导出完整包"
                          >
                            {exportingPkgId === it.id ? '⏳' : '📦'}
                          </button>
                          <button
                            type="button"
                            className="ks-hist-delete"
                            onClick={(e) => handleDelete(e, it.id, it.title)}
                            title="从历史移除"
                            aria-label="删除"
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              <div className="ks-hist-footer">
                <button
                  type="button"
                  className="ks-hist-foot-btn"
                  onClick={handleExport}
                  title="把整份历史导出为 JSON 文件"
                >
                  ⬇ 导出 JSON
                </button>
                <button
                  type="button"
                  className="ks-hist-foot-btn"
                  onClick={handleImportClick}
                  title="从 JSON 文件合并历史（同 id 按更新时间新者胜）"
                >
                  ⬆ 导入 JSON
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleImportFile}
                  style={{ display: 'none' }}
                  aria-hidden="true"
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

function formatRelativeTime(t: number): string {
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

const topbarCss = `
.ks-topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  height: 64px;
  padding: 0 20px;
  margin: 12px 16px 0;
  border-radius: var(--ks-radius-lg);
  border: 1px solid var(--ks-border);
  background: var(--ks-surface-glass);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  box-shadow: var(--ks-shadow-soft), var(--ks-shadow-inset-hi);
  position: relative;
}

.ks-topbar-left {
  display: flex; align-items: center; gap: 14px;
  min-width: 0;
}
.rs-logo {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px 6px 6px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
}
.rs-logo-mark {
  width: 22px; height: 22px;
  background:
    radial-gradient(circle at 30% 30%, #ffb686, var(--ks-amber) 60%, #d95a1a);
  border-radius: 50%;
  box-shadow:
    0 0 0 2px rgba(255,255,255,0.9) inset,
    0 6px 14px rgba(255, 123, 61, 0.45);
}
.rs-logo-text {
  font-family: var(--ks-font-display);
  letter-spacing: 0.02em;
  font-size: 13px;
  font-weight: 600;
  color: var(--ks-text);
}
.ks-divider {
  width: 1px; height: 28px;
  background: var(--ks-border);
}
.ks-doc { display: flex; flex-direction: column; line-height: 1.2; min-width: 0; }
.ks-doc-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ks-doc-title {
  font-family: var(--ks-font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--ks-text);
  letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0;
  max-width: 260px;
}
/* ➕ 新的故事 —— 圆形 icon 按钮，与 title 基线对齐 */
.ks-doc-new-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 50%;
  border: 1px dashed var(--ks-border-strong, var(--ks-border));
  background: transparent;
  color: var(--ks-text-dim);
  cursor: pointer;
  transition:
    color var(--ks-dur-fast) var(--ks-ease),
    background var(--ks-dur-fast) var(--ks-ease),
    border-color var(--ks-dur-fast) var(--ks-ease),
    transform var(--ks-dur-fast) var(--ks-ease);
}
.ks-doc-new-btn:hover {
  color: var(--color-text-on-bright-primary);
  background: var(--ks-amber);
  border-style: solid;
  border-color: var(--ks-amber);
  transform: rotate(90deg);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ks-amber) 28%, transparent);
}
.ks-doc-new-btn:active {
  transform: rotate(90deg) scale(0.92);
}
.ks-doc-new-btn:focus-visible {
  outline: 2px solid var(--ks-amber);
  outline-offset: 2px;
}

.ks-doc-meta {
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--ks-text-dim);
  margin-top: 2px;
}

/* 模式切换 · 胶囊 Tab */
.ks-mode-switch {
  display: inline-flex;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-pill);
  padding: 4px;
  gap: 2px;
  background: var(--ks-panel-elev);
  box-shadow: var(--ks-shadow-inset-hi);
}
.ks-mode-tab {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 20px;
  background: transparent;
  border: 1px solid transparent;
  font-family: var(--ks-font-ui);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--ks-text-soft);
  border-radius: var(--ks-radius-pill);
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
.ks-mode-tab:hover:not(:disabled) {
  color: var(--ks-text);
  background: rgba(28, 22, 15, 0.04);
  box-shadow: none;
  transform: none;
}
.ks-mode-tab.is-active {
  background: #fff;
  color: var(--ks-amber);
  border-color: var(--ks-border);
  box-shadow:
    0 1px 2px rgba(28, 22, 15, 0.05),
    0 4px 12px rgba(255, 123, 61, 0.14);
  transform: none;
}
.ks-tab-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor;
  opacity: 0.85;
  box-shadow: 0 0 6px currentColor;
}
.ks-mode-tab:not(.is-active) .ks-tab-dot { opacity: 0.4; box-shadow: none; }

/* 右侧动作 */
.ks-topbar-right {
  display: flex; gap: 6px; justify-content: flex-end; align-items: center;
}
.ks-action {
  font-family: var(--ks-font-ui);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  padding: 7px 14px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  border-color: var(--ks-border);
  color: var(--ks-text-soft);
}
.ks-action:hover:not(:disabled) {
  color: var(--ks-amber);
  background: var(--ks-panel-solid);
  border-color: var(--ks-border-strong);
  box-shadow: var(--ks-shadow-soft);
}

/* 撤销 / 重做按钮组 */
.ks-history-group {
  display: inline-flex;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-pill);
  padding: 3px;
  margin-right: 4px;
  background: var(--ks-panel-elev);
  box-shadow: var(--ks-shadow-inset-hi);
}
.ks-history-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px !important;
  border-color: transparent !important;
  background: transparent !important;
  color: var(--ks-text-soft) !important;
  letter-spacing: 0 !important;
  border-radius: var(--ks-radius-pill);
  transition: color var(--ks-dur-fast), background var(--ks-dur-fast);
  box-shadow: none !important;
}
.ks-history-btn:hover:not(:disabled) {
  color: var(--ks-amber) !important;
  background: var(--ks-amber-soft) !important;
  transform: none !important;
  box-shadow: none !important;
}
.ks-history-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ks-history-arrow {
  font-size: 15px;
  line-height: 1;
}
.ks-history-count {
  font-size: 10px;
  letter-spacing: 0;
  color: var(--ks-text-faint);
  min-width: 12px;
  text-align: right;
}

/* "救火"按钮 —— UI 卡死时一键重置 shellStore.
   视觉上跟其他 .ks-action 同档但用偏冷的边框, 暗示"工具/兜底"语义. */
.ks-reset-ui-btn {
  display: inline-flex;
  align-items: center;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  padding: 6px 12px;
  color: var(--ks-text-dim);
  border-color: var(--ks-border-soft);
  background: transparent;
}
.ks-reset-ui-btn:hover:not(:disabled) {
  color: var(--ks-cyan, #5b8cb8);
  border-color: rgba(108, 143, 184, 0.45);
  background: rgba(108, 143, 184, 0.08);
  box-shadow: none;
}

/* ─── 剧本历史下拉 ─── */
.ks-hist-dd { position: relative; }
/* Portal 版本挂到 body，用 fixed 贴 viewport 坐标；避免被父容器 overflow 裁切 */
.ks-hist-panel.ks-hist-panel-portal {
  position: fixed;
  top: 0;
  right: 0;
  min-width: 340px;
  max-width: 440px;
  max-height: 60vh;
  overflow: auto;
  padding: 6px;
  background: var(--ks-panel-elev);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  box-shadow: var(--ks-shadow-lift);
  z-index: 9999;
  animation: ks-hist-panel-in 180ms var(--ks-ease);
}
@keyframes ks-hist-panel-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ks-hist-empty {
  padding: 28px 16px;
  font-size: 12px;
  color: var(--ks-text-dim);
  text-align: center;
  line-height: 1.6;
}
.ks-hist-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.ks-hist-item {
  padding: 10px 12px;
  border-radius: var(--ks-radius-md);
  cursor: pointer;
  transition: background var(--ks-dur-fast);
  border: 1px solid transparent;
}
.ks-hist-item:hover {
  background: var(--ks-amber-soft);
  border-color: rgba(255, 123, 61, 0.2);
}
.ks-hist-item.is-active {
  background: rgba(255, 123, 61, 0.14);
  border-color: rgba(255, 123, 61, 0.35);
}
.ks-hist-item-row {
  display: flex; align-items: center; gap: 8px;
}
.ks-hist-item-title {
  flex: 1;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ks-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-hist-active-badge {
  font-size: 9.5px;
  letter-spacing: 0.14em;
  padding: 2px 8px;
  border: 1px solid rgba(255, 123, 61, 0.45);
  color: var(--ks-amber);
  border-radius: var(--ks-radius-pill);
  background: rgba(255, 123, 61, 0.08);
}
.ks-hist-item-meta {
  display: flex; align-items: center;
  margin-top: 4px;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--ks-text-dim);
}
.ks-hist-delete {
  margin-left: auto;
  background: transparent;
  border: 0;
  color: var(--ks-text-faint);
  font-size: 13px;
  padding: 3px 8px;
  cursor: pointer;
  border-radius: var(--ks-radius-pill);
  transition: color var(--ks-dur-fast), background var(--ks-dur-fast);
}
.ks-hist-delete:hover {
  color: var(--ks-rose);
  background: rgba(240, 119, 157, 0.12);
}

/* 版本展开切换按钮（每条剧本右侧） */
.ks-hist-versions-toggle {
  all: unset;
  margin-left: auto;
  padding: 2px 8px;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--ks-text-dim);
  background: transparent;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-pill);
  cursor: pointer;
  transition:
    color var(--ks-dur-fast) var(--ks-ease),
    background var(--ks-dur-fast) var(--ks-ease),
    border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-hist-versions-toggle:hover {
  color: var(--ks-text);
  border-color: var(--ks-border);
  background: var(--ks-panel-elev);
}
.ks-hist-versions-toggle.is-open {
  color: var(--ks-amber);
  border-color: var(--ks-amber);
  background: var(--ks-amber-soft);
}
/* toggle 拿走了 margin-left:auto，delete 就要也 margin-left:0，否则被挤到右边之外 */
.ks-hist-item-meta .ks-hist-versions-toggle + .ks-hist-pkg,
.ks-hist-item-meta .ks-hist-versions-toggle + .ks-hist-delete {
  margin-left: 4px;
}

/* 完整包导出按钮：与 .ks-hist-delete 风格一致，但不是破坏性动作所以 hover 走中性色 */
.ks-hist-pkg {
  margin-left: auto;
  background: transparent;
  border: 0;
  color: var(--ks-text-faint);
  font-size: 12px;
  padding: 3px 6px;
  cursor: pointer;
  border-radius: var(--ks-radius-pill);
  transition: background 0.12s, color 0.12s;
}
.ks-hist-pkg:hover:not(:disabled) {
  background: var(--ks-surface-2, rgba(255, 255, 255, 0.06));
  color: var(--ks-text);
}
.ks-hist-pkg:disabled {
  cursor: wait;
  opacity: 0.6;
}
/* 同 meta 行存在 pkg 时，把 pkg 推到右边、delete 紧贴其后 */
.ks-hist-item-meta .ks-hist-pkg ~ .ks-hist-delete {
  margin-left: 2px;
}

/* 复制链接按钮 —— 与 pkg 风格一致；🔗 不是破坏性动作，hover 用中性色 */
.ks-hist-copy-link {
  margin-left: auto;
  background: transparent;
  border: 0;
  color: var(--ks-text-faint);
  font-size: 12px;
  padding: 3px 6px;
  cursor: pointer;
  border-radius: var(--ks-radius-pill);
  transition: background 0.12s, color 0.12s;
}
.ks-hist-copy-link:hover {
  background: var(--ks-surface-2, rgba(255, 255, 255, 0.06));
  color: var(--ks-text);
}
/* 已经有 copy-link 抢走 margin-left:auto，pkg / delete 都贴紧 */
.ks-hist-item-meta .ks-hist-copy-link ~ .ks-hist-pkg,
.ks-hist-item-meta .ks-hist-copy-link ~ .ks-hist-delete {
  margin-left: 2px;
}
/* versions-toggle + copy-link 同时存在时，copy-link 不抢 auto，靠 toggle 的 + 选择器推 */
.ks-hist-item-meta .ks-hist-versions-toggle + .ks-hist-copy-link {
  margin-left: 4px;
}


/* 版本列表 */
.ks-hist-versions {
  margin: 6px 0 0;
  padding: 6px 8px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px dashed var(--ks-border-soft);
  background: color-mix(in srgb, var(--ks-panel-solid) 70%, transparent);
  border-radius: var(--ks-radius-sm);
}
.ks-hist-version {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 8px;
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-elev);
  position: relative;
}
.ks-hist-version.is-latest {
  border: 1px solid var(--ks-amber-soft);
}
.ks-hist-version-main {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ks-text);
}
.ks-hist-version-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.ks-hist-version-badge {
  padding: 1px 6px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ks-amber);
  background: var(--ks-amber-soft);
  border-radius: var(--ks-radius-pill);
}
.ks-hist-version-rollback-tag {
  padding: 1px 6px;
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--ks-cyan, #5b8cb8);
  background: rgba(108, 143, 184, 0.12);
  border-radius: var(--ks-radius-pill);
}
.ks-hist-version-meta {
  font-size: 10px;
  color: var(--ks-text-faint);
  letter-spacing: 0.04em;
}
.ks-hist-version-rollback {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  all: unset;
  padding: 3px 10px;
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--ks-amber);
  border: 1px solid var(--ks-amber);
  background: var(--ks-amber-soft);
  border-radius: var(--ks-radius-pill);
  cursor: pointer;
  transition: background var(--ks-dur-fast) var(--ks-ease);
}
.ks-hist-version-rollback:hover {
  background: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
}

/* 导出 / 导入：面板底部横排两按钮 */
.ks-hist-footer {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--ks-border);
}
.ks-hist-foot-btn {
  flex: 1;
  font-family: var(--ks-font-ui);
  font-size: 11.5px;
  letter-spacing: 0.02em;
  padding: 7px 10px;
  border-radius: var(--ks-radius-md);
  border: 1px solid var(--ks-border);
  background: transparent;
  color: var(--ks-text-soft);
  cursor: pointer;
  transition:
    color var(--ks-dur-fast) var(--ks-ease),
    background var(--ks-dur-fast) var(--ks-ease),
    border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-hist-foot-btn:hover {
  color: var(--ks-amber);
  background: var(--ks-amber-soft);
  border-color: rgba(255, 123, 61, 0.35);
}

/* ─── ThemeSwitcher · 三主题色盘切换 ─── */
.ks-theme-switcher {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  box-shadow: var(--ks-shadow-inset-hi);
  margin-left: 4px;
}
.ks-theme-chip {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 0;
  padding: 5px;
  border-radius: var(--ks-radius-pill);
  cursor: pointer;
  color: var(--ks-text-soft);
  transition:
    padding var(--ks-dur-fast) var(--ks-ease),
    background var(--ks-dur-fast) var(--ks-ease),
    color var(--ks-dur-fast) var(--ks-ease);
  font-family: var(--ks-font-ui);
  font-size: 11.5px;
  line-height: 1;
}
.ks-theme-chip:hover {
  padding: 5px 10px 5px 5px;
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
}
.ks-theme-chip.is-active {
  padding: 5px 12px 5px 6px;
  background: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
}
.ks-theme-swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.12),
    inset 0 0 0 1px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
}
.ks-theme-label {
  display: inline-block;
  max-width: 0;
  overflow: hidden;
  white-space: nowrap;
  transition: max-width var(--ks-dur-mid) var(--ks-ease),
              margin-left var(--ks-dur-fast) var(--ks-ease);
  font-family: var(--ks-font-cn);
  font-weight: 500;
  letter-spacing: 0.02em;
}
.ks-theme-chip:hover .ks-theme-label,
.ks-theme-chip.is-active .ks-theme-label {
  max-width: 80px;
  margin-left: 6px;
}
`
injectStyleOnce('topbar', topbarCss)
