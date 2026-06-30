import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useAssetStore } from '../media/assetStore'
import { useMediaStore } from '../media/mediaStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { AssetLightbox, type LightboxItem } from './AssetLightbox'
import {
  DOCK_MIME,
  serializeDockPayload,
  parseDockPayload,
  type DockDropPayload,
} from '../editor/timeline/dndTypes'
import type { Scenario, Scene } from '../scenario/types'
import { TTS_VOICE_PRESETS } from '../llm/TTSProvider'
import { AnchorPicker } from './AnchorPicker'
import type { SeedanceMode } from '../llm/seedanceContent'
import {
  SEEDANCE_RESOLUTION_CHOICES,
  SEEDANCE_RATIO_CHOICES,
  type SeedanceResolutionTier,
  type SeedanceRatio,
} from '../llm/seedanceResolution'
import {
  cardTag,
  collectSceneSpeakers,
  type AnchorRef,
  type CardSpec,
} from './assetCards'
import { jobForMedia, type GenJob } from './generationQueueStore'
import { GenRequestDialog } from './GenRequestDialog'

const EMPTY: string[] = []

/**
 * AssetCard —— 素材库「生成卡片」单元（图像 / 视频 / 音色 三态）。
 *
 * 图像卡：变体/锚点 + 候选条（采用·拖时间轴·→视频）+ 数量 + prompt + 生成。
 * 视频卡：多模态参考（锚点参考图 + 首/尾帧 + 运镜参考视频 + 氛围参考音频 + 生成音轨）
 *        + 时长 + 运镜 prompt；候选为可播放 <video>，可采用(写 sceneVideos)/拖时间轴。
 * 音色卡：说话人(角色已锚定音色) / 音色预设 + 语速 + 数量 + 台词文本 + 合成；
 *        候选为可播放 <audio>，可拖入时间轴 VO 轨 / 「设为该角色音色」。
 *
 * 受控组件：全部可编辑态由 AssetBoard 持有，便于批量「一键生成」。
 */
export function AssetCard(props: {
  spec: CardSpec
  sceneId: string
  scenarioId: string
  scenario: Scenario
  scene: Scene
  /** 折叠态：true=只显示紧凑头(标题+候选数+缩略预览),点头展开 */
  collapsed?: boolean
  /** 切换折叠/展开 */
  onToggleCollapse?: () => void
  prompt: string
  variantId?: string
  anchors: AnchorRef[]
  count: number
  startFrameMediaId?: string
  endFrameMediaId?: string
  durationSec: number
  refVideoMediaId?: string
  refAudioMediaId?: string
  /** 全能参考图（多模态参考模式）：用户自由拖入 / 选入的额外参考图 mediaId 列表 */
  refImageMediaIds?: string[]
  onRefImagesChange?: (ids: string[]) => void
  genAudio: boolean
  /** 视频生成模式（官方互斥）：frames=首尾帧 / reference=多模态参考 */
  videoMode?: SeedanceMode
  /** 视频分辨率档位（真字段 body.resolution） */
  resolution?: SeedanceResolutionTier
  /** 视频比例（真字段 body.ratio） */
  ratio?: SeedanceRatio
  speakerId?: string
  voiceType?: string
  speedRatio?: number
  busy: boolean
  stage?: string | null
  error?: string | null
  onPromptChange: (v: string) => void
  onVariantChange: (v: string | undefined) => void
  onAnchorsChange: (v: AnchorRef[]) => void
  onCountChange: (n: number) => void
  onStartFrameChange: (id: string | undefined) => void
  onEndFrameChange: (id: string | undefined) => void
  onDurationChange: (n: number) => void
  onRefVideoChange: (id: string | undefined) => void
  onRefAudioChange: (id: string | undefined) => void
  onGenAudioChange: (v: boolean) => void
  onVideoModeChange: (m: SeedanceMode) => void
  onResolutionChange: (r: SeedanceResolutionTier) => void
  onRatioChange: (r: SeedanceRatio) => void
  /** 3D 机位：是否已附加机位静帧软参考 */
  blockoutAttached?: boolean
  /** 3D 机位：已附加机位静帧的预览 url */
  blockoutStillUrl?: string
  /** 打开 3D 机位编辑器（绑定本卡） */
  onOpenBlockout?: () => void
  /** 移除已附加的机位静帧参考 */
  onClearBlockout?: () => void
  onSpeakerChange: (id: string | undefined, voiceType?: string) => void
  onVoiceTypeChange: (v: string) => void
  onSpeedChange: (n: number) => void
  onGenerate: () => void
  onSpawnVideo: (fromMediaId: string) => void
  onRemove?: () => void
}) {
  const {
    spec,
    sceneId,
    scenarioId,
    scenario,
    scene,
    prompt,
    variantId,
    anchors,
    count,
    startFrameMediaId,
    endFrameMediaId,
    durationSec,
    refVideoMediaId,
    refAudioMediaId,
    genAudio,
    speakerId,
    voiceType,
    speedRatio,
    busy,
    stage,
    error,
  } = props
  const isVideo = spec.mediaKind === 'video'
  const isAudio = spec.mediaKind === 'audio'
  // 视频生成模式：默认多模态参考（保证角色/场景/道具锚点可见可用）
  const videoMode: SeedanceMode = props.videoMode ?? 'reference'
  const videoResolution: SeedanceResolutionTier = props.resolution ?? '1080p'
  const videoRatio: SeedanceRatio = props.ratio ?? '16:9'

  const records = useAssetStore((s) => s.records)
  const urlOf = useAssetStore((s) => s.urlOf)
  const removeAsset = useAssetStore((s) => s.remove)
  const replaceAsset = useAssetStore((s) => s.replaceDataUrl)
  const entries = useMediaStore((s) => s.entries)
  const ingestDataUrl = useMediaStore((s) => s.ingestDataUrl)
  const replaceMediaUrl = useMediaStore((s) => s.replaceUrl)
  const addSceneImage = useScenarioStore((s) => s.addSceneImage)
  const addSceneVideo = useScenarioStore((s) => s.addSceneVideo)
  const removeSceneImage = useScenarioStore((s) => s.removeSceneImage)
  const removeSceneVideo = useScenarioStore((s) => s.removeSceneVideo)
  const setCharacterVoiceAnchor = useScenarioStore((s) => s.setCharacterVoiceAnchor)
  const sceneImages = useScenarioStore(
    (s) => s.scenario.scenes[sceneId]?.sceneImages ?? EMPTY,
  )
  const sceneVideos = useScenarioStore(
    (s) => s.scenario.scenes[sceneId]?.sceneVideos ?? EMPTY,
  )
  const [showEnd, setShowEnd] = useState(!!endFrameMediaId)
  const [showRefMore, setShowRefMore] = useState(false)
  /** 选图弹层目标槽位（点击「选图」时打开；从本节点图像素材里挑）；null = 关闭 */
  const [picker, setPicker] = useState<'start' | 'end' | 'omni' | null>(null)
  /** 当前正被拖拽悬停的槽位（高亮用） */
  const [dragSlot, setDragSlot] = useState<'start' | 'end' | 'omni' | null>(null)
  /** 本地上传：隐藏 file input + 当前上传目标槽位 */
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<'start' | 'end' | 'omni' | null>(null)
  /** audio 候选时长缓存（<audio> onLoadedMetadata 填）；拖入时间轴时取它 */
  const [audioDur, setAudioDur] = useState<Record<string, number>>({})
  /** 灯箱（点开候选放大看细节）当前索引；null = 关闭 */
  const [lightIdx, setLightIdx] = useState<number | null>(null)
  /** 「ⓘ 生成信息」当前查看的产物 mediaId；null = 关闭。就地弹 GenRequestDialog。 */
  const [infoMediaId, setInfoMediaId] = useState<string | null>(null)

  // 据 mediaId 反查「生成这条素材的那次请求」（内存活动队列 → localStorage 归档兜底）。
  // 查不到也给一个最小 job，让弹窗显示「未记录请求快照」而非无反馈。
  const infoJob: GenJob | null = useMemo(() => {
    if (!infoMediaId) return null
    return (
      jobForMedia(infoMediaId) ?? {
        id: `noreq-${infoMediaId}`,
        kind: isVideo ? 'video' : isAudio ? 'audio' : 'image',
        label: spec.title,
        status: 'done',
        attempts: 1,
        createdAt: Date.now(),
        run: async () => undefined,
      }
    )
  }, [infoMediaId, isVideo, isAudio, spec.title])

  const tag = cardTag(spec, variantId)

  const isAudioRec = (r: { mimeType?: string }): boolean =>
    (r.mimeType ?? '').startsWith('audio/')

  // 本卡候选（按 cardTag 归组）。audio 走 mime 识别（落盘后 kind 被服务端归一成 image）。
  const candidates = useMemo(() => {
    if (isAudio) {
      return records.filter(
        (r) =>
          r.meta.scenarioId === scenarioId &&
          r.meta.sceneId === sceneId &&
          r.meta.tags?.includes(tag) &&
          isAudioRec(r),
      )
    }
    return records.filter(
      (r) =>
        r.kind === (isVideo ? 'video' : 'image') &&
        !isAudioRec(r) &&
        r.meta.scenarioId === scenarioId &&
        r.meta.sceneId === sceneId &&
        r.meta.tags?.includes(tag),
    )
  }, [records, scenarioId, sceneId, tag, isVideo, isAudio])

  // 灯箱条目：本卡候选 → LightboxItem（图/视频/音频），顺序与候选条一致。
  const lightItems = useMemo<LightboxItem[]>(
    () =>
      candidates.map((r) => {
        const mid = r.meta.mediaId
        const url = (mid && entries[mid]?.url) || urlOf(r.id)
        const kind: 'image' | 'video' | 'audio' = isAudio ? 'audio' : isVideo ? 'video' : 'image'
        const adopted = mid ? (isVideo ? sceneVideos : sceneImages).includes(mid) : false
        return {
          id: r.id,
          mediaId: mid,
          url,
          kind,
          prompt: r.meta.prompt,
          model: r.meta.model,
          createdAt: r.createdAt,
          bytes: r.bytes,
          filename: r.meta.humanReadableName ?? r.filename,
          adopted,
        }
      }),
    [candidates, entries, urlOf, isAudio, isVideo, sceneImages, sceneVideos],
  )

  // 删除候选后条目变少：夹紧灯箱索引；空了就关。
  useEffect(() => {
    if (lightIdx === null) return
    if (lightItems.length === 0) setLightIdx(null)
    else if (lightIdx >= lightItems.length) setLightIdx(lightItems.length - 1)
  }, [lightItems.length, lightIdx])

  // 真正删除一条候选（落盘删 + 若已采用则取消采用引用）。无二次确认，调用方负责。
  const doDelete = useCallback(
    (it: { id: string; mediaId?: string }) => {
      if (it.mediaId) {
        if (isVideo) removeSceneVideo(sceneId, it.mediaId)
        else if (!isAudio) removeSceneImage(sceneId, it.mediaId)
      }
      void removeAsset(it.id)
    },
    [isVideo, isAudio, sceneId, removeSceneVideo, removeSceneImage, removeAsset],
  )

  // 候选条上的快捷删除（带二次确认）。
  const quickDelete = useCallback(
    (it: { id: string; mediaId?: string }) => {
      if (!window.confirm('删除这条候选？删除后不可恢复（若已采用，将一并从本场景移除）。')) return
      doDelete(it)
    },
    [doDelete],
  )

  // 灯箱里编辑完图像后保存：replace=就地覆盖原图（id/采用引用不变，同步刷新预览）；
  // new=另存为本卡新候选（走 mediaStore.ingestDataUrl，自动落盘 + 注入 scenarioId）。
  const handleSaveEdited = useCallback(
    async (it: LightboxItem, dataUrl: string, mode: 'replace' | 'new') => {
      if (mode === 'replace') {
        const updated = await replaceAsset(it.id, dataUrl)
        if (!updated) throw new Error('保存失败')
        if (it.mediaId) replaceMediaUrl(it.mediaId, dataUrl)
      } else {
        ingestDataUrl(dataUrl, {
          sceneId,
          promptKind: 'card',
          tags: [tag],
          humanReadableName: `${spec.title} · 编辑`,
          mimeType: 'image/png',
        })
      }
    },
    [replaceAsset, replaceMediaUrl, ingestDataUrl, sceneId, tag, spec.title],
  )

  // 视频卡首尾帧候选来源：本节点全部图像素材（任意卡的候选）
  const frameChoices = useMemo(() => {
    if (!isVideo) return []
    const seen = new Set<string>()
    const out: { mediaId: string; url: string }[] = []
    for (const r of records) {
      if (
        r.kind !== 'image' ||
        isAudioRec(r) ||
        r.meta.scenarioId !== scenarioId ||
        r.meta.sceneId !== sceneId
      )
        continue
      const mid = r.meta.mediaId
      if (!mid || seen.has(mid)) continue
      seen.add(mid)
      out.push({ mediaId: mid, url: entries[mid]?.url || urlOf(r.id) })
    }
    return out
  }, [isVideo, records, scenarioId, sceneId, entries, urlOf])

  // 视频卡运镜参考视频候选：本节点全部视频素材
  const refVideoChoices = useMemo(() => {
    if (!isVideo) return []
    const seen = new Set<string>()
    const out: { mediaId: string; url: string }[] = []
    for (const r of records) {
      if (r.kind !== 'video' || r.meta.scenarioId !== scenarioId || r.meta.sceneId !== sceneId)
        continue
      const mid = r.meta.mediaId
      if (!mid || seen.has(mid)) continue
      seen.add(mid)
      out.push({ mediaId: mid, url: entries[mid]?.url || urlOf(r.id) })
    }
    return out
  }, [isVideo, records, scenarioId, sceneId, entries, urlOf])

  // 视频卡氛围参考音频候选：本节点全部音频素材
  const refAudioChoices = useMemo(() => {
    if (!isVideo) return []
    const seen = new Set<string>()
    const out: { mediaId: string; name: string; url: string }[] = []
    for (const r of records) {
      if (!isAudioRec(r) || r.meta.scenarioId !== scenarioId || r.meta.sceneId !== sceneId)
        continue
      const mid = r.meta.mediaId
      if (!mid || seen.has(mid)) continue
      seen.add(mid)
      out.push({ mediaId: mid, name: r.meta.humanReadableName ?? r.filename, url: entries[mid]?.url || urlOf(r.id) })
    }
    return out
  }, [isVideo, records, scenarioId, sceneId, entries, urlOf])

  const speakers = useMemo(
    () => (isAudio ? collectSceneSpeakers(scene, scenario) : []),
    [isAudio, scene, scenario],
  )

  const accent =
    spec.kind === 'scene'
      ? 'scene'
      : spec.kind === 'character'
        ? 'char'
        : spec.kind === 'prop'
          ? 'prop'
          : isVideo
            ? 'video'
            : isAudio
              ? 'audio'
              : 'free'

  // 锚点选择器：自由卡总显示；视频卡仅「多模态参考」模式显示（官方互斥）。
  // 通用视频卡（spec.generic）不绑场景锚点 —— 全干净，参考图全靠用户上传/拖入。
  const showAnchorPicker =
    spec.kind === 'free' || (isVideo && !spec.generic && videoMode === 'reference')

  const headIcon = isVideo ? '🎬 ' : isAudio ? '🎙 ' : ''
  const startFrameUrl = startFrameMediaId ? entries[startFrameMediaId]?.url : undefined
  const endFrameUrl = endFrameMediaId ? entries[endFrameMediaId]?.url : undefined

  // 拖拽：接受应用内素材拖入（DOCK_MIME 的 image payload）或操作系统文件拖入（Files）。
  const hasImageDrag = (e: DragEvent): boolean =>
    Array.prototype.indexOf.call(e.dataTransfer.types, DOCK_MIME) !== -1
  const hasFileDrag = (e: DragEvent): boolean =>
    Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1
  const acceptsDrop = (e: DragEvent): boolean => hasImageDrag(e) || hasFileDrag(e)
  const readDropImageId = (e: DragEvent): string | undefined => {
    const raw = e.dataTransfer.getData(DOCK_MIME)
    const payload = raw ? parseDockPayload(raw) : null
    if (payload && payload.kind === 'image' && 'mediaId' in payload) return payload.mediaId
    return undefined
  }

  // 本地上传：读文件 → dataURL → ingestDataUrl（立即得到可用 url）→ 返回 mediaId。
  const uploadFiles = useCallback(
    async (files: FileList | null): Promise<string[]> => {
      if (!files || files.length === 0) return []
      const ids: string[] = []
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result))
          fr.onerror = () => reject(fr.error)
          fr.readAsDataURL(file)
        })
        ids.push(ingestDataUrl(dataUrl, { name: file.name, mimeType: file.type, sceneId }))
      }
      return ids
    },
    [ingestDataUrl, sceneId],
  )

  // 把上传/拖入的文件按目标槽位落地。
  const applyUploadedIds = useCallback(
    (target: 'start' | 'end' | 'omni', ids: string[]) => {
      if (ids.length === 0) return
      if (target === 'start') props.onStartFrameChange(ids[0])
      else if (target === 'end') props.onEndFrameChange(ids[0])
      else props.onRefImagesChange?.([...(props.refImageMediaIds ?? []), ...ids])
    },
    [props],
  )

  const openUpload = (target: 'start' | 'end' | 'omni'): void => {
    uploadTargetRef.current = target
    fileInputRef.current?.click()
  }

  const collapsed = !!props.collapsed
  const canToggle = !!props.onToggleCollapse
  // 折叠态缩略预览：取第一条候选的封面
  const firstCand = candidates[0]
  const firstThumbUrl = firstCand
    ? (firstCand.meta.mediaId && entries[firstCand.meta.mediaId]?.url) || urlOf(firstCand.id)
    : undefined

  return (
    <div
      data-asset-card={spec.id}
      className={`ks-card ks-card-${accent} ${busy ? 'is-busy' : ''} ${collapsed ? 'is-collapsed' : ''}`}
    >
      <header
        className={`ks-card-head ${canToggle ? 'is-toggle' : ''}`}
        onClick={canToggle ? props.onToggleCollapse : undefined}
        role={canToggle ? 'button' : undefined}
        tabIndex={canToggle ? 0 : undefined}
        onKeyDown={
          canToggle
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  props.onToggleCollapse?.()
                }
              }
            : undefined
        }
        title={canToggle ? (collapsed ? '点击展开' : '点击收起') : undefined}
      >
        {canToggle ? (
          <span className="ks-card-caret" aria-hidden>
            {collapsed ? '▸' : '▾'}
          </span>
        ) : null}
        {canToggle && collapsed ? (
          <span className="ks-card-opendot" aria-hidden title="点击展开" />
        ) : null}
        <span className="ks-card-title" title={spec.title}>
          {headIcon}
          {spec.title}
        </span>
        {candidates.length > 0 ? (
          <span className="ks-card-count-badge" title={`${candidates.length} 条候选`}>
            {candidates.length}
          </span>
        ) : null}
        {collapsed && firstThumbUrl ? (
          isVideo ? (
            <video className="ks-card-peek" src={firstThumbUrl} muted playsInline preload="metadata" />
          ) : isAudio ? null : (
            <img className="ks-card-peek" src={firstThumbUrl} alt="" draggable={false} />
          )
        ) : null}
        {!collapsed && spec.variants && spec.variants.length > 0 ? (
          <select
            className="ks-card-variant"
            value={variantId ?? ''}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => props.onVariantChange(e.target.value || undefined)}
            title="选择形态变体"
          >
            <option value="">主形象</option>
            {spec.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        ) : null}
        {props.onRemove ? (
          <button
            type="button"
            className="ks-card-x"
            title="删除这张卡"
            onClick={(e) => {
              e.stopPropagation()
              props.onRemove?.()
            }}
          >
            ✕
          </button>
        ) : null}
      </header>

      {collapsed ? null : (
        <>
      {/* 候选条 */}
      <div className="ks-card-strip">
        {candidates.length === 0 ? (
          <div className="ks-card-strip-empty">
            {busy
              ? stage || '生成中…'
              : isVideo
                ? '尚无视频 · 点「生成视频」'
                : isAudio
                  ? '尚无配音 · 点「合成」'
                  : '尚无候选 · 点「生成」'}
          </div>
        ) : (
          candidates.map((r, candIdx) => {
            const mediaId = r.meta.mediaId
            const url = (mediaId && entries[mediaId]?.url) || urlOf(r.id)

            if (isAudio) {
              const durMs = (mediaId && audioDur[mediaId]) || 3000
              const payload: DockDropPayload | null = mediaId
                ? { kind: 'audio', mediaId, role: 'vo', label: spec.title, durationMs: durMs }
                : null
              return (
                <div
                  key={r.id}
                  className="ks-card-aud"
                  draggable={!!payload}
                  onDragStart={(e) => {
                    if (!payload) return
                    e.dataTransfer.effectAllowed = 'copy'
                    e.dataTransfer.setData(DOCK_MIME, serializeDockPayload(payload))
                  }}
                  title="拖入时间轴 VO 轨 / 点「设为音色」锚定到角色"
                >
                  <audio
                    src={url}
                    controls
                    preload="metadata"
                    onLoadedMetadata={(e) => {
                      if (!mediaId) return
                      const d = (e.currentTarget as HTMLAudioElement).duration
                      if (Number.isFinite(d) && d > 0)
                        setAudioDur((m) => ({ ...m, [mediaId]: Math.round(d * 1000) }))
                    }}
                  />
                  {speakerId && mediaId && voiceType ? (
                    <button
                      type="button"
                      className="ks-card-adopt ks-card-adopt-voice"
                      title="把这段音色锚定到该角色（后续配音默认用它）"
                      onClick={() =>
                        setCharacterVoiceAnchor(speakerId, {
                          voiceType,
                          sampleMediaId: mediaId,
                          sampleText: prompt,
                          speedRatio,
                        })
                      }
                    >
                      设为音色
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ks-card-aud-del"
                    title="删除这条配音"
                    onClick={() => quickDelete({ id: r.id, mediaId })}
                  >
                    🗑
                  </button>
                </div>
              )
            }

            const adopted = mediaId
              ? (isVideo ? sceneVideos : sceneImages).includes(mediaId)
              : false
            const payload: DockDropPayload | null = mediaId
              ? isVideo
                ? { kind: 'video', mediaId, label: spec.title }
                : { kind: 'image', mediaId, label: spec.title }
              : null
            return (
              <div
                key={r.id}
                className={`ks-card-cand ${adopted ? 'is-adopted' : ''}`}
                draggable={!!payload}
                onDragStart={(e) => {
                  if (!payload) return
                  e.dataTransfer.effectAllowed = 'copy'
                  e.dataTransfer.setData(DOCK_MIME, serializeDockPayload(payload))
                }}
                onClick={() => setLightIdx(candIdx)}
                title={adopted ? '已是正式素材 · 点开看大图 / 拖入时间轴' : '点开看大图 · 拖入时间轴 / 点「采用」'}
              >
                {isVideo ? (
                  <video src={url} muted playsInline preload="metadata" loop
                    onMouseEnter={(e) => void (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
                    onMouseLeave={(e) => (e.currentTarget as HTMLVideoElement).pause()}
                  />
                ) : (
                  <img src={url} alt="" draggable={false} loading="lazy" />
                )}
                {/* 点开放大看细节 */}
                <button
                  type="button"
                  className="ks-card-zoom"
                  title="放大看细节"
                  onClick={(e) => {
                    e.stopPropagation()
                    setLightIdx(candIdx)
                  }}
                >
                  🔍
                </button>
                <button
                  type="button"
                  className="ks-card-del"
                  title={isVideo ? '删除这条视频候选' : '删除这条图像候选'}
                  onClick={(e) => {
                    e.stopPropagation()
                    quickDelete({ id: r.id, mediaId })
                  }}
                >
                  🗑
                </button>
                <div className="ks-card-cand-ops">
                  {mediaId ? (
                    <button
                      type="button"
                      className="ks-card-info"
                      title="查看这条的生成信息：提示词 / 参数 / 用到的角色·场景·道具锚点参考图"
                      onClick={(e) => {
                        e.stopPropagation()
                        setInfoMediaId(mediaId)
                      }}
                    >
                      ⓘ
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="ks-card-adopt"
                    disabled={!mediaId || adopted}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!mediaId) return
                      if (isVideo) addSceneVideo(sceneId, mediaId)
                      else addSceneImage(sceneId, mediaId)
                    }}
                  >
                    {adopted ? '已采用' : '采用'}
                  </button>
                  {!isVideo && mediaId ? (
                    <button
                      type="button"
                      className="ks-card-tovideo"
                      title="用这张图生成视频"
                      onClick={(e) => {
                        e.stopPropagation()
                        props.onSpawnVideo(mediaId)
                      }}
                    >
                      →视频
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 锚点选择器（自由卡 / 视频卡） */}
      {showAnchorPicker ? (
        <AnchorPicker scenario={scenario} value={anchors} onChange={props.onAnchorsChange} />
      ) : null}

      {/* 音色卡：说话人 / 音色预设 + 语速 */}
      {isAudio ? (
        <div className="ks-card-voice-ctrl">
          <div className="ks-card-voice-row">
            <select
              className="ks-card-variant ks-card-voice-sel"
              value={speakerId ?? ''}
              onChange={(e) => {
                const id = e.target.value || undefined
                const sp = speakers.find((s) => s.charId === id)
                props.onSpeakerChange(id, sp?.voiceType)
              }}
              title="说话人（选角色可继承其已锚定音色）"
            >
              <option value="">旁白 / 通用</option>
              {speakers.map((s) => (
                <option key={s.charId} value={s.charId}>
                  {s.name}
                  {s.voiceType ? ' · 已锚定' : ''}
                </option>
              ))}
            </select>
            <select
              className="ks-card-variant ks-card-voice-sel"
              value={voiceType ?? ''}
              onChange={(e) => props.onVoiceTypeChange(e.target.value)}
              title="音色（voice_type）"
            >
              {TTS_VOICE_PRESETS.map((v) => (
                <option key={v.voiceType} value={v.voiceType} title={v.style}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <label className="ks-card-dur">
            语速
            <input
              type="number"
              min={0.5}
              max={2}
              step={0.1}
              value={speedRatio ?? 1}
              onChange={(e) =>
                props.onSpeedChange(Math.max(0.5, Math.min(2, Number(e.target.value) || 1)))
              }
            />
            ×
          </label>
        </div>
      ) : null}

      {/* 视频卡：首/尾帧 + 运镜参考视频 + 氛围参考音频 + 生成音轨 + 时长 */}
      {isVideo ? (
        <div className="ks-card-video-ctrl">
          {/* 本地上传参考图（首帧 / 尾帧 / 全能参考共用一个隐藏 input） */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const target = uploadTargetRef.current
              const files = e.target.files
              if (target) void uploadFiles(files).then((ids) => applyUploadedIds(target, ids))
              uploadTargetRef.current = null
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
          />
          {/* 模式切换（官方互斥：首尾帧 ⊕ 多模态参考）+ 分辨率/比例 */}
          <div className="ks-card-vmode">
            <div className="ks-card-vmode-seg" role="tablist" aria-label="视频生成模式">
              <button
                type="button"
                role="tab"
                aria-selected={videoMode === 'frames'}
                className={`ks-card-vmode-tab ${videoMode === 'frames' ? 'is-on' : ''}`}
                title="首尾帧模式：首帧（+可选尾帧）严格控制起止画面"
                onClick={() => props.onVideoModeChange('frames')}
              >
                首尾帧
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={videoMode === 'reference'}
                className={`ks-card-vmode-tab ${videoMode === 'reference' ? 'is-on' : ''}`}
                title="多模态参考模式：角色/场景/道具锚点 + 运镜参考视频 / 氛围参考音频（保持一致性）"
                onClick={() => props.onVideoModeChange('reference')}
              >
                多模态参考
              </button>
            </div>
            <div className="ks-card-vspecs">
              <select
                className="ks-card-variant ks-card-vspec-sel"
                value={videoResolution}
                onChange={(e) => props.onResolutionChange(e.target.value as SeedanceResolutionTier)}
                title="分辨率（body.resolution）"
              >
                {SEEDANCE_RESOLUTION_CHOICES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className="ks-card-variant ks-card-vspec-sel"
                value={videoRatio}
                onChange={(e) => props.onRatioChange(e.target.value as SeedanceRatio)}
                title="比例（body.ratio）"
              >
                {SEEDANCE_RATIO_CHOICES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 首帧 / 主参考 —— 单槽位：从右侧「正式素材 / 分镜」或卡候选拖入，可清除，或点「选图」 */}
          <div className="ks-card-frow">
            <div className="ks-card-frow-head">
              <span className="ks-card-frow-label">
                {videoMode === 'frames' ? '首帧' : '首帧 / 主参考'}
              </span>
              <span className={`ks-card-frow-mode ${startFrameMediaId ? 'is-on' : ''}`}>
                {startFrameMediaId
                  ? videoMode === 'frames'
                    ? '图生视频'
                    : '已设主参考'
                  : '文生（留空）'}
              </span>
              {startFrameMediaId ? (
                <button
                  type="button"
                  className="ks-card-frow-clear"
                  title="查看该关键帧/主参考图的生成信息：用了哪些角色/场景锚点参考图"
                  onClick={() => setInfoMediaId(startFrameMediaId)}
                >
                  ⓘ
                </button>
              ) : null}
              <button
                type="button"
                className="ks-card-frow-clear"
                onClick={() => setPicker('start')}
              >
                选图
              </button>
              <button
                type="button"
                className="ks-card-frow-clear"
                title="从本地上传一张图作首帧"
                onClick={() => openUpload('start')}
              >
                上传
              </button>
            </div>
            <div
              className={`ks-card-slot ${startFrameMediaId ? 'has' : ''} ${dragSlot === 'start' ? 'is-over' : ''}`}
              onDragOver={(e) => {
                if (!acceptsDrop(e)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                if (dragSlot !== 'start') setDragSlot('start')
              }}
              onDragLeave={() => setDragSlot((s) => (s === 'start' ? null : s))}
              onDrop={(e) => {
                if (hasFileDrag(e)) {
                  e.preventDefault()
                  setDragSlot(null)
                  void uploadFiles(e.dataTransfer.files).then((ids) =>
                    applyUploadedIds('start', ids),
                  )
                  return
                }
                const id = readDropImageId(e)
                if (!id) return
                e.preventDefault()
                setDragSlot(null)
                props.onStartFrameChange(id)
              }}
            >
              {startFrameMediaId && startFrameUrl ? (
                <>
                  <img src={startFrameUrl} alt="" draggable={false} />
                  <button
                    type="button"
                    className="ks-card-slot-clear"
                    title="清除首帧"
                    onClick={() => props.onStartFrameChange(undefined)}
                  >
                    ✕
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="ks-card-slot-empty"
                  title="点击从本节点素材选图（也可从右侧拖入）"
                  onClick={() => setPicker('start')}
                >
                  <span className="ks-card-slot-plus" aria-hidden>＋</span>
                  <span>拖入 / 上传 / 选图（留空 = 文生）</span>
                </button>
              )}
            </div>
          </div>

          {/* 全能参考图 —— 仅「多模态参考」模式：自由拖入多张参考图（角色/场景/分镜/任意图） */}
          {videoMode === 'reference' ? (
            <div className="ks-card-frow ks-card-omni">
              <div className="ks-card-frow-head">
                <span className="ks-card-frow-label">全能参考图</span>
                <span className="ks-card-frow-mode">
                  {(props.refImageMediaIds?.length ?? 0)} 张 · 可多图
                </span>
                <button
                  type="button"
                  className="ks-card-frow-clear"
                  onClick={() => setPicker('omni')}
                >
                  选图
                </button>
                <button
                  type="button"
                  className="ks-card-frow-clear"
                  title="从本地上传参考图（可多张）"
                  onClick={() => openUpload('omni')}
                >
                  上传
                </button>
                {(props.refImageMediaIds?.length ?? 0) > 0 ? (
                  <button
                    type="button"
                    className="ks-card-frow-clear"
                    title="清空全部全能参考"
                    onClick={() => props.onRefImagesChange?.([])}
                  >
                    清空
                  </button>
                ) : null}
              </div>
              <div
                className={`ks-card-omni-zone ${dragSlot === 'omni' ? 'is-over' : ''}`}
                onDragOver={(e) => {
                  if (!acceptsDrop(e)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  if (dragSlot !== 'omni') setDragSlot('omni')
                }}
                onDragLeave={() => setDragSlot((s) => (s === 'omni' ? null : s))}
                onDrop={(e) => {
                  if (hasFileDrag(e)) {
                    e.preventDefault()
                    setDragSlot(null)
                    void uploadFiles(e.dataTransfer.files).then((ids) =>
                      applyUploadedIds('omni', ids),
                    )
                    return
                  }
                  const id = readDropImageId(e)
                  if (!id) return
                  e.preventDefault()
                  setDragSlot(null)
                  const cur = props.refImageMediaIds ?? []
                  if (!cur.includes(id)) props.onRefImagesChange?.([...cur, id])
                }}
              >
                {(props.refImageMediaIds ?? []).length === 0 ? (
                  <div className="ks-card-omni-empty">
                    拖入（右侧素材 / 分镜 / 卡候选）· 上传本地图 · 选图 —— 可多张作参考
                  </div>
                ) : (
                  (props.refImageMediaIds ?? []).map((mid) => {
                    const u = entries[mid]?.url
                    return (
                      <div key={mid} className="ks-card-omni-item">
                        {u ? <img src={u} alt="" draggable={false} /> : null}
                        <button
                          type="button"
                          className="ks-card-omni-item-del"
                          title="移除这张参考"
                          onClick={() =>
                            props.onRefImagesChange?.(
                              (props.refImageMediaIds ?? []).filter((x) => x !== mid),
                            )
                          }
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ) : null}

          {/* 尾帧 —— 仅「首尾帧」模式（A→B 运镜；尾帧需配首帧） */}
          {videoMode === 'frames' ? (
          showEnd ? (
            <div className="ks-card-frow">
              <div className="ks-card-frow-head">
                <span className="ks-card-frow-label">尾帧</span>
                <span className={`ks-card-frow-mode ${endFrameMediaId ? 'is-on' : ''}`}>
                  A→B 运镜
                </span>
                <button
                  type="button"
                  className="ks-card-frow-clear"
                  onClick={() => setPicker('end')}
                >
                  选图
                </button>
                <button
                  type="button"
                  className="ks-card-frow-clear"
                  title="从本地上传一张图作尾帧"
                  onClick={() => openUpload('end')}
                >
                  上传
                </button>
                <button
                  type="button"
                  className="ks-card-frow-clear"
                  title="移除尾帧设置"
                  onClick={() => {
                    props.onEndFrameChange(undefined)
                    setShowEnd(false)
                  }}
                >
                  移除
                </button>
              </div>
              <div
                className={`ks-card-slot ${endFrameMediaId ? 'has' : ''} ${dragSlot === 'end' ? 'is-over' : ''}`}
                onDragOver={(e) => {
                  if (!acceptsDrop(e)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  if (dragSlot !== 'end') setDragSlot('end')
                }}
                onDragLeave={() => setDragSlot((s) => (s === 'end' ? null : s))}
                onDrop={(e) => {
                  if (hasFileDrag(e)) {
                    e.preventDefault()
                    setDragSlot(null)
                    void uploadFiles(e.dataTransfer.files).then((ids) =>
                      applyUploadedIds('end', ids),
                    )
                    return
                  }
                  const id = readDropImageId(e)
                  if (!id) return
                  e.preventDefault()
                  setDragSlot(null)
                  props.onEndFrameChange(id)
                }}
              >
                {endFrameMediaId && endFrameUrl ? (
                  <>
                    <img src={endFrameUrl} alt="" draggable={false} />
                    <button
                      type="button"
                      className="ks-card-slot-clear"
                      title="清除尾帧"
                      onClick={() => props.onEndFrameChange(undefined)}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="ks-card-slot-empty"
                    title="点击从本节点素材选图（也可从右侧拖入）"
                    onClick={() => setPicker('end')}
                  >
                    <span className="ks-card-slot-plus" aria-hidden>＋</span>
                    <span>拖入 / 上传 / 选图作尾帧</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <button type="button" className="ks-card-link" onClick={() => setShowEnd(true)}>
              ＋ 尾帧（A→B 运镜）
            </button>
          )
          ) : null}

          {/* 运镜参考视频 + 氛围参考音频 —— 仅「多模态参考」模式 */}
          {videoMode === 'reference' ? (
          showRefMore ? (
            <div className="ks-card-frow">
              <div className="ks-card-frow-head">
                <span className="ks-card-frow-label">参考</span>
                <span className="ks-card-frow-mode">运镜视频 / 氛围音频</span>
                <button
                  type="button"
                  className="ks-card-frow-clear"
                  title="移除参考设置"
                  onClick={() => {
                    props.onRefVideoChange(undefined)
                    props.onRefAudioChange(undefined)
                    setShowRefMore(false)
                  }}
                >
                  移除
                </button>
              </div>
              <div className="ks-card-frow-sub">
                <span className="ks-card-frow-sublabel">运镜参考视频</span>
                {refVideoMediaId ? (
                  <button
                    type="button"
                    className="ks-card-frow-clear"
                    onClick={() => props.onRefVideoChange(undefined)}
                  >
                    清除
                  </button>
                ) : null}
              </div>
              {refVideoChoices.length === 0 ? (
                <div className="ks-card-frow-empty">本节点暂无视频素材（生成视频后可作运镜参考）</div>
              ) : (
                <div className="ks-card-thumbs">
                  {refVideoChoices.map((f) => (
                    <button
                      key={f.mediaId}
                      type="button"
                      className={`ks-card-frame ${refVideoMediaId === f.mediaId ? 'is-sel' : ''}`}
                      title={refVideoMediaId === f.mediaId ? '再次点击取消' : '参考运镜 / 动作'}
                      onClick={() =>
                        props.onRefVideoChange(
                          refVideoMediaId === f.mediaId ? undefined : f.mediaId,
                        )
                      }
                    >
                      <video src={f.url} muted preload="metadata" />
                    </button>
                  ))}
                </div>
              )}
              <div className="ks-card-frow-sub">
                <span className="ks-card-frow-sublabel">氛围参考音频</span>
              </div>
              <select
                className="ks-card-variant ks-card-voice-sel"
                value={refAudioMediaId ?? ''}
                onChange={(e) => props.onRefAudioChange(e.target.value || undefined)}
                title="参考 BGM / 氛围"
              >
                <option value="">无</option>
                {refAudioChoices.map((a) => (
                  <option key={a.mediaId} value={a.mediaId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <button type="button" className="ks-card-link" onClick={() => setShowRefMore(true)}>
              ＋ 运镜参考视频 / 氛围参考音频
            </button>
          )
          ) : null}

          {/* 3D 机位调度 —— 仅「多模态参考」模式（白模静帧作软参考，不进成片） */}
          {videoMode === 'reference' ? (
            <div className="ks-card-frow ks-card-blk-row">
              {props.blockoutAttached ? (
                <>
                  {props.blockoutStillUrl ? (
                    <img
                      className="ks-card-blk-thumb"
                      src={props.blockoutStillUrl}
                      alt="机位静帧"
                    />
                  ) : null}
                  <div className="ks-card-frow-meta">
                    <span className="ks-card-frow-sublabel">3D 机位静帧 · 软参考</span>
                  </div>
                  <button
                    type="button"
                    className="ks-card-link"
                    title="重新调度 / 换机位"
                    onClick={() => props.onOpenBlockout?.()}
                  >
                    🔁 换机位
                  </button>
                  <button
                    type="button"
                    className="ks-card-link is-danger"
                    title="移除机位参考"
                    onClick={() => props.onClearBlockout?.()}
                  >
                    ✕ 移除
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="ks-card-link"
                  title="低模 3D 空间摆位 + 机位调度，渲染机位静帧作视频软参考"
                  onClick={() => props.onOpenBlockout?.()}
                >
                  🧊 打开 3D 空间摆位 / 加相机
                </button>
              )}
            </div>
          ) : null}

          <div className="ks-card-video-foot">
            <label className="ks-card-dur">
              时长
              <input
                type="number"
                min={1}
                max={12}
                value={durationSec}
                onChange={(e) => props.onDurationChange(Math.max(1, Math.min(12, Number(e.target.value) || 5)))}
              />
              秒
            </label>
            <label className="ks-card-check" title="让 Seedance 直接产出带音轨的视频">
              <input
                type="checkbox"
                checked={genAudio}
                onChange={(e) => props.onGenAudioChange(e.target.checked)}
              />
              生成音轨
            </label>
          </div>
        </div>
      ) : null}

      <textarea
        className="ks-card-prompt"
        value={prompt}
        rows={2}
        placeholder={
          isVideo
            ? '运镜 / 动作描述（起势→触发→余波）…'
            : isAudio
              ? '台词 / 旁白文本…'
              : spec.kind === 'scene'
                ? '描述这个画面…'
                : spec.kind === 'free'
                  ? '自由生成：写你想要的画面…'
                  : '锚点外观描述…'
        }
        onChange={(e) => props.onPromptChange(e.target.value)}
      />

      <footer className="ks-card-foot">
        {error ? (
          <span className="ks-card-err" title={error}>{error}</span>
        ) : busy && stage ? (
          <span className="ks-card-stage">{stage}</span>
        ) : (
          <span />
        )}
        {/* 数量（图像/音频多候选；视频固定 1） */}
        {!isVideo ? (
          <label className="ks-card-count" title="一次生成几条候选">
            ×
            <input
              type="number"
              min={1}
              max={4}
              value={count}
              onChange={(e) => props.onCountChange(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
            />
          </label>
        ) : null}
        <button
          type="button"
          className="ks-card-gen"
          disabled={busy || !prompt.trim()}
          onClick={props.onGenerate}
        >
          {busy
            ? isAudio
              ? '合成中…'
              : '生成中…'
            : isVideo
              ? '🎬 生成视频'
              : isAudio
                ? candidates.length > 0
                  ? '⟳ 再合成'
                  : '🎙 合成'
                : candidates.length > 0
                  ? '⟳ 再生成'
                  : '生成'}
        </button>
      </footer>

      {/* 选图弹层：从本节点图像素材里挑一张设给目标槽位（首帧 / 尾帧 / 全能参考） */}
      {picker !== null ? (
        <div
          className="ks-card-picker"
          role="dialog"
          aria-modal="true"
          onClick={() => setPicker(null)}
        >
          <div className="ks-card-picker-box" onClick={(e) => e.stopPropagation()}>
            <div className="ks-card-picker-head">
              <span className="ks-card-picker-title">
                选图 ·{' '}
                {picker === 'end' ? '尾帧' : picker === 'omni' ? '全能参考' : '首帧 / 主参考'}
              </span>
              <button type="button" className="ks-card-x" onClick={() => setPicker(null)}>
                ✕
              </button>
            </div>
            {frameChoices.length === 0 ? (
              <div className="ks-card-frow-empty">
                本节点暂无图像素材 · 先在场景/图像卡生成，或在右侧「正式素材」上传/采用
              </div>
            ) : (
              <div className="ks-card-picker-grid">
                {frameChoices.map((f) => (
                  <button
                    key={f.mediaId}
                    type="button"
                    className="ks-card-picker-cell"
                    onClick={() => {
                      if (picker === 'start') props.onStartFrameChange(f.mediaId)
                      else if (picker === 'end') props.onEndFrameChange(f.mediaId)
                      else if (picker === 'omni') props.onRefImagesChange?.([
                        ...(props.refImageMediaIds ?? []),
                        f.mediaId,
                      ])
                      setPicker(null)
                    }}
                  >
                    <img src={f.url} alt="" draggable={false} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* 候选放大灯箱：点开看细节 + 上/下张 + 采用 / →视频 / 下载 / 删除 */}
      {lightIdx !== null ? (
        <AssetLightbox
          title={spec.title}
          items={lightItems}
          index={lightIdx}
          onClose={() => setLightIdx(null)}
          onNavigate={setLightIdx}
          onToggleAdopt={(it) => {
            if (!it.mediaId) return
            if (isVideo) {
              if (it.adopted) removeSceneVideo(sceneId, it.mediaId)
              else addSceneVideo(sceneId, it.mediaId)
            } else {
              if (it.adopted) removeSceneImage(sceneId, it.mediaId)
              else addSceneImage(sceneId, it.mediaId)
            }
          }}
          onSpawnVideo={!isVideo ? (mid) => props.onSpawnVideo(mid) : undefined}
          onDelete={(it) => doDelete({ id: it.id, mediaId: it.mediaId })}
          onSaveEdited={!isVideo && !isAudio ? handleSaveEdited : undefined}
        />
      ) : null}

      {/* 生成信息：就地查看「这条候选/这张关键帧」发给模型的提示词 / 参数 /
          用到的角色·场景·道具锚点参考图（按 mediaId 反查请求快照）。 */}
      {infoMediaId && infoJob ? (
        <GenRequestDialog job={infoJob} onClose={() => setInfoMediaId(null)} />
      ) : null}
        </>
      )}
    </div>
  )
}
