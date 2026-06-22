import { useState } from 'react'
import { useAssetStore, type AssetRecord } from '../media/assetStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * 资产库 —— 当前场景的"历史生成 / 拖入"全部图像，永远落在 .reel-assets/ 磁盘上。
 *
 * 触发方式：StagePane 画布右下角浮动按钮 "📚 N 张"
 *
 * 行为：
 *   - 抽屉式从下方升起，按时间倒序展示所有该 sceneId 下的图像
 *   - 单击缩略图 → 把这张切换为当前显示（写入 sceneImageCache.put）
 *   - 删除按钮 → DELETE 接口同时清磁盘 blob + manifest 条目
 *   - 当前正在显示的那张会高亮
 *
 * 安全：
 *   - 所有写操作都走 dev server middleware，仅本机访问
 *   - 删除是不可逆的（不进回收站）—— 故意做得显眼一点，避免误删
 */

interface Props {
  sceneId: string
  scenarioId?: string
}

export function AssetLibrary({ sceneId, scenarioId }: Props) {
  const [open, setOpen] = useState(false)
  const records = useAssetStore((s) => s.records)
  const urlOf = useAssetStore((s) => s.urlOf)
  const remove = useAssetStore((s) => s.remove)
  const loaded = useAssetStore((s) => s.loaded)
  const error = useAssetStore((s) => s.error)
  const putCache = useSceneImageCache((s) => s.put)
  const currentRecord = useSceneImageCache((s) => s.records[sceneId])
  const currentAssetId =
    currentRecord?.status === 'ready' ? currentRecord.assetId : undefined

  const list = records
    .filter(
      (r) =>
        r.kind === 'image' &&
        r.meta.sceneId === sceneId &&
        (scenarioId ? r.meta.scenarioId === scenarioId : true),
    )
    .sort((a, b) => b.createdAt - a.createdAt)

  function pick(asset: AssetRecord): void {
    putCache(sceneId, urlOf(asset.id), asset.meta.prompt ?? '', asset.id)
  }

  async function onDelete(asset: AssetRecord, e: React.MouseEvent): Promise<void> {
    e.stopPropagation()
    const ok = window.confirm(
      `从磁盘永久删除这张？\n${asset.meta.prompt?.slice(0, 80) ?? '(无提示词)'}`,
    )
    if (!ok) return
    await remove(asset.id)
    // 如果删的是当前显示，清 cache 让 StagePane 自动找下一张历史
    if (currentAssetId === asset.id) {
      useSceneImageCache.setState((s) => {
        const { [sceneId]: _omit, ...rest } = s.records
        return { records: rest }
      })
    }
  }

  return (
    <>
      <button
        type="button"
        className="ks-al-fab ks-mono"
        onClick={() => setOpen((v) => !v)}
        title={
          loaded
            ? `${list.length} 张历史 · 永久存储于 .reel-assets/`
            : '正在加载磁盘资产…'
        }
      >
        ▤ {list.length}
      </button>

      {open && (
        <div
          className="ks-al-panel"
          role="dialog"
          aria-label="资产库"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="ks-al-head">
            <span className="ks-al-title ks-mono">SCENE ASSET LIBRARY</span>
            <span className="ks-al-sub ks-cn">
              · {list.length} 张 · 全部已落盘到 .reel-assets/
            </span>
            <span className="ks-al-spacer" />
            <button
              type="button"
              className="ks-al-x"
              onClick={() => setOpen(false)}
              aria-label="关闭"
            >
              ✕
            </button>
          </header>

          {error && (
            <div className="ks-al-err ks-mono">磁盘后端不可达：{error}</div>
          )}

          {list.length === 0 && !error ? (
            <div className="ks-al-empty ks-cn">
              这个场景暂无历史。生成或拖入第一张图后，会自动出现在这里并永久保存。
            </div>
          ) : (
            <ul className="ks-al-grid">
              {list.map((a) => {
                const isCurrent = currentAssetId === a.id
                return (
                  <li
                    key={a.id}
                    className={`ks-al-card ${isCurrent ? 'is-current' : ''}`}
                    onClick={() => pick(a)}
                    title={a.meta.prompt ?? a.id}
                  >
                    <img
                      className="ks-al-thumb"
                      src={urlOf(a.id)}
                      alt={a.id}
                      draggable={false}
                    />
                    <div className="ks-al-meta">
                      <span className="ks-al-time ks-mono">
                        {fmtTime(a.createdAt)}
                      </span>
                      <span className="ks-al-tag ks-mono">
                        {a.meta.promptKind ?? a.kind} ·{' '}
                        {fmtBytes(a.bytes)}
                      </span>
                      {a.meta.model && (
                        <span className="ks-al-model ks-mono">
                          {a.meta.model}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="ks-al-del"
                      onClick={(e) => void onDelete(a, e)}
                      title="从磁盘永久删除"
                    >
                      ✕
                    </button>
                    {isCurrent && (
                      <span className="ks-al-badge ks-mono">CURRENT</span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}K`
  return `${(n / 1024 / 1024).toFixed(1)}M`
}

const css = `
.ks-al-fab {
  position: absolute;
  right: 12px;
  top: 12px;
  z-index: 6;
  padding: 6px 14px;
  font-family: var(--ks-font-ui);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: var(--ks-glass-blur);
  -webkit-backdrop-filter: var(--ks-glass-blur);
  border: 1px solid rgba(108, 143, 184, 0.4);
  color: var(--ks-cyan);
  border-radius: var(--ks-radius-pill);
  cursor: pointer;
  box-shadow: var(--ks-shadow-soft);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-al-fab:hover {
  background: #fff;
  border-color: var(--ks-cyan);
  box-shadow: var(--ks-shadow-hover);
  transform: translateY(-1px);
}

.ks-al-panel {
  position: absolute;
  left: 12px; right: 12px; bottom: 12px;
  z-index: 7;
  max-height: 62%;
  display: flex; flex-direction: column;
  background: var(--ks-surface-glass);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-xl);
  box-shadow: var(--ks-shadow-lift);
  overflow: hidden;
}
.ks-al-head {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--ks-border-soft);
}
.ks-al-title {
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.28em;
  color: var(--ks-amber);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-al-sub {
  font-size: 12.5px;
  color: var(--ks-text-dim);
}
.ks-al-spacer { flex: 1; }
.ks-al-x {
  all: unset;
  cursor: pointer;
  width: 28px; height: 28px;
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--ks-text-soft);
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: 50%;
  font-size: 13px;
  transition: all var(--ks-dur-fast);
}
.ks-al-x:hover {
  color: var(--ks-rose);
  border-color: rgba(240, 119, 157, 0.45);
  background: rgba(240, 119, 157, 0.08);
}
.ks-al-empty {
  padding: 36px 24px;
  color: var(--ks-text-dim);
  font-size: 13.5px;
  text-align: center;
}
.ks-al-err {
  padding: 12px 18px;
  font-size: 12px;
  color: #b1335a;
  background: rgba(240, 119, 157, 0.08);
  border-bottom: 1px solid rgba(240, 119, 157, 0.3);
}
.ks-al-grid {
  list-style: none;
  margin: 0;
  padding: 14px 16px 18px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  overflow-y: auto;
}
.ks-al-card {
  position: relative;
  display: flex; flex-direction: column;
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  overflow: hidden;
  cursor: pointer;
  box-shadow: var(--ks-shadow-soft);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-al-card:hover {
  border-color: var(--ks-cyan);
  transform: translateY(-2px);
  box-shadow: var(--ks-shadow-hover);
}
.ks-al-card.is-current {
  border-color: var(--ks-amber);
  box-shadow:
    0 0 0 3px var(--ks-amber-soft),
    var(--ks-shadow-hover);
}
.ks-al-thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
  background: var(--ks-surface-warm);
}
.ks-al-meta {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px;
  font-family: var(--ks-font-mono);
  font-size: 10px;
  color: var(--ks-text-dim);
  letter-spacing: 0.02em;
}
.ks-al-time { color: var(--ks-text-soft); }
.ks-al-tag { color: var(--ks-cyan); font-weight: 600; }
.ks-al-model { color: var(--ks-mint); font-size: 9.5px; font-weight: 600; }
.ks-al-del {
  position: absolute;
  top: 6px; right: 6px;
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: var(--ks-glass-blur);
  -webkit-backdrop-filter: var(--ks-glass-blur);
  border: 1px solid var(--ks-border);
  border-radius: 50%;
  color: var(--ks-text-soft);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, all var(--ks-dur-fast);
  box-shadow: var(--ks-shadow-soft);
}
.ks-al-card:hover .ks-al-del { opacity: 1; }
.ks-al-del:hover {
  color: var(--ks-rose);
  border-color: rgba(240, 119, 157, 0.5);
  background: rgba(240, 119, 157, 0.08);
}
.ks-al-badge {
  position: absolute;
  top: 8px; left: 8px;
  padding: 3px 10px;
  font-family: var(--ks-font-ui);
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.14em;
  background: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
  border-radius: var(--ks-radius-pill);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--ks-amber) 40%, transparent);
}
`
injectStyleOnce('asset-library', css)
