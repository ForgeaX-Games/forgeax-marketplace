import { useEffect, useRef, useState } from 'react'
import type { Character } from '../scenario/types'
import { useScenarioStore } from '../scenario/scenarioStore'
import { injectStyleOnce } from '../styles/injectStyle'
import { useMediaStore } from '../media/mediaStore'
import { useShellStore } from '../shell/shellStore'
import { runForgeImagePipeline } from '../llm/forgeImagePipeline'
import { createImageProvider, getModerationContext } from '../llm/GptImageProvider'
import { AssetPreviewDialog, type PreviewTarget } from './AssetPreviewDialog'
import { enqueueAuditions, auditionCardKey } from './enqueueAudition'
import { useCardJob, useGenerationQueue, type GenJob } from './generationQueueStore'
import { ForgeChatPanel } from './ForgeChatPanel'
import { VisualStyleSelector } from './VisualStyleSelector'
import { DirectorStyleSelector } from './DirectorStyleSelector'
import { UIStyleSelector } from './UIStyleSelector'
import { MinigamePoolSelector } from './MinigamePoolSelector'
import { NumericModule } from './modules/NumericModule'
import { InventoryModule } from './modules/InventoryModule'

/**
 * RefGrid 每张卡片的显示项 —— 继承 PreviewTarget，再叠加两个 UI 专用字段：
 *   - persistState：entry 的落盘状态，'failed' 时卡片右上角亮红色 ⟳ 重试按钮
 *   - mediaId：点 ⟳ 时要重试的具体 mediaId（= 角色/场所/道具的 ref 字段）
 * 这两个字段不传给 AssetPreviewDialog（它只要 PreviewTarget），通过 pick 过滤掉。
 */
interface RefGridItem extends PreviewTarget {
  persistState?: 'pending' | 'saved' | 'failed'
  mediaId?: string
  /*
   * v3.10 · 已积累的变体数量（character.appearanceVariants / prop.variants /
   * location.angleRefs 的 length）。卡片右下角拿来当 chip 显示，让作者一眼
   * 看到"这个角色已经有 3 套形态"或"这个场景已经攒了 2 个视角"。
   * 变体 = 0 时不渲染，免得每张卡都长个无意义的 0 号小章。
   */
  variantCount?: number
}

/**
 * ForgeTab —— 剧本锻造页。
 *
 * 布局（split）：
 *   ┌─────────────────────────────┬────────────────────────┐
 *   │ 左：参考图网格                │ 右：对话面板            │
 *   │  · 角色三视图                 │  · 想法 / 贴剧本 / 拖图  │
 *   │  · 场所基准图                 │  · 历史消息 & 附件       │
 *   │  · 开始生成按钮 + 进度        │  · 按 ⏎ 发送给 LLM      │
 *   └─────────────────────────────┴────────────────────────┘
 *
 * 为什么是这个布局（见作者反馈）：
 *   "一句话想法、贴剧本，去除，合并为一个对话窗口，在 forge 的右侧"
 *   "我上传给你的这个文件、以及我们的生成记录，图像、视频等，都有历史"
 *
 * 左右都自带滚动；右侧对话走 forgeChatStore（per-scenario 持久化），
 * 切 tab / 刷新不丢。LLM 返回后自动 loadScenario，左侧网格立刻刷新。
 */

/**
 * 单个失败项（`character/location/prop` 生图失败）的可展示形态。
 *
 * `moderation` 非空说明是被 Azure safety system 挡下来的 —— UI 会额外渲染一个
 * "查看完整 prompt"折叠按钮，让作者对着这段 prompt 改剧本。
 */
interface ForgeFailure {
  label: string
  message: string
  moderation?: ReturnType<typeof getModerationContext>
}
/**
 * ForgeWizard 入口属性.
 *
 * chatDetached: 当上层(ForgeTab)已经把 ForgeChatPanel 提到外壳常驻时, 这里
 * 就不再渲染右列 chat —— 否则会 chat 在外壳和 wizard 内被双倍渲染, 同一个
 * forgeChatStore 被两份订阅, 输入框冲突. 默认 false (老调用点不受影响).
 */
interface ForgeWizardProps {
  chatDetached?: boolean
}

export function ForgeWizard({ chatDetached = false }: ForgeWizardProps = {}) {
  return (
    <div
      className={`ks-forge-wizard${chatDetached ? ' is-chat-detached' : ''}`}
    >
      <div className="ks-forge-wizard-main">
        <RefsPanel />
      </div>
      {!chatDetached && (
        <div className="ks-forge-wizard-chat">
          <ForgeChatPanel />
        </div>
      )}
    </div>
  )
}

function RefsPanel() {
  const scenario = useScenarioStore((s) => s.scenario)
  const setCharacterTurnaroundRef = useScenarioStore((s) => s.setCharacterTurnaroundRef)
  const setLocationRefImage = useScenarioStore((s) => s.setLocationRefImage)
  const setPropRefImage = useScenarioStore((s) => s.setPropRefImage)
  const mediaEntries = useMediaStore((s) => s.entries)
  const ingestDataUrl = useMediaStore((s) => s.ingestDataUrl)
  const retryPersist = useMediaStore((s) => s.retryPersist)
  const setForgeProgress = useShellStore((s) => s.setForgeProgress)
  const imageSection = useShellStore((s) => s.imageSection)

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failures, setFailures] = useState<ForgeFailure[]>([])
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  /**
   * 正在后台重试落盘的 mediaId 集合 —— 为了让卡片 ⟳ 按钮在点击后立刻变 disabled
   * 避免重复派发。retryPersist 结束后从 set 里剥离。
   */
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set())

  /** 角色试镜视频批量生成状态（v7）—— 实时进度改由队列驱动。 */
  const [auditionError, setAuditionError] = useState<string | null>(null)
  /** 当前仍在排队 / 生成中的试镜 job 数（用于按钮文案与禁用）。 */
  const auditionActiveCount = useGenerationQueue((s) => {
    let n = 0
    for (const j of Object.values(s.jobs)) {
      if (
        j.cardKey?.startsWith('audition:') &&
        (j.status === 'queued' || j.status === 'running')
      )
        n += 1
    }
    return n
  })

  const characters = Object.values(scenario.characters ?? {})
  const locations = Object.values(scenario.locations ?? {})
  const props = Object.values(scenario.props ?? {})

  /**
   * "有图"的判据 —— 和卡片 url 条件严格一致：
   *   1) 有 ref 字段
   *   2) mediaStore 里能查到 entry 且 url 非空
   *   3) **entry 不是 failed 状态** —— failed 表示上次落盘挂了，scenario 虽然还留着
   *      m-xxx，但刷新就会变成悬空引用；把它算作"缺失"强制让"只生成缺失"覆盖它
   */
  const hasImg = (refId?: string): boolean => {
    if (!refId) return false
    const e = mediaEntries[refId]
    if (!e) return false
    if (!e.url) return false
    if (e.persistState === 'failed') return false
    return true
  }

  // 角色锚点 = 单张三视图定妆照（turnaroundRefImageId / 兼容旧 refImageId）。
  const charMissing = (c: Character): boolean =>
    !hasImg(c.turnaroundRefImageId ?? c.refImageId)
  const missingCounts = {
    characters: characters.filter(charMissing).length,
    locations: locations.filter((l) => !hasImg(l.refImageId)).length,
    props: props.filter((p) => !hasImg(p.refImageId)).length,
  }
  const missingTotal =
    missingCounts.characters + missingCounts.locations + missingCounts.props
  const allTotal = characters.length + locations.length + props.length

  const canRun = allTotal > 0

  /**
   * 执行生成。
   *
   * opts.onlyMissing = true（默认）：只跑缺失 / 失败的条目，避免浪费 API 预算、
   *   也避免覆盖掉作者已经确认的图。这条路径做法：按 hasImg 过滤后，
   *   构造一个"只含待生成条目"的 subset scenario 喂给 pipeline —— pipeline 本身
   *   遍历 scenario.characters/locations/props 全量，不需要改。
   *
   * opts.onlyMissing = false：作者显式要求"全部重生"（比如换风格后希望统一刷新），
   *   走弹确认后的老路径。
   */
  const handleRun = async (opts: { onlyMissing: boolean }): Promise<void> => {
    if (running || !canRun) return
    const { onlyMissing } = opts

    // onlyMissing=true 但现在啥都不缺 —— 直接提示一下；不发请求
    if (onlyMissing && missingTotal === 0) {
      setError('当前所有参考图都已经生成好了。如果想重刷，请点右侧「全部重生」。')
      return
    }

    setRunning(true)
    setError(null)
    setFailures([])

    const runChars = onlyMissing
      ? characters.filter(charMissing)
      : characters
    const runLocs = onlyMissing
      ? locations.filter((l) => !hasImg(l.refImageId))
      : locations
    const runProps = onlyMissing
      ? props.filter((p) => !hasImg(p.refImageId))
      : props
    const totalJobs = runChars.length + runLocs.length + runProps.length
    setProgress({ done: 0, total: totalJobs })
    setForgeProgress({ done: 0, total: totalJobs })

    console.info(
      `[reel-studio/forge] 开始生成参考图（${onlyMissing ? '只生成缺失' : '全部重生'}）`,
      {
        characters: runChars.length,
        locations: runLocs.length,
        props: runProps.length,
        totalJobs,
        skippedBecauseExisting: onlyMissing
          ? {
              characters: characters.length - runChars.length,
              locations: locations.length - runLocs.length,
              props: props.length - runProps.length,
            }
          : undefined,
      },
    )

    // 给 pipeline 的是 subset scenario —— 过滤后的角色/场所/道具。
    // 其它字段（visualStyle / uiStyle / 全局 prompts）仍然从原 scenario 透传，
    // 保证已生成的条目还能作为"一致性锚点"被 pipeline 内部读取。
    const subsetScenario: typeof scenario = {
      ...scenario,
      characters: Object.fromEntries(runChars.map((c) => [c.id, c])),
      locations: Object.fromEntries(runLocs.map((l) => [l.id, l])),
      props: Object.fromEntries(runProps.map((p) => [p.id, p])),
    }

    try {
      const client = createImageProvider()
      const summary = await runForgeImagePipeline({
        client,
        scenario: subsetScenario,
        skipShots: true,
        // mediaLookup 仍然读完整 mediaStore —— pipeline 内部可能需要参考"已经存在的其他角色/场所图"
        mediaLookup: (id) => useMediaStore.getState().entries[id]?.url,
        onCharacterRef: (id, result) => {
          const mid = ingestDataUrl(result.dataUrl, {
            name: `turnaround-${id}.png`,
            mimeType: result.mimeType,
            promptKind: 'character-ref',
            tags: ['turnaround'],
            humanReadableName: `角色定妆照 · ${id}`,
          })
          setCharacterTurnaroundRef(id, mid)
        },
        onLocationRef: (id, result) => {
          const mid = ingestDataUrl(result.dataUrl, {
            name: `location-${id}.png`,
            mimeType: result.mimeType,
            promptKind: 'location-ref',
            humanReadableName: `场景基准 · ${id}`,
          })
          setLocationRefImage(id, mid)
        },
        onPropRef: (id, result) => {
          const mid = ingestDataUrl(result.dataUrl, {
            name: `prop-${id}.png`,
            mimeType: result.mimeType,
            promptKind: 'prop-ref',
            humanReadableName: `道具参考 · ${id}`,
          })
          setPropRefImage(id, mid)
        },
        onProgress: (done, total) => {
          setProgress({ done, total })
          setForgeProgress({ done, total })
        },
      })
      const fails: ForgeFailure[] = [
        ...summary.characters.failed.map((f) => ({
          label: `角色 ${f.item.name}`,
          message: f.error.message,
          moderation: getModerationContext(f.error),
        })),
        ...summary.locations.failed.map((f) => ({
          label: `场所 ${f.item.location.name} · ${f.item.label}`,
          message: f.error.message,
          moderation: getModerationContext(f.error),
        })),
        ...summary.props.failed.map((f) => ({
          label: `道具 ${f.item.name}`,
          message: f.error.message,
          moderation: getModerationContext(f.error),
        })),
      ]
      setFailures(fails)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
      setForgeProgress(null)
    }
  }

  /**
   * "全部重生"按钮确认 —— 避免作者误点把已满意的图全覆盖。
   */
  const handleRegenerateAll = async (): Promise<void> => {
    if (running) return
    if (allTotal === 0) return
    const existing = allTotal - missingTotal
    if (existing > 0) {
      const ok = window.confirm(
        `将重新生成全部 ${allTotal} 张参考图，其中 ${existing} 张已经存在的会被覆盖。确定继续？`,
      )
      if (!ok) return
    }
    await handleRun({ onlyMissing: false })
  }

  /**
   * 角色「试镜视频 + 音色」批量生成（v7）。
   *
   * 仅对**已有单人参考图**的角色可跑（headshot/fullbody/turnaround/refImage 任一）。
   *   - onlyMissing=true：跳过已有 auditionVideoMediaId 的角色
   *   - onlyMissing=false：全部重生（覆盖旧试镜视频/音色）
   *
   * 统一入队 generationQueue（cardKey=audition:<id>，视频并发池）：实时进度/失败原因/
   * 重试由各角色卡浮层（AuditionTileStatus）+ 下方「生成队列」展示，不再阻塞式 await。
   */
  const handleGenerateAuditions = (opts: { onlyMissing: boolean }): void => {
    // 可生成的前提：有任一可用单人参考图（headshot / fullbody / turnaround / refImage）。
    const canRun = (c: Character): boolean =>
      hasImg(c.headshotMediaId) ||
      hasImg(c.fullbodyMediaId) ||
      hasImg(c.turnaroundRefImageId) ||
      hasImg(c.refImageId)
    const withRef = characters.filter(canRun)
    const runList = opts.onlyMissing
      ? withRef.filter((c) => !c.auditionVideoMediaId)
      : withRef
    if (runList.length === 0) {
      setAuditionError(
        withRef.length === 0
          ? '请先生成角色定妆照，再生成试镜视频。'
          : '所有有定妆照的角色都已生成试镜视频；如需重做请用「全部重生」。',
      )
      return
    }
    setAuditionError(null)
    // 统一走生成队列：每个角色一个 cardKey=audition:<id> 的 job，
    // 实时状态/进度/失败原因/重试改由各角色卡浮层 + 下方「生成队列」展示，
    // 不再阻塞式 await（切 tab/继续操作都不影响后台跑）。
    const group = `audition-${Date.now().toString(36)}`
    enqueueAuditions(runList, { group })
  }

  /**
   * 对单张失败图点"重试落盘"。
   *
   * 语义：仅把 mediaStore 里 persistState='failed' 的条目重新 POST 去 asset。
   * 不重新调用生图模型（省钱、也保住作者当前看到的那张）。
   *
   * 成功：entry.url 切到 /__reel__/assets/xxx，卡片 url 通过订阅自动刷新。
   * 仍失败：保持 failed，按钮回到可点状态，等后端恢复再试。
   * IDB 里连 Blob 都没有：返回 false —— 这种确实救不回，弹个提示。
   */
  const handleRetryPersist = async (mid: string): Promise<void> => {
    if (retryingIds.has(mid)) return
    setRetryingIds((s) => {
      const next = new Set(s)
      next.add(mid)
      return next
    })
    try {
      const ok = await retryPersist(mid)
      if (!ok) {
        alert(
          '重试失败：这张图的原始数据在本地也已丢失（可能清过浏览器数据）。请点卡片选择"重新生成"。',
        )
      }
    } finally {
      setRetryingIds((s) => {
        const next = new Set(s)
        next.delete(mid)
        return next
      })
    }
  }

  // 角色/场所/道具三卡永远显示，不再用 hasAnyAsset 守门。

  // 参考图详情（点卡片）→ 铺满内容区的整页（2026-06：从中央浮窗改为 inline 全屏）。
  // 仅在「参考图」分区内生效；返回即清空 preview 回到网格。
  if (imageSection === 'refs' && preview) {
    return (
      <div className="ks-forge-step ks-forge-step-detail">
        <AssetPreviewDialog
          target={preview}
          variant="inline"
          onClose={() => setPreview(null)}
          onAfterUpdate={() => setPreview(null)}
        />
      </div>
    )
  }

  // 「风格」分区：全屏铺满内容区的视觉风格选择器（无二级面板框）。
  if (imageSection === 'style') {
    return (
      <div className="ks-forge-step ks-forge-step-full">
        <VisualStyleSelector />
      </div>
    )
  }

  // 「UI」分区：全屏铺满的游戏化 UI 风格选择器。
  if (imageSection === 'director') {
    return (
      <div className="ks-forge-step ks-forge-step-full">
        <DirectorStyleSelector />
      </div>
    )
  }

  if (imageSection === 'ui') {
    return (
      <div className="ks-forge-step ks-forge-step-full">
        <UIStyleSelector />
      </div>
    )
  }

  // 「小游戏」分区：小游戏池选择器（cover-flow 多选入池）。
  if (imageSection === 'minigame') {
    return (
      <div className="ks-forge-step ks-forge-step-full">
        <MinigamePoolSelector />
      </div>
    )
  }

  // 「数值系统」模块：全局变量 + 节点门槛/分支条件（节点图编辑器后续阶段挂载）。
  if (imageSection === 'numeric') {
    return (
      <div className="ks-forge-step ks-forge-step-full">
        <NumericModule />
      </div>
    )
  }

  // 「背包系统」模块：搜寻拾取道具 + 物品效果（编辑器后续阶段挂载）。
  if (imageSection === 'inventory') {
    return (
      <div className="ks-forge-step ks-forge-step-full">
        <InventoryModule />
      </div>
    )
  }

  // 「参考图」分区（默认）：参考图流水线网格 + 生成按钮 + 进度/错误。
  return (
    <div className="ks-forge-step">
      <div className="ks-forge-grid-head">
        <div>
          <div className="ks-forge-step-title ks-mono">参考图流水线</div>
          <div className="ks-forge-refs-summary ks-cn">
            并发生成 · <strong>角色 ×{characters.length}</strong> ·{' '}
            <strong>场所 ×{locations.length}</strong> ·{' '}
            <strong>关键道具 ×{props.length}</strong>
            <span className="ks-forge-refs-hint">
              （分镜关键帧请到「剧情树」面板按场景生成）
            </span>
          </div>
        </div>
        <div className="ks-forge-run-cluster">
          {/*
           * 主按钮 = "只生成缺失"（默认路径）。
           * 作者反馈："生成现在缺失的按钮，就避免重复生成现有的了。"
           * 当 missingTotal === 0 时仍然可点（会给一条 info 提示"都已经有了"），
           * 不 disable 以免作者以为按钮坏了 —— 改变文案即可。
           */}
          <button
            type="button"
            className="ks-action is-primary ks-forge-run-btn"
            onClick={() => void handleRun({ onlyMissing: true })}
            disabled={running || !canRun}
            title={
              missingTotal === 0
                ? '当前没有缺失的参考图；如需重刷请点右侧「全部重生」'
                : `只生成尚未有图 / 落盘失败的条目（共 ${missingTotal} 张）`
            }
          >
            {running
              ? '生成中…'
              : missingTotal === 0 && allTotal > 0
                ? '已全部生成'
                : `只生成缺失${missingTotal > 0 ? ` · ${missingTotal} 张` : ''}`}
          </button>
          {/*
           * 辅助按钮 = "全部重生"。仅当当前存在 >=1 张已生成图、作者确实想推翻重来时用。
           * 空态（一张都没生成）时隐藏 —— 此时"只生成缺失"就等于"全部生成"。
           */}
          {allTotal > 0 && allTotal - missingTotal > 0 && (
            <button
              type="button"
              className="ks-action is-ghost ks-forge-run-btn-ghost"
              onClick={() => void handleRegenerateAll()}
              disabled={running}
              title={`重新生成全部 ${allTotal} 张参考图（会覆盖已有的图）`}
            >
              ⟲ 全部重生
            </button>
          )}
          {/*
           * 角色试镜视频（v7）—— 以定妆照为参考生成 ~10s/3:4 单人胸像试镜视频，
           * 并抽取整段音轨作角色音色样本。仅对已有定妆照的角色可跑。
           */}
          <button
            type="button"
            className="ks-action is-ghost ks-forge-run-btn-ghost"
            onClick={() => handleGenerateAuditions({ onlyMissing: true })}
            disabled={running}
            title="为已有定妆照的角色生成试镜视频（缺失），并提取音色样本"
          >
            {auditionActiveCount > 0
              ? `试镜生成中… (${auditionActiveCount})`
              : '🎬 生成试镜视频（缺失）'}
          </button>
          {characters.some((c) => c.auditionVideoMediaId) && (
            <button
              type="button"
              className="ks-action is-ghost ks-forge-run-btn-ghost"
              onClick={() => handleGenerateAuditions({ onlyMissing: false })}
              disabled={running}
              title="重新生成全部角色的试镜视频与音色（覆盖已有）"
            >
              ⟲ 试镜全部重生
            </button>
          )}
        </div>
      </div>
      {auditionError && <div className="ks-forge-refs-error ks-cn">× {auditionError}</div>}

      {/*
       * 注：不再在此处渲染"尚无角色或场所"整块空态 ——
       * 两个 RefGrid 各自带 emptyHint 占位，视觉上也能撑起页面。
       * 重复的 "请先锻造剧本" 文案反而让 UI 显得啰嗦。
       */}

      {/*
       * 角色定妆照 —— 单张三视图（左半高清半身 + 右半全身正/侧/背一行），单张单行。
       * 写回 turnaroundRefImageId，现役视频参考（buildVideoReferenceSet）直接读它。
       * 永久显示（即使还没 characters）：空态给占位，别让作者以为模块丢了。
       */}
      <RefGrid
        title="角色定妆照"
        emptyHint="剧本锻造后自动填充角色（三视图定妆照）"
        items={characters.map((c) => {
          const mid = c.turnaroundRefImageId ?? c.refImageId
          const imageUrl = mid ? mediaEntries[mid]?.url : undefined
          const videoUrl = c.auditionVideoMediaId
            ? mediaEntries[c.auditionVideoMediaId]?.url
            : undefined
          const voiceSampleUrl = c.voiceSampleMediaId
            ? mediaEntries[c.voiceSampleMediaId]?.url
            : undefined
          return {
            id: c.id,
            name: c.name,
            kind: 'character' as const,
            prompt: c.prompt ?? '',
            // 网格优先展示试镜视频；缺则展示定妆照图。
            url: imageUrl,
            imageUrl,
            videoUrl,
            voiceSampleUrl,
            persistState: mid ? mediaEntries[mid]?.persistState : undefined,
            mediaId: mid,
            variantCount: c.appearanceVariants?.length ?? 0,
          }
        })}
        onPick={(it) => setPreview(it)}
        onRetryPersist={handleRetryPersist}
        retryingIds={retryingIds}
        videoSlot
      />


      {/*
       * 场所基准图 —— 永久显示（即使当前 scenario 还没 locations）。
       * 作者视角里这是「场景生成模块」，藏起来会被误以为"模块没了"。
       * 空态走 RefGrid 自己的 empty 占位文案。
       */}
      <RefGrid
        title="场所基准图"
        emptyHint="剧本锻造后自动填充场所"
        items={locations.map((l) => ({
          id: l.id,
          name: l.name,
          kind: 'location' as const,
          prompt: l.prompt ?? '',
          url: l.refImageId ? mediaEntries[l.refImageId]?.url : undefined,
          persistState: l.refImageId
            ? mediaEntries[l.refImageId]?.persistState
            : undefined,
          mediaId: l.refImageId,
          variantCount: l.angleRefs?.length ?? 0,
        }))}
        onPick={(it) => setPreview(it)}
        onRetryPersist={handleRetryPersist}
        retryingIds={retryingIds}
      />


      {/*
       * 关键道具基准图 —— v3.7 新增模块（角色/场所平级）。
       * 仅当 LLM 在剧本锻造时识别出"跨镜反复出现且有身份识别度"的物品才会有条目；
       * 普通场景（无关键道具）空态占位，不隐藏模块，避免作者误以为"丢了"。
       */}
      <RefGrid
        title="关键道具基准图"
        emptyHint="剧本锻造后自动提取关键道具（非所有剧本都有）"
        items={props.map((p) => ({
          id: p.id,
          name: p.name,
          kind: 'prop' as const,
          prompt: p.prompt ?? '',
          url: p.refImageId ? mediaEntries[p.refImageId]?.url : undefined,
          persistState: p.refImageId
            ? mediaEntries[p.refImageId]?.persistState
            : undefined,
          mediaId: p.refImageId,
          variantCount: p.variants?.length ?? 0,
        }))}
        onPick={(it) => setPreview(it)}
        onRetryPersist={handleRetryPersist}
        retryingIds={retryingIds}
      />

      {/*
       * UI 风格已迁出为独立「UI」分区（imageSection==='ui'），此处不再渲染。
       */}


      {progress && (
        <div className="ks-forge-refs-progress ks-mono">
          进度 {progress.done} / {progress.total}
          <div className="ks-forge-refs-bar">
            <div
              className="ks-forge-refs-bar-fill"
              style={{
                width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}
      {error && <div className="ks-forge-refs-error ks-cn">× {error}</div>}
      {failures.length > 0 && (
        <div className="ks-forge-refs-error ks-cn">
          <div>部分生图失败（其余已完成）：</div>
          <ul>
            {failures.map((f, i) => (
              <ForgeFailureRow key={i} failure={f} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * 单行失败记录 —— moderation 错误时多给一个"查看完整 prompt"折叠按钮。
 *
 * 为什么要单独展示 prompt：Azure safety system 对"哪段文字触发"完全不透明，作者
 * 只能拿着自己的原始 prompt 去推敲。把真正送给模型的最终 prompt（含 visualStyle /
 * 角色外观 / 场所描述拼装后的完整版）给他看，是**唯一**能帮他定位的信息。
 *
 * v6.3 · 当 Provider 判断"很可能是风格切换后的整体评估误判"（
 * likelyStyleInteraction=true）时，额外显眼地提示作者"这不是你写的内容的问题，
 * 去改视觉风格或让 LLM 按新风格重写描述"，而不是让他反复修措辞白费劲。
 */
function ForgeFailureRow({ failure }: { failure: ForgeFailure }) {
  const [expanded, setExpanded] = useState(false)
  const mod = failure.moderation
  return (
    <li>
      <div>
        <strong>{failure.label}</strong>：{failure.message}
      </div>
      {mod && (
        <div style={{ marginTop: 6 }}>
          {mod.likelyStyleInteraction && (
            <div
              className="ks-cn"
              style={{
                marginBottom: 6,
                padding: '6px 8px',
                background: 'rgba(255, 193, 7, 0.08)',
                border: '1px solid rgba(255, 193, 7, 0.3)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              <strong>提示：</strong>描述本身似乎无明显敏感词。常见原因是{' '}
              <strong>视觉风格与原描述不匹配</strong>
              （例如把写实剧本切成二次元风格）。建议切到【剧本树】里找到对应{' '}
              {failure.label}，让 LLM 按新风格重写 <code>描述/外观</code> 字段，
              或先换回原视觉风格。
            </div>
          )}
          <button
            type="button"
            className="ks-btn ks-btn-ghost ks-btn-sm"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '收起' : '查看完整 prompt（帮助定位触发词）'}
          </button>
          {mod.azureRequestId && (
            <span className="ks-faint ks-mono" style={{ marginLeft: 8, fontSize: 11 }}>
              Azure request ID: {mod.azureRequestId}
            </span>
          )}
          {expanded && (
            <pre
              className="ks-mono"
              style={{
                marginTop: 6,
                padding: 8,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                fontSize: 11,
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {mod.prompt}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * 试镜视频缩略图 —— 默认不播放（停在首帧），鼠标悬停才播放并**带声音**，
 * 移开暂停、复位首帧、重新静音。点击由外层 tile 处理（进详情）。
 *
 * 注：悬停时显式取消静音再 play()。多数浏览器在页面已有交互后允许带声音播放；
 * 若被自动播放策略拦截（play() reject），静默忽略，不影响画面。
 */
/**
 * 角色试镜卡的视频位 —— 卡片「外面」永远展示**正在播放的视频**（静音循环自动播）。
 *
 * 两个坑：
 *  1. 仅靠 <video autoPlay> 在动态 src + iframe 里经常不触发 → 用 effect 在
 *     loadedmetadata 后显式 muted+play()，保证默认就在播（而不是停在第一帧）。
 *  2. 图生视频的**首帧 = 输入参考图**（一张静态图）。原生 loop 每轮都会闪回第 0 帧，
 *     看着就像「图片插进来」。这里改成手动循环：起播 & 每轮都从 LOOP_START 开始，
 *     跳过那段静止首帧，外面就是连续的视频。
 * 悬浮取消静音放出音色，离开恢复静音但继续播。
 */
function HoverVideo({ src }: { src: string }): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const LOOP_START = 0.25

  useEffect(() => {
    const v = ref.current
    if (!v) return
    v.muted = true
    const kick = () => {
      try {
        if (v.currentTime < LOOP_START) v.currentTime = LOOP_START
      } catch {
        /* seek 偶发抛错，忽略 */
      }
      void v.play().catch(() => {})
    }
    if (v.readyState >= 1) kick()
    else v.addEventListener('loadedmetadata', kick, { once: true })
    return () => v.removeEventListener('loadedmetadata', kick)
  }, [src])

  return (
    <video
      ref={ref}
      src={src}
      muted
      autoPlay
      playsInline
      preload="auto"
      onEnded={() => {
        // 手动循环：跳过静止首帧，避免「图片插进来」的闪烁。
        const v = ref.current
        if (!v) return
        try {
          v.currentTime = LOOP_START
        } catch {
          /* ignore */
        }
        void v.play().catch(() => {})
      }}
      onMouseEnter={() => {
        const v = ref.current
        if (!v) return
        v.muted = false
        v.volume = 1
        void v.play().catch(() => {})
      }}
      onMouseLeave={() => {
        const v = ref.current
        if (!v) return
        // 继续静音播放（保持「外面就是视频」），只是收回声音。
        v.muted = true
      }}
    />
  )
}

/**
 * 角色试镜卡的状态浮层 —— 订阅 cardKey=audition:<id> 的队列 job，覆盖在视频位上：
 *   · 排队中 / 生成中 → 半透明遮罩 + 转圈 + 阶段文字（如「生成试镜视频 · queued」「提取音色」）
 *   · 失败           → 红字原因 + 「重试」按钮（重新入队）
 *   · 完成 / 无 job   → 不渲染（让视频本身显示）
 * 这样作者不再面对空白干等，失败也能在卡片上看到原因。
 */
function AuditionTileStatus({
  id,
  name,
}: {
  id: string
  name: string
}): JSX.Element | null {
  const job: GenJob | undefined = useCardJob(auditionCardKey(id))
  if (!job) return null
  if (job.status === 'done') return null

  if (job.status === 'failed' || job.status === 'cancelled') {
    const reason = job.error || (job.status === 'cancelled' ? '已取消' : '生成失败')
    return (
      <div className="ks-forge-aud-status is-failed" onClick={(e) => e.stopPropagation()}>
        <div className="ks-forge-aud-status-msg ks-cn" title={reason}>
          ✕ {reason}
        </div>
        <button
          type="button"
          className="ks-forge-aud-retry ks-mono"
          onClick={(e) => {
            e.stopPropagation()
            enqueueAuditions([{ id, name }])
          }}
        >
          ⟳ 重试
        </button>
      </div>
    )
  }

  // queued / running
  const label =
    job.status === 'queued' ? '排队中…' : job.stage || '生成试镜视频…'
  return (
    <div className="ks-forge-aud-status is-running">
      <span className="ks-forge-aud-spin" aria-hidden />
      <span className="ks-forge-aud-status-msg ks-cn" title={label}>
        {label}
      </span>
    </div>
  )
}

function RefGrid({
  title,
  items,
  onPick,
  emptyHint,
  onRetryPersist,
  retryingIds,
  videoSlot,
}: {
  title: string
  items: RefGridItem[]
  onPick: (item: PreviewTarget) => void
  emptyHint?: string
  onRetryPersist?: (mediaId: string) => void
  retryingIds?: Set<string>
  /**
   * 视频位模式（角色试镜网格）：每张卡是 3:4 视频位 —— 有 videoUrl 就悬浮播放，
   * 没有就留空（不显示定妆照图、不显示「点击编辑」遮罩）。定妆照图在详情里看。
   */
  videoSlot?: boolean
}) {
  return (
    <section className="ks-forge-refs-section">
      <header className="ks-forge-skel-head ks-mono">{`${title} · ${items.length}`}</header>
      {items.length === 0 ? (
        /*
         * 空态 —— 避免整块被条件渲染掉，让作者清楚这个模块存在。
         * 2026-04 作者反馈："角色三视图下方的场景生成模块没了" ——
         * 根因就是旧代码在 items 为空时把整块 section 一起藏了。
         */
        <div className="ks-forge-refs-empty ks-cn">
          {emptyHint ?? '暂无内容'}
        </div>
      ) : (
        <div className="ks-forge-refs-grid">
          {items.map((it) => {
            // onPick 只传 PreviewTarget 需要的字段，persistState/mediaId 是 RefGrid 内部用
            const picked: PreviewTarget = {
              id: it.id,
              name: it.name,
              kind: it.kind,
              prompt: it.prompt,
              url: it.url,
              imageUrl: it.imageUrl,
              videoUrl: it.videoUrl,
              voiceSampleUrl: it.voiceSampleUrl,
            }
            const isFailed = it.persistState === 'failed'
            const isPending = it.persistState === 'pending'
            const isRetrying = it.mediaId ? retryingIds?.has(it.mediaId) : false
            return (
              <div key={it.id} className="ks-forge-refs-tile-wrap">
                <button
                  type="button"
                  className="ks-forge-refs-tile"
                  onClick={() => onPick(picked)}
                  title={`${it.name} · 点击预览与编辑`}
                >
                  <div
                    className={`ks-forge-refs-thumb${videoSlot ? ' is-video' : ''}`}
                  >
                    {videoSlot ? (
                      // 视频位：有试镜视频→悬浮播放(3:4 完整展示)；没有→留空占位。点击 tile 进详情。
                      // 叠加生成状态浮层（排队/生成中/失败+重试），让作者不再空白干等。
                      <>
                        {it.videoUrl ? (
                          <HoverVideo src={it.videoUrl} />
                        ) : (
                          <span className="ks-forge-refs-vidempty ks-cn">待生成试镜视频</span>
                        )}
                        <AuditionTileStatus id={it.id} name={it.name} />
                      </>
                    ) : it.url ? (
                      <img src={it.url} alt={it.name} />
                    ) : (
                      <span className="ks-forge-refs-placeholder ks-mono">待生成</span>
                    )}
                    {videoSlot && it.videoUrl && (
                      <span
                        className="ks-forge-refs-badge is-audition ks-mono"
                        title="已生成试镜视频（含音色样本）· 悬浮播放，点击进详情"
                      >
                        试镜
                      </span>
                    )}
                    {/* 仅图片网格(场所/道具)保留「点击编辑」遮罩；视频位不叠遮罩 */}
                    {!videoSlot && (
                      <span className="ks-forge-refs-hover-overlay ks-mono">点击编辑</span>
                    )}
                    {/*
                     * 落盘状态徽标 —— 仅 failed / pending 显示，saved 不打扰。
                     *   · failed：红色 "未落盘" + 右上角 ⟳ 按钮（通过 onClick 阻止冒泡）
                     *   · pending：黄色 "落盘中"，不带按钮，等着自己完成
                     */}
                    {isFailed && (
                      <span
                        className="ks-forge-refs-badge is-failed ks-mono"
                        title="后端写盘失败，刷新就会丢；点右上角 ⟳ 重试"
                      >
                        未落盘
                      </span>
                    )}
                    {isPending && !isFailed && (
                      <span
                        className="ks-forge-refs-badge is-pending ks-mono"
                        title="正在写盘，请稍候"
                      >
                        落盘中…
                      </span>
                    )}
                    {/*
                     * v3.10 · 变体计数 chip
                     *
                     *   仅在 variantCount > 0 时渲染，提示作者"这张主图下面还挂了 N
                     *   个形态变体"。点击会冒泡到 tile 的 onClick，进入 dialog 看 strip。
                     *   位置：右下角；颜色用 amber-soft，避免和 failed/pending 红黄抢眼。
                     */}
                    {it.variantCount && it.variantCount > 0 ? (
                      <span
                        className="ks-forge-refs-badge is-variants ks-mono"
                        title={`已有 ${it.variantCount} 个${it.kind === 'location' ? '视角' : '形态变体'}（点开卡片管理）`}
                      >
                        +{it.variantCount}
                      </span>
                    ) : null}
                  </div>
                  <div className="ks-forge-refs-caption ks-cn">{it.name}</div>
                </button>
                {isFailed && it.mediaId && onRetryPersist && (
                  <button
                    type="button"
                    className="ks-forge-refs-retry ks-mono"
                    disabled={isRetrying}
                    onClick={(e) => {
                      // 不触发外层 tile 的 onClick（避免同时打开预览）
                      e.stopPropagation()
                      if (it.mediaId) onRetryPersist(it.mediaId)
                    }}
                    title="重新尝试把这张图写到磁盘（只重传，不重新生图）"
                  >
                    {isRetrying ? '…' : '⟳'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

const css = `
.ks-forge-wizard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  height: 100%;
  min-height: 0;
}
/*
 * chat 已被外壳层托管, wizard 收回单列布局. main 自然占满整宽, 不再为不存在
 * 的 chat 列留出 320–420px 空间 (作者切到 image / script 视图时, 角色卡片
 * 网格能多挤一列出来).
 */
.ks-forge-wizard.is-chat-detached {
  grid-template-columns: minmax(0, 1fr);
}

.ks-forge-wizard-main {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ks-forge-wizard-chat {
  min-width: 0;
  min-height: 0;
}

/* 窄屏降级：堆叠布局（聊天在上，网格滚动在下 —— 与语义一致） */
@media (max-width: 1024px) {
  .ks-forge-wizard {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .ks-forge-wizard-chat {
    order: -1;
    max-height: 44vh;
    border-bottom: 1px solid var(--ks-border-soft);
  }
}

.ks-forge-step {
  padding: 16px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
/* 风格 / UI / 小游戏分区：carousel 全屏铺满内容区，无内边距、无二级面板框 */
.ks-forge-step-full {
  padding: 0;
  gap: 0;
  /* content-driven：填满可用高度；内容（轮播 min-height）更高时撑开，触发 .ks-forge-wizard-main 的 overflow-y:auto 滚动，而非被裁没 */
  flex: 1 0 auto;
  min-height: 0;
}
/* 参考图详情（inline 整页）：锁定在内容区一屏内 —— flex 占满 + min-height:0，
 * 让内部的 AssetPreviewDialog 卡片自适应高度、右侧面板内部滚动；
 * 否则容器按内容高度撑开会导致整页滚动、左侧大图被右栏内容拉长。 */
.ks-forge-step-detail {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0;
  gap: 0;
}
.ks-forge-grid-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.ks-forge-step-title {
  font-size: 11px;
  letter-spacing: 0.26em;
  color: var(--ks-amber);
  text-transform: uppercase;
  margin-bottom: 4px;
}
.ks-forge-empty {
  padding: 28px 20px;
  font-size: 13px;
  color: var(--ks-text-dim);
  text-align: center;
  border: 1px dashed var(--ks-border);
  border-radius: var(--ks-radius-lg);
  background: var(--ks-surface-glass);
}

/* RefGrid 空态 —— 保留 section 边框，只把 grid 区换成占位文案 */
.ks-forge-refs-empty {
  padding: 28px 20px;
  font-size: 12.5px;
  color: var(--ks-text-dim);
  text-align: center;
  background: var(--ks-surface-warm);
  letter-spacing: 0.04em;
}

.ks-forge-run-btn {
  flex-shrink: 0;
}
.ks-forge-run-cluster {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.ks-action.is-ghost {
  background: transparent;
  border-color: var(--ks-border);
  color: var(--ks-text-soft);
}
.ks-action.is-ghost:hover:not(:disabled) {
  background: var(--ks-surface-warm);
  color: var(--ks-text);
}
.ks-forge-run-btn-ghost {
  font-size: 12px;
  letter-spacing: 0.08em;
  padding: 8px 12px;
}
.ks-action.is-primary {
  background: var(--ks-amber);
  border-color: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ks-amber) 30%, transparent);
}
.ks-action.is-primary:hover:not(:disabled) {
  background: var(--ks-amber-glow);
  border-color: var(--ks-amber-glow);
  color: var(--color-text-on-bright-primary);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--ks-amber) 45%, transparent);
  transform: translateY(-1px);
}

/* ─── 复用样式（skel/refs grids） ─── */
.ks-forge-skel-head {
  padding: 12px 16px;
  background: var(--ks-surface-warm);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--ks-amber);
  border-bottom: 1px solid var(--ks-border-soft);
  text-transform: uppercase;
}
.ks-forge-refs-summary {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ks-text-soft);
}
.ks-forge-refs-summary strong {
  color: var(--ks-amber);
  font-weight: 600;
  margin: 0 2px;
}
.ks-forge-refs-hint {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  color: var(--ks-text-faint);
  letter-spacing: 0.02em;
}
.ks-forge-refs-section {
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  overflow: hidden;
  background: var(--ks-panel-elev);
  box-shadow: var(--ks-shadow-soft);
}
.ks-forge-refs-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 14px;
  padding: 16px;
  /* 视频卡(3:4)与图片卡(1:1)高度不同：顶端对齐，不让行被拉伸 */
  align-items: start;
}
.ks-forge-refs-tile {
  all: unset;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  border-radius: var(--ks-radius-md);
  padding: 6px;
  transition: background var(--ks-dur-fast) var(--ks-ease),
              transform var(--ks-dur-fast) var(--ks-ease);
}
.ks-forge-refs-tile:hover {
  background: var(--ks-amber-soft);
  transform: translateY(-2px);
}
.ks-forge-refs-tile:focus-visible {
  outline: 2px solid var(--ks-amber);
  outline-offset: 2px;
}
.ks-forge-refs-thumb {
  position: relative;
  aspect-ratio: 1 / 1;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  background: var(--ks-surface-warm);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: var(--ks-shadow-inset-hi);
}
.ks-forge-refs-thumb img,
.ks-forge-refs-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
/*
 * 试镜视频卡：用 3:4 竖画幅完整展示视频（与生成比例一致，不裁切）。
 * object-fit: contain 保证整段画面都在框内（背景填深色，避免拉伸/裁脸）。
 */
.ks-forge-refs-thumb.is-video {
  aspect-ratio: 3 / 4;
  background: #0c0a08;
}
.ks-forge-refs-thumb.is-video video {
  object-fit: contain;
}
/* 视频位空态：3:4 空槽，居中淡字（点击进详情生成） */
.ks-forge-refs-vidempty {
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--ks-text-faint);
  text-align: center;
  padding: 0 8px;
}
/* 试镜生成状态浮层（排队 / 生成中 / 失败+重试）—— 覆盖在 3:4 视频位上 */
.ks-forge-aud-status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  text-align: center;
  background: rgba(8, 7, 5, 0.72);
  backdrop-filter: blur(1px);
  z-index: 3;
}
.ks-forge-aud-status.is-failed {
  background: rgba(40, 8, 8, 0.82);
}
.ks-forge-aud-status-msg {
  font-size: 11px;
  line-height: 1.4;
  color: var(--ks-text, #f2ede4);
  max-height: 4.2em;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  word-break: break-word;
}
.ks-forge-aud-status.is-failed .ks-forge-aud-status-msg {
  color: #ffb4ad;
}
.ks-forge-aud-spin {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(212, 255, 72, 0.25);
  border-top-color: var(--ks-amber, #d4ff48);
  animation: ks-forge-aud-spin 0.8s linear infinite;
}
@keyframes ks-forge-aud-spin {
  to {
    transform: rotate(360deg);
  }
}
.ks-forge-aud-retry {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 180, 173, 0.5);
  background: rgba(255, 180, 173, 0.12);
  color: #ffd9d4;
  cursor: pointer;
}
.ks-forge-aud-retry:hover {
  background: rgba(255, 180, 173, 0.22);
}
.ks-forge-refs-hover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(28, 22, 15, 0.36);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #fff;
  font-size: 11px;
  letter-spacing: 0.16em;
  opacity: 0;
  transition: opacity var(--ks-dur-fast) var(--ks-ease);
}
.ks-forge-refs-tile:hover .ks-forge-refs-hover-overlay {
  opacity: 1;
}
.ks-forge-refs-placeholder {
  font-size: 10px;
  color: var(--ks-text-faint);
  letter-spacing: 0.2em;
}
/* ─── 落盘状态徽标（未落盘 / 落盘中）+ 重试按钮 ─── */
.ks-forge-refs-tile-wrap {
  position: relative;
}
.ks-forge-refs-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  letter-spacing: 0.1em;
  pointer-events: none;
  text-transform: uppercase;
}
.ks-forge-refs-badge.is-failed {
  background: rgba(240, 119, 157, 0.92);
  color: #fff;
  box-shadow: 0 2px 6px rgba(240, 119, 157, 0.5);
}
.ks-forge-refs-badge.is-pending {
  background: rgba(255, 193, 7, 0.92);
  color: #2a1a00;
  box-shadow: 0 2px 6px rgba(255, 193, 7, 0.4);
}
/* v7 · 试镜视频徽标 —— 放右上角，与左下/右下错开。 */
.ks-forge-refs-badge.is-audition {
  left: auto;
  right: 6px;
  top: 6px;
  bottom: auto;
  background: rgba(63, 185, 122, 0.92);
  color: #07210f;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(63, 185, 122, 0.4);
}
/*
 * v3.10 · 变体计数 chip。位置故意放右下角，跟左下角 failed/pending 错开，
 * 同时同时出现也不重叠。颜色用 amber-soft 避免抢戏。
 */
.ks-forge-refs-badge.is-variants {
  left: auto;
  right: 6px;
  bottom: 6px;
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
  border: 1px solid var(--ks-amber);
  font-weight: 600;
}
.ks-forge-refs-retry {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(240, 119, 157, 0.6);
  background: rgba(30, 20, 20, 0.86);
  color: var(--ks-rose);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 2;
  transition: transform var(--ks-dur-fast) var(--ks-ease),
              background var(--ks-dur-fast) var(--ks-ease);
}
.ks-forge-refs-retry:hover:not(:disabled) {
  background: rgba(240, 119, 157, 0.2);
  transform: scale(1.08);
}
.ks-forge-refs-retry:disabled {
  opacity: 0.5;
  cursor: wait;
}
.ks-forge-refs-caption {
  font-size: 12px;
  color: var(--ks-text);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.ks-forge-refs-progress {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--ks-text-soft);
}
.ks-forge-refs-bar {
  margin-top: 8px;
  height: 6px;
  background: var(--ks-border-soft);
  border-radius: 999px;
  overflow: hidden;
}
.ks-forge-refs-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ks-amber), var(--ks-amber-glow));
  border-radius: 999px;
  box-shadow: 0 0 8px rgba(255, 123, 61, 0.4);
  transition: width 180ms linear;
}
.ks-forge-refs-error {
  padding: 12px 14px;
  border: 1px solid rgba(240, 119, 157, 0.45);
  border-radius: var(--ks-radius-md);
  color: var(--ks-rose);
  font-size: 12.5px;
  line-height: 1.6;
  background: rgba(240, 119, 157, 0.08);
}
.ks-forge-refs-error ul {
  margin: 6px 0 0;
  padding-left: 18px;
}

/* UI 风格区块 (从剧本 tab 迁来 · v5) */
.ks-forge-uistyle-block {
  margin-top: 16px;
  padding: 14px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  background: var(--ks-panel-elev);
}
.ks-forge-uistyle-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.ks-forge-uistyle-head .ks-mono {
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--ks-text-dim);
}
.ks-forge-uistyle-hint {
  font-family: var(--ks-font-cn);
  font-size: 11.5px;
  color: var(--ks-text-soft);
}
`
injectStyleOnce('forge-wizard', css)
