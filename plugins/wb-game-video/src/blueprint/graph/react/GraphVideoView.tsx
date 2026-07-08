/**
 * GraphVideoView —— 新引擎「视频」库，样式对齐旧视频 tab（CatalogShell：左栏列表 + 右栏预览）。
 * 数据 = 两部分合并：① 该 game 的资产清单视频（/__reel__/assets?kind=video，narr-* 叙事段，
 * 与蓝图演出节点「视频」下拉同源）；② 旧内置视频库 VIDEO_CLIPS（战斗片段，直接带 url）。
 */
import { useEffect, useMemo, useState } from 'react'
import { CatalogShell } from '../../../forge/CatalogTabs'
import { VIDEO_CLIPS } from '../../../scenario/gameAssetCatalog'
import { listVideoAssetInfos, resolveMediaSrc, type VideoAssetInfo } from './media'

function fmtMB(bytes?: number): string {
  return typeof bytes === 'number' ? `${(bytes / 1e6).toFixed(1)} MB` : ''
}

interface VideoEntry {
  id: string
  label: string
  src: string
  sub: string
  group: string
}

export function GraphVideoView(): JSX.Element {
  const game = useMemo(() => new URLSearchParams(location.search).get('game') ?? 'game-nodia-fighting', [])
  const [assets, setAssets] = useState<VideoAssetInfo[]>([])
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    let alive = true
    void listVideoAssetInfos(game).then((vs) => { if (alive) setAssets(vs) })
    return () => { alive = false }
  }, [game])

  const entries = useMemo<VideoEntry[]>(() => {
    const clips: VideoEntry[] = VIDEO_CLIPS.map((c) => ({ id: c.id, label: c.label, src: c.url, sub: `${Math.round((c.durMs ?? 0) / 1000)}s · ${c.type ?? 'video'}`, group: '战斗' }))
    const narr: VideoEntry[] = assets.map((v) => ({ id: v.id, label: v.id, src: resolveMediaSrc(v.id, game) ?? '', sub: fmtMB(v.bytes), group: '叙事' }))
    return [...clips, ...narr]
  }, [assets, game])

  useEffect(() => {
    setSelected((cur) => cur || entries[0]?.id || '')
  }, [entries])

  const cur = entries.find((e) => e.id === selected)
  const src = cur?.src

  return (
    <CatalogShell
      icon="🎥"
      title="视频素材"
      items={entries.map((e) => ({ id: e.id, label: `${e.group} · ${e.label}` }))}
      selectedId={selected}
      onSelect={setSelected}
      renderPreview={() => (
        <div className="gc-stage gc-stage-video">
          <div className="gc-video-head">
            <div>
              <div className="gc-video-title">{cur?.label ?? '视频预览'}</div>
              <div className="gc-video-sub">{cur ? `${cur.group} · ${cur.sub}` : `${entries.length} 条（战斗 ${VIDEO_CLIPS.length} + 叙事 ${assets.length}）`}</div>
            </div>
          </div>
          <div className="gc-frame" data-type="video">
            <span className="gc-badge">🎥 <em>{cur?.group ?? '视频'}</em></span>
            {src ? (
              <video key={selected} className="gc-video" src={src} controls autoPlay muted playsInline />
            ) : (
              <div style={{ color: 'var(--gc-faint, #8c8377)', fontSize: 13 }}>选择左侧视频预览</div>
            )}
          </div>
        </div>
      )}
    />
  )
}
