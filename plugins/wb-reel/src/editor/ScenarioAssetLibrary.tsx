import { useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { injectStyleOnce } from '../styles/injectStyle'
import { SceneAssetGallery } from './SceneAssetGallery'
import { MultiVersionStrip } from './MultiVersionStrip'
import { collectScenarioAssets, type AssetRef } from './collectScenarioAssets'
import {
  DOCK_MIME,
  serializeDockPayload,
  type DockDropPayload,
} from './timeline/dndTypes'

/**
 * ScenarioAssetLibrary —— 资产面板底部"素材库"区块（v3.9.4 新增）。
 *
 * 作者需求（v3.9.4）：
 *   "我在这个剧本中生成的、上传的图像和视频历史，要在当前的素材库中能看到。
 *    并且，我清空时间轴的时候，不清空这里，现在是一起清空的。"
 *
 * 两档视野（"本场景" / "本剧本"）× 两档类型（图 / 视频）。
 *   - 视野通过顶部 pill 切换（ScopeToggle）
 *   - 类型通过下方段切换（KindToggle）
 *   - 本场景视野：直接复用 SceneAssetGallery，既有能力（上传 / 排序 / 删除 /
 *     拖入时间轴）原封保留
 *   - 本剧本视野：只读平铺（按场景分组），每个条目仍然可拖入时间轴，但不提
 *     供"在这个场景里删"入口（作者想删要去到对应 scene 的"本场景"视图里删）
 *
 * 与 PromptTabs 的关系：
 *   - PromptTabs 只管"提示词 + 生成动作"（v3.9.4 已精简）
 *   - 素材库作为 panel 一级分区独立挂在 PromptTabs 下方（见
 *     StagePromptFloater）
 *
 * 数据来源：
 *   scenario.scenes[*].sceneImages / sceneVideos —— 已经是"作者上传/生成过
 *   的历史素材"的单源；mediaStore 存实体。
 */
export function ScenarioAssetLibrary() {
  const scenario = useScenarioStore((s) => s.scenario)
  const selectedSceneId = useScenarioStore((s) => s.selectedSceneId)
  const scene = scenario.scenes[selectedSceneId]

  const [scope, setScope] = useState<'scene' | 'scenario' | 'by-shot'>('scene')
  const [kind, setKind] = useState<'image' | 'video'>('image')

  if (!scene) return null

  return (
    <section className="ks-asset-lib" aria-label="素材库">
      <header className="ks-asset-lib-head">
        <span className="ks-mono ks-asset-lib-title">素材库 · ASSETS</span>
        <ScopeToggle scope={scope} onChange={setScope} />
      </header>
      {/* by-shot 视图天然只看图像（视频不按 shot 归属），不展示 kind 切换 */}
      {scope !== 'by-shot' && <KindToggle kind={kind} onChange={setKind} />}

      {scope === 'scene' ? (
        <SceneAssetGallery
          sceneId={scene.id}
          kind={kind}
          ids={kind === 'image' ? scene.sceneImages ?? [] : scene.sceneVideos ?? []}
        />
      ) : scope === 'scenario' ? (
        <ScenarioWideList kind={kind} />
      ) : (
        <MultiVersionStrip sceneId={scene.id} variant="panel" />
      )}
    </section>
  )
}

/**
 * 视野切换 —— 本场景 / 本剧本。
 * 用药丸切换保持和 PromptTabs tab bar 视觉同族。
 */
function ScopeToggle({
  scope,
  onChange,
}: {
  scope: 'scene' | 'scenario' | 'by-shot'
  onChange: (next: 'scene' | 'scenario' | 'by-shot') => void
}) {
  return (
    <div className="ks-asset-lib-scope" role="tablist" aria-label="素材库视野">
      <button
        type="button"
        role="tab"
        aria-selected={scope === 'scene'}
        className={`ks-asset-lib-scope-btn ${scope === 'scene' ? 'is-active' : ''}`}
        onClick={() => onChange('scene')}
        title="只看当前场景上传/生成过的素材"
      >
        本场景
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={scope === 'by-shot'}
        className={`ks-asset-lib-scope-btn ${scope === 'by-shot' ? 'is-active' : ''}`}
        onClick={() => onChange('by-shot')}
        title="按分镜分组展示，含每个 shot 的所有历史版本（v6）"
      >
        按分镜
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={scope === 'scenario'}
        className={`ks-asset-lib-scope-btn ${scope === 'scenario' ? 'is-active' : ''}`}
        onClick={() => onChange('scenario')}
        title="查看整本剧本的历史素材（其他场景的也能拖回来用）"
      >
        本剧本
      </button>
    </div>
  )
}

function KindToggle({
  kind,
  onChange,
}: {
  kind: 'image' | 'video'
  onChange: (next: 'image' | 'video') => void
}) {
  return (
    <div className="ks-asset-lib-kind" role="tablist" aria-label="素材类型">
      <button
        type="button"
        role="tab"
        aria-selected={kind === 'image'}
        className={`ks-asset-lib-kind-btn ${kind === 'image' ? 'is-active' : ''}`}
        onClick={() => onChange('image')}
      >
        图像
        <span className="ks-mono ks-asset-lib-kind-sub">IMAGE</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={kind === 'video'}
        className={`ks-asset-lib-kind-btn ${kind === 'video' ? 'is-active' : ''}`}
        onClick={() => onChange('video')}
      >
        视频
        <span className="ks-mono ks-asset-lib-kind-sub">VIDEO</span>
      </button>
    </div>
  )
}

/**
 * ScenarioWideList —— "本剧本"视野：跨场景平铺，按 scene 分组展示。
 *
 * 只读视图：不提供删除 / 排序 / 上传入口（要操作某个 scene 的素材，
 * 切回"本场景"视野最直观）。但每个条目依然可拖 —— 这样作者可以把
 * 之前场景生成的图/视频拖到当前时间轴复用，这正是作者的需求核心。
 *
 * 注：v3.10 起，"按分镜"档已经迁出到独立组件 MultiVersionStrip，
 * 并被 SceneDetailDrawer 直接复用。本文件不再维护那段渲染逻辑。
 */
function ScenarioWideList({ kind }: { kind: 'image' | 'video' }) {
  const scenario = useScenarioStore((s) => s.scenario)
  const entries = useMediaStore((s) => s.entries)
  const assets = useMemo(() => collectScenarioAssets(scenario), [scenario])
  const list = kind === 'image' ? assets.images : assets.videos

  if (list.length === 0) {
    return (
      <div className="ks-asset-lib-empty ks-mono ks-faint">
        ◇ 本剧本还没有{kind === 'image' ? '图像' : '视频'}素材
      </div>
    )
  }

  // 按 sceneId 分组保持输入顺序（collectScenarioAssets 已按 pos.y 排好序）
  const groups: { sceneId: string; items: AssetRef[] }[] = []
  for (const item of list) {
    const last = groups[groups.length - 1]
    if (last && last.sceneId === item.sceneId) last.items.push(item)
    else groups.push({ sceneId: item.sceneId, items: [item] })
  }

  return (
    <div className="ks-asset-lib-wide">
      {groups.map(({ sceneId, items }) => {
        const scene = scenario.scenes[sceneId]
        const label = scene?.title ?? sceneId
        return (
          <div key={sceneId} className="ks-asset-lib-group">
            <div className="ks-asset-lib-group-head">
              <span className="ks-asset-lib-group-title">{label}</span>
              <span className="ks-mono ks-faint ks-asset-lib-group-sub">
                {sceneId} · {items.length}
              </span>
            </div>
            <ul className="ks-asset-lib-group-list">
              {items.map(({ mediaId }) => {
                const entry = entries[mediaId]
                const payload: DockDropPayload =
                  kind === 'image'
                    ? { kind: 'image', mediaId, label: entry?.name ?? mediaId }
                    : { kind: 'video', mediaId, label: entry?.name ?? mediaId }
                return (
                  <li
                    key={mediaId}
                    className={`ks-asset-lib-item ${entry ? '' : 'is-missing'}`}
                    draggable={!!entry}
                    onDragStart={(e) => {
                      if (!entry) return
                      e.dataTransfer.effectAllowed = 'copy'
                      e.dataTransfer.setData(
                        DOCK_MIME,
                        serializeDockPayload(payload),
                      )
                    }}
                    title={
                      entry
                        ? `${entry.name} · 拖入时间轴${kind === 'image' ? '创建新分镜' : '覆盖场景视频'}`
                        : 'ref missing'
                    }
                  >
                    {!entry ? (
                      <div className="ks-asset-lib-thumb is-missing-thumb">⚠</div>
                    ) : kind === 'image' ? (
                      <img
                        className="ks-asset-lib-thumb"
                        src={entry.url}
                        alt={entry.name}
                        draggable={false}
                      />
                    ) : (
                      <video
                        className="ks-asset-lib-thumb"
                        src={entry.url}
                        muted
                        playsInline
                        preload="metadata"
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

const css = `
.ks-asset-lib {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-solid);
}
.ks-asset-lib-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px;
}
.ks-asset-lib-title {
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--ks-amber);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-asset-lib-scope {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  box-shadow: var(--ks-shadow-inset-hi);
}
.ks-asset-lib-scope-btn {
  all: unset;
  cursor: pointer;
  font-family: var(--ks-font-ui);
  font-size: 11px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: var(--ks-radius-pill);
  color: var(--ks-text-soft);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-asset-lib-scope-btn:hover { color: var(--ks-text); }
.ks-asset-lib-scope-btn.is-active {
  background: #fff;
  color: var(--ks-amber);
  box-shadow: 0 1px 2px rgba(28, 22, 15, 0.05);
}

.ks-asset-lib-kind {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 2px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-elev);
}
.ks-asset-lib-kind-btn {
  all: unset;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: var(--ks-radius-sm);
  color: var(--ks-text-soft);
  font-size: 11.5px;
  font-weight: 500;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-asset-lib-kind-btn:hover { color: var(--ks-text); background: rgba(28, 22, 15, 0.04); }
.ks-asset-lib-kind-btn.is-active {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
}
.ks-asset-lib-kind-sub {
  font-family: var(--ks-font-mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  opacity: 0.75;
}

.ks-asset-lib-empty {
  padding: 12px 4px;
  font-size: 11px;
  text-align: center;
}

/* ── 本剧本视野：跨场景平铺 ─────────────────────────── */
.ks-asset-lib-wide {
  display: flex;
  flex-direction: column;
  gap: 10px;
  /*
   * v3.9.8 · 移除原来硬编码的 max-height:300 + overflow:auto。
   *   外层（StagePromptFloater 的 .ks-prompt-panel-assets-dock）现在是
   *   flex-basis:360 的固定高度滚动容器，子内容直接撑开就行；再加内层
   *   max-height 会出现"嵌套滚动条"+"内容被截在 300 高度内"双重问题。
   */
  padding-right: 2px;
}
.ks-asset-lib-group-head {
  display: flex; align-items: baseline; gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid var(--ks-border-soft);
  margin-bottom: 6px;
}
.ks-asset-lib-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ks-text);
}
.ks-asset-lib-group-sub {
  font-size: 9.5px;
  letter-spacing: 0.08em;
}
.ks-asset-lib-group-list {
  all: unset;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 6px;
}
.ks-asset-lib-item {
  display: block;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-elev);
  cursor: grab;
  overflow: hidden;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-asset-lib-item:hover {
  border-color: var(--ks-amber);
  box-shadow: var(--ks-shadow-soft);
}
.ks-asset-lib-item:active { cursor: grabbing; }
.ks-asset-lib-item.is-missing { opacity: 0.45; cursor: not-allowed; }
.ks-asset-lib-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
  background: var(--ks-panel-solid);
  pointer-events: none;
}
.ks-asset-lib-thumb.is-missing-thumb {
  display: flex; align-items: center; justify-content: center;
  color: var(--ks-rose);
  font-size: 18px;
}

/* v6（P3-D）· 按分镜视图 —— 每组是一行版本链 */
.ks-asset-lib-byshot {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ks-asset-lib-version-item {
  position: relative;
  cursor: pointer;
}
.ks-asset-lib-version-item.is-current {
  outline: 2px solid var(--ks-accent, #6cf);
  outline-offset: -1px;
  cursor: default;
}
.ks-asset-lib-version-item:hover {
  filter: brightness(1.05);
}
.ks-asset-lib-version-tag {
  position: absolute;
  left: 3px;
  bottom: 3px;
  font-size: 9.5px;
  padding: 1px 4px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border-radius: 3px;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  pointer-events: none;
}
.ks-asset-lib-version-current {
  position: absolute;
  right: 3px;
  top: 3px;
  font-size: 10.5px;
  color: var(--ks-accent, #6cf);
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}
`
injectStyleOnce('scenario-asset-library', css)
