import { useMemo } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { useAssetStore } from '../media/assetStore'
import { injectStyleOnce } from '../styles/injectStyle'
import {
  DOCK_MIME,
  serializeDockPayload,
  type DockDropPayload,
} from './timeline/dndTypes'

/**
 * MultiVersionStrip —— v3.10 抽出来的"按 shot 分组的候选图版本链"。
 *
 * 设计动因：
 *   作者反馈"节点详情抽屉里要能直接看到这一场的所有候选图"，不用再切去
 *   ScenarioAssetLibrary 的"按分镜"档。把原本嵌在 ScenarioAssetLibrary
 *   内的 SceneShotVersionGallery 提到独立组件，参数化外形（compact 横滚 vs
 *   panel 网格），方便至少两处使用：
 *     1. ScenarioAssetLibrary "按分镜"档（现状外观，panel 网格）
 *     2. SceneDetailDrawer 的 Stage 下方紧凑横滚（新加，作者点名要的）
 *     3. ForgeWizard 卡片悬浮（PR3 后续接入）
 *
 * 数据来源（与原实现一致，迁移而非重写）：
 *   useAssetStore().records 按
 *     `meta.sceneId === sceneId && meta.shotId !== undefined && kind === 'image'`
 *   过滤，再按 shotId 分桶，桶内按 createdAt 倒序得到"最新在前"的版本链。
 *
 * 交互：
 *   · 高亮"◆ 当前"——若 shot.keyframeMediaRef === asset.meta.mediaId
 *   · 点击非当前版本 → setSceneShotKeyframe 回滚 + primeMediaEntry 预灌
 *     mediaStore，让 StagePane / PromptTabs 立刻看到
 *   · 仍然 draggable=DOCK_MIME，可拖入时间轴（保留旧 muscle memory）
 *
 * 不做的事：
 *   · 不暴露删除入口 —— "删除"由 ScenarioAssetLibrary 的"本场景"档统管，
 *     避免每个使用点都要重做删除 UX
 *   · 不暴露上传入口 —— 同上
 *   · 不渲染 panel 外框 —— 由父容器决定（compact 嵌入 Stage 下方需要透明）
 */

export type MultiVersionStripVariant = 'compact' | 'panel'

interface Props {
  sceneId: string
  /** compact = 横向单行（drawer Stage 下方）；panel = 多组堆叠（ScenarioAssetLibrary） */
  variant?: MultiVersionStripVariant
  /** 空数据时的占位文本；不传则用默认文案 */
  emptyHint?: string
}

interface Bucket {
  assetId: string
  mediaId: string
  createdAt: number
  filename: string
  url: string
  mimeType: string
  bytes: number
}

interface Group {
  shotId: string
  order: number
  items: Bucket[]
}

/**
 * Hook 暴露：让有特殊渲染需求（e.g. ForgeWizard 卡片悬浮）的调用方
 * 直接拿到分组数据，自己定外形。复用查询逻辑，不复用渲染。
 */
export function useShotVersionGroups(sceneId: string): Group[] {
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const scenario = useScenarioStore((s) => s.scenario)
  const records = useAssetStore((s) => s.records)

  return useMemo<Group[]>(() => {
    if (!scene) return []
    const shotOrder = new Map<string, number>()
    for (const sh of scene.shots ?? []) shotOrder.set(sh.id, sh.order ?? 0)

    const real = new Map<string, Bucket[]>()
    for (const r of records) {
      if (r.kind !== 'image') continue
      if (r.meta.sceneId !== sceneId) continue
      if (r.meta.scenarioId !== scenario.id) continue
      if (!r.meta.shotId || !r.meta.mediaId) continue
      // shotOrder 不存在意味着该 shot 已被删 → 静悄悄过滤掉孤儿版本
      if (!shotOrder.has(r.meta.shotId)) continue
      const arr = real.get(r.meta.shotId) ?? []
      arr.push({
        assetId: r.id,
        mediaId: r.meta.mediaId,
        createdAt: r.createdAt,
        filename: r.filename,
        mimeType: r.mimeType,
        bytes: r.bytes,
        url: `/__reel__/assets/${r.id}`,
      })
      real.set(r.meta.shotId, arr)
    }

    const out: Group[] = []
    for (const [shotId, items] of real.entries()) {
      items.sort((a, b) => b.createdAt - a.createdAt)
      out.push({ shotId, order: shotOrder.get(shotId) ?? 0, items })
    }
    out.sort((a, b) => a.order - b.order)
    return out
  }, [scene, records, sceneId, scenario.id])
}

export function MultiVersionStrip({
  sceneId,
  variant = 'panel',
  emptyHint,
}: Props) {
  const scene = useScenarioStore((s) => s.scenario.scenes[sceneId])
  const setSceneShotKeyframe = useScenarioStore((s) => s.setSceneShotKeyframe)
  const entries = useMediaStore((s) => s.entries)
  const groups = useShotVersionGroups(sceneId)

  if (!scene) return null

  if (groups.length === 0) {
    // compact 模式空态做小一点，drawer 不喜欢一大块占位
    if (variant === 'compact') {
      return (
        <div
          className="ks-mvs ks-mvs-compact ks-mvs-empty ks-mono ks-faint"
          aria-label="候选图为空"
        >
          ◇ {emptyHint ?? '本场景还没有按分镜生成的候选图'}
        </div>
      )
    }
    return (
      <div className="ks-mvs ks-mvs-panel ks-mvs-empty ks-mono ks-faint">
        ◇ {emptyHint ?? '这个场景还没有「按分镜生成」的历史版本'}
        <div style={{ marginTop: 4, fontSize: 10.5 }}>
          提示：生成完若干分镜后，这里会按 Shot 分组列出历史版本，可随时回滚。
        </div>
      </div>
    )
  }

  return (
    <div className={`ks-mvs ks-mvs-${variant}`} aria-label="分镜候选图">
      {groups.map(({ shotId, order, items }) => {
        const shot = scene.shots?.find((s) => s.id === shotId)
        const currentMediaId = shot?.keyframeMediaRef
        return (
          <div key={shotId} className="ks-mvs-group">
            <div className="ks-mvs-group-head">
              <span className="ks-mvs-group-title">Shot {order + 1}</span>
              <span className="ks-mono ks-faint ks-mvs-group-sub">
                {/*
                 * compact 不显示 shotId（横向空间紧），只展示版本数。
                 * panel 模式保留全量信息（作者历史习惯）。
                 */}
                {variant === 'compact' ? `v${items.length}` : `${shotId} · v${items.length}`}
              </span>
            </div>
            <ul className="ks-mvs-list">
              {items.map((it, idx) => {
                const isCurrent = currentMediaId === it.mediaId
                const versionLabel = `v${items.length - idx}`
                const entry = entries[it.mediaId]
                const payload: DockDropPayload = {
                  kind: 'image',
                  mediaId: it.mediaId,
                  label: entry?.name ?? it.filename,
                }
                return (
                  <li
                    key={it.assetId}
                    className={`ks-mvs-item ${isCurrent ? 'is-current' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'copy'
                      e.dataTransfer.setData(
                        DOCK_MIME,
                        serializeDockPayload(payload),
                      )
                    }}
                    onClick={() => {
                      if (isCurrent) return
                      // primeMediaEntry：mediaStore 立刻获得此 id 的 url，避免 StagePane 渲染空白后再 hydrate 闪一下
                      void import('../media/mediaStore').then(
                        ({ primeMediaEntry }) => {
                          primeMediaEntry({
                            id: it.mediaId,
                            name: it.filename,
                            mimeType: it.mimeType,
                            size: it.bytes,
                            url: it.url,
                            createdAt: it.createdAt,
                            persistState: 'saved',
                          })
                        },
                      )
                      setSceneShotKeyframe(sceneId, shotId, it.mediaId)
                    }}
                    title={`${versionLabel} · ${new Date(
                      it.createdAt,
                    ).toLocaleString('zh-CN')}${
                      isCurrent ? ' · 当前版本' : ' · 点击回滚到此版本'
                    }`}
                  >
                    <img
                      className="ks-mvs-thumb"
                      src={it.url}
                      alt={versionLabel}
                      draggable={false}
                    />
                    <span className="ks-mvs-tag">{versionLabel}</span>
                    {isCurrent && <span className="ks-mvs-current">◆</span>}
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
.ks-mvs {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ks-mvs-empty {
  padding: 10px 8px;
  font-size: 11px;
  text-align: center;
}
.ks-mvs-compact.ks-mvs-empty {
  padding: 6px 10px;
  text-align: left;
}

/* compact 模式：每组横向一行；多个 group 上下叠（紧凑） */
.ks-mvs-compact {
  gap: 6px;
}
.ks-mvs-compact .ks-mvs-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ks-mvs-compact .ks-mvs-group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 1px 0;
}
.ks-mvs-compact .ks-mvs-group-title {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ks-text);
}
.ks-mvs-compact .ks-mvs-group-sub {
  font-size: 9.5px;
  letter-spacing: 0.06em;
}
.ks-mvs-compact .ks-mvs-list {
  all: unset;
  list-style: none;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
  /* 横滚条做细，防止占走视觉空间 */
  scrollbar-width: thin;
}
.ks-mvs-compact .ks-mvs-item {
  flex: 0 0 auto;
  width: 84px;
}

/* panel 模式：与原 .ks-asset-lib-byshot 视觉一致，作为兼容层 */
.ks-mvs-panel .ks-mvs-group-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid var(--ks-border-soft);
  margin-bottom: 6px;
}
.ks-mvs-panel .ks-mvs-group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ks-text);
}
.ks-mvs-panel .ks-mvs-group-sub {
  font-size: 9.5px;
  letter-spacing: 0.08em;
}
.ks-mvs-panel .ks-mvs-list {
  all: unset;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 6px;
}

/* 通用 item 外观 —— compact / panel 共享 */
.ks-mvs-item {
  display: block;
  position: relative;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-elev);
  cursor: pointer;
  overflow: hidden;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-mvs-item:hover {
  border-color: var(--ks-amber);
  filter: brightness(1.05);
}
.ks-mvs-item:active { cursor: grabbing; }
.ks-mvs-item.is-current {
  outline: 2px solid var(--ks-accent, #6cf);
  outline-offset: -1px;
  cursor: default;
}
.ks-mvs-thumb {
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  display: block;
  background: var(--ks-panel-solid);
  pointer-events: none;
}
.ks-mvs-tag {
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
.ks-mvs-current {
  position: absolute;
  right: 3px;
  top: 3px;
  font-size: 10.5px;
  color: var(--ks-accent, #6cf);
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}
`
injectStyleOnce('multi-version-strip', css)
