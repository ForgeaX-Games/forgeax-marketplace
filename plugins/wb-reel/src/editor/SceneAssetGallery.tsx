import { useRef, useState } from 'react'
import { useMediaStore } from '../media/mediaStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { injectStyleOnce } from '../styles/injectStyle'
import {
  DOCK_MIME,
  serializeDockPayload,
  parseDockPayload,
  type DockDropPayload,
} from './timeline/dndTypes'

/**
 * SceneAssetGallery —— 场景级图像 / 视频资产小画廊。
 *
 * 设计目标（2026-04-30 作者需求）：
 *   - 用户可在"资产生成"面板里直接上传多张图 / 多段视频
 *   - 支持从系统文件管理器直接**拖文件进画廊**入库（2026-05 补）—
 *     无需点击按钮；内部 item 的拖拽（到时间轴 / 重排序）不受影响，
 *     依据 dataTransfer.types 是否包含 'Files' 区分
 *   - 支持排序（左移/右移小按钮）、预览（缩略图/封面帧）、删除
 *   - 条目可拖入时间轴：图 → 新 shot；视频 → 覆盖 scene 主视频（MVP）
 *
 * 数据层：
 *   - 资产 id 列表写入 scene.sceneImages / scene.sceneVideos（mediaStore id）
 *   - 媒体实体（File/dataUrl + 元数据）放 mediaStore，全局单一来源
 *
 * 为什么不直接用 scene.media.ref？
 *   - scene.media 是"当前代表画面"，多版本切换语义不匹配
 *   - sceneImages/sceneVideos 作为"素材库"，与代表画面解耦，拖入时间轴再落地
 */
export function SceneAssetGallery({
  sceneId,
  kind,
  ids,
  compact = false,
}: {
  sceneId: string
  kind: 'image' | 'video'
  ids: string[]
  /**
   * compact（2026-06-16 作者反馈，用于右侧 dock「素材库」窄列）：
   *   - 去掉顶部独立「上传」按钮 —— 上传入口收敛到「内容区」本身。
   *   - 整块画廊点击空白处即开文件选择器；拖文件进来入库（与常规一致）。
   *   - 缩略图更小、间距更紧，适配窄列；正式素材照常可拖入时间轴。
   * 素材项 / 操作按钮在 compact 下 stopPropagation，避免点到它们时误触发上传。
   */
  compact?: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ingest = useMediaStore((s) => s.ingest)
  const entries = useMediaStore((s) => s.entries)
  const addSceneImage = useScenarioStore((s) => s.addSceneImage)
  const removeSceneImage = useScenarioStore((s) => s.removeSceneImage)
  const reorderSceneImages = useScenarioStore((s) => s.reorderSceneImages)
  const addSceneVideo = useScenarioStore((s) => s.addSceneVideo)
  const removeSceneVideo = useScenarioStore((s) => s.removeSceneVideo)
  const reorderSceneVideos = useScenarioStore((s) => s.reorderSceneVideos)
  const [busy, setBusy] = useState(false)
  // dropzone 高亮 —— 只在整个画廊区域生效，不影响 item 内部的 draggable
  const [isDragOver, setIsDragOver] = useState(false)

  const accept = kind === 'image' ? 'image/*' : 'video/*'
  const isImage = kind === 'image'

  async function onPickFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      for (const file of Array.from(files)) {
        // 粗校验：非对应类型直接跳过，避免用户误拖文档
        if (isImage && !file.type.startsWith('image/')) continue
        if (!isImage && !file.type.startsWith('video/')) continue
        const id = ingest(file)
        if (isImage) addSceneImage(sceneId, id)
        else addSceneVideo(sceneId, id)
      }
    } finally {
      setBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /*
   * 外部文件拖入支持 —— 作者反馈"点击上传太麻烦"。
   *
   * 判定 "这是外部文件拖入" 而不是 "画廊内 item 的重排序拖拽"：
   *   e.dataTransfer.types 里包含 'Files' 才处理，否则 passthrough 让时间轴 DnD
   *   / 内部重排等其它拖拽逻辑正常走。
   *
   * 这样：
   *   - 从资源管理器/Finder 拖进来的图片视频 → 走 onPickFiles 入库
   *   - 拖画廊内的一张图（DOCK_MIME payload）到时间轴 → 不被这里拦
   */
  function hasExternalFiles(e: React.DragEvent): boolean {
    const types = e.dataTransfer.types
    // types 是 DOMStringList（类数组），用 indexOf 最省事 —— 'Files' 是浏览器
    // 在外部文件拖入时加的固定标签，内部 DnD（DOCK_MIME 等）不会包含。
    return Array.prototype.indexOf.call(types, 'Files') !== -1
  }
  // 是否是本应用内素材候选拖入（生成卡候选 / 别处素材）—— DOCK_MIME。
  function hasDockPayload(e: React.DragEvent): boolean {
    return Array.prototype.indexOf.call(e.dataTransfer.types, DOCK_MIME) !== -1
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if (!hasExternalFiles(e) && !hasDockPayload(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDragOver) setIsDragOver(true)
  }
  function onDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    // currentTarget 是画廊根；relatedTarget 是下一个 hover 目标。
    // 如果下一个目标还在画廊内部，不要清除高亮（避免反复闪）。
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setIsDragOver(false)
  }
  async function onDrop(e: React.DragEvent<HTMLDivElement>): Promise<void> {
    // 应用内候选拖入 → 采用为正式素材（与「采用」按钮等价）
    if (!hasExternalFiles(e) && hasDockPayload(e)) {
      const raw = e.dataTransfer.getData(DOCK_MIME)
      const payload = raw ? parseDockPayload(raw) : null
      if (payload && payload.kind === kind && 'mediaId' in payload) {
        e.preventDefault()
        setIsDragOver(false)
        if (isImage) addSceneImage(sceneId, payload.mediaId)
        else addSceneVideo(sceneId, payload.mediaId)
      }
      return
    }
    if (!hasExternalFiles(e)) return
    e.preventDefault()
    setIsDragOver(false)
    await onPickFiles(e.dataTransfer.files)
  }

  /**
   * compact 模式「点击空白处上传」——点击画廊任意非素材/非按钮区域开文件选择器。
   * 素材项 <li> 与操作按钮组在 compact 下各自 stopPropagation，所以走到这里的
   * 一定是空白区域（根容器 / body / 空态提示）。
   */
  function onBlankClick(): void {
    if (!compact || busy) return
    fileInputRef.current?.click()
  }

  function remove(id: string): void {
    if (isImage) removeSceneImage(sceneId, id)
    else removeSceneVideo(sceneId, id)
  }

  function move(id: string, dir: -1 | 1): void {
    const i = ids.indexOf(id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    const next = ids.slice()
    next.splice(i, 1)
    next.splice(j, 0, id)
    if (isImage) reorderSceneImages(sceneId, next)
    else reorderSceneVideos(sceneId, next)
  }

  return (
    <div
      className={`ks-asset-gallery ${compact ? 'is-compact' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
      onClick={compact ? onBlankClick : undefined}
      title={compact ? '点击空白处或拖文件上传素材' : undefined}
    >
      {/* 文件选择器 input 常驻 —— compact 点空白处 / 常规点上传按钮都用它 */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => void onPickFiles(e.target.files)}
      />
      {!compact && (
        <div className="ks-asset-gallery-bar">
          <button
            type="button"
            className="ks-asset-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {busy
              ? '上传中…'
              : isImage
                ? '＋ 上传图片（可拖入）'
                : '＋ 上传视频（可拖入）'}
          </button>
          <span className="ks-mono ks-asset-count">
            {ids.length} 项 · 可拖入时间轴
          </span>
        </div>
      )}

      {ids.length === 0 ? (
        <div className="ks-asset-gallery-body">
          <div className="ks-asset-empty ks-mono ks-faint">
            {compact ? (
              <>
                <span className="ks-asset-empty-icon" aria-hidden>＋</span>
                <span className="ks-asset-empty-main">
                  点击空白处 / 拖文件到这里上传
                </span>
                <span className="ks-asset-empty-sub">
                  也可在「打开素材库」里生成后自动入库
                </span>
              </>
            ) : (
              <>
                ◇ 还没有
                {isImage ? '参考图' : '参考视频'}
                · 拖文件到这里 / 点上方按钮上传 / 生成后入库
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="ks-asset-gallery-body">
          {compact && (
            <div className="ks-asset-compact-hint ks-mono">
              {ids.length} 项 · 拖入时间轴 · 点空白处加图
            </div>
          )}
          <ul className="ks-asset-list">
          {ids.map((id, idx) => {
            const entry = entries[id]
            if (!entry) {
              // 引用已失效（mediaStore 被删），展示占位并允许用户清理
              return (
                <li
                  key={id}
                  className="ks-asset-item is-missing"
                  onClick={compact ? (e) => e.stopPropagation() : undefined}
                >
                  <div className="ks-asset-thumb ks-asset-thumb-missing">⚠</div>
                  <div className="ks-asset-meta ks-mono">
                    ref missing · {id.slice(0, 8)}
                  </div>
                  <button
                    type="button"
                    className="ks-asset-icon-btn"
                    title="移除失效引用"
                    onClick={() => remove(id)}
                  >
                    ✕
                  </button>
                </li>
              )
            }
            const payload: DockDropPayload = isImage
              ? { kind: 'image', mediaId: id, label: entry.name }
              : {
                  kind: 'video',
                  mediaId: id,
                  label: entry.name,
                }
            return (
              <li
                key={id}
                className="ks-asset-item"
                draggable
                onClick={compact ? (e) => e.stopPropagation() : undefined}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy'
                  e.dataTransfer.setData(
                    DOCK_MIME,
                    serializeDockPayload(payload),
                  )
                }}
                title={`${entry.name} · 拖入时间轴${isImage ? '创建新分镜' : '覆盖场景视频'}`}
              >
                {isImage ? (
                  <img
                    className="ks-asset-thumb"
                    src={entry.url}
                    alt={entry.name}
                    draggable={false}
                  />
                ) : (
                  <video
                    className="ks-asset-thumb"
                    src={entry.url}
                    muted
                    playsInline
                    preload="metadata"
                  />
                )}
                <div className="ks-asset-meta">
                  <span className="ks-asset-name" title={entry.name}>
                    {entry.name}
                  </span>
                  <span className="ks-mono ks-asset-order">#{idx + 1}</span>
                </div>
                <div className="ks-asset-ops">
                  <button
                    type="button"
                    className="ks-asset-icon-btn"
                    onClick={() => move(id, -1)}
                    disabled={idx === 0}
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ks-asset-icon-btn"
                    onClick={() => move(id, +1)}
                    disabled={idx === ids.length - 1}
                    title="下移"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="ks-asset-icon-btn"
                    onClick={() => remove(id)}
                    title="移出素材库（不删除原文件）"
                  >
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
          </ul>
        </div>
      )}
    </div>
  )
}

const css = `
.ks-asset-gallery {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 去掉原来的 10px 外 padding —— 让 sticky 的 bar 能贴到容器顶；
   * 内容区的留白交给 .ks-asset-gallery-body / .ks-asset-list 自己控制 */
  padding: 0;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-solid);
  /* 画廊容器自己裁圆角；sticky 的 bar 只需要在 PromptTabs 的滚动容器里吸顶 */
  overflow: visible;
  position: relative;
  transition: border-color var(--ks-dur-fast) var(--ks-ease),
              box-shadow var(--ks-dur-fast) var(--ks-ease);
}
/* 外部文件拖到画廊上时的高亮：琥珀色虚边 + 柔光，明确告诉作者"放开就入库" */
.ks-asset-gallery.is-drag-over {
  border-color: var(--ks-amber);
  border-style: dashed;
  box-shadow:
    0 0 0 2px var(--ks-amber-soft),
    0 8px 24px rgba(255, 123, 61, 0.18);
}
.ks-asset-gallery.is-drag-over::after {
  content: '松开以添加到素材库';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--ks-font-cn);
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--ks-amber);
  background: color-mix(in srgb, var(--ks-amber-soft) 70%, transparent);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  border-radius: var(--ks-radius-md);
  pointer-events: none;
  z-index: 5;
}
/*
 * sticky 常驻：当父级滚动容器（PromptTabs 右侧栏）向下滚时，
 * 这一条会粘在视口顶端（top:0）。
 *
 * 关键前置：sticky 的祖先链不能有 overflow:hidden；PromptTabs 的
 * .ks-pt / body 是 overflow:visible，因此 sticky 会作用到 PromptTabs
 * 的最外层可滚动容器。
 *
 * 视觉：半透明 + 背景 blur，滚动时底下内容能隐约透出来一点，让"吸顶"
 * 看起来像窗口的一部分而不是硬浮条。
 */
.ks-asset-gallery-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  position: sticky;
  top: 0;
  z-index: 2;
  background: color-mix(in srgb, var(--ks-panel-solid) 88%, transparent);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-top-left-radius: var(--ks-radius-md);
  border-top-right-radius: var(--ks-radius-md);
  border-bottom: 1px solid var(--ks-border-soft);
}
/* 列表 / 空态外层留白，替代原来 gallery 的整体 padding */
.ks-asset-gallery-body {
  padding: 6px 10px 10px;
}
.ks-asset-upload-btn {
  all: unset;
  cursor: pointer;
  font-family: var(--ks-font-ui);
  font-size: 11px;
  font-weight: 500;
  /* 扁一点：上下 padding 从 6 收到 3，按钮高度整体下降到 ~24 */
  padding: 3px 12px;
  border: 1px dashed var(--ks-border-strong);
  border-radius: var(--ks-radius-pill);
  color: var(--ks-text-soft);
  background: var(--ks-panel-elev);
  transition: all var(--ks-dur-fast) var(--ks-ease);
  white-space: nowrap;
}
.ks-asset-upload-btn:hover:not(:disabled) {
  border-color: var(--ks-amber);
  color: var(--ks-amber);
  background: var(--ks-amber-soft);
}
.ks-asset-upload-btn:disabled { opacity: .5; cursor: not-allowed; }

.ks-asset-count {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ks-text-faint);
  margin-left: auto;
  white-space: nowrap;
}

.ks-asset-empty {
  font-size: 11px;
  letter-spacing: 0.02em;
  padding: 8px 2px;
}

.ks-asset-list {
  all: unset;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  padding: 2px 0;
}
.ks-asset-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-elev);
  cursor: grab;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-asset-item:hover {
  border-color: var(--ks-amber);
  box-shadow: var(--ks-shadow-soft);
}
.ks-asset-item:active { cursor: grabbing; }
.ks-asset-item.is-missing {
  opacity: 0.55;
  cursor: not-allowed;
}
.ks-asset-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-solid);
  display: block;
  pointer-events: none;
}
.ks-asset-thumb-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ks-rose);
  font-size: 18px;
}
.ks-asset-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
  font-size: 10.5px;
  color: var(--ks-text-soft);
}
.ks-asset-name {
  flex: 1;
  min-width: 0;
  /* 两行 clamp + tooltip —— 文件名不再单行截成「半截」(作者反馈右侧文字都是一半)。 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
  line-height: 1.4;
}
.ks-asset-order {
  color: var(--ks-text-faint);
  font-size: 9.5px;
  letter-spacing: 0.08em;
}
.ks-asset-ops {
  display: flex;
  gap: 2px;
  justify-content: flex-end;
}
.ks-asset-icon-btn {
  all: unset;
  cursor: pointer;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--ks-text-soft);
  border-radius: var(--ks-radius-sm);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-asset-icon-btn:hover:not(:disabled) {
  color: var(--ks-amber);
  background: rgba(255, 123, 61, 0.1);
}
.ks-asset-icon-btn:disabled { opacity: 0.3; cursor: not-allowed; }

/* ───────────────────────────────────────────────────────────────────
 * compact 变体（右侧 dock「素材库」窄列, 2026-06-16）
 *   - 无独立上传按钮: 整块画廊点空白即上传 + 拖文件入库 + 正式素材展示。
 *   - 虚线边框 + pointer 暗示「这是可点/可拖的上传内容区」。
 *   - 缩略图更小、间距更紧, 适配 ~280px 窄列。
 * ─────────────────────────────────────────────────────────────────── */
.ks-asset-gallery.is-compact {
  gap: 0;
  cursor: pointer;
  border-style: dashed;
  border-color: var(--ks-border);
  background: var(--ks-panel-elev);
}
.ks-asset-gallery.is-compact:hover {
  border-color: var(--ks-amber-soft);
}
.ks-asset-gallery.is-compact .ks-asset-gallery-body {
  padding: 8px;
}
/* 空态: 撑起一块足够大的点击/拖拽区, 居中提示 */
.ks-asset-gallery.is-compact .ks-asset-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 116px;
  padding: 12px 10px;
  text-align: center;
  cursor: pointer;
}
.ks-asset-empty-icon {
  font-size: 20px;
  line-height: 1;
  color: var(--ks-amber);
  opacity: 0.85;
}
.ks-asset-empty-main {
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ks-text-soft);
}
.ks-asset-empty-sub {
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: var(--ks-text-faint);
}
/* 有素材时: 顶部一条轻提示 + 更紧凑的小图网格 */
.ks-asset-compact-hint {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ks-text-faint);
  padding: 0 2px 6px;
}
.ks-asset-gallery.is-compact .ks-asset-list {
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 6px;
}
.ks-asset-gallery.is-compact .ks-asset-item {
  padding: 4px;
  gap: 3px;
  cursor: grab;
}
.ks-asset-gallery.is-compact .ks-asset-meta {
  font-size: 9px;
}
.ks-asset-gallery.is-compact .ks-asset-order { display: none; }
`
injectStyleOnce('scene-asset-gallery', css)
