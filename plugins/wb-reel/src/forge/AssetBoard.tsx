import { useEffect, useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { createImageProvider } from '../llm'
import { injectStyleOnce } from '../styles/injectStyle'
import { AssetCard } from './AssetCard'
import {
  buildAnchorRefs,
  buildSeededCardRefs,
  cardTag,
  composeCardPrompt,
  computeNodeCards,
  characterVoice,
  type AnchorRef,
  type CardSpec,
} from './assetCards'
import { generateCardAudio, generateCardImage, generateCardVideo } from './assetCardGen'
import type { SeedanceMode } from '../llm/seedanceContent'
import type { SeedanceResolutionTier, SeedanceRatio } from '../llm/seedanceResolution'
import { useGenerationQueue } from './generationQueueStore'
import { orchestrateVideos } from './orchestrateVideos'
import { GenerationQueuePanel } from './GenerationQueuePanel'
import { BlockoutEditor } from './blockout/BlockoutEditor'
import { normalizeBlockout } from './blockout/normalizeBlockout'
import { composeBlockoutVideoPrompt } from './blockout/blockoutPrompt'

const DEFAULT_VOICE_TYPE = 'BV001_streaming'

interface CardState {
  prompt: string
  variantId?: string
  anchors: AnchorRef[]
  /** 一次生成的候选数量（图像/音频；视频固定 1） */
  count: number
  // 视频卡
  startFrameMediaId?: string
  endFrameMediaId?: string
  durationSec: number
  /** 视频多模态：运镜参考视频 / 氛围参考音频（mediaId） */
  refVideoMediaId?: string
  refAudioMediaId?: string
  /** 全能参考图：用户自由拖入 / 选入的额外参考图 mediaId 列表（多模态参考模式） */
  refImageMediaIds?: string[]
  /** 视频是否直接生成音轨（Seedance generate_audio） */
  genAudio: boolean
  /** 视频生成模式（官方互斥）：frames=首尾帧 / reference=多模态参考 */
  videoMode?: SeedanceMode
  /** 视频分辨率档位（body.resolution） */
  resolution?: SeedanceResolutionTier
  /** 视频比例（body.ratio） */
  ratio?: SeedanceRatio
  /** 3D 机位调度：渲染出的机位静帧（软参考 reference_image）mediaId */
  blockoutStillMediaId?: string
  /** 3D 机位调度：随静帧一起附加的运镜/布局/防泄漏 prompt */
  blockoutPromptAddon?: string
  // 音色卡
  /** 说话人角色 id（音色卡；空 = 旁白/通用） */
  speakerId?: string
  /** TTS 音色 voice_type */
  voiceType?: string
  /** 语速 0.5–2.0 */
  speedRatio?: number
}

function defaultState(spec: CardSpec): CardState {
  return {
    prompt: spec.basePrompt,
    variantId: spec.defaultVariantId,
    anchors: [],
    count: 1,
    durationSec: 5,
    genAudio: true,
    videoMode: 'reference',
    resolution: '1080p',
    ratio: '16:9',
    speakerId: spec.speakerId,
    voiceType: spec.mediaKind === 'audio' ? (spec.defaultVoiceType ?? DEFAULT_VOICE_TYPE) : undefined,
    speedRatio: spec.mediaKind === 'audio' ? 1 : undefined,
  }
}

/**
 * AssetBoard —— 素材库内容区（完整版）。
 *
 * 进节点自动「播种」图像卡：场景画面 + 每出场角色(绑变体) + 每关键道具，
 *   均带锚点参考图（与视觉-参考图库强关联）做一致性生成。
 * 用户可加：图像自由卡（AnchorPicker 选参考 + 自由 prompt）、视频卡（多模态：
 *   首帧/尾帧 + 锚点参考 + 运镜 prompt，图生/文生视频）。
 * 图像候选可一键「→视频」派生一张预填首帧的视频卡。
 *
 * 候选只进 assetStore（按 cardTag 归组）；「采用」才写 sceneImages/sceneVideos。
 * 由 AssetsTab 以 key={sceneId} 挂载 —— 切节点整体重挂，卡状态按节点隔离。
 */
export function AssetBoard({ sceneId }: { sceneId: string }) {
  const scenario = useScenarioStore((s) => s.scenario)
  const scene = scenario.scenes[sceneId]
  const client = useMemo(() => createImageProvider(), [])
  const mediaLookup = useMemo(
    () => (id: string) => useMediaStore.getState().entries[id]?.url,
    [],
  )

  const baseCards = useMemo(
    () => (scene ? computeNodeCards(scene, scenario) : []),
    [scene, scenario],
  )
  const [extraCards, setExtraCards] = useState<CardSpec[]>([])
  const cards = useMemo(() => [...baseCards, ...extraCards], [baseCards, extraCards])

  const [stateById, setStateById] = useState<Record<string, CardState>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [stages, setStages] = useState<Record<string, string | null>>({})
  const [errs, setErrs] = useState<Record<string, string | null>>({})
  /** 视频编排：是否允许没关键帧的分镜也用纯锚点文生 */
  const [orchTextOnly, setOrchTextOnly] = useState(false)
  /** 上次编排的提示（入队/跳过统计） */
  const [orchNote, setOrchNote] = useState<string | null>(null)
  /** 当前打开 3D 机位编辑器并绑定的视频卡 id（null = 关闭） */
  const [blockoutCardId, setBlockoutCardId] = useState<string | null>(null)

  useEffect(() => {
    setStateById((prev) => {
      let changed = false
      const next = { ...prev }
      for (const c of cards) {
        if (!next[c.id]) {
          next[c.id] = defaultState(c)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [cards])

  // 折叠态：自动播种卡默认折叠（减少占位，点头展开）；用户手动加的卡默认展开（待配置）。
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  useEffect(() => {
    setCollapsed((prev) => {
      let changed = false
      const next = { ...prev }
      for (const c of baseCards) {
        if (next[c.id] === undefined) {
          next[c.id] = true
          changed = true
        }
      }
      for (const c of extraCards) {
        if (next[c.id] === undefined) {
          next[c.id] = false
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [baseCards, extraCards])

  function toggleCollapsed(id: string): void {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function patch(id: string, p: Partial<CardState>): void {
    setStateById((prev) => {
      const cur: CardState = prev[id] ?? {
        prompt: '',
        anchors: [],
        count: 1,
        durationSec: 5,
        genAudio: true,
      }
      return { ...prev, [id]: { ...cur, ...p } }
    })
  }

  function clampCount(n: number | undefined): number {
    return Math.max(1, Math.min(4, n ?? 1))
  }

  async function generateOne(spec: CardSpec): Promise<void> {
    const st = stateById[spec.id] ?? defaultState(spec)
    setErrs((e) => ({ ...e, [spec.id]: null }))

    // ── 视频卡（多模态：首尾帧 + 锚点参考图 + 运镜参考视频 + 氛围参考音频）──
    if (spec.mediaKind === 'video') {
      const prompt = st.prompt.trim()
      if (!prompt) return
      const tag = cardTag(spec, st.variantId)
      const startFrameUrl = st.startFrameMediaId ? mediaLookup(st.startFrameMediaId) : undefined
      const endFrameUrl = st.endFrameMediaId ? mediaLookup(st.endFrameMediaId) : undefined
      const anchorRefUrls = buildAnchorRefs(scenario, st.anchors, mediaLookup).map(
        (r) => r.dataUrl,
      )
      // 全能参考图：用户自由拖入/选入的额外参考图，与锚点参考并列喂给视频模型。
      const omniRefUrls = (st.refImageMediaIds ?? [])
        .map((id) => mediaLookup(id))
        .filter((u): u is string => !!u)
      const referenceImageUrls = [...anchorRefUrls, ...omniRefUrls]
      const referenceVideoUrl = st.refVideoMediaId ? mediaLookup(st.refVideoMediaId) : undefined
      let referenceAudioUrl = st.refAudioMediaId ? mediaLookup(st.refAudioMediaId) : undefined
      // 音色参考：未显式指定参考音频时，取第一个带「音色样本」的角色锚点的 voiceSample
      // 作 Seedance reference_audio，并在 prompt 末尾追加备注，让模型知道这是该角色的音色基准。
      let voiceNote = ''
      if (!referenceAudioUrl) {
        for (const a of st.anchors) {
          if (a.kind !== 'character') continue
          const ch = scenario.characters?.[a.id]
          const vsUrl = ch?.voiceSampleMediaId ? mediaLookup(ch.voiceSampleMediaId) : undefined
          if (vsUrl) {
            referenceAudioUrl = vsUrl
            voiceNote = `（音色参考：${ch!.name} 的声音）`
            break
          }
        }
      }
      // 3D 机位静帧：作软参考（reference_image）追加到参考图序列，并把布局/运镜/防泄漏
      // prompt 附加到正文；存在静帧时强制 reference 模式（与首尾帧互斥）。
      const blockoutStillUrl = st.blockoutStillMediaId
        ? mediaLookup(st.blockoutStillMediaId)
        : undefined
      const finalRefs = blockoutStillUrl
        ? [...referenceImageUrls, blockoutStillUrl]
        : referenceImageUrls
      const finalMode: SeedanceMode = blockoutStillUrl ? 'reference' : (st.videoMode ?? 'reference')
      const basePrompt =
        blockoutStillUrl && st.blockoutPromptAddon
          ? `${prompt}\n\n${st.blockoutPromptAddon}`
          : prompt
      const finalPrompt = voiceNote ? `${basePrompt}\n\n${voiceNote}` : basePrompt
      setBusy((b) => ({ ...b, [spec.id]: true }))
      setStages((s) => ({ ...s, [spec.id]: '提交任务…' }))
      try {
        await generateCardVideo({
          sceneId,
          tag,
          title: spec.title,
          prompt: finalPrompt,
          mode: finalMode,
          resolution: st.resolution,
          ratio: st.ratio,
          startFrameUrl,
          endFrameUrl,
          referenceImageUrls: finalRefs,
          referenceVideoUrl,
          referenceAudioUrl,
          generateAudio: st.genAudio,
          durationSec: st.durationSec,
          onStage: (stage) => setStages((s) => ({ ...s, [spec.id]: stage })),
        })
      } catch (err) {
        setErrs((e) => ({ ...e, [spec.id]: (err as Error).message || '生成失败' }))
      } finally {
        setBusy((b) => ({ ...b, [spec.id]: false }))
        setStages((s) => ({ ...s, [spec.id]: null }))
      }
      return
    }

    // ── 音色卡（TTS 配音；voiceType=角色锚定音色或自选预设；count 多条候选）──
    if (spec.mediaKind === 'audio') {
      const text = st.prompt.trim()
      if (!text) return
      const voiceType =
        st.voiceType ||
        (st.speakerId ? characterVoice(scenario, st.speakerId).voiceType : undefined) ||
        DEFAULT_VOICE_TYPE
      const tag = cardTag(spec, st.variantId)
      const n = clampCount(st.count)
      setBusy((b) => ({ ...b, [spec.id]: true }))
      setStages((s) => ({ ...s, [spec.id]: '合成中…' }))
      try {
        for (let i = 0; i < n; i++) {
          setStages((s) => ({ ...s, [spec.id]: n > 1 ? `合成 ${i + 1}/${n}…` : '合成中…' }))
          await generateCardAudio({
            sceneId,
            tag,
            title: spec.title,
            text,
            voiceType,
            speedRatio: st.speedRatio,
          })
        }
      } catch (err) {
        setErrs((e) => ({ ...e, [spec.id]: (err as Error).message || '合成失败' }))
      } finally {
        setBusy((b) => ({ ...b, [spec.id]: false }))
        setStages((s) => ({ ...s, [spec.id]: null }))
      }
      return
    }

    // ── 图像卡（count 张候选；锚点参考图条件化生成）──
    const prompt = composeCardPrompt(st.prompt, spec.variants, st.variantId)
    if (!prompt.trim()) return
    const tag = cardTag(spec, st.variantId)
    const referenceImages =
      spec.kind === 'free'
        ? buildAnchorRefs(scenario, st.anchors, mediaLookup)
        : scene
          ? buildSeededCardRefs({ spec, variantId: st.variantId, scene, scenario, mediaLookup })
          : []
    const n = clampCount(st.count)
    setBusy((b) => ({ ...b, [spec.id]: true }))
    setStages((s) => ({ ...s, [spec.id]: n > 1 ? `生成 0/${n}…` : null }))
    try {
      for (let i = 0; i < n; i++) {
        setStages((s) => ({ ...s, [spec.id]: n > 1 ? `生成 ${i + 1}/${n}…` : null }))
        await generateCardImage({
          sceneId,
          kind: spec.kind,
          tag,
          title: spec.title,
          prompt,
          client,
          referenceImages,
        })
      }
    } catch (err) {
      setErrs((e) => ({ ...e, [spec.id]: (err as Error).message || '生成失败' }))
    } finally {
      setBusy((b) => ({ ...b, [spec.id]: false }))
      setStages((s) => ({ ...s, [spec.id]: null }))
    }
  }

  /** 把一张图像卡的 count 个候选入统一队列（image 池并发由 settings 控制）。返回入队数。 */
  function enqueueImageCard(spec: CardSpec, group: string): number {
    const st = stateById[spec.id] ?? defaultState(spec)
    const prompt = composeCardPrompt(st.prompt, spec.variants, st.variantId)
    if (!prompt.trim()) return 0
    const tag = cardTag(spec, st.variantId)
    const referenceImages =
      spec.kind === 'free'
        ? buildAnchorRefs(scenario, st.anchors, mediaLookup)
        : scene
          ? buildSeededCardRefs({ spec, variantId: st.variantId, scene, scenario, mediaLookup })
          : []
    const n = clampCount(st.count)
    const q = useGenerationQueue.getState()
    for (let i = 0; i < n; i++) {
      q.enqueue({
        kind: 'image',
        label: `图像 · ${spec.title}${n > 1 ? ` (${i + 1}/${n})` : ''}`,
        sceneId,
        group,
        run: async ({ setRequest }) =>
          generateCardImage({
            sceneId,
            kind: spec.kind,
            tag,
            title: spec.title,
            prompt,
            client,
            referenceImages,
            onRequest: setRequest,
          }),
      })
    }
    return n
  }

  function generateAllImages(): void {
    // 一键图像统一走生成队列（分池并发 + 进度可视 + 可暂停/取消），
    // 视频/音频成本高，不纳入此批量（视频走「转视频」编排，音频逐卡）。
    const imageCards = cards.filter((c) => (c.mediaKind ?? 'image') === 'image')
    const group = `imgall-${Date.now().toString(36)}`
    let total = 0
    for (const c of imageCards) total += enqueueImageCard(c, group)
    setOrchNote(total > 0 ? `已入队 ${total} 张图像 · 见上方生成队列` : '没有可生成的图像卡')
  }

  /** 一键把分镜转视频（编排进队列；keyframe 优先，可选纯锚点文生）。 */
  function orchestrate(scope: 'node' | 'all'): void {
    const res = orchestrateVideos({
      sceneIds: scope === 'node' ? [sceneId] : undefined,
      includeTextOnly: orchTextOnly,
    })
    if (res.enqueued === 0) {
      const why = res.skips[0]?.reason
      setOrchNote(
        `没有可生成的分镜${why ? `（${why}）` : ''}` +
          (!orchTextOnly ? ' · 可勾选「纯锚点文生」放宽' : ''),
      )
    } else {
      setOrchNote(
        `已入队 ${res.enqueued} 段视频${res.skipped > 0 ? ` · 跳过 ${res.skipped}` : ''} · 见上方生成队列`,
      )
    }
  }

  function rid(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
  }

  function addFreeImageCard(): void {
    setExtraCards((f) => [...f, { id: rid('free'), kind: 'free', title: '自由卡', basePrompt: '' }])
  }

  function addVideoCard(startFrameMediaId?: string, generic = false): string {
    const id = rid('video')
    setExtraCards((f) => [
      ...f,
      {
        id,
        kind: 'video',
        mediaKind: 'video',
        title: generic ? '通用视频卡' : '节点视频卡',
        basePrompt: '',
        generic,
      },
    ])
    setStateById((prev) => ({
      ...prev,
      [id]: {
        prompt: '',
        anchors: [],
        count: 1,
        durationSec: 5,
        genAudio: true,
        videoMode: 'reference',
        resolution: '1080p',
        ratio: '16:9',
        startFrameMediaId,
      },
    }))
    return id
  }

  /** 素材库工具栏「3D 机位」入口：没视频卡就建一张，并打开 blockout 编辑器绑定到它。 */
  function openBlockoutFromBoard(): void {
    const existingVideo = cards.find((c) => c.mediaKind === 'video')
    const targetId = existingVideo ? existingVideo.id : addVideoCard()
    setBlockoutCardId(targetId)
  }

  /**
   * BlockoutEditor 渲染机位静帧后回调：把静帧 mediaId 写进目标视频卡，
   * 并据 blockout+机位算出运镜/布局/防泄漏 prompt 附加文本。随后关闭编辑器。
   */
  function handleBlockoutStill(
    cardId: string,
    info: { mediaId: string; blockoutId: string; cameraId: string },
  ): void {
    const blk = scenario.blockouts?.[info.blockoutId]
    let addon = ''
    if (blk) {
      const norm = normalizeBlockout(blk, {
        validCharacterIds: new Set(Object.keys(scenario.characters ?? {})),
        validLocationIds: new Set(Object.keys(scenario.locations ?? {})),
        validPropIds: new Set(Object.keys(scenario.props ?? {})),
      })
      const cam = norm.cameras.find((c) => c.id === info.cameraId)
      if (cam) {
        // 角色锚点在该卡 refs 序列里的 1-based 序号（用于「见角色参考图N」图例）
        const st = stateById[cardId]
        const charAnchors = (st?.anchors ?? []).filter((a) => a.kind === 'character')
        const anchorIndexOf = (characterId: string): number | undefined => {
          const i = charAnchors.findIndex((a) => a.id === characterId)
          return i >= 0 ? i + 1 : undefined
        }
        const { prompt } = composeBlockoutVideoPrompt({
          blockout: norm,
          camera: cam,
          scenario: { characters: scenario.characters },
          anchorIndexOf,
          basePrompt: '',
        })
        addon = prompt
      }
    }
    setStateById((prev) => ({
      ...prev,
      [cardId]: {
        ...(prev[cardId] ?? defaultState(cards.find((c) => c.id === cardId)!)),
        blockoutStillMediaId: info.mediaId,
        blockoutPromptAddon: addon,
        videoMode: 'reference',
      },
    }))
    setBlockoutCardId(null)
  }

  function addAudioCard(): void {
    const id = rid('audio')
    setExtraCards((f) => [
      ...f,
      { id, kind: 'audio', mediaKind: 'audio', title: '配音卡', basePrompt: '' },
    ])
    setStateById((prev) => ({
      ...prev,
      [id]: {
        prompt: '',
        anchors: [],
        count: 1,
        durationSec: 5,
        genAudio: true,
        voiceType: DEFAULT_VOICE_TYPE,
        speedRatio: 1,
      },
    }))
  }

  function removeCard(id: string): void {
    setExtraCards((f) => f.filter((c) => c.id !== id))
    setStateById((prev) => {
      const { [id]: _omit, ...rest } = prev
      return rest
    })
  }

  if (!scene) return null

  return (
    <div className="ks-board">
      <div className="ks-board-bar">
        <span className="ks-board-title">生成卡片</span>
        <span className="ks-board-sub">
          {orchNote ?? `${cards.length} 张 · 候选不自动入库，满意点「采用」`}
        </span>
        <div className="ks-board-actions">
          <button type="button" className="ks-board-btn" onClick={addFreeImageCard}>
            ＋ 图像卡
          </button>
          <button
            type="button"
            className="ks-board-btn"
            title="节点视频卡：绑定本节点场景/角色/道具锚点"
            onClick={() => addVideoCard()}
          >
            🎬 节点视频卡
          </button>
          <button
            type="button"
            className="ks-board-btn"
            title="通用视频卡：全干净，自行上传/选择角色场景等参考图"
            onClick={() => addVideoCard(undefined, true)}
          >
            🎬 通用视频卡
          </button>
          <button
            type="button"
            className="ks-board-btn"
            title="低模 3D 空间摆位 + 机位调度，渲染机位静帧作视频软参考"
            onClick={openBlockoutFromBoard}
          >
            🧊 3D 机位
          </button>
          <button type="button" className="ks-board-btn" onClick={addAudioCard}>
            🎙 配音卡
          </button>
          <button
            type="button"
            className="ks-board-btn is-primary"
            onClick={() => generateAllImages()}
          >
            ⚡ 一键生成全部图像
          </button>
          <span className="ks-board-divider" />
          <label className="ks-board-check" title="没关键帧的分镜也用「场景/角色/道具」锚点文生视频">
            <input
              type="checkbox"
              checked={orchTextOnly}
              onChange={(e) => setOrchTextOnly(e.target.checked)}
            />
            纯锚点文生
          </label>
          <button
            type="button"
            className="ks-board-btn is-video"
            onClick={() => orchestrate('node')}
            title="把当前节点已出关键帧的分镜批量转视频"
          >
            🎬 本节点转视频
          </button>
          <button
            type="button"
            className="ks-board-btn is-video"
            onClick={() => orchestrate('all')}
            title="把全部节点已出关键帧的分镜批量转视频"
          >
            🎬 全部节点转视频
          </button>
        </div>
      </div>

      <GenerationQueuePanel />

      <div className="ks-board-grid">
        <div className="ks-board-cols">
        {cards.map((spec) => {
          const st = stateById[spec.id] ?? defaultState(spec)
          // 用户手动添加的卡（自由图像/视频/配音）可删；自动播种的不可删
          const removable = extraCards.some((c) => c.id === spec.id)
          return (
            <AssetCard
              key={spec.id}
              spec={spec}
              sceneId={sceneId}
              scenarioId={scenario.id}
              scenario={scenario}
              scene={scene}
              collapsed={!!collapsed[spec.id]}
              onToggleCollapse={() => toggleCollapsed(spec.id)}
              prompt={st.prompt}
              variantId={st.variantId}
              anchors={st.anchors}
              count={st.count}
              startFrameMediaId={st.startFrameMediaId}
              endFrameMediaId={st.endFrameMediaId}
              durationSec={st.durationSec}
              refVideoMediaId={st.refVideoMediaId}
              refAudioMediaId={st.refAudioMediaId}
              refImageMediaIds={st.refImageMediaIds}
              genAudio={st.genAudio}
              videoMode={st.videoMode}
              resolution={st.resolution}
              ratio={st.ratio}
              speakerId={st.speakerId}
              voiceType={st.voiceType}
              speedRatio={st.speedRatio}
              busy={!!busy[spec.id]}
              stage={stages[spec.id]}
              error={errs[spec.id]}
              onPromptChange={(v) => patch(spec.id, { prompt: v })}
              onVariantChange={(v) => patch(spec.id, { variantId: v })}
              onAnchorsChange={(v) => patch(spec.id, { anchors: v })}
              onCountChange={(n) => patch(spec.id, { count: n })}
              onStartFrameChange={(id) => patch(spec.id, { startFrameMediaId: id })}
              onEndFrameChange={(id) => patch(spec.id, { endFrameMediaId: id })}
              onDurationChange={(n) => patch(spec.id, { durationSec: n })}
              onRefVideoChange={(id) => patch(spec.id, { refVideoMediaId: id })}
              onRefAudioChange={(id) => patch(spec.id, { refAudioMediaId: id })}
              onRefImagesChange={(ids) => patch(spec.id, { refImageMediaIds: ids })}
              onGenAudioChange={(v) => patch(spec.id, { genAudio: v })}
              onVideoModeChange={(m) => patch(spec.id, { videoMode: m })}
              onResolutionChange={(r) => patch(spec.id, { resolution: r })}
              onRatioChange={(r) => patch(spec.id, { ratio: r })}
              blockoutAttached={!!st.blockoutStillMediaId}
              blockoutStillUrl={st.blockoutStillMediaId ? mediaLookup(st.blockoutStillMediaId) : undefined}
              onOpenBlockout={() => setBlockoutCardId(spec.id)}
              onClearBlockout={() =>
                patch(spec.id, { blockoutStillMediaId: undefined, blockoutPromptAddon: undefined })
              }
              onSpeakerChange={(id, vt) => patch(spec.id, { speakerId: id, ...(vt ? { voiceType: vt } : {}) })}
              onVoiceTypeChange={(v) => patch(spec.id, { voiceType: v })}
              onSpeedChange={(n) => patch(spec.id, { speedRatio: n })}
              onGenerate={() => void generateOne(spec)}
              onSpawnVideo={(fromMediaId) => addVideoCard(fromMediaId)}
              onRemove={removable ? () => removeCard(spec.id) : undefined}
            />
          )
        })}
        </div>
      </div>

      {blockoutCardId ? (
        <div
          className="ks-blk-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBlockoutCardId(null)
          }}
        >
          <div className="ks-blk-modal">
            <div className="ks-blk-modal-head">
              <span className="ks-blk-modal-title">🧊 3D 机位调度</span>
              <span className="ks-blk-modal-sub">
                低模摆位 + 机位 → 渲染静帧作视频软参考（白模不会出现在成片）
              </span>
              <button
                type="button"
                className="ks-board-btn"
                onClick={() => setBlockoutCardId(null)}
              >
                ✕ 关闭
              </button>
            </div>
            <div className="ks-blk-modal-body">
              <BlockoutEditor
                sceneId={sceneId}
                onUseCameraStill={(info) => handleBlockoutStill(blockoutCardId, info)}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const css = `
.ks-board {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 3D 机位调度模态: 只覆盖卡片画布(AssetBoard 中区), 不全屏 —— 右侧「正式素材」
 * 托盘保持可见, 方便把场景图拖进 3D 场景。故 absolute(限定在 position:relative
 * 的 .ks-board 内) 而非 fixed(全屏)。 */
.ks-blk-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  padding: 8px;
  background: rgba(8, 10, 16, 0.62);
  backdrop-filter: blur(2px);
}
.ks-blk-modal {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ks-panel, #14161c);
  border: 1px solid var(--ks-border-soft, #2a2e38);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55);
}
.ks-blk-modal-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ks-border-soft, #2a2e38);
  background: var(--ks-panel-elev, #1a1d25);
}
.ks-blk-modal-title {
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 14px;
  font-weight: 700;
}
.ks-blk-modal-sub {
  flex: 1 1 auto;
  font-size: 12px;
  opacity: 0.6;
}
.ks-blk-modal-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
.ks-board-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-elev);
}
.ks-board-title {
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 13px;
  font-weight: 700;
  color: var(--ks-text);
}
.ks-board-sub {
  font-size: 11px;
  color: var(--ks-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-board-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.ks-board-divider {
  width: 1px; align-self: stretch; margin: 2px 2px;
  background: var(--ks-border-soft);
}
.ks-board-check {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--ks-font-ui); font-size: 10.5px; color: var(--ks-text-soft);
  cursor: pointer; white-space: nowrap;
}
.ks-board-check input { accent-color: var(--ks-amber, #d4ff48); }
.ks-board-btn {
  all: unset;
  cursor: pointer;
  font-family: var(--ks-font-ui);
  font-size: 11px;
  padding: 5px 12px;
  border-radius: var(--ks-radius-pill, 999px);
  border: 1px solid var(--ks-border-strong, rgba(255,255,255,0.18));
  color: var(--ks-text-soft);
  background: var(--ks-panel-solid);
  white-space: nowrap;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-board-btn:hover:not(:disabled) { border-color: var(--ks-amber); color: var(--ks-amber); }
.ks-board-btn:disabled { opacity: .5; cursor: not-allowed; }
.ks-board-btn.is-primary {
  border-color: transparent;
  color: #15110a;
  background: var(--ks-amber, #d4ff48);
  font-weight: 600;
}
.ks-board-btn.is-video {
  border-color: #ff6ba6;
  color: #ff6ba6;
}
.ks-board-btn.is-video:hover:not(:disabled) {
  background: #ff6ba6; color: #1a0a12; border-color: transparent;
}

/* 滚动容器（固定高度 + 纵向滚动）—— 列布局放在内层，避免 multicol 在受限高度下
 * 往「横向」溢出。 */
.ks-board-grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  scrollbar-width: thin;
}
/*
 * 关键修复（2026-06-20）：改用 CSS 多列「瀑布流」布局。
 *   CSS grid / flex 的同一行会共享行高 —— 展开一张卡，同行其它卡所在的行被撑高，
 *   折叠卡看起来「被拉伸 / 捆绑、文字飘在顶部」。多列布局里每张卡按自身高度独立
 *   流动，彼此行高完全解耦：展开任意一张都不会影响其它卡。
 */
.ks-board-cols {
  columns: 248px;
  column-gap: 12px;
}

/* ── 单卡 ───────────────────────────────────────── */
.ks-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--ks-border, rgba(255,255,255,0.1));
  border-radius: var(--ks-radius-md, 10px);
  background: var(--ks-panel-solid, rgba(0,0,0,0.2));
  border-top: 2px solid var(--ks-border, rgba(255,255,255,0.1));
  /* 多列流：每张卡不被拆到两列；卡间纵向间距用 margin（多列没有 row-gap）。 */
  width: 100%;
  margin: 0 0 12px;
  break-inside: avoid;
  -webkit-column-break-inside: avoid;
}
.ks-card.is-busy { box-shadow: inset 0 0 0 1px var(--ks-amber-soft, rgba(212,255,72,0.25)); }
.ks-card-scene { border-top-color: #6aa6ff; }
.ks-card-char  { border-top-color: #d4ff48; }
.ks-card-prop  { border-top-color: #ff9d4d; }
.ks-card-free  { border-top-color: #b692ff; }
.ks-card-video { border-top-color: #ff6ba6; }
.ks-card-audio { border-top-color: #4dd2c2; }

.ks-card-head { display: flex; align-items: center; gap: 6px; }
.ks-card-head.is-toggle { cursor: pointer; user-select: none; outline: none; }
.ks-card-head.is-toggle:hover .ks-card-title { color: var(--ks-amber); }
.ks-card-head.is-toggle:focus-visible { box-shadow: 0 0 0 2px var(--ks-amber-soft, rgba(212,255,72,0.3)); border-radius: 4px; }
/* 折叠态：卡片更紧凑，头部就是全部 */
.ks-card.is-collapsed { gap: 0; padding-bottom: 7px; }
.ks-card-caret {
  flex: 0 0 auto; width: 12px; text-align: center;
  font-size: 9px; color: var(--ks-text-faint);
  transition: color var(--ks-dur-fast) var(--ks-ease);
}
.ks-card-head.is-toggle:hover .ks-card-caret { color: var(--ks-amber); }
/* 折叠态「可展开」引导：脉冲小绿点（点击展开） */
.ks-card-opendot {
  flex: 0 0 auto;
  width: 7px; height: 7px; border-radius: 50%;
  background: #3fb950;
  box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5);
  animation: ks-card-opendot-pulse 1.8s ease-out infinite;
}
.ks-card-head.is-toggle:hover .ks-card-opendot { background: #46d160; }
@keyframes ks-card-opendot-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0.5); }
  70%  { box-shadow: 0 0 0 5px rgba(63, 185, 80, 0); }
  100% { box-shadow: 0 0 0 0 rgba(63, 185, 80, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .ks-card-opendot { animation: none; }
}
.ks-card-count-badge {
  flex: 0 0 auto;
  font-family: var(--ks-font-ui); font-size: 9.5px; line-height: 1;
  padding: 2px 6px; border-radius: 999px;
  color: var(--ks-text-soft); background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border-soft);
}
.ks-card-peek {
  flex: 0 0 auto; width: 26px; height: 26px;
  object-fit: cover; border-radius: 5px;
  border: 1px solid var(--ks-border-soft); background: var(--ks-panel-elev);
}
.ks-card-title {
  flex: 1; min-width: 0;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 12.5px; font-weight: 600; color: var(--ks-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-card-variant {
  font-family: var(--ks-font-ui);
  font-size: 11px;
  color: var(--ks-text-soft);
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm, 5px);
  padding: 2px 4px;
  max-width: 110px;
}
.ks-card-x {
  all: unset; cursor: pointer;
  width: 18px; height: 18px; display: inline-flex;
  align-items: center; justify-content: center;
  font-size: 11px; color: var(--ks-text-faint);
  border-radius: 4px;
}
.ks-card-x:hover { color: var(--ks-rose, #ff6b6b); background: rgba(255,107,107,0.1); }

.ks-card-strip {
  display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden;
  min-height: 72px; padding-bottom: 2px;
  scrollbar-width: thin;
}
.ks-card-strip-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: var(--ks-text-faint); text-align: center;
  border: 1px dashed var(--ks-border-soft); border-radius: var(--ks-radius-sm, 5px);
}
.ks-card-cand {
  position: relative; flex: 0 0 auto;
  width: 96px; aspect-ratio: 1 / 1;
  border-radius: var(--ks-radius-sm, 5px); overflow: hidden;
  border: 1px solid var(--ks-border); background: var(--ks-panel-elev);
  cursor: grab;
}
.ks-card-cand:active { cursor: grabbing; }
.ks-card-cand.is-adopted { border-color: var(--ks-amber, #d4ff48); }
.ks-card-cand img,
.ks-card-cand video { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.ks-card-cand-ops {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; gap: 3px; padding: 4px;
  opacity: 0; transition: opacity var(--ks-dur-fast) var(--ks-ease);
}
.ks-card-cand:hover .ks-card-cand-ops { opacity: 1; }
.ks-card-adopt, .ks-card-tovideo {
  all: unset; cursor: pointer;
  font-size: 10px; padding: 1px 7px; border-radius: 999px;
  color: #15110a; background: var(--ks-amber, #d4ff48);
}
.ks-card-tovideo { background: #ff6ba6; color: #1a0a12; }
.ks-card-adopt:disabled { background: rgba(255,255,255,0.35); color: rgba(0,0,0,0.5); cursor: default; }

/* 候选悬浮角标：左上放大、右上删除（点开看大图 / 删除历史） */
.ks-card-zoom, .ks-card-del {
  position: absolute; top: 3px;
  width: 20px; height: 20px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 5px; cursor: pointer;
  font-size: 11px; line-height: 1;
  background: rgba(0,0,0,0.55); color: #fff;
  opacity: 0; transition: opacity var(--ks-dur-fast) var(--ks-ease);
}
.ks-card-zoom { left: 3px; }
.ks-card-del  { right: 3px; }
.ks-card-cand:hover .ks-card-zoom,
.ks-card-cand:hover .ks-card-del { opacity: 1; }
.ks-card-zoom:hover { background: rgba(0,0,0,0.8); }
.ks-card-del:hover  { background: rgba(220,60,60,0.92); }
/* 音频候选行内删除按钮 */
.ks-card-aud-del {
  all: unset; cursor: pointer; flex: 0 0 auto;
  font-size: 12px; line-height: 1; padding: 2px 5px; border-radius: 5px;
  color: var(--ks-text-soft); opacity: 0.7;
}
.ks-card-aud-del:hover { opacity: 1; color: #ff8a8a; background: rgba(255,80,80,0.12); }

.ks-card-video-ctrl { display: flex; flex-direction: column; gap: 5px; }
.ks-card-frames { display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: thin; }
.ks-card-frames-label { flex: 0 0 auto; font-size: 10px; color: var(--ks-text-faint); }
.ks-card-frame {
  all: unset; cursor: pointer; flex: 0 0 auto;
  width: 40px; height: 40px; border-radius: 4px; overflow: hidden;
  border: 1px solid var(--ks-border-soft); background: var(--ks-panel-elev);
}
.ks-card-frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ks-card-frame.is-sel { border-color: var(--ks-amber, #d4ff48); box-shadow: 0 0 0 1px var(--ks-amber, #d4ff48); }
.ks-card-frame-none {
  display: inline-flex; align-items: center; justify-content: center;
  width: auto; padding: 0 8px; font-size: 10px; color: var(--ks-text-soft);
}

/* ── 视频卡 · 单槽位（首帧 / 尾帧 / 全能参考图）：拖入 + 清除 + 选图 ── */
.ks-card-slot {
  position: relative;
  min-height: 56px;
  border-radius: var(--ks-radius-sm, 6px);
  border: 1px dashed var(--ks-border-soft);
  background: var(--ks-panel-solid);
  overflow: hidden;
  transition: border-color var(--ks-dur-fast) var(--ks-ease), box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-card-slot.has { border-style: solid; }
.ks-card-slot.is-over {
  border-color: var(--ks-amber);
  border-style: dashed;
  box-shadow: 0 0 0 2px var(--ks-amber-soft, rgba(212,255,72,0.3));
}
.ks-card-slot > img {
  display: block; width: 100%; max-height: 132px; object-fit: contain;
  background: #0c0e13;
}
.ks-card-slot-clear {
  position: absolute; top: 4px; right: 4px;
  width: 20px; height: 20px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 5px; cursor: pointer;
  font-size: 11px; line-height: 1; color: #fff;
  background: rgba(0,0,0,0.55);
}
.ks-card-slot-clear:hover { background: rgba(220,60,60,0.92); }
.ks-card-slot-empty {
  all: unset; cursor: pointer; box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  width: 100%; min-height: 56px; padding: 8px;
  text-align: center; font-size: 10.5px; color: var(--ks-text-faint);
}
.ks-card-slot-empty:hover { color: var(--ks-amber); }
.ks-card-slot-plus { font-size: 16px; line-height: 1; opacity: 0.8; }

/* ── 全能参考图 · 多图拖拽区 ── */
.ks-card-omni { gap: 6px; }
.ks-card-omni-zone {
  display: flex; flex-wrap: wrap; gap: 6px;
  padding: 6px; min-height: 56px;
  border-radius: var(--ks-radius-sm, 6px);
  border: 1px dashed var(--ks-border-soft);
  background: var(--ks-panel-solid);
  transition: border-color var(--ks-dur-fast) var(--ks-ease), box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-card-omni-zone.is-over {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 2px var(--ks-amber-soft, rgba(212,255,72,0.3));
}
.ks-card-omni-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 10.5px; color: var(--ks-text-faint); text-align: center;
}
.ks-card-omni-item {
  position: relative; flex: 0 0 auto;
  width: 52px; height: 52px; border-radius: 5px; overflow: hidden;
  border: 1px solid var(--ks-border-soft); background: var(--ks-panel-elev);
}
.ks-card-omni-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ks-card-omni-item-del {
  position: absolute; top: 1px; right: 1px;
  width: 16px; height: 16px; padding: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 4px; cursor: pointer;
  font-size: 9px; color: #fff; background: rgba(0,0,0,0.55);
  opacity: 0; transition: opacity var(--ks-dur-fast) var(--ks-ease);
}
.ks-card-omni-item:hover .ks-card-omni-item-del { opacity: 1; }
.ks-card-omni-item-del:hover { background: rgba(220,60,60,0.92); }

/* ── 选图弹层（首帧 / 尾帧 / 全能参考的兜底点选）── */
.ks-card-picker {
  position: fixed; inset: 0; z-index: 2300;
  display: flex; align-items: center; justify-content: center;
  padding: 40px;
  background: var(--ks-overlay-scrim, rgba(10,10,12,0.78));
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.ks-card-picker-box {
  width: min(560px, 92vw); max-height: 80vh;
  display: flex; flex-direction: column;
  background: var(--ks-panel, #14161c);
  border: 1px solid var(--ks-border-soft); border-radius: 12px;
  overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,0.55);
}
.ks-card-picker-head {
  flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; border-bottom: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-elev);
}
.ks-card-picker-title {
  flex: 1; font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 13px; font-weight: 700; color: var(--ks-text);
}
.ks-card-picker-grid {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px;
  display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 8px; scrollbar-width: thin;
}
.ks-card-picker-cell {
  all: unset; cursor: pointer;
  aspect-ratio: 1 / 1; border-radius: 6px; overflow: hidden;
  border: 1px solid var(--ks-border-soft); background: var(--ks-panel-elev);
  transition: border-color var(--ks-dur-fast) var(--ks-ease), box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-card-picker-cell:hover { border-color: var(--ks-amber); box-shadow: 0 0 0 2px var(--ks-amber-soft, rgba(212,255,72,0.3)); }
.ks-card-picker-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }

/* ── 视频卡 · 模式切换 + 分辨率/比例（首尾帧 ⊕ 多模态参考，官方互斥）── */
.ks-card-vmode {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  justify-content: space-between;
}
.ks-card-vmode-seg {
  display: inline-flex; padding: 2px; gap: 2px;
  border: 1px solid var(--ks-border-soft); border-radius: 999px;
  background: var(--ks-panel-elev);
}
.ks-card-vmode-tab {
  all: unset; cursor: pointer; user-select: none;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 11px; font-weight: 600; color: var(--ks-text-soft);
  padding: 3px 12px; border-radius: 999px; transition: background .15s, color .15s;
}
.ks-card-vmode-tab:hover { color: var(--ks-text); }
.ks-card-vmode-tab.is-on {
  color: #15110a; background: var(--ks-amber, #d4ff48);
}
.ks-card-vspecs { display: inline-flex; align-items: center; gap: 6px; }
.ks-card-vspec-sel { max-width: 118px; }

/* ── 视频卡 · 帧/参考分区（v6.13 交互重做）────────────── */
.ks-card-frow {
  display: flex; flex-direction: column; gap: 5px;
  padding: 5px 8px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm, 6px);
  background: var(--ks-panel-elev);
}
.ks-card-frow-head { display: flex; align-items: center; gap: 8px; }
.ks-card-frow-label {
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 11.5px; font-weight: 600; color: var(--ks-text-soft);
}
.ks-card-frow-mode {
  font-size: 10px; color: var(--ks-text-faint);
  padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--ks-border-soft);
}
.ks-card-frow-mode.is-on {
  color: #15110a; background: var(--ks-amber, #d4ff48); border-color: transparent;
}
.ks-card-frow-clear {
  all: unset; cursor: pointer; margin-left: auto;
  font-size: 10px; color: var(--ks-text-faint);
  padding: 1px 8px; border-radius: 999px;
  border: 1px solid var(--ks-border-soft);
}
.ks-card-frow-clear:hover { color: var(--ks-rose, #ff6b6b); border-color: var(--ks-rose, #ff6b6b); }
.ks-card-frow-empty {
  font-size: 10.5px; color: var(--ks-text-faint); line-height: 1.4;
  padding: 2px 2px;
}
.ks-card-thumbs {
  display: flex; gap: 6px; overflow-x: auto; overflow-y: hidden;
  padding-bottom: 2px; scrollbar-width: thin;
}
.ks-card-frow-sub { display: flex; align-items: center; gap: 8px; }
.ks-card-frow-sublabel { font-size: 10.5px; color: var(--ks-text-faint); }
.ks-card-link {
  all: unset; cursor: pointer; align-self: flex-start;
  font-size: 10.5px; color: var(--ks-text-soft);
}
.ks-card-link:hover { color: var(--ks-amber); }
.ks-card-link.is-danger { color: var(--ks-danger, #e06c75); }
.ks-card-link.is-danger:hover { color: #ff8b93; }
/* 3D 机位行：横排（覆盖 .ks-card-frow 的 column），缩略图 + 标签同行，按钮回流到次行 */
.ks-card-blk-row { flex-direction: row; align-items: center; gap: 5px 8px; flex-wrap: wrap; }
.ks-card-frow-meta { display: inline-flex; align-items: center; flex: 1 1 auto; min-width: 0; }
.ks-card-blk-thumb {
  width: 56px; height: 36px; object-fit: cover;
  border-radius: 4px; border: 1px solid var(--ks-border-soft);
  flex: 0 0 auto;
}
.ks-card-dur {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10.5px; color: var(--ks-text-soft);
}
.ks-card-dur input {
  width: 44px; font-family: var(--ks-font-ui); font-size: 11px;
  color: var(--ks-text); background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border-soft); border-radius: 4px; padding: 2px 4px;
}

.ks-card-prompt {
  all: unset;
  font-family: var(--ks-font-ui); font-size: 11.5px; line-height: 1.45;
  color: var(--ks-text); background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border-soft); border-radius: var(--ks-radius-sm, 5px);
  padding: 6px 8px; resize: vertical; min-height: 34px;
  white-space: pre-wrap; word-break: break-word;
}
.ks-card-prompt:focus { border-color: var(--ks-amber); }

/* ── 音色卡 ──────────────────────────────────────── */
.ks-card-voice-ctrl { display: flex; flex-direction: column; gap: 6px; }
.ks-card-voice-row { display: flex; gap: 6px; }
.ks-card-voice-sel { flex: 1; min-width: 0; max-width: none; }
/* 音频候选格：横向铺满，audio 播放器 + 设为音色 */
.ks-card-aud {
  position: relative; flex: 0 0 auto;
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 4px 6px;
  border-radius: var(--ks-radius-sm, 5px);
  border: 1px solid var(--ks-border); background: var(--ks-panel-elev);
  cursor: grab;
}
.ks-card-aud:active { cursor: grabbing; }
.ks-card-aud audio { flex: 1; min-width: 0; height: 30px; }
.ks-card-adopt-voice {
  flex: 0 0 auto; background: #4dd2c2; color: #082621;
}
/* audio 候选条改为纵向堆叠（每条占整行） */
.ks-card-audio .ks-card-strip {
  flex-direction: column; overflow-x: hidden; overflow-y: auto;
  max-height: 168px; gap: 6px;
}

.ks-card-video-foot { display: flex; align-items: center; gap: 10px; }
.ks-card-check {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 10.5px; color: var(--ks-text-soft);
}
.ks-card-check input { accent-color: var(--ks-amber, #d4ff48); }

.ks-card-count {
  display: inline-flex; align-items: center; gap: 2px;
  font-size: 11px; color: var(--ks-text-soft);
}
.ks-card-count input {
  width: 38px; font-family: var(--ks-font-ui); font-size: 11px;
  color: var(--ks-text); background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border-soft); border-radius: 4px; padding: 2px 4px;
}

.ks-card-foot { display: flex; align-items: center; gap: 8px; }
.ks-card-err {
  flex: 1; min-width: 0; font-size: 10.5px; color: var(--ks-rose, #ff6b6b);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-card-stage {
  flex: 1; min-width: 0; font-size: 10.5px; color: var(--ks-text-faint);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-card-foot > span:first-child:not(.ks-card-err):not(.ks-card-stage) { flex: 1; }
.ks-card-gen {
  all: unset; cursor: pointer;
  font-family: var(--ks-font-ui); font-size: 11px; font-weight: 600;
  padding: 5px 14px; border-radius: var(--ks-radius-pill, 999px);
  color: #15110a; background: var(--ks-amber, #d4ff48);
  white-space: nowrap;
}
.ks-card-gen:disabled { opacity: .45; cursor: not-allowed; }
`
injectStyleOnce('asset-board', css)
