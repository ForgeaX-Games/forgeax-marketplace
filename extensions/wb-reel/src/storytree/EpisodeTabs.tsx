import { useEffect, useState } from 'react'
import { useShellStore } from '../shell/shellStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { injectStyleOnce } from '../styles/injectStyle'
import type { Episode } from '../scenario/types'

const EMPTY_EPISODES: Episode[] = []

/**
 * EpisodeTabs —— StoryTree 顶部剧集选择器（v4 分剧集化）。
 *
 * 功能：
 *   - 显示所有剧集（tab 形式）—— 单选切换，无"全部集"聚合视图
 *   - 点击切换 shellStore.activeEpisodeId → StoryGraph 按集过滤
 *   - "+ 新建集" 按钮 → 弹 inline 输入框（轻量，不开大 Dialog）
 *   - 集名称可双击内联重命名
 *
 * 设计取舍（2026-05-27 作者反馈）：
 *   - 移除"全部集"按钮 —— 跨集图过大没法看清，强制每次只看一集，更符合"分剧集"语义
 *   - activeEpisodeId 兜底：null / 不存在 episode 时自动落到第一集，确保画布永不空白
 *   - 不显示"删除集"按钮在 tab 上（避免误操作）；删除走右键菜单或专属管理面板
 *   - 集顺序不在这里拖排（复杂度高，留 P5）
 */
export function EpisodeTabs() {
  const episodes = useScenarioStore((s) => s.scenario.episodes ?? EMPTY_EPISODES)
  const addEpisode = useScenarioStore((s) => s.addEpisode)
  const updateEpisode = useScenarioStore((s) => s.updateEpisode)
  const rootSceneId = useScenarioStore((s) => s.scenario.rootSceneId)
  const activeEpisodeId = useShellStore((s) => s.activeEpisodeId)
  const setActiveEpisodeId = useShellStore((s) => s.setActiveEpisodeId)

  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const sorted = [...episodes].sort((a, b) => a.order - b.order)

  /**
   * 兜底：activeEpisodeId 为 null（旧数据 / 之前选了"全部集"）或指向已删除的集时,
   * 自动切到第一集. 没有 sorted[0] 时 (无任何集) 不动 —— 整个 EpisodeTabs 直接 return null.
   */
  useEffect(() => {
    if (sorted.length === 0) return
    const validIds = new Set(sorted.map((e) => e.id))
    if (activeEpisodeId === null || !validIds.has(activeEpisodeId)) {
      setActiveEpisodeId(sorted[0]!.id)
    }
  }, [activeEpisodeId, sorted, setActiveEpisodeId])

  // 没有任何集时不展示 Tabs（极端兜底；正常通过 schemaMigrate 至少会有 1 集）
  if (sorted.length === 0) {
    return null
  }

  function handleAddConfirm() {
    const title = newTitle.trim() || `第${sorted.length + 1}集`
    const id = `ep-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
    addEpisode({ id, title, rootSceneId })
    setActiveEpisodeId(id)
    setNewTitle('')
    setAdding(false)
  }

  function handleRenameConfirm(id: string) {
    const title = renameValue.trim()
    if (title) updateEpisode(id, { title })
    setRenamingId(null)
    setRenameValue('')
  }

  return (
    <nav className="ks-episode-tabs" aria-label="剧集切换">
      {sorted.map((ep: Episode) => (
        <div key={ep.id} className="ks-episode-tab-wrap">
          {renamingId === ep.id ? (
            <input
              className="ks-episode-tab-rename"
              value={renameValue}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => handleRenameConfirm(ep.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm(ep.id)
                if (e.key === 'Escape') { setRenamingId(null); setRenameValue('') }
              }}
            />
          ) : (
            <button
              type="button"
              className={`ks-episode-tab ${activeEpisodeId === ep.id ? 'is-active' : ''}`}
              onClick={() => setActiveEpisodeId(ep.id)}
              onDoubleClick={() => {
                setRenamingId(ep.id)
                setRenameValue(ep.title)
              }}
              title={`${ep.title}${ep.synopsis ? ` · ${ep.synopsis}` : ''}\n双击重命名`}
            >
              {ep.title}
            </button>
          )}
        </div>
      ))}

      {/* 新建集 */}
      {adding ? (
        <div className="ks-episode-tab-new-input">
          <input
            className="ks-episode-tab-rename"
            placeholder={`第${sorted.length + 1}集`}
            value={newTitle}
            autoFocus
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={handleAddConfirm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddConfirm()
              if (e.key === 'Escape') { setAdding(false); setNewTitle('') }
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="ks-episode-tab-add"
          onClick={() => setAdding(true)}
          title="新建剧集"
        >
          + 新集
        </button>
      )}
    </nav>
  )
}

const css = `
.ks-episode-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px 0;
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}
.ks-episode-tabs::-webkit-scrollbar { display: none; }

.ks-episode-tab-wrap {
  flex-shrink: 0;
}

.ks-episode-tab {
  all: unset;
  flex-shrink: 0;
  padding: 5px 14px;
  font-family: var(--ks-font-cn);
  font-size: 12px;
  font-weight: 500;
  color: var(--ks-text-soft);
  border-radius: var(--ks-radius-pill);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--ks-dur-fast) var(--ks-ease),
    background var(--ks-dur-fast) var(--ks-ease),
    border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-episode-tab:hover:not(.is-active) {
  color: var(--ks-text);
  background: rgba(255, 123, 61, 0.06);
  border-color: rgba(255, 123, 61, 0.18);
}
.ks-episode-tab.is-active {
  color: var(--ks-amber);
  background: rgba(255, 123, 61, 0.12);
  border-color: rgba(255, 123, 61, 0.35);
  font-weight: 600;
}
.ks-episode-tab:focus-visible {
  outline: 2px solid var(--ks-amber);
  outline-offset: 2px;
}

.ks-episode-tab-rename {
  width: 100px;
  padding: 4px 10px;
  font-family: var(--ks-font-cn);
  font-size: 12px;
  font-weight: 500;
  color: var(--ks-text);
  background: var(--ks-surface);
  border: 1px solid var(--ks-amber);
  border-radius: var(--ks-radius-pill);
  outline: none;
  box-shadow: 0 0 0 2px rgba(255, 123, 61, 0.2);
}

.ks-episode-tab-add {
  all: unset;
  flex-shrink: 0;
  padding: 5px 12px;
  font-family: var(--ks-font-cn);
  font-size: 12px;
  color: var(--ks-text-muted);
  border-radius: var(--ks-radius-pill);
  border: 1px dashed var(--ks-border);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--ks-dur-fast) var(--ks-ease),
    border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-episode-tab-add:hover {
  color: var(--ks-amber);
  border-color: var(--ks-amber);
}
.ks-episode-tab-add:focus-visible {
  outline: 2px solid var(--ks-amber);
  outline-offset: 2px;
}

.ks-episode-tab-new-input {
  flex-shrink: 0;
}
`
injectStyleOnce('episode-tabs', css)
