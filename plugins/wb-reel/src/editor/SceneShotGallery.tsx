import { useEffect, useMemo, useRef, useState } from 'react'
import { useMediaStore } from '../media/mediaStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { injectStyleOnce } from '../styles/injectStyle'
import { DOCK_MIME, serializeDockPayload, type DockDropPayload } from './timeline/dndTypes'

const FRAMING_LABEL: Record<string, string> = {
  wide: '远景',
  medium: '中景',
  close: '近景',
  insert: '插入',
  ots: '过肩',
  pov: '主观',
}

/**
 * SceneShotGallery —— 右侧「正式素材」的「分镜」页签：按镜头管理智能体生成的关键帧。
 *
 * 背景（2026-06-20 作者反馈）：
 *   智能体在对话里生成的分镜关键帧，之前被 AssetCard 的 frameChoices 一股脑塞进
 *   视频卡（不可清理、占位巨大）。改为：关键帧不进卡，落在这里按镜头(镜1/镜2…)管理。
 *
 * 数据来源：scene.shots[]
 *   - keyframeStrategy='ab' → 首帧 startFrameMediaRef(A) + 尾帧 endFrameMediaRef(B)
 *   - 否则 → 单帧 keyframeMediaRef
 *
 * 每张关键帧 draggable（DOCK_MIME image payload），可拖进：
 *   时间轴新分镜 / 视频卡的首帧·尾帧·全能参考槽位。
 */
export function SceneShotGallery({
  sceneId,
  focusShotId = null,
  focusTick = 0,
}: {
  sceneId: string
  /** 时间轴右键「在素材库查看」跳来时要高亮 / 滚动到的镜头 id */
  focusShotId?: string | null
  /** 单调递增；变化时即使 focusShotId 不变也重新滚动高亮 */
  focusTick?: number
}) {
  const shots = useScenarioStore((s) => s.scenario.scenes[sceneId]?.shots)
  const entries = useMediaStore((s) => s.entries)

  // 高亮聚焦镜头：滚动到位 + 短暂描边脉冲。tick 变化即重放（同一镜连点也生效）。
  const shotRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [pulseId, setPulseId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusShotId) return
    const el = shotRefs.current[focusShotId]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPulseId(focusShotId)
    const t = window.setTimeout(() => setPulseId(null), 1600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick, focusShotId])

  // 把每个镜头摊平成"可拖的关键帧条目"：单帧 1 条 / AB 帧 2 条。
  const rows = useMemo(() => {
    const list = (shots ?? []).slice().sort((a, b) => a.order - b.order)
    return list.map((sh, i) => {
      const idx = i + 1
      const framing = FRAMING_LABEL[sh.framing] ?? sh.framing
      const frames: { mediaId?: string; tag: string }[] =
        sh.keyframeStrategy === 'ab'
          ? [
              { mediaId: sh.startFrameMediaRef, tag: '首' },
              { mediaId: sh.endFrameMediaRef, tag: '尾' },
            ]
          : [{ mediaId: sh.keyframeMediaRef, tag: '' }]
      return { id: sh.id, idx, framing, prompt: sh.prompt, frames }
    })
  }, [shots])

  const total = rows.reduce((n, r) => n + r.frames.filter((f) => f.mediaId).length, 0)

  if (rows.length === 0) {
    return (
      <div className="ks-shotgal-empty ks-mono ks-faint">
        ◇ 本节点暂无分镜 · 让 AI 生成分镜/关键帧后，这里按镜头(镜1/镜2…)管理
      </div>
    )
  }

  return (
    <div className="ks-shotgal">
      <div className="ks-shotgal-hint ks-mono">
        {rows.length} 镜 · {total} 关键帧 · 拖入时间轴 / 视频卡槽位
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          ref={(el) => {
            shotRefs.current[r.id] = el
          }}
          className={`ks-shotgal-shot ${pulseId === r.id ? 'is-focus-pulse' : ''}`}
        >
          <div className="ks-shotgal-shot-head">
            <span className="ks-shotgal-shot-no">镜{r.idx}</span>
            <span className="ks-shotgal-shot-framing">{r.framing}</span>
            {r.prompt ? (
              <span className="ks-shotgal-shot-prompt" title={r.prompt}>
                {r.prompt}
              </span>
            ) : null}
          </div>
          <div className="ks-shotgal-frames">
            {r.frames.map((f, fi) => {
              const url = f.mediaId ? entries[f.mediaId]?.url : undefined
              if (!f.mediaId || !url) {
                return (
                  <div key={fi} className="ks-shotgal-frame is-pending" title="该关键帧尚未生成">
                    <span className="ks-shotgal-frame-pending">待生成{f.tag ? ` · ${f.tag}帧` : ''}</span>
                  </div>
                )
              }
              const label = `镜${r.idx}${f.tag ? ` · ${f.tag}帧` : ''}`
              const payload: DockDropPayload = { kind: 'image', mediaId: f.mediaId, label }
              return (
                <div
                  key={fi}
                  className="ks-shotgal-frame"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData(DOCK_MIME, serializeDockPayload(payload))
                  }}
                  title={`${label} · 拖入时间轴 / 视频卡首帧·尾帧·全能参考`}
                >
                  <img src={url} alt={label} draggable={false} loading="lazy" />
                  {f.tag ? <span className="ks-shotgal-frame-tag">{f.tag}</span> : null}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

const css = `
.ks-shotgal { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.ks-shotgal-hint {
  font-size: 9px; letter-spacing: 0.1em; color: var(--ks-text-faint); padding: 0 2px;
}
.ks-shotgal-empty {
  font-size: 11px; letter-spacing: 0.02em; line-height: 1.6;
  padding: 14px 8px; text-align: center; color: var(--ks-text-faint);
}
.ks-shotgal-shot {
  display: flex; flex-direction: column; gap: 5px; min-width: 0;
  padding: 7px 8px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm, 6px);
  background: var(--ks-panel-solid);
  transition: border-color var(--ks-dur-fast) var(--ks-ease), box-shadow var(--ks-dur-fast) var(--ks-ease);
}
/* 从时间轴右键「在素材库查看」跳来时, 命中镜头卡的高亮脉冲 */
.ks-shotgal-shot.is-focus-pulse {
  border-color: var(--ks-amber, #d4ff48);
  box-shadow: 0 0 0 2px var(--ks-amber-soft, rgba(212,255,72,0.35)), 0 0 16px rgba(212,255,72,0.28);
  animation: ks-shotgal-focus 1.6s var(--ks-ease);
}
@keyframes ks-shotgal-focus {
  0% { box-shadow: 0 0 0 2px var(--ks-amber, #d4ff48), 0 0 26px rgba(212,255,72,0.6); }
  100% { box-shadow: 0 0 0 2px var(--ks-amber-soft, rgba(212,255,72,0.35)), 0 0 16px rgba(212,255,72,0.28); }
}
.ks-shotgal-shot-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ks-shotgal-shot-no {
  flex: 0 0 auto;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 11px; font-weight: 700; color: var(--ks-text);
}
.ks-shotgal-shot-framing {
  flex: 0 0 auto; font-size: 9px; line-height: 1;
  padding: 2px 6px; border-radius: 999px;
  color: var(--ks-text-soft); background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border-soft);
}
.ks-shotgal-shot-prompt {
  flex: 1; min-width: 0; font-size: 9.5px; color: var(--ks-text-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-shotgal-frames { display: flex; flex-wrap: wrap; gap: 6px; }
.ks-shotgal-frame {
  position: relative; flex: 0 0 auto;
  width: 76px; aspect-ratio: 16 / 9;
  border-radius: var(--ks-radius-sm, 5px); overflow: hidden;
  border: 1px solid var(--ks-border); background: var(--ks-panel-elev);
  cursor: grab;
  transition: border-color var(--ks-dur-fast) var(--ks-ease), box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-shotgal-frame:hover { border-color: var(--ks-amber); box-shadow: var(--ks-shadow-soft); }
.ks-shotgal-frame:active { cursor: grabbing; }
.ks-shotgal-frame img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.ks-shotgal-frame-tag {
  position: absolute; top: 2px; left: 2px;
  font-size: 8px; line-height: 1; padding: 2px 4px; border-radius: 4px;
  color: #15110a; background: var(--ks-amber, #d4ff48);
}
.ks-shotgal-frame.is-pending {
  cursor: default; border-style: dashed;
  display: flex; align-items: center; justify-content: center;
}
.ks-shotgal-frame-pending {
  font-size: 8.5px; color: var(--ks-text-faint); text-align: center; padding: 2px;
}
`
injectStyleOnce('scene-shot-gallery', css)
