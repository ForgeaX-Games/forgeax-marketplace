import { useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore, primeMediaEntry } from '../media/mediaStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { useAssetStore } from '../media/assetStore'
import { useSettingsStore } from '../scenario/settingsStore'
import { useShellStore } from '../shell/shellStore'
import { createImageProvider, createTextProvider, createVideoProvider } from '../llm'
import { DEFAULT_VIDEO_SIZE } from '../llm/seedanceResolution'
import { isVideoTaskProvider } from '../llm/VideoProvider'
import { useVideoTaskStore } from '../llm/videoTaskStore'
import {
  uploadRefMedia,
  MAX_VIDEO_BYTES,
  MAX_AUDIO_BYTES,
  type RefMediaKind,
} from '../llm/uploadRefMedia'
import {
  forgeImagePrompt,
  forgeVideoPrompt,
} from '../llm/promptForge'
import { forgeShotRefine } from '../llm/forgeShotRefine'
import { runForgeImagePipeline } from '../llm/forgeImagePipeline'
import { getAuthoringHint } from '../llm/visualStylePresets'
import type { Character, Scene, Shot, ShotFraming } from '../scenario/types'
import { CopyButton } from '../ui/CopyButton'
import { TextareaWithCopy } from '../ui/TextareaWithCopy'
import { useFireToast } from '../ui/toastStore'
import { injectStyleOnce } from '../styles/injectStyle'
// v3.9.4：SCENE / VIDEO 两个 tab 不再内嵌"参考图像/视频素材库"。
//         跨场景素材库现在作为独立组件 ScenarioAssetLibrary 挂在面板底部
//         （StagePromptFloater 里），SCENE / VIDEO tab 只负责提示词与生成动作。

const EMPTY_CHARS_PT: Record<string, Character> = {}

/**
 * PromptTabs —— 场景的"多类型提示词"编辑区
 *
 * v3 起三枚 tab —— Scene / Shot / Video（旧版两枚）：
 *   ▣ SCENE —— 主场景画面（喂 GPT-Image-2 / 外部生图）+ 背景描述（v3 新增：导演/舞美，不上字幕）
 *   ▣ SHOT  —— 当前选中 shot 的镜头级 prompt、framing、cameraHint、transitionHint；
 *              Shot 级"单独重生"按钮。shellStore.selectedShotId 为 null 时 default 到 keyShotId。
 *   ▣ VIDEO —— 喂视频模型（seedance / sora）的运动/镜头/节奏描述
 *
 * 旧"UI 风格" tab 在 2026-04 已砍；shot 级是 v3 新拆分出来的"镜头语言"层。
 *
 * 每个 tab 的内容：
 *   - 文本编辑框（底色 + copy 按钮）
 *   - 简化的动作栏：[锻造] + [生成 / 重新生成]
 *     2026-04 简化：去掉了 "已生成 · 426702ms" 戳章 —— StagePane 里已经
 *     挂了一枚 `ks-img-stamp` 显示相同信息，PromptTabs 再贴一次纯属重复。
 *     首次生成按钮显示 "生成"，一旦出图就变成 "重新生成"（语义=同一个动作）。
 *
 * 一致性：
 *   - 角色锚点（characterIds）会被自动拼到生图 prompt 前面
 *   - 全局 uiStyle 也会被前置（从 scenario.uiStyle 读，不再需要场景级 tab）
 *   - Shot 级 prompt 会继承 Scene prompt + background 作为上下文（composeShotPrompt）
 */
export function PromptTabs({ scene }: { scene: Scene }) {
  // v3.9.5（作者反馈"镜头这个模块你怎么又加回来了"）：
  //   顶部 tab bar 彻底回退到两档 SCENE / VIDEO，不再有 SHOT tab。
  //   镜头景别现在作为 SCENE tab 内提示词下方的 chips 小模块（见
  //   FramingPicker）。ShotPromptTab / FRAMING_OPTS 作为内部实现保留
  //   （FRAMING_OPTS 被 FramingPicker 复用；ShotPromptTab 挪到其他入口
  //   复用或后续清理）。
  const [tab, setTab] = useState<'scene' | 'video'>('scene')

  return (
    <div className="ks-pt">
      <div className="ks-pt-bar">
        <PromptTab label="场景生成" sub="SCENE" active={tab === 'scene'} onClick={() => setTab('scene')} />
        <PromptTab label="视频生成" sub="VIDEO" active={tab === 'video'} onClick={() => setTab('video')} />
      </div>

      {tab === 'scene' && <ScenePromptTab scene={scene} />}
      {tab === 'video' && <VideoPromptTab scene={scene} />}

    </div>
  )
}

function PromptTab({
  label,
  sub,
  active,
  onClick,
}: {
  label: string
  sub: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`ks-pt-tab ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      <span className="ks-pt-tab-label ks-cn">{label}</span>
      <span className="ks-pt-tab-sub ks-mono">{sub}</span>
    </button>
  )
}

// ─────────────────────────────────────────────────────────
// SCENE TAB
// ─────────────────────────────────────────────────────────

function ScenePromptTab({ scene }: { scene: Scene }) {
  const setScenePrompts = useScenarioStore((s) => s.setScenePrompts)
  const setSceneCharacterIds = useScenarioStore((s) => s.setSceneCharacterIds)
  const characters = useScenarioStore((s) => s.scenario.characters ?? EMPTY_CHARS_PT)
  const uiStyle = useScenarioStore((s) => s.scenario.uiStyle)
  const toast = useFireToast()
  const visualStyle = useScenarioStore((s) => s.scenario.visualStyle)
  const synopsis = useScenarioStore((s) => s.scenario.synopsis)
  const retryImage = useSceneImageCache((s) => s.retry)
  const cacheRecord = useSceneImageCache((s) => s.records[scene.id])
  const imgClient = useMemo(() => createImageProvider(), [])
  const txtClient = useMemo(() => createTextProvider(), [])

  // v3.9.7 · 重大简化：textarea value 即最终 prompt。
  //   旧版：value（scene prompt）→ composeImagePrompt → composed（加【整体
  //         视觉风格】【出场角色一致性】【本场画面】包装）→ 真正喂 Image2。
  //         作者看不见 composed，textarea 里只有简单场景描述，他骂"你现在
  //         的根本不是提示词，就只是简单的场景描述"。
  //   新版：锻造 skill 直接输出一段完整的 gpt-image-2 prompt（已含角色锚点、
  //         风格、景别），写回 scene.prompts.scene；textarea 里就是最终
  //         prompt；生图直接用这段文本，不再二次包装。
  const value = scene.prompts?.scene ?? scene.media.prompt ?? ''

  const isPending = cacheRecord?.status === 'pending'
  const isReady = cacheRecord?.status === 'ready'
  const isError = cacheRecord?.status === 'error'

  // 景别是"锻造 hint"—— 只影响下一次锻造的 prompt 输出，不入 schema。
  // 换 scene 后 React key 变自动重置；作者反复切换 scene 时不会串味。
  const [framing, setFraming] = useState<ShotFraming | null>(null)

  const [forgeStatus, setForgeStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'forging' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  function genImage(): void {
    // v3.9.7：直接用 textarea 文本生图，不再走 composeImagePrompt 二次包装
    if (!value.trim()) return
    void retryImage(scene.id, value, imgClient)
  }

  async function forgePrompt(): Promise<void> {
    setForgeStatus({ kind: 'forging' })
    toast(`锻造中 · 场景「${scene.title}」的画面提示词`)
    try {
      const refs = pickCharacterRefs(scene.characterIds, characters)
      const intent =
        value.trim() ||
        `场景标题：${scene.title}。请按 skill 范例的密度，把这一场扩成 80-150 字的电影级画面提示词。`
      const framingHint = framing
        ? FRAMING_OPTS.find((o) => o.id === framing)
        : undefined
      const res = await forgeImagePrompt(txtClient, {
        intent,
        storyContext: synopsis,
        characters: refs,
        uiStyle: uiStyle?.prompt,
        style: getAuthoringHint(visualStyle) || undefined,
        framing: framingHint
          ? `${framingHint.label}（${framingHint.sub}）`
          : undefined,
      })
      setScenePrompts(scene.id, { scene: res.prompt })
      setForgeStatus({ kind: 'idle' })
      toast('✓ 场景提示词已更新', { kind: 'success' })
    } catch (e) {
      setForgeStatus({ kind: 'error', message: (e as Error).message })
      toast(`锻造失败 · ${(e as Error).message}`, { kind: 'error' })
    }
  }

  return (
    <div className="ks-pt-body">
      {/*
       * v3.9.7 · 紧凑版 SCENE tab：
       *   textarea（内嵌复制）→ 景别 chips → 角色锚点 → 动作栏
       *   删除项：外置 FieldHead 上的 CopyButton、ComposedPreview "FINAL"块
       */}
      <TextareaWithCopy
        rows={5}
        value={value}
        placeholder="场景画面提示词（锻造后会直接覆盖这里，就是喂给 GPT-Image-2 的最终文本）"
        copyHint="复制场景画面提示词"
        onChange={(e) => setScenePrompts(scene.id, { scene: e.target.value })}
      />

      <FramingPicker value={framing} onChange={setFraming} />

      <CharacterAnchors
        sceneCharacterIds={scene.characterIds ?? []}
        characters={characters}
        onChange={(ids) => setSceneCharacterIds(scene.id, ids)}
      />

      <div className="ks-pt-actions">
        <button
          type="button"
          className="ks-pt-btn"
          onClick={forgePrompt}
          disabled={forgeStatus.kind === 'forging'}
          title="用 Opus 4.6 + cinema-image-prompt skill 锻造一段完整的 gpt-image-2 提示词（含角色锚点 / 景别）"
        >
          {forgeStatus.kind === 'forging' ? '锻造中…' : '锻造提示词'}
        </button>
        <button
          type="button"
          className="ks-pt-btn is-primary"
          onClick={genImage}
          disabled={!value.trim() || isPending}
          title={isReady ? '重新生成（旧图自动归档到资产库）' : '用 GPT-Image-2 生成画面'}
        >
          {isPending
            ? '生成中…'
            : isReady
              ? '重新生成'
              : '生成画面'}
        </button>
        {isError && (
          <span
            className="ks-pt-err-chip ks-mono"
            title={cacheRecord?.status === 'error' ? cacheRecord.message : ''}
          >
            ✗ 生成失败
          </span>
        )}
      </div>
      {forgeStatus.kind === 'error' && (
        <div className="ks-pt-state ks-state-error ks-mono">
          锻造失败 · {forgeStatus.message}
        </div>
      )}

      {/* ── v4 · 当前分镜子区 ───────────────────────────────────────
       * 作者反馈："1个节点内的三张分镜，拖动时间轴，预览没跳转到对应图像，
       *   ……点击后，右侧的提示词详情，显示的都是同一个，并没有跳转到当前
       *   图片的提示词，没办法针对性的锻造、生成新图替换等。"
       *
       * 解法：SCENE tab 下新增"当前分镜"子区 —— Shot Strip + 当前 shot
       * 的 prompt / framing / 生成按钮。shellStore.selectedShotId 已由
       * Timeline 在拖动 playhead / 点击 shot chip 时实时同步，这里只要
       * 渲染 ShotPromptTab(compact)，作者就能对每一镜独立锻造 / 生图。
       *
       * 为什么 compact：去掉"一键生成所有分镜"全局按钮 —— 这是作者明确投诉
       * 的误点位，节点详情里不应出现"跨 scene 批量"入口。
       * ──────────────────────────────────────────────────────────── */}
      {scene.shots && scene.shots.length > 0 && (
        <div className="ks-pt-shot-subpanel">
          <div className="ks-pt-shot-subpanel-head">
            <span className="ks-pt-shot-subpanel-title">当前分镜</span>
            <span className="ks-mono ks-pt-shot-subpanel-sub">SHOT</span>
            <span className="ks-pt-shot-subpanel-hint">
              拖动时间轴或点选缩略图切换 · 针对单镜锻造/生成/修改
            </span>
          </div>
          <ShotPromptTab scene={scene} compact />
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// SHOT TAB · v3
// ─────────────────────────────────────────────────────────

/**
 * `<ShotHistoryStrip />` —— ShotPromptTab 下方的"本镜历史版本"缩略图条。
 *
 * v5（P3）· 作者原话："生成的图像视频，命名好，做好版本、文件管理"。
 *
 * 实现要点：
 *   · 数据源：`useAssetStore().records`，按 `meta.shotId === shotId &&
 *     meta.scenarioId === 当前剧本 id && kind === 'image'` 过滤
 *   · 只展示 >= 2 条时的列表（<=1 条时无"历史"可言，不浪费纵向空间）
 *   · 当前项（assetId.meta.mediaId === currentMediaId）高亮 + 右上角 "◆ 当前"
 *   · 点非当前项 → 调 `setSceneShotKeyframe`，同时调 primeMediaEntry 保证
 *     mediaStore 立刻有该 id → keyframe 预览立刻刷新（不用等 hydrate tick）
 */
function ShotHistoryStrip({
  sceneId,
  shotId,
  currentMediaId,
  onPick,
}: {
  sceneId: string
  shotId: string
  currentMediaId: string | undefined
  onPick: (mediaId: string) => void
}): JSX.Element | null {
  const records = useAssetStore((s) => s.records)
  const scenarioId = useScenarioStore((s) => s.scenario.id)
  const history = useMemo(() => {
    return records
      .filter(
        (r) =>
          r.kind === 'image' &&
          r.meta.shotId === shotId &&
          r.meta.sceneId === sceneId &&
          r.meta.scenarioId === scenarioId &&
          !!r.meta.mediaId,
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [records, shotId, sceneId, scenarioId])

  if (history.length <= 1) return null

  return (
    <div className="ks-pt-history">
      <div className="ks-pt-history-head">
        <span className="ks-pt-history-title">历史版本</span>
        <span className="ks-mono ks-pt-history-sub">HIST · {history.length}</span>
      </div>
      <div className="ks-pt-history-strip">
        {history.map((r) => {
          const mediaId = r.meta.mediaId as string
          const url = `/__reel__/assets/${r.id}`
          const isCurrent = currentMediaId === mediaId
          return (
            <button
              type="button"
              key={r.id}
              className={`ks-pt-history-item ${isCurrent ? 'is-current' : ''}`}
              onClick={() => {
                if (isCurrent) return
                // 立刻 prime mediaStore → keyframe-preview 不用等 hydrate
                primeMediaEntry({
                  id: mediaId,
                  name: r.filename,
                  mimeType: r.mimeType,
                  size: r.bytes,
                  url,
                  createdAt: r.createdAt,
                  persistState: 'saved',
                })
                onPick(mediaId)
              }}
              title={`${new Date(r.createdAt).toLocaleString('zh-CN')} · ${r.filename}`}
            >
              <img src={url} alt={r.filename} />
              {isCurrent && (
                <span className="ks-pt-history-current">◆ 当前</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const FRAMING_OPTS: { id: ShotFraming; label: string; sub: string }[] = [
  { id: 'wide',   label: '远景', sub: 'WIDE' },
  { id: 'medium', label: '中景', sub: 'MED'  },
  { id: 'close',  label: '特写', sub: 'CU'   },
  { id: 'insert', label: '插入', sub: 'INS'  },
  { id: 'ots',    label: '过肩', sub: 'OTS'  },
  { id: 'pov',    label: '主观', sub: 'POV'  },
]

/**
 * FramingPicker —— v3.9.5 新增，SCENE tab 里"提示词下方"的小模块。
 *
 * 作者原话：
 *   "镜头作为一个提示词下方的点选小模块，放在生图这里。视频那里就提示词
 *    去约束镜头。……我们生成一个关键帧，对镜头不满意、角色不满意，要变
 *    成全景，那就选择他想要的如全景、探后选择角色锚点等，我们锻造提示词，
 *    然后生成新的关键帧。"
 *
 * 交互契约：
 *   - 6 个 chip：远景 / 中景 / 特写 / 插入 / 过肩 / 主观
 *   - 再点一次 = 取消（作者切"想让 LLM 自由发挥"的档位）
 *   - 选中只影响下一次「锻造提示词」—— 不立即改 prompt、不立即生图
 *   - 未选 = 旧行为（LLM 自由判断景别）
 *
 * 为什么不持久化 schema：
 *   景别只是锻造 hint，作者选完马上就锻造；持久化会让"换 scene 看到上次
 *   的选中"这种粘性反而让人困惑。状态随 ScenePromptTab 的生命周期走即可。
 */
function FramingPicker({
  value,
  onChange,
}: {
  value: ShotFraming | null
  onChange: (next: ShotFraming | null) => void
}) {
  return (
    <div className="ks-pt-framing">
      <div className="ks-pt-framing-head">
        <span className="ks-pt-framing-title">镜头景别</span>
        <span className="ks-mono ks-pt-framing-sub">FRAMING</span>
        <span className="ks-pt-framing-hint">
          {value ? '下次锻造时用该景别' : '可选 · 默认由 LLM 自行决定'}
        </span>
      </div>
      <div className="ks-pt-framing-chips" role="radiogroup">
        {FRAMING_OPTS.map((opt) => {
          const active = value === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`ks-pt-framing-chip ${active ? 'is-active' : ''}`}
              onClick={() => onChange(active ? null : opt.id)}
              title={`${opt.label} · ${opt.sub}（再点一次取消）`}
            >
              <span className="ks-pt-framing-chip-label">{opt.label}</span>
              <span className="ks-mono ks-pt-framing-chip-sub">{opt.sub}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * ShotPromptTab —— 当前选中 shot 的镜头级编辑器（v3.5 增强版）
 *
 * 新增功能（对比 v3 原版）：
 *   · Shot Strip —— 顶部横向缩略列表，点击切换选中镜
 *   · 修改本镜 —— 展开意图输入框，调 forgeShotRefine（LLM 重写 prompt → 重新生图）
 *   · 一键生成所有分镜 —— 调 runForgeImagePipeline 两阶段流水线（角色ref + shot关键帧）
 */
function ShotPromptTab({ scene, compact = false }: { scene: Scene; compact?: boolean }) {
  const selectedShotId = useShellStore((s) => s.selectedShotId)
  const setSelectedShotId = useShellStore((s) => s.setSelectedShotId)
  const updateShot = useScenarioStore((s) => s.updateShot)
  const setSceneShotKeyframe = useScenarioStore((s) => s.setSceneShotKeyframe)
  const setCharacterTurnaroundRef = useScenarioStore((s) => s.setCharacterTurnaroundRef)
  const setLocationRefImage = useScenarioStore((s) => s.setLocationRefImage)
  const addLocationAngleRef = useScenarioStore((s) => s.addLocationAngleRef)
  const toast = useFireToast()
  const scenario = useScenarioStore((s) => s.scenario)
  const ingestDataUrl = useMediaStore((s) => s.ingestDataUrl)
  const ingestDataUrlFn = useMediaStore((s) => s.ingestDataUrl)
  const getMediaEntry = useMediaStore((s) => s.get)
  const getUrl = (id: string): string | undefined => getMediaEntry(id)?.url
  const imgClient = useMemo(() => createImageProvider(), [])
  const txtClient = useMemo(() => createTextProvider(), [])

  const shots = scene.shots ?? []
  const keyShotId = scene.keyShotId ?? shots[0]?.id
  const shot = shots.find((sh) => sh.id === selectedShotId) ??
    shots.find((sh) => sh.id === keyShotId) ??
    shots[0]

  // 生成本镜 / 重新生成 状态
  const [genStatus, setGenStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  // 修改本镜 状态
  const [refineOpen, setRefineOpen] = useState(false)
  const [refineIntent, setRefineIntent] = useState('')
  const [refineStatus, setRefineStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  // 一键生成所有分镜 状态
  const [batchStatus, setBatchStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending'; done: number; total: number }
    | { kind: 'done'; failed: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  if (!shot) {
    return (
      <div className="ks-pt-body ks-mono ks-faint">
        ◇ 该场景没有分镜 · 请先运行 Forge 分镜拆解
      </div>
    )
  }

  const isKey = shot.id === keyShotId
  const prompt = shot.prompt ?? ''

  // ── 生成本镜 ─────────────────────────────────────────────────────
  async function regenShot(): Promise<void> {
    if (!shot || !prompt.trim()) return
    setGenStatus({ kind: 'pending' })
    useSceneImageCache.getState().markPending(scene.id, scene.prompts?.scene ?? '')
    const shotLabel = `Shot ${(shot.order ?? 0) + 1}`
    toast(`生图中 · ${shotLabel}`)
    try {
      const out = await imgClient.generate({ prompt, size: '1024x1024' })
      const mediaId = ingestDataUrl(out.dataUrl, {
        name: `${scene.id}-${shot.id}.png`,
        sceneId: scene.id,
        shotId: shot.id,
        humanReadableName: `${scene.title ?? scene.id} · shot-${(shot.order ?? 0) + 1}`,
      })
      setSceneShotKeyframe(scene.id, shot.id, mediaId)
      const curCache = useSceneImageCache.getState().records[scene.id]
      if (isKey || curCache?.status !== 'ready') {
        useSceneImageCache.getState().put(scene.id, out.dataUrl, scene.prompts?.scene ?? '')
      }
      setGenStatus({ kind: 'idle' })
      toast(`✓ ${shotLabel} 图像已生成`, { kind: 'success' })
    } catch (e) {
      const msg = (e as Error).message
      setGenStatus({ kind: 'error', message: msg })
      useSceneImageCache.getState().markError(scene.id, scene.prompts?.scene ?? '', msg)
      toast(`${shotLabel} 生图失败 · ${msg}`, { kind: 'error' })
    }
  }

  // ── 修改本镜（LLM 重写 prompt → 重新生图）────────────────────────
  async function handleRefine(): Promise<void> {
    if (!shot || !refineIntent.trim()) return
    setRefineStatus({ kind: 'pending' })
    const shotLabel = `Shot ${(shot.order ?? 0) + 1}`
    toast(`锻造 + 生图中 · ${shotLabel}`)
    try {
      const shotIndex = shots.indexOf(shot)
      const prevShot = shotIndex > 0 ? shots[shotIndex - 1] : undefined
      const nextShot = shotIndex < shots.length - 1 ? shots[shotIndex + 1] : undefined
      const charIds = (shot.characterIds && shot.characterIds.length > 0
        ? shot.characterIds
        : scene.characterIds) ?? []
      const characters = charIds
        .map((id) => scenario.characters?.[id])
        .filter((c): c is NonNullable<typeof c> => !!c)

      const result = await forgeShotRefine(txtClient, imgClient, {
        scene,
        currentShot: shot,
        prevShot,
        nextShot,
        characters,
        userIntent: refineIntent,
      })

      // 写回新 prompt
      updateShot(scene.id, shot.id, { prompt: result.newPrompt })

      // 写回新图
      const mediaId = ingestDataUrlFn(result.imageResult.dataUrl, {
        name: `${scene.id}-${shot.id}-refined.png`,
        sceneId: scene.id,
        shotId: shot.id,
        humanReadableName: `${scene.title ?? scene.id} · shot-${(shot.order ?? 0) + 1} · refined`,
      })
      setSceneShotKeyframe(scene.id, shot.id, mediaId)
      if (isKey || useSceneImageCache.getState().records[scene.id]?.status !== 'ready') {
        useSceneImageCache.getState().put(scene.id, result.imageResult.dataUrl, scene.prompts?.scene ?? '')
      }

      setRefineStatus({ kind: 'idle' })
      setRefineOpen(false)
      setRefineIntent('')
      toast(`✓ ${shotLabel} 已按新意图重生`, { kind: 'success' })
    } catch (e) {
      setRefineStatus({ kind: 'error', message: (e as Error).message })
      toast(`${shotLabel} 修改失败 · ${(e as Error).message}`, { kind: 'error' })
    }
  }

  // ── 一键生成所有分镜 ──────────────────────────────────────────────
  async function handleBatchGenerate(): Promise<void> {
    if (batchStatus.kind === 'pending') return

    // v4（2026-05-07）· 作者反馈："我在节点详情，点击这个节点的生图，你给弄成了
    //   所有节点的所有分镜生成"。为了避免误触发，首次批量生图加二次确认；
    //   只有当剧本里已经有 ≥ 2 个 scene 或总 shot ≥ 4 时才 confirm，
    //   小剧本（单 scene 短故事）保持直接跑的流畅。
    const allScenes = Object.values(scenario.scenes)
    const totalShots = allScenes.reduce(
      (n, s) => n + (s.shots?.length ?? 0),
      0,
    )
    const generatedShots = allScenes.reduce(
      (n, s) => n + (s.shots?.filter((sh) => sh.keyframeMediaRef).length ?? 0),
      0,
    )
    const needsConfirm = allScenes.length >= 2 || totalShots >= 4
    if (needsConfirm) {
      const remaining = totalShots - generatedShots
      const msg =
        remaining === 0
          ? `剧本里 ${allScenes.length} 个场景 · ${totalShots} 个分镜都已生成过。\n点击"确定"会全部重新生成；"取消"则什么都不做。`
          : `将为剧本里 ${allScenes.length} 个场景 · ${remaining}/${totalShots} 个未生成的分镜执行两阶段生图。\n（先生成角色/场所参考图，再生成分镜关键帧）\n\n确定开始？`
      // eslint-disable-next-line no-alert
      const ok = window.confirm(msg)
      if (!ok) {
        toast('已取消批量生图')
        return
      }
    }

    setBatchStatus({ kind: 'pending', done: 0, total: 0 })
    toast(`批量生图已开始 · ${allScenes.length} 场景 / ${totalShots} 分镜`)
    try {
      // 计算已有 keyframeMediaRef 的 shot 跳过集合
      const skipSet = new Set<string>()
      for (const sc of Object.values(scenario.scenes)) {
        for (const sh of sc.shots ?? []) {
          if (sh.keyframeMediaRef) skipSet.add(`${sc.id}::${sh.id}`)
        }
      }

      let failedCount = 0
      const summary = await runForgeImagePipeline({
        client: imgClient,
        scenario,
        mediaLookup: (id) => getUrl(id),
        onCharacterRef: (characterId, result) => {
          const mediaId = ingestDataUrlFn(result.dataUrl, {
            name: `turnaround-${characterId}.png`,
            tags: ['turnaround'],
          })
          setCharacterTurnaroundRef(characterId, mediaId)
        },
        onLocationRef: (locationId, result) => {
          const mediaId = ingestDataUrlFn(result.dataUrl, { name: `loc-ref-${locationId}.png` })
          setLocationRefImage(locationId, mediaId)
        },
        onLocationAngleRef: (locationId, angle, result) => {
          const mediaId = ingestDataUrlFn(result.dataUrl, {
            name: `loc-${locationId}-${angle.id}.png`,
          })
          addLocationAngleRef(locationId, {
            id: angle.id,
            label: angle.label,
            anglePrompt: angle.anglePrompt,
            mediaId,
          })
        },
        onSceneShotKeyframe: (sceneId, shotId, result, meta) => {
          const mediaId = ingestDataUrlFn(result.dataUrl, {
            name: `${sceneId}-${shotId}.png`,
            sceneId,
            shotId,
            humanReadableName: meta.isKeyShot
              ? `${sceneId} · key · ${shotId}`
              : `${sceneId} · ${shotId}`,
          })
          setSceneShotKeyframe(sceneId, shotId, mediaId)
          if (meta.isKeyShot || useSceneImageCache.getState().records[sceneId]?.status !== 'ready') {
            useSceneImageCache.getState().put(sceneId, result.dataUrl, '')
          }
        },
        onProgress: (done, total) => {
          setBatchStatus({ kind: 'pending', done, total })
        },
        // concurrency 不指定 → 走 forgeImagePipeline 的 IMAGE_BATCH_CONCURRENCY 默认
      })
      failedCount = summary.shots.failed.length + summary.characters.failed.length + summary.locations.failed.length + summary.props.failed.length
      setBatchStatus({ kind: 'done', failed: failedCount })
      if (failedCount > 0) {
        toast(`批量生图完成 · ${failedCount} 张失败（见面板详情）`, { kind: 'warning' })
      } else {
        toast('✓ 全部分镜关键帧已生成', { kind: 'success' })
      }
    } catch (e) {
      setBatchStatus({ kind: 'error', message: (e as Error).message })
      toast(`批量生图中断 · ${(e as Error).message}`, { kind: 'error' })
    }
  }

  return (
    <div className="ks-pt-body">

      {/* ── Shot Strip ──────────────────────────────────────────────── */}
      <div className="ks-pt-shot-strip">
        <div className="ks-pt-shot-strip-list">
          {shots.map((sh, i) => {
            const thumbUrl = sh.keyframeMediaRef ? getUrl(sh.keyframeMediaRef) : undefined
            const active = sh.id === shot.id
            const isKeySh = sh.id === keyShotId
            return (
              <button
                key={sh.id}
                type="button"
                className={`ks-pt-shot-chip ${active ? 'is-active' : ''} ${isKeySh ? 'is-key' : ''}`}
                onClick={() => setSelectedShotId(sh.id)}
                title={`第 ${i + 1} 镜 · ${sh.framing}${isKeySh ? ' · 代表帧' : ''}`}
              >
                {thumbUrl ? (
                  <img src={thumbUrl} className="ks-pt-shot-chip-thumb" alt="" />
                ) : (
                  <span className="ks-pt-shot-chip-placeholder ks-mono">{i + 1}</span>
                )}
                <span className="ks-pt-shot-chip-label ks-mono">
                  {FRAMING_OPTS.find((o) => o.id === sh.framing)?.sub ?? sh.framing.toUpperCase()}
                </span>
              </button>
            )
          })}
        </div>
        {/* 一键生成所有分镜 按钮（compact 模式下隐藏 ——
             作者反馈："我在节点详情，点击这个节点的生图，你给弄成了所有节点的所有分镜生成"。
             SCENE tab 内嵌的"当前分镜"子区不应再有这颗全局批量按钮） */}
        {!compact && (
        <button
          type="button"
          className={`ks-pt-btn ks-pt-btn-batch ${batchStatus.kind === 'pending' ? 'is-pending' : ''}`}
          onClick={handleBatchGenerate}
          disabled={batchStatus.kind === 'pending'}
          title="两阶段生图：先生成角色参考图，再生成所有分镜关键帧（已有图的镜头自动跳过）"
        >
          {batchStatus.kind === 'pending'
            ? `生成中 ${batchStatus.done}/${batchStatus.total}`
            : '⚡ 一键生成所有分镜'}
        </button>
        )}
      </div>
      {batchStatus.kind === 'done' && (
        <div className={`ks-pt-state ${batchStatus.failed > 0 ? 'ks-state-error' : 'ks-state-done'} ks-mono`}>
          {batchStatus.failed > 0
            ? `完成，${batchStatus.failed} 个任务失败`
            : '所有分镜生成完成'}
        </div>
      )}
      {batchStatus.kind === 'error' && (
        <div className="ks-pt-state ks-state-error ks-mono">{batchStatus.message}</div>
      )}

      {/* ── 当前镜字段编辑 ─────────────────────────────────────────── */}
      <FieldHead
        title={`镜头 · ${shot.id}`}
        sub={isKey ? 'KEY SHOT' : 'SHOT'}
        hint={`第 ${shot.order + 1} 镜 · 共 ${shots.length} 镜`}
      >
        <CopyButton value={prompt} />
      </FieldHead>

      {/* framing chips */}
      <div className="ks-pt-shot-framing">
        {FRAMING_OPTS.map((opt) => {
          const active = shot.framing === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              className={`ks-pt-anchor ${active ? 'is-active' : ''}`}
              onClick={() => updateShot(scene.id, shot.id, { framing: opt.id })}
              title={opt.sub}
            >
              <span className="ks-pt-anchor-dot" />
              {opt.label}
            </button>
          )
        })}
      </div>

      {/* 已生成缩略图预览（本镜） */}
      {shot.keyframeMediaRef && (() => {
        const url = getUrl(shot.keyframeMediaRef)
        return url ? (
          <img
            src={url}
            className="ks-pt-shot-keyframe-preview"
            alt={`镜头 ${shot.id} 关键帧`}
          />
        ) : null
      })()}

      {/* v5（P3）· 本镜历史版本条
        * ──────────────────────────────────────────────────────────────
        * 数据来源：assetStore 里 meta.shotId === shot.id 的 image 资产
        * 点一张缩略图 → setSceneShotKeyframe 把当前 keyframe 指回去。
        * 刚生成的图因 asset 落盘是异步的，所以第一次会"晚 1-2 秒才入列"。
        * 空列表（或只有 1 条 = 当前版本）时整条隐藏，避免冗余。 */}
      <ShotHistoryStrip
        sceneId={scene.id}
        shotId={shot.id}
        currentMediaId={shot.keyframeMediaRef}
        onPick={(mediaId) => {
          setSceneShotKeyframe(scene.id, shot.id, mediaId)
          toast('✓ 已回滚到历史版本', { kind: 'success' })
        }}
      />

      <textarea
        rows={4}
        value={prompt}
        placeholder="本镜画面，约 50-100 字。与场景/背景描述方向一致"
        onChange={(e) => updateShot(scene.id, shot.id, { prompt: e.target.value })}
      />

      <FieldHead title="机位 / 运动" sub="CAMERA" hint="可选，例如：手持推进、长焦压缩">
        <span />
      </FieldHead>
      <textarea
        rows={2}
        value={shot.cameraHint ?? ''}
        placeholder="dolly in · 24mm 广角 · 半秒静止后缓推……"
        onChange={(e) => updateShot(scene.id, shot.id, { cameraHint: e.target.value })}
      />

      <FieldHead title="与下一镜衔接" sub="TRANSITION" hint="可选，切/叠/划/光影桥接">
        <span />
      </FieldHead>
      <textarea
        rows={2}
        value={shot.transitionHint ?? ''}
        placeholder="硬切到下一镜中景 · 以雨声做声桥"
        onChange={(e) => updateShot(scene.id, shot.id, { transitionHint: e.target.value })}
      />

      {/* ── 动作栏 ──────────────────────────────────────────────────── */}
      <div className="ks-pt-actions">
        <button
          type="button"
          className="ks-pt-btn is-primary"
          onClick={regenShot}
          disabled={!prompt.trim() || genStatus.kind === 'pending'}
          title="只重生当前分镜，不影响其他镜头"
        >
          {genStatus.kind === 'pending'
            ? '生成中…'
            : shot.keyframeMediaRef
              ? '重新生成本镜'
              : '生成本镜'}
        </button>
        <button
          type="button"
          className={`ks-pt-btn ${refineOpen ? 'is-active-subtle' : ''}`}
          onClick={() => { setRefineOpen((v) => !v); setRefineStatus({ kind: 'idle' }) }}
          title="用 LLM 根据你的意图修改本镜 prompt，并重新生图"
        >
          {refineOpen ? '收起修改' : '修改本镜'}
        </button>
        {isKey && (
          <span className="ks-pt-shot-hint ks-mono">
            ★ 代表帧 · 生成后同步 Scene / StoryTree
          </span>
        )}
      </div>
      {genStatus.kind === 'error' && (
        <div className="ks-pt-state ks-state-error ks-mono">{genStatus.message}</div>
      )}

      {/* ── 修改本镜展开区 ───────────────────────────────────────────── */}
      {refineOpen && (
        <div className="ks-pt-refine">
          <FieldHead title="修改意图" sub="REFINE" hint="告诉 AI 你希望如何改这一镜">
            <span />
          </FieldHead>
          <textarea
            rows={3}
            className="ks-pt-refine-input"
            value={refineIntent}
            placeholder="例：让她离镜头更近，表情更紧张；去掉背景人群；改成夜景……"
            onChange={(e) => setRefineIntent(e.target.value)}
          />
          <div className="ks-pt-actions">
            <button
              type="button"
              className="ks-pt-btn is-primary"
              onClick={handleRefine}
              disabled={!refineIntent.trim() || refineStatus.kind === 'pending'}
            >
              {refineStatus.kind === 'pending' ? '修改中…' : '确认修改并重新生图'}
            </button>
          </div>
          {refineStatus.kind === 'error' && (
            <div className="ks-pt-state ks-state-error ks-mono">{refineStatus.message}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// VIDEO TAB
// ─────────────────────────────────────────────────────────

/**
 * `<FrameSlot />` —— 视频生成的首/尾帧可视化槽位。
 *
 *   · 有图：展示缩略图 + 左上"起始帧"/"尾帧"标签 + 右上 ✕（清除）
 *   · 作者按 ✕ 后进入 `overridden=true` 状态，右上出现 ⟳（恢复默认）
 *   · 无图：展示虚线空槽 + 小字提示；仍提供 ⟳ 让作者撤销清除
 *
 *   目前 url 只能取自"当前 scene 的 keyShot / tailShot 的 keyframeMediaRef"
 *   自动填充；未来可在此加"从媒体库选图"菜单，MVP 先不做。
 */
function FrameSlot({
  label,
  url,
  overridden,
  onClear,
  onReset,
  onPick,
  autoUrl,
  scene,
}: {
  label: string
  url: string | undefined
  overridden: boolean
  onClear: () => void
  onReset: () => void
  /** v6（P3-E）· 作者从"候选池"里挑了一张；候选池 = sceneImages + 各 shot keyframe */
  onPick: (mediaId: string) => void
  autoUrl: string | undefined
  scene: Scene
}): JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const entries = useMediaStore((s) => s.entries)

  // 去重合并：sceneImages（上传 / 跨 shot 共享）+ 所有 shot 的 keyframeMediaRef
  const candidates = useMemo(() => {
    const seen = new Set<string>()
    const out: Array<{ mediaId: string; label: string; source: 'sceneImage' | 'shot' }> = []
    for (const id of scene.sceneImages ?? []) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      const e = entries[id]
      out.push({ mediaId: id, label: e?.name ?? id, source: 'sceneImage' })
    }
    for (const sh of scene.shots ?? []) {
      const id = sh.keyframeMediaRef
      if (!id || seen.has(id)) continue
      seen.add(id)
      const e = entries[id]
      out.push({
        mediaId: id,
        label: `Shot ${(sh.order ?? 0) + 1}${e?.name ? ` · ${e.name}` : ''}`,
        source: 'shot',
      })
    }
    return out
  }, [scene, entries])

  return (
    <div className={`ks-pt-frame-slot ${url ? 'has-img' : ''}`}>
      <span className="ks-pt-frame-slot-label">{label}</span>
      {url ? (
        <img src={url} alt={label} />
      ) : (
        <span className="ks-pt-frame-slot-empty">
          {overridden
            ? '已清除\n生成时只用文字'
            : autoUrl
              ? '参考图加载中…'
              : '点生成后自动用\n当前分镜关键帧'}
        </span>
      )}
      <div className="ks-pt-frame-slot-actions">
        {candidates.length > 0 && (
          <button
            type="button"
            className="ks-pt-frame-slot-btn"
            title="从媒体库挑选"
            onClick={() => setPickerOpen((v) => !v)}
          >
            ⋯
          </button>
        )}
        {url && (
          <button
            type="button"
            className="ks-pt-frame-slot-btn"
            title="清除"
            onClick={onClear}
          >
            ✕
          </button>
        )}
        {overridden && (
          <button
            type="button"
            className="ks-pt-frame-slot-btn"
            title="恢复默认"
            onClick={onReset}
          >
            ⟳
          </button>
        )}
      </div>
      {pickerOpen && (
        <FrameSlotPicker
          candidates={candidates}
          onPick={(mediaId) => {
            onPick(mediaId)
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * `<RefMediaSlot />` —— v6（P4）· 参考视频 / 参考音频槽位。
 *
 * 设计：
 *   · 空状态：两个按钮「上传本地文件」+「粘贴 URL」
 *   · 有值状态：展示"文件名 + 当前 URL + 清除按钮"，并让 <video>/<audio> 元素直接播放预览
 *     （URL 形式是 /uploads/xxx 走 vite proxy，https:// 直链直接播）
 *   · 上传中：按钮替换为"上传中… XX%"（没有分块进度，先用简单的 pending 文本）
 *   · 文件超限 / 扩展名错：本地 uploadRefMedia 会抛，onError 回调让父组件 toast
 *
 * 为什么不像 FrameSlot 那样显示缩略图：
 *   · 视频缩略图要 seek → drawImage，浏览器跨域会 CORS 炸；这里偷懒只播
 *   · 音频压根没有"缩略图"概念，一个 <audio controls /> 就够作者耳检
 *
 * 'error' + 'warning' 两级 toast 在父组件做，这里职责单一：收集输入并 onPicked。
 */
function RefMediaSlot({
  kind,
  label,
  url,
  name,
  onPicked,
  onClear,
  onError,
}: {
  kind: RefMediaKind
  label: string
  url: string
  name: string
  onPicked: (url: string, name: string) => void
  onClear: () => void
  onError: (message: string) => void
}): JSX.Element {
  const [uploading, setUploading] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteValue, setPasteValue] = useState('')
  const acceptAttr =
    kind === 'video'
      ? 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.m4v,.webm'
      : 'audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac'
  const maxBytes = kind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES

  async function onFileChosen(f: File): Promise<void> {
    // 上传前做一次 size 预检，省一次网络往返
    if (f.size > maxBytes) {
      onError(
        `${kind} 文件 ${Math.round(f.size / (1024 * 1024))}MB 超过上限 ` +
          `${Math.round(maxBytes / (1024 * 1024))}MB`,
      )
      return
    }
    setUploading(true)
    try {
      // 不再上传到本机 Flask（已退役）：登记为本地 blob: URL，提交任务时由
      // 宿主 litellm 视频网关现取现转 base64。
      const r = await uploadRefMedia(f, kind)
      onPicked(r.url, r.originalName)
    } catch (e) {
      onError(`${kind} 选取失败 · ${(e as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  function onPasteSubmit(): void {
    const u = pasteValue.trim()
    if (!u) {
      setPasteOpen(false)
      return
    }
    if (!/^https?:\/\//i.test(u)) {
      onError(`${kind} URL 必须以 http(s):// 开头`)
      return
    }
    // 尝试从 URL 末段抽一个 humanReadable name
    const guessName = u.split('/').pop()?.split('?')[0] || u
    onPicked(u, guessName)
    setPasteValue('')
    setPasteOpen(false)
  }

  // blob: 对象 URL 与 https:// 直链都可直接给 <video>/<audio> 播放预览。
  const previewSrc = url || undefined

  return (
    <div className={`ks-pt-refmedia-slot ${url ? 'has-media' : ''}`}>
      <div className="ks-pt-refmedia-head">
        <span className="ks-pt-refmedia-label">{label}</span>
        {url && (
          <button
            type="button"
            className="ks-pt-refmedia-btn"
            title="清除"
            onClick={onClear}
          >
            ✕
          </button>
        )}
      </div>

      {url ? (
        <div className="ks-pt-refmedia-body">
          <div className="ks-pt-refmedia-name ks-mono" title={url}>
            {name || url}
          </div>
          {kind === 'video' ? (
            <video
              className="ks-pt-refmedia-preview"
              src={previewSrc}
              controls
              preload="metadata"
              muted
            />
          ) : (
            <audio
              className="ks-pt-refmedia-preview"
              src={previewSrc}
              controls
              preload="metadata"
            />
          )}
          <span className="ks-pt-refmedia-url ks-mono ks-faint" title={url}>
            {url.length > 60 ? `${url.slice(0, 58)}…` : url}
          </span>
        </div>
      ) : pasteOpen ? (
        <div className="ks-pt-refmedia-paste">
          <input
            className="ks-pt-refmedia-input ks-mono"
            type="url"
            placeholder={
              kind === 'video'
                ? 'https://your-cdn/motion.mp4'
                : 'https://your-cdn/bgm.mp3'
            }
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onPasteSubmit()
              if (e.key === 'Escape') {
                setPasteValue('')
                setPasteOpen(false)
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="ks-pt-refmedia-btn"
            onClick={onPasteSubmit}
          >
            ✓
          </button>
          <button
            type="button"
            className="ks-pt-refmedia-btn"
            onClick={() => {
              setPasteValue('')
              setPasteOpen(false)
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        <div className="ks-pt-refmedia-actions">
          <label className="ks-pt-refmedia-btn" title={`上传本地${kind === 'video' ? '视频' : '音频'}`}>
            {uploading ? '上传中…' : '上传'}
            <input
              type="file"
              accept={acceptAttr}
              disabled={uploading}
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFileChosen(f)
                // 清 input 值，让作者可以重复选同一个文件
                e.target.value = ''
              }}
            />
          </label>
          <button
            type="button"
            className="ks-pt-refmedia-btn"
            onClick={() => setPasteOpen(true)}
          >
            粘贴 URL
          </button>
          <span className="ks-faint ks-mono ks-pt-refmedia-hint">
            {kind === 'video'
              ? '让 Seedance 复现相同镜头运动'
              : 'BGM / 环境声参考，生成画面节奏'}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * v6（P3-E）· FrameSlot 弹出式图片选择器。
 *
 *   · 候选来源：本 scene 已上传的 sceneImages + 各 shot 当前 keyframe
 *   · 点击缩略图 → onPick(mediaId) 并关闭
 *   · 点击背景空白处（或 ✕ 按钮）→ 关闭不改动
 *   · 不做分页：超过 12 张走内部滚动条，避免把整个 tab 撑长
 */
function FrameSlotPicker({
  candidates,
  onPick,
  onClose,
}: {
  candidates: Array<{ mediaId: string; label: string; source: 'sceneImage' | 'shot' }>
  onPick: (mediaId: string) => void
  onClose: () => void
}): JSX.Element {
  const entries = useMediaStore((s) => s.entries)
  return (
    <div
      className="ks-pt-frame-picker"
      role="dialog"
      aria-label="挑选参考图"
      onClick={(e) => {
        // 背景层点击即关；内容由内部 onClick 阻断冒泡
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ks-pt-frame-picker-body" onClick={(e) => e.stopPropagation()}>
        <div className="ks-pt-frame-picker-head">
          <span className="ks-mono">挑选参考图 · {candidates.length}</span>
          <button
            type="button"
            className="ks-pt-frame-slot-btn"
            onClick={onClose}
            title="取消"
          >
            ✕
          </button>
        </div>
        <div className="ks-pt-frame-picker-grid">
          {candidates.map((c) => {
            const entry = entries[c.mediaId]
            return (
              <button
                key={c.mediaId}
                type="button"
                className="ks-pt-frame-picker-item"
                onClick={() => onPick(c.mediaId)}
                title={c.label}
              >
                {entry ? (
                  <img src={entry.url} alt={c.label} />
                ) : (
                  <span className="ks-faint ks-mono">?</span>
                )}
                <span className="ks-pt-frame-picker-tag">
                  {c.source === 'shot' ? 'SHOT' : 'SCENE'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}


function VideoPromptTab({ scene }: { scene: Scene }) {
  const setScenePrompts = useScenarioStore((s) => s.setScenePrompts)
  const setSceneMediaRef = useScenarioStore((s) => s.setSceneMediaRef)
  const characters = useScenarioStore((s) => s.scenario.characters ?? EMPTY_CHARS_PT)
  const ingestMedia = useMediaStore((s) => s.ingest)
  const getMediaEntryVideo = useMediaStore((s) => s.get)
  const cacheRecord = useSceneImageCache((s) => s.records[scene.id])
  const settings = useSettingsStore((s) => s.videoConfig)
  const scenarioVideoCfg = useScenarioStore((s) => s.scenario.videoConfig)
  // 仅用于上传层打码 gate：写实风格才打码，非写实跳过。
  const visualStyle = useScenarioStore((s) => s.scenario.visualStyle)
  const toast = useFireToast()
  // 重要安全约束：apiKey/apiBase 永远来自 settingsStore（localStorage 本机），
  // 不会从 scenario JSON 注入；scenario 只能影响 model/duration/size 这种"项目级配置"字段
  const cfg = { ...settings, ...(scenarioVideoCfg ?? {}) }

  const videoProvider = useMemo(() => createVideoProvider(cfg), [
    cfg.provider,
    cfg.apiKey,
    cfg.apiBase,
    cfg.model,
  ])
  const txtClient = useMemo(() => createTextProvider(), [])

  /**
   * v4 · 订阅 videoTaskStore 里"当前 scene 最近一条任务"。
   *   · 提交后 store 拿到 taskId → 每次轮询 patch → 组件自动重渲染
   *   · 切 tab 或刷新后 resumeRunningVideoTasks 会重建 poll，store 继续更新
   *   · 仍保留本地 status 作为"当次交互状态"（显示生成按钮禁用/出错红框）
   */
  const latestTask = useVideoTaskStore((s) => {
    const ids = s.sceneIndex[scene.id] ?? []
    const sorted = ids
      .map((id) => s.tasks[id])
      .filter((t) => !!t)
      .sort((a, b) => b.createdAt - a.createdAt)
    return sorted[0]
  })

  const sceneText = scene.prompts?.scene ?? scene.media.prompt ?? ''
  const value = scene.prompts?.video ?? ''
  // v3.9.7：textarea value 即最终视频 prompt。
  //   旧版用 `【画面参考·图1】... 【时间码动作】...` 二次拼接 → 作者看不见真实
  //   prompt；skill 本身会在锻造时把画面引用 + 时间码结构一次性产出，textarea
  //   里就是最终文本。生图的参考图通过 referenceImageDataUrl 单独传给 provider。

  /**
   * v5（P3）· 首/尾帧选择。
   *
   * 数据源（按优先级自动填充）：
   *   · 起始帧 startRefMediaId = shot.startFrameMediaRef (ab 策略)
   *                        ?? scene.keyShot.keyframeMediaRef
   *                        ?? sceneImageCache (老路径)
   *   · 尾帧   endRefMediaId  = shot.endFrameMediaRef (ab 策略)
   *                        ?? 同 scene 最后一个 shot 的 keyframeMediaRef
   *
   * 作者可以：
   *   · 点 ✕ 清除任一端（start 清掉就退回文生视频；end 清掉就走单首帧）
   *   · 这些选择只影响"本次手动生成"，不写回 scene 数据结构；重新打开 scene
   *     恢复自动默认 —— 保持"快速覆盖实验 + 不污染剧本数据"的语义
   */
  const shotsList = scene.shots ?? []
  const keyShotId = scene.keyShotId ?? shotsList[0]?.id
  const keyShot = shotsList.find((sh) => sh.id === keyShotId)
  const tailShot = shotsList[shotsList.length - 1]
  const autoStartMediaId =
    keyShot?.startFrameMediaRef ?? keyShot?.keyframeMediaRef
  const autoEndMediaId =
    keyShot?.endFrameMediaRef ??
    (tailShot?.id !== keyShot?.id ? tailShot?.keyframeMediaRef : undefined)

  const [startOverride, setStartOverride] = useState<string | null | undefined>(undefined)
  const [endOverride, setEndOverride] = useState<string | null | undefined>(undefined)
  // undefined = 跟随自动；null = 作者明确清除；string = 作者明确覆盖为某 mediaId
  const effectiveStartMediaId =
    startOverride === null ? undefined : (startOverride ?? autoStartMediaId)
  const effectiveEndMediaId =
    endOverride === null ? undefined : (endOverride ?? autoEndMediaId)
  const startEntryUrl = effectiveStartMediaId
    ? getMediaEntryVideo(effectiveStartMediaId)?.url
    : undefined
  const endEntryUrl = effectiveEndMediaId
    ? getMediaEntryVideo(effectiveEndMediaId)?.url
    : undefined

  // ========================================================================
  // v6（P4）· 参考视频 / 参考音频
  // ========================================================================
  // 设计基调与 startOverride / endOverride 对齐：
  //   · 本 tab 内 state，不写回 scenario → "本次实验性覆盖"
  //   · 两种来源：本地上传 → /uploads/xxx；作者粘贴 → 公网 https URL
  //   · refVideoUrl / refAudioUrl 存的都是"最终要塞进 provider.createTask 的 URL"
  //     —— /uploads/xxx 和 https:// 都合法，后端会做最终解析
  //   · refVideoName / refAudioName 仅用来 UI 提示"这是哪个文件"，不参与 API
  const [refVideoUrl, setRefVideoUrl] = useState<string>('')
  const [refVideoName, setRefVideoName] = useState<string>('')
  const [refAudioUrl, setRefAudioUrl] = useState<string>('')
  const [refAudioName, setRefAudioName] = useState<string>('')

  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending'; stage: string; elapsed: number }
    | {
        kind: 'done'
        url: string
        latencyMs: number
        taskId: string
        warnings?: string[]
      }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const [forgeStatus, setForgeStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'forging' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function forgePrompt(): Promise<void> {
    // v3.9.7：锻造时永远吃最新的 scene.prompts.scene（sceneText），作者说
    //   "如果直接走之前流程下来的提示词，就显示之前的提示词，然后如果这一镜
    //    优化了关键帧，你就锻造提示词，跟前面场景生成的提示词同步一下"
    //   —— 单按钮就够：每次锻造 scenePrompt 自动同步最新版。
    if (!sceneText.trim()) {
      setForgeStatus({
        kind: 'error',
        message: '请先在「场景生成」tab 写好画面提示词（视频要继承画面）',
      })
      return
    }
    setForgeStatus({ kind: 'forging' })
    toast(`锻造中 · 场景「${scene.title}」的视频提示词`)
    try {
      const refs = pickCharacterRefs(scene.characterIds, characters)
      const motion =
        value.trim() ||
        '请基于画面，给出一个 5-10 秒的关键动作镜头：起势 → 触发 → 余波。'
      const res = await forgeVideoPrompt(txtClient, {
        scenePrompt: sceneText,
        motion,
        durationSec: cfg.durationSec ?? 5,
        characters: refs,
        keepUI: true,
      })
      setScenePrompts(scene.id, { video: res.prompt })
      setForgeStatus({ kind: 'idle' })
      toast('✓ 视频提示词已更新', { kind: 'success' })
    } catch (e) {
      setForgeStatus({ kind: 'error', message: (e as Error).message })
      toast(`锻造失败 · ${(e as Error).message}`, { kind: 'error' })
    }
  }

  async function generate(): Promise<void> {
    const prompt = value.trim() || sceneText.trim()
    if (!prompt) return
    setStatus({ kind: 'pending', stage: '提交任务…', elapsed: 0 })
    toast(`视频生成已提交 · 场景「${scene.title}」`)
    const tStart = performance.now()
    // v5（P3）· 首尾帧优先用 UI 选择的 startEntryUrl/endEntryUrl。
    //   退路（作者完全没选）：仍保留 sceneImageCache 的 dataUrl 作 start ——
    //   这是上一代"只有一个参考图"时期唯一的降级路径，刚好和 referenceImageDataUrl
    //   的 contract 对齐，Provider 会把它当 startFrame。
    const fallbackStart =
      cacheRecord?.status === 'ready' ? cacheRecord.dataUrl : undefined
    const startForApi = startEntryUrl ?? fallbackStart
    const endForApi = endEntryUrl
    try {
      // 可 resume 的 Provider（LocalSeedance / Seedance）走"store+resume"双通道：
      //   · createTask 拿 taskId 立刻 upsert 到 store → 即便 unmount 也能 resume
      //   · pollTask 内部回调把最新 status 回写 store
      //   · providerKind 一起存进 store，resumeRunningVideoTasks 据此重建对应 Provider
      //   · Mock（或任何不实现 VideoTaskProvider 的 client）走 videoProvider.generate
      if (isVideoTaskProvider(videoProvider)) {
        const created = await videoProvider.createTask({
          prompt,
          startFrameImageUrl: startForApi,
          endFrameImageUrl: endForApi,
          durationSec: cfg.durationSec ?? 5,
          size: cfg.size ?? DEFAULT_VIDEO_SIZE,
          // v6（P4）· 参考视频 / 参考音频 URL（/uploads/xxx 或 https://...）
          referenceVideoUrl: refVideoUrl || undefined,
          referenceAudioUrl: refAudioUrl || undefined,
          visualStyle,
        })
        const { taskId } = created
        const providerKind = videoProvider.getProviderKind()
        // v6（P4）· 服务端对参考视频/音频的 "/uploads/ 本机不可达" 提醒
        if (created.warnings && created.warnings.length > 0) {
          for (const w of created.warnings) {
            toast(w, { kind: 'warning' })
          }
        }
        useVideoTaskStore.getState().upsert({
          taskId,
          remoteTaskId: created.remoteTaskId,
          sceneId: scene.id,
          status: 'generating',
          createdAt: Date.now(),
          lastMessage: '已提交，排队中',
          providerKind,
        })
        const result = await videoProvider.pollTask(taskId, {
          onUpdate: (t) => {
            const elapsed = Math.round(performance.now() - tStart)
            useVideoTaskStore.getState().patch(taskId, {
              status: t.status as 'generating' | 'downloading' | 'queued',
              apiStatus: t.api_status,
              lastMessage: `${t.status}${t.api_status ? ` · ${t.api_status}` : ''}`,
              elapsedMs: elapsed,
            })
            setStatus({
              kind: 'pending',
              stage: `${t.status}${t.api_status ? ` · ${t.api_status}` : ''}`,
              elapsed,
            })
          },
        })
        if (result.status !== 'completed' || !result.videoUrl) {
          useVideoTaskStore.getState().patch(taskId, {
            status: result.status,
            error: result.error,
            lastMessage: result.error ?? result.status,
          })
          throw new Error(
            `[TASK_FAILED] ${result.status} · ${result.error ?? '(no detail)'}`,
          )
        }
        const fetched = await fetch(result.videoUrl)
        const blob = await fetched.blob()
        const file = new File([blob], `${scene.id}.mp4`, {
          type: blob.type || 'video/mp4',
        })
        const id = ingestMedia(file)
        setSceneMediaRef(scene.id, { kind: 'VIDEO', ref: id })
        useVideoTaskStore.getState().patch(taskId, {
          status: 'completed',
          videoUrl: result.videoUrl,
          ingested: true,
          lastMessage: '完成',
        })
        const latency = Math.round(performance.now() - tStart)
        setStatus({ kind: 'done', url: result.videoUrl, latencyMs: latency, taskId })
        toast(`✓ 视频已生成 · ${Math.round(latency / 1000)}s`, { kind: 'success' })
        return
      }

      // 回退路径（Mock / 未实现 VideoTaskProvider 的 client）：不记 store
      const out = await videoProvider.generate({
        prompt,
        startFrameImageUrl: startForApi,
        endFrameImageUrl: endForApi,
        durationSec: cfg.durationSec ?? 5,
        size: cfg.size ?? DEFAULT_VIDEO_SIZE,
        referenceVideoUrl: refVideoUrl || undefined,
        referenceAudioUrl: refAudioUrl || undefined,
        visualStyle,
        onProgress: (msg, elapsed) => {
          setStatus({ kind: 'pending', stage: msg, elapsed })
        },
      })
      if (out.url) {
        const fetched = await fetch(out.url)
        const blob = await fetched.blob()
        const file = new File([blob], `${scene.id}.mp4`, {
          type: blob.type || 'video/mp4',
        })
        const id = ingestMedia(file)
        setSceneMediaRef(scene.id, { kind: 'VIDEO', ref: id })
      }
      setStatus({
        kind: 'done',
        url: out.url,
        latencyMs: out.latencyMs,
        taskId: out.taskId,
        warnings: out.warnings,
      })
      toast(
        `✓ 视频已生成 · ${Math.round(out.latencyMs / 1000)}s`,
        { kind: 'success' },
      )
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message })
      toast(`视频生成失败 · ${(e as Error).message}`, { kind: 'error' })
    }
  }

  return (
    <div className="ks-pt-body">
      <TextareaWithCopy
        rows={5}
        value={value}
        placeholder={
          '视频运动 / 镜头描述 —— 按「锻造视频提示词」会自动吃最新的场景画面\n' +
          '示例：[0-2 秒] 中景，男人停在门外，雨水顺手腕滴落。2.39:1 变形宽银幕。\n' +
          '       [3-5 秒] 镜头缓推到他的指节，门缝透出第二个人的影子。'
        }
        copyHint="复制视频提示词"
        onChange={(e) => setScenePrompts(scene.id, { video: e.target.value })}
      />

      <div className="ks-pt-meta ks-mono">
        Provider · {videoProvider.getProviderName()} ·{' '}
        <span className="ks-faint">{videoProvider.getModel()}</span>
        {videoProvider.getProviderName() === 'Mock' && (
          <span className="ks-pt-warn"> · 未填 API key（左栏 视频设置）</span>
        )}
      </div>

      {/* v5（P3）· 首帧 / 尾帧 可视化槽位
        * ──────────────────────────────────────────────────────────────
        * · 默认跟随 shot/scene 自动选图（见 autoStartMediaId / autoEndMediaId）
        * · 作者点 ✕ 可清除；点 ⟳ 可恢复默认
        * · 无图 → 灰色空槽 + 文字提示"点选分镜关键帧自动填"
        * · seedance 用首尾帧最多 2 张；若作者还想补更多参考，走 BatchGenBar 的
        *   自动 refSet 路径（9 张），单次手工生成这里保持"两帧+提示词"的极简心智。
        * ──────────────────────────────────────────────────────────── */}
      <div className="ks-pt-frames">
        <FrameSlot
          label="起始帧"
          url={startEntryUrl}
          overridden={startOverride !== undefined}
          onClear={() => setStartOverride(null)}
          onReset={() => setStartOverride(undefined)}
          onPick={(mediaId) => setStartOverride(mediaId)}
          autoUrl={
            autoStartMediaId
              ? getMediaEntryVideo(autoStartMediaId)?.url
              : undefined
          }
          scene={scene}
        />
        <span className="ks-pt-frames-arrow ks-mono">→</span>
        <FrameSlot
          label="尾帧"
          url={endEntryUrl}
          overridden={endOverride !== undefined}
          onClear={() => setEndOverride(null)}
          onReset={() => setEndOverride(undefined)}
          onPick={(mediaId) => setEndOverride(mediaId)}
          autoUrl={
            autoEndMediaId
              ? getMediaEntryVideo(autoEndMediaId)?.url
              : undefined
          }
          scene={scene}
        />
      </div>

      {/* v6（P4）· 参考视频 / 参考音频
        * ──────────────────────────────────────────────────────────────
        * · 运镜参考视频 —— 让 Seedance 复现这段镜头运动（推/拉/摇/甩）
        * · BGM 参考音频 —— 让 Seedance 生成与音轨氛围贴合的画面节奏
        * · 两种来源可选：选取本地文件（登记为 blob: URL，提交时由宿主 litellm
        *   网关转 base64）或直接粘贴公网 URL（作者已有 CDN 时首选）
        * · 大体积素材转 base64 后请求体较大；UI 这里只提交 URL，具体提醒已在
        *   生成按钮点下后 toast 出来
        * ──────────────────────────────────────────────────────────── */}
      <div className="ks-pt-refmedia">
        <RefMediaSlot
          kind="video"
          label="参考视频（运镜）"
          url={refVideoUrl}
          name={refVideoName}
          onPicked={(url, name) => {
            setRefVideoUrl(url)
            setRefVideoName(name)
          }}
          onClear={() => {
            setRefVideoUrl('')
            setRefVideoName('')
          }}
          onError={(msg) => toast(msg, { kind: 'error' })}
        />
        <RefMediaSlot
          kind="audio"
          label="参考音频（BGM / 氛围）"
          url={refAudioUrl}
          name={refAudioName}
          onPicked={(url, name) => {
            setRefAudioUrl(url)
            setRefAudioName(name)
          }}
          onClear={() => {
            setRefAudioUrl('')
            setRefAudioName('')
          }}
          onError={(msg) => toast(msg, { kind: 'error' })}
        />
      </div>

      <div className="ks-pt-actions">
        <button
          type="button"
          className="ks-pt-btn"
          onClick={forgePrompt}
          disabled={forgeStatus.kind === 'forging'}
          title="用 Opus 4.6 + cinema-video-prompt skill 锻造时间码视频提示词（自动吃最新的场景画面提示词）"
        >
          {forgeStatus.kind === 'forging' ? '锻造中…' : '锻造视频提示词'}
        </button>
        <button
          type="button"
          className="ks-pt-btn is-primary"
          onClick={generate}
          disabled={(!value.trim() && !sceneText.trim()) || status.kind === 'pending'}
          title={`用 ${videoProvider.getProviderName()} 生成视频${status.kind === 'done' ? '（覆盖旧稿）' : ''}`}
        >
          {status.kind === 'pending'
            ? '生成中…'
            : status.kind === 'done'
              ? '重新生成'
              : '生成视频'}
        </button>
      </div>
      {forgeStatus.kind === 'error' && (
        <div className="ks-pt-state ks-state-error ks-mono">
          {forgeStatus.message}
        </div>
      )}

      {status.kind === 'pending' && (
        <div className="ks-pt-state ks-state-pending">
          <span className="ks-mono">◆ {status.stage} · {Math.round(status.elapsed / 1000)}s</span>
          <span className="ks-faint ks-mono">
            seedance 一般需要 60-180 秒；浏览器不要切到后台
          </span>
        </div>
      )}
      {/* v4 · 当本地 status.kind === 'idle' 时，如果 store 里还有"上一次"
          任务的快照（可能是别的 tab 触发或刷新前的），就把它展示出来，
          这样 resume 成功后作者能在 VIDEO tab 里看到"xx 正在 generating · 38s"，
          而不是一片空白。*/}
      {status.kind === 'idle' && latestTask && (
        <div
          className={`ks-pt-state ${
            latestTask.status === 'completed'
              ? 'ks-state-done'
              : latestTask.status === 'failed' || latestTask.status === 'interrupted'
              ? 'ks-state-error'
              : 'ks-state-pending'
          }`}
        >
          <span className="ks-mono">
            ◆ 任务 {latestTask.taskId.slice(-6)} ·{' '}
            {latestTask.lastMessage ?? latestTask.status}
            {latestTask.elapsedMs
              ? ` · ${Math.round(latestTask.elapsedMs / 1000)}s`
              : ''}
          </span>
          {latestTask.videoUrl && (
            <a
              className="ks-pt-link ks-mono"
              href={latestTask.videoUrl}
              target="_blank"
              rel="noreferrer"
            >
              在新标签页打开 ↗
            </a>
          )}
          {latestTask.error && (
            <span className="ks-faint ks-mono">{latestTask.error}</span>
          )}
        </div>
      )}
      {status.kind === 'done' && (
        <div className="ks-pt-state ks-state-done">
          <span className="ks-section-title">视频已生成</span>
          {status.url && (
            <a
              className="ks-pt-link ks-mono"
              href={status.url}
              target="_blank"
              rel="noreferrer"
            >
              在新标签页打开 ↗
            </a>
          )}
          {status.warnings?.map((w, i) => (
            <div key={i} className="ks-pt-warn ks-mono">
              ⚠ {w}
            </div>
          ))}
        </div>
      )}
      {status.kind === 'error' && (
        <div className="ks-pt-state ks-state-error ks-mono">
          {status.message}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// 公用小件
// ─────────────────────────────────────────────────────────

function FieldHead({
  title,
  sub,
  hint,
  children,
}: {
  title: string
  sub?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="ks-pt-fieldhead">
      <div className="ks-pt-fieldhead-text">
        <span className="ks-pt-fieldhead-title">{title}</span>
        {sub && <span className="ks-pt-fieldhead-sub ks-mono">{sub}</span>}
        {hint && <span className="ks-pt-fieldhead-hint ks-mono">· {hint}</span>}
      </div>
      <div className="ks-pt-fieldhead-actions">{children}</div>
    </div>
  )
}

/*
 * v3.9.7：ComposedPreview 整块删除。
 *   作者原话："锻造好的提示词直接更新在场景画面提示词中" ——
 *   textarea 里就是最终 prompt，不再做二次包装/预览。
 *   composeImagePrompt 也一并删除（同理不再二次包装）。
 *   相关 CSS `.ks-pt-composed*` 保留（空声明），万一有别处还引用；
 *   下个版本清理。
 */

function CharacterAnchors({
  sceneCharacterIds,
  characters,
  onChange,
}: {
  sceneCharacterIds: string[]
  characters: Record<string, { id: string; name: string }>
  onChange: (ids: string[]) => void
}) {
  const list = Object.values(characters)
  if (list.length === 0) {
    return (
      <div className="ks-pt-anchors-empty ks-mono ks-faint">
        ◇ 角色库为空 · 在左栏「角色库」添加角色后，可勾选作为一致性锚点
      </div>
    )
  }
  return (
    <div className="ks-pt-anchors">
      <div className="ks-pt-anchors-label ks-mono">
        一致性锚点 · CHARACTERS IN SCENE
      </div>
      <div className="ks-pt-anchors-row">
        {list.map((c) => {
          const active = sceneCharacterIds.includes(c.id)
          return (
            <button
              key={c.id}
              type="button"
              className={`ks-pt-anchor ${active ? 'is-active' : ''}`}
              onClick={() => {
                onChange(
                  active
                    ? sceneCharacterIds.filter((x) => x !== c.id)
                    : [...sceneCharacterIds, c.id],
                )
              }}
            >
              <span className="ks-pt-anchor-dot" />
              {c.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 从 scene.characterIds + scenario.characters 抽出 forgeXxx 需要的轻量结构 */
function pickCharacterRefs(
  ids: string[] | undefined,
  characters: Record<string, { id: string; name: string; prompt: string }>,
): { name: string; prompt: string }[] {
  if (!ids || ids.length === 0) return []
  const out: { name: string; prompt: string }[] = []
  for (const id of ids) {
    const c = characters[id]
    if (c) out.push({ name: c.name, prompt: c.prompt })
  }
  return out
}

/*
 * v3.9.7：composeImagePrompt 已删除。
 *   之前用于把 scene.prompts.scene + 角色 prompts + 全局 UI 风格拼成
 *   "最终发给 image2 的字符串"，但作者骂"你现在的根本不是提示词，就
 *   只是简单的场景描述" —— 他希望锻造 skill 直接输出一段完整 prompt
 *   （已经含锚点 / 风格 / 景别的措辞），不再在前端做二次 "【xxx】" 包装。
 *   现在 SCENE tab 的 textarea value 就是**最终 prompt**，生图直接喂。
 */

const ptCss = `
.ks-pt {
  display: flex; flex-direction: column;
  gap: 12px;
}
.ks-pt-bar {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  /*
   * v3.9.4 · 下缘阴影缓冲 —— 修 "tab bar 与 body 硬切重叠" 的体感 bug。
   *
   * 背景：作者反馈——
   *   "两个按钮下方的内容，划上去之后，优化一下可视化，加个半透明阴影过度也行，
   *    现在重叠在一起了。"
   *
   * 现象：sticky 吸顶后，下方 body 滚上来会从 tab bar 底边硬切出现，
   *       活跃按钮（白填充）直接贴在正文标题上，视觉上"重叠"。
   *
   * 解法：给 bar 加一枚往下扩散的 box-shadow（y-offset=4, blur=10,
   *       低不透明度），正文滚到 bar 下方时会自然"虚化淡入"，不再硬切。
   *       用 box-shadow 比伪元素更简单、没有 overflow 裁切风险。
   */
  box-shadow:
    var(--ks-shadow-inset-hi),
    0 4px 10px -2px color-mix(in srgb, var(--ks-panel-solid) 55%, transparent),
    0 8px 18px -6px color-mix(in srgb, var(--ks-panel-solid) 35%, transparent);
  /* 常驻吸顶：滚动 Prompt 右侧栏时 tab bar 粘在顶端
   * 最近滚动祖先是 .ks-prompt-panel-body / .ks-stage-floater-body
   * 都是 overflow-y:auto —— sticky top:0 会贴到 padding-top 内边 */
  position: sticky;
  top: 0;
  z-index: 3;
  /* blur + 半透背景：滚动时底下内容透一层，不突兀 */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  background:
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--ks-panel-solid) 94%, transparent),
      color-mix(in srgb, var(--ks-panel-solid) 88%, transparent)
    );
}
/*
 * 进入动画：切 tab 时底下内容淡入一下，不直接硬替换。
 * 作者视角："重叠" ≈ 瞬切感太强，让人以为 UI 叠了。
 */
.ks-pt-body {
  animation: ks-pt-body-in 160ms var(--ks-ease);
}
@keyframes ks-pt-body-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ks-pt-tab {
  all: unset;
  cursor: pointer;
  display: flex; flex-direction: column; align-items: center;
  gap: 1px;
  /* 扁一点：上下 padding 从 8px 收到 4px */
  padding: 4px 6px;
  border-radius: var(--ks-radius-pill);
  color: var(--ks-text-soft);
  transition: all var(--ks-dur-fast) var(--ks-ease);
  text-align: center;
}
.ks-pt-tab:hover { color: var(--ks-text); background: rgba(28, 22, 15, 0.04); }
.ks-pt-tab.is-active {
  background: #fff;
  color: var(--ks-amber);
  box-shadow:
    0 1px 2px rgba(28, 22, 15, 0.05),
    0 4px 12px rgba(255, 123, 61, 0.14);
}
.ks-pt-tab-label { font-size: 12.5px; font-family: var(--ks-font-ui); font-weight: 500; }
.ks-pt-tab-sub { font-family: var(--ks-font-mono); font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase; }

.ks-pt-body {
  display: flex; flex-direction: column;
  gap: 10px;
}

.ks-pt-fieldhead {
  display: flex; justify-content: space-between; align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--ks-border-soft);
  gap: 8px;
}
.ks-pt-fieldhead:first-child { border-top: 0; padding-top: 0; }
.ks-pt-fieldhead-text {
  display: flex; align-items: baseline; gap: 10px;
  font-size: 12px;
  flex-wrap: wrap;
}
.ks-pt-fieldhead-title { color: var(--ks-text); font-weight: 600; font-size: 13px; }
.ks-pt-fieldhead-sub {
  font-family: var(--ks-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.22em;
  color: var(--ks-amber);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-pt-fieldhead-hint {
  font-size: 11px;
  color: var(--ks-text-faint);
}
.ks-pt-fieldhead-actions { display: inline-flex; gap: 4px; }

.ks-pt-actions {
  display: flex; gap: 8px; align-items: center;
}
/* ─────────────────────────────────────────────────────────────────
 * ks-pt-btn —— 统一的场景动作按钮
 *
 * 2026-04 重写：旧版有两个分别撞色的 action-primary（青）+ action-secondary（琥珀），
 * 文案还带着 "⚒ Opus 锻造提示词" / "↻ 用 GPT-Image-2 生成画面" 长句。
 * 作者原话："这两个按钮现在做的非常差……简单点显示不好吗？"
 *
 * 取向：
 *   - 同款极简药丸，描边 + 低饱和底色；区分 primary/secondary 只靠"描边色"
 *   - 文案压到 2-5 个中文字（"锻造提示词" / "生成画面" / "重新生成"）
 *   - 不带装饰符号（⚒ / ↻）—— 文字自己就能承载语义，单字符反而增噪
 *   - 保留 is-primary 主按钮的琥珀描边，作为视觉锚点
 * ────────────────────────────────────────────────────────────────── */
.ks-pt-btn {
  font-family: var(--ks-font-ui);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  padding: 7px 16px;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  color: var(--ks-text-soft);
  border-radius: var(--ks-radius-pill);
  cursor: pointer;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-pt-btn:hover:not(:disabled) {
  border-color: var(--ks-border-strong);
  color: var(--ks-text);
  background: var(--ks-panel-solid);
}
.ks-pt-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ks-pt-btn.is-primary {
  border-color: var(--ks-amber);
  color: var(--ks-amber);
  background: var(--ks-amber-soft);
}
.ks-pt-btn.is-primary:hover:not(:disabled) {
  background: rgba(255, 123, 61, 0.18);
  box-shadow: var(--ks-shadow-soft);
}
.ks-pt-err-chip {
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--ks-rose);
  padding: 4px 10px;
  border: 1px solid rgba(240, 119, 157, 0.4);
  background: rgba(240, 119, 157, 0.08);
  border-radius: var(--ks-radius-pill);
  cursor: help;
}

.ks-pt-meta {
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ks-text-dim);
}
.ks-pt-warn { color: var(--ks-amber); font-weight: 600; }

.ks-pt-state {
  padding: 12px 14px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  font-size: 12px;
  display: flex; flex-direction: column; gap: 4px;
  background: var(--ks-panel-solid);
}
.ks-state-pending {
  border-color: rgba(108, 143, 184, 0.32);
  background: rgba(108, 143, 184, 0.05);
}
.ks-state-done {
  border-color: rgba(111, 199, 168, 0.4);
  background: rgba(111, 199, 168, 0.06);
}
.ks-state-error {
  border-color: rgba(240, 119, 157, 0.4);
  background: rgba(240, 119, 157, 0.06);
  color: #b1335a;
  word-break: break-all;
}
.ks-pt-link { color: var(--ks-cyan); text-decoration: none; font-weight: 500; }
.ks-pt-link:hover { text-decoration: underline; }

.ks-pt-anchors {
  padding: 10px 12px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-solid);
  display: flex; flex-direction: column; gap: 8px;
}
.ks-pt-anchors-empty {
  padding: 6px 0;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--ks-text-dim);
}
.ks-pt-anchors-label {
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.24em;
  color: var(--ks-amber);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-pt-anchors-row {
  display: flex; gap: 6px; flex-wrap: wrap;
}
.ks-pt-anchor {
  all: unset;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px;
  font-size: 11.5px;
  font-weight: 500;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-pill);
  color: var(--ks-text-soft);
  background: var(--ks-panel-elev);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-pt-anchor:hover {
  border-color: var(--ks-cyan);
  color: var(--ks-cyan);
  background: rgba(108, 143, 184, 0.08);
}
.ks-pt-anchor.is-active {
  border-color: var(--ks-amber);
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
}
.ks-pt-anchor-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: currentColor;
}

/* v3 · shot framing chip row —— 紧凑排布，复用 .ks-pt-anchor chip 样式 */
.ks-pt-shot-framing {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ks-pt-shot-hint {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--ks-amber);
  align-self: center;
}

/* v3.5 · Shot Strip —— 横向镜头缩略列表 */
.ks-pt-shot-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0 4px;
  border-bottom: 1px solid var(--ks-border-soft);
}
.ks-pt-shot-strip-list {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  scrollbar-width: thin;
  padding-bottom: 2px;
}
.ks-pt-shot-chip {
  all: unset;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 56px;
  border: 1.5px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-elev);
  overflow: hidden;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-pt-shot-chip:hover { border-color: var(--ks-border-strong); }
.ks-pt-shot-chip.is-active {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 2px var(--ks-amber-soft);
}
.ks-pt-shot-chip.is-key .ks-pt-shot-chip-label {
  color: var(--ks-amber);
}
.ks-pt-shot-chip-thumb {
  width: 56px;
  height: 36px;
  object-fit: cover;
  display: block;
}
.ks-pt-shot-chip-placeholder {
  width: 56px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--ks-text-dim);
  background: var(--ks-panel-solid);
}
.ks-pt-shot-chip-label {
  font-size: 8.5px;
  letter-spacing: 0.2em;
  color: var(--ks-text-faint);
  text-transform: uppercase;
  padding-bottom: 3px;
}

/* v3.5 · 本镜关键帧缩略预览 */
.ks-pt-shot-keyframe-preview {
  width: 100%;
  max-height: 140px;
  object-fit: cover;
  border-radius: var(--ks-radius-sm);
  border: 1px solid var(--ks-border-soft);
  display: block;
}

/* v3.5 · 一键生成所有分镜按钮 */
.ks-pt-btn-batch {
  flex-shrink: 0;
  font-size: 11px;
  white-space: nowrap;
  border-color: var(--ks-cyan);
  color: var(--ks-cyan);
  background: rgba(108, 143, 184, 0.06);
}
.ks-pt-btn-batch:hover:not(:disabled) {
  background: rgba(108, 143, 184, 0.14);
  border-color: var(--ks-cyan);
}
.ks-pt-btn-batch.is-pending {
  opacity: 0.7;
  cursor: wait;
}

/* v3.5 · 修改本镜展开区 */
.ks-pt-refine {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(108, 143, 184, 0.3);
  border-radius: var(--ks-radius-md);
  background: rgba(108, 143, 184, 0.04);
}
.ks-pt-refine-input {
  resize: vertical;
}
.ks-pt-btn.is-active-subtle {
  border-color: var(--ks-cyan);
  color: var(--ks-cyan);
  background: rgba(108, 143, 184, 0.08);
}

.ks-pt-composed {
  padding: 10px 12px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-md);
  font-size: 12px;
  background: var(--ks-panel-solid);
}
.ks-pt-composed[open] {
  background: var(--ks-amber-soft);
  border-color: rgba(255, 123, 61, 0.3);
}
.ks-pt-composed summary {
  cursor: pointer;
  color: var(--ks-text-dim);
  font-family: var(--ks-font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 600;
}
.ks-pt-composed > .ks-cn {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ks-text-soft);
  margin: 8px 0;
  white-space: pre-wrap;
}
/* v3.9.6：未注入锚点时在 summary 里贴个小 tag，提示作者"你还没勾选角色锚点" */
.ks-pt-composed-tag {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--ks-text-faint);
  border: 1px solid var(--ks-border-soft);
  border-radius: 999px;
  text-transform: none;
}
/* v3.9.6：空态占位 —— 作者还没输入场景 prompt 时，UI 仍保持相同结构 */
.ks-pt-composed-empty {
  padding: 10px 4px;
  font-size: 12px;
  line-height: 1.7;
}
/* v3.9.6：同 .ks-cn 的视觉继承，显式命名避免未来样式漂移 */
.ks-pt-composed-body { /* 占位 class，样式由 .ks-cn 提供 */ }

/* ── v3.9.5 · FramingPicker (SCENE tab 内"镜头景别"chips) ─────── */
.ks-pt-framing {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-elev);
}
.ks-pt-framing-head {
  display: flex; align-items: baseline; gap: 8px;
  flex-wrap: wrap;
}
.ks-pt-framing-title { font-size: 12px; font-weight: 600; color: var(--ks-text); }
.ks-pt-framing-sub {
  font-family: var(--ks-font-mono);
  font-size: 9px;
  letter-spacing: 0.22em;
  color: var(--ks-amber);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-pt-framing-hint {
  font-size: 10.5px;
  color: var(--ks-text-faint);
  margin-left: auto;
}
.ks-pt-framing-chips {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(68px, 1fr));
  gap: 4px;
}
.ks-pt-framing-chip {
  all: unset;
  cursor: pointer;
  display: flex; flex-direction: column; align-items: center;
  gap: 1px;
  padding: 4px 6px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-panel-solid);
  color: var(--ks-text-soft);
  transition: all var(--ks-dur-fast) var(--ks-ease);
  text-align: center;
}
.ks-pt-framing-chip:hover {
  border-color: var(--ks-amber);
  color: var(--ks-text);
}
.ks-pt-framing-chip.is-active {
  background: var(--ks-amber-soft);
  border-color: var(--ks-amber);
  color: var(--ks-amber);
  box-shadow: 0 1px 2px rgba(28, 22, 15, 0.05);
}
.ks-pt-framing-chip-label { font-size: 11.5px; font-weight: 500; }
.ks-pt-framing-chip-sub {
  font-family: var(--ks-font-mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  opacity: 0.75;
}

/* ── v4 · SCENE tab 内"当前分镜"子区 ──────────────────────── */
.ks-pt-shot-subpanel {
  margin-top: 8px;
  padding: 10px 12px 6px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-elev);
  display: flex; flex-direction: column;
}
.ks-pt-shot-subpanel-head {
  display: flex; align-items: baseline; gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.ks-pt-shot-subpanel-title {
  font-size: 12px; font-weight: 600; color: var(--ks-text);
}
.ks-pt-shot-subpanel-sub {
  font-family: var(--ks-font-mono);
  font-size: 9px;
  letter-spacing: 0.22em;
  color: var(--ks-cyan);
  text-transform: uppercase;
  font-weight: 600;
}
.ks-pt-shot-subpanel-hint {
  font-size: 10.5px;
  color: var(--ks-text-faint);
  margin-left: auto;
}

/* v5（P3）· 本镜历史版本条 ────────────────────────────────────────── */
.ks-pt-history {
  margin-top: 8px;
  padding: 8px 0;
  border-top: 1px dashed var(--ks-border);
}
.ks-pt-history-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.ks-pt-history-title {
  font-size: 12.5px;
  color: var(--ks-text);
  font-weight: 600;
}
.ks-pt-history-sub {
  font-size: 10.5px;
  color: var(--ks-text-faint);
}
.ks-pt-history-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}
.ks-pt-history-item {
  position: relative;
  flex: 0 0 auto;
  width: 96px;
  height: 54px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--ks-border);
  background: transparent;
  cursor: pointer;
  padding: 0;
}
.ks-pt-history-item:hover { border-color: var(--ks-accent, #6cf); }
.ks-pt-history-item.is-current {
  border-color: var(--ks-accent, #6cf);
  box-shadow: 0 0 0 1px var(--ks-accent, #6cf);
  cursor: default;
}
.ks-pt-history-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ks-pt-history-current {
  position: absolute;
  bottom: 2px;
  right: 2px;
  font-size: 9.5px;
  padding: 1px 4px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  border-radius: 3px;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
}

/* v5（P3）· 首/尾帧槽位 ─────────────────────────────────────────── */
.ks-pt-frames {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0 4px;
}
.ks-pt-frames-arrow {
  color: var(--ks-text-faint);
  font-size: 14px;
  line-height: 1;
}
.ks-pt-frame-slot {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  aspect-ratio: 16 / 9;
  max-width: 180px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px dashed var(--ks-border);
  background: color-mix(in oklab, currentColor 4%, transparent);
  display: grid;
  place-items: center;
}
.ks-pt-frame-slot.has-img { border-style: solid; }
.ks-pt-frame-slot img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ks-pt-frame-slot-label {
  position: absolute;
  top: 4px;
  left: 6px;
  font-size: 10px;
  color: #fff;
  background: rgba(0,0,0,0.55);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  pointer-events: none;
}
.ks-pt-frame-slot-empty {
  font-size: 10.5px;
  color: var(--ks-text-faint);
  text-align: center;
  padding: 0 8px;
}
.ks-pt-frame-slot-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  gap: 3px;
}
.ks-pt-frame-slot-btn {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  display: grid; place-items: center;
}
.ks-pt-frame-slot-btn:hover { background: rgba(0,0,0,0.8); }

/* v6（P3-E）· Picker 浮层 ── 居中半透明遮罩 + grid ───────────────────── */
.ks-pt-frame-picker {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: grid;
  place-items: center;
  z-index: 9990;
  animation: ks-pt-picker-in 120ms ease-out;
}
@keyframes ks-pt-picker-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.ks-pt-frame-picker-body {
  width: min(560px, 92vw);
  max-height: 72vh;
  background: var(--ks-panel-solid);
  color: var(--ks-text);
  border: 1px solid var(--ks-border-soft);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ks-pt-frame-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ks-border-soft);
}
.ks-pt-frame-picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
}
.ks-pt-frame-picker-item {
  position: relative;
  aspect-ratio: 16 / 9;
  border: 1px solid var(--ks-border);
  border-radius: 6px;
  overflow: hidden;
  background: color-mix(in oklab, currentColor 4%, transparent);
  cursor: pointer;
  padding: 0;
}
.ks-pt-frame-picker-item:hover {
  border-color: var(--ks-accent, #6cf);
}
.ks-pt-frame-picker-item img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.ks-pt-frame-picker-tag {
  position: absolute;
  bottom: 3px;
  left: 3px;
  font-size: 9.5px;
  padding: 1px 4px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  border-radius: 3px;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  pointer-events: none;
}

/* ========================================================================
 * v6（P4）· 参考视频 / 参考音频槽（RefMediaSlot）
 * ======================================================================== */
.ks-pt-refmedia {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 6px 0 2px;
}
.ks-pt-refmedia-slot {
  border: 1px dashed var(--ks-border, #3a3e48);
  border-radius: 6px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.015);
  transition: border-color .15s ease, background .15s ease;
}
.ks-pt-refmedia-slot.has-media {
  border-style: solid;
  border-color: var(--ks-accent, #7aa2f7);
  background: rgba(122,162,247,0.045);
}
.ks-pt-refmedia-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.ks-pt-refmedia-label {
  font-size: 12px;
  color: var(--ks-text-strong, #e5e7eb);
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-weight: 500;
}
.ks-pt-refmedia-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 2px 8px;
  font-size: 11.5px;
  color: var(--ks-text, #d1d5db);
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--ks-border, #3a3e48);
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  user-select: none;
}
.ks-pt-refmedia-btn:hover {
  background: rgba(255,255,255,0.08);
  border-color: var(--ks-accent, #7aa2f7);
}
.ks-pt-refmedia-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ks-pt-refmedia-hint {
  font-size: 11px;
  margin-left: 4px;
}
.ks-pt-refmedia-paste {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ks-pt-refmedia-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  font-size: 11.5px;
  background: var(--ks-bg-deep, #1d1f24);
  color: var(--ks-text, #d1d5db);
  border: 1px solid var(--ks-border, #3a3e48);
  border-radius: 4px;
  outline: none;
}
.ks-pt-refmedia-input:focus {
  border-color: var(--ks-accent, #7aa2f7);
}
.ks-pt-refmedia-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ks-pt-refmedia-name {
  font-size: 11.5px;
  color: var(--ks-text-strong, #e5e7eb);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ks-pt-refmedia-preview {
  width: 100%;
  max-height: 140px;
  background: #000;
  border-radius: 4px;
}
audio.ks-pt-refmedia-preview {
  height: 32px;
  background: rgba(0,0,0,0.25);
}
.ks-pt-refmedia-url {
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`
injectStyleOnce('prompt-tabs', ptCss)
