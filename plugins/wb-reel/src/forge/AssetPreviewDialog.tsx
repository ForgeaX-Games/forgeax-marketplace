import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { createImageProvider } from '../llm/GptImageProvider'
import { composeVisualPrompt } from '../llm/visualStylePresets'
import { buildCharacterTurnaroundPrompt } from '../llm/forgeImagePipeline'
import { AssetLightbox, type LightboxItem } from './AssetLightbox'
import { getTtsClient } from '../llm/TTSProvider'
import { createTextProvider } from '../llm/ClaudeAzureProvider'
import {
  castCharacterVoice,
  heuristicFallback,
} from '../llm/characterVoiceCaster'
import { enqueueAudition, auditionCardKey } from './enqueueAudition'
import { useCardJob } from './generationQueueStore'
import type { Character, CharacterVoiceAnchor } from '../scenario/types'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * AssetPreviewDialog —— 参考图卡片点击后的二级弹窗。
 *
 * 设计原则（v3.9.8 重写）：
 *   作者反馈："简单提示词就生出丑东西，要把新的要求 + 之前的提示词走一遍 LLM，
 *   让 LLM 来修改新的提示词并走生图。别用『用此 Prompt 生成』、『按指令修改』
 *   两个按钮误导人，它们实际都是直接生图、没走 LLM 优化。"
 *
 *   —— 现在只有**一条**主生成路径：
 *     作者当前 prompt（必填） + 修改意图（可选） → forgeImagePrompt（LLM 锻造）
 *                                               → 新 prompt 覆盖 textarea
 *                                               → 用新 prompt + 参考图（若有修改意图）生图
 *
 *   这样无论作者写的是"赶考的书生 …"这样的简单描述，还是把完整 prompt 粘进去，
 *   生图前都会经过一次 cinema-image-prompt skill 的锻造，输出有电影感的长提示词。
 *
 * 支持操作：
 *   - 大图预览（2:1 左右分栏）
 *   - 查看 / 编辑 prompt 的文本
 *   - **优化提示词并生成**（核心按钮）：LLM 锻造 → 生图。若填了"修改意图"，
 *     以当前图为 reference + 把意图喂进 intent；否则仅基于当前 prompt 锻造
 *   - 保存 Prompt（仅写回 textarea 文本，不生图，作者想离线保留思路时用）
 *   - 手动：上传图片覆盖 / 下载当前图
 *
 * 存储：
 *   - 生成 / 上传成功后 → mediaStore.ingestDataUrl 得到 mid → scenario store 对应的
 *     setCharacterTurnaroundRef / setLocationRefImage / setPropRefImage 写回
 *   - 锻造得到的新 prompt 会覆盖对应 character/location/prop.prompt
 */

export interface PreviewTarget {
  id: string
  name: string
  kind: 'character' | 'location' | 'prop'
  prompt: string
  url?: string
  /**
   * 角色试镜视频 URL（auditionVideoMediaId 解析）—— 角色定妆照流程 v7。
   * 网格优先展示它；详情面板把它作主预览，原定妆照图仍在 `imageUrl`/`url` 保留。
   */
  videoUrl?: string
  /**
   * 原始定妆照图 URL —— 当 `url` 已被试镜视频占位时，这里仍保留可查看的静态图。
   * 缺省时回退到 `url`。
   */
  imageUrl?: string
  /** 角色音色样本 MP3 的 URL（voiceSampleMediaId 解析），详情面板 `<audio>` 回放。 */
  voiceSampleUrl?: string
}

/*
 * v3.10 · 写入模式（write-mode）
 *
 *   - 'replace'：旧默认行为，生图/上传完直接覆盖主图（character.turnaroundRefImageId
 *     / location.refImageId / prop.refImageId）。文本变化也一并写主 prompt。
 *   - 'append-variant'：把这次产物当作"新形态变体"追加进 character.appearanceVariants
 *     / prop.variants，不动主图、不动主 prompt。location 暂走 angleRefs（既有），
 *     在这个 dialog 里以"加视角"的语义表达。
 *
 * 这是为了支持"角色换装 / 战损 / 不同年龄"这类需求 —— 主图作为基础锚，
 * 变体单独入库，下游在 shot.characterVariantIds 里按 id 选用，避免覆盖丢失。
 */
interface Props {
  target: PreviewTarget
  onClose: () => void
  /**
   * 更新成功后的回调（给调用方机会关闭 dialog 或刷新；可选）。
   * 当前 ForgeWizard 传入关闭 dialog，让 store 变更触发网格重渲染。
   */
  onAfterUpdate?: () => void
  /**
   * 展示形态（2026-06 作者反馈："图像一级界面迁移到左栏后，参考图详情在内容区全屏展示"）：
   *   - 'dialog'（默认）：createPortal 的居中浮层弹窗 + 全屏 scrim 遮罩。
   *   - 'inline'：铺满父容器（内容区）的整页，无遮罩/无 portal，顶栏「关闭」语义为「返回」。
   * 内部仅根容器/包裹方式不同，body 内全部编辑能力两种形态完全一致。
   */
  variant?: 'dialog' | 'inline'
}

type BusyKind = 'replace' | 'append-variant' | 'upload' | null

/*
 * v3.12 · "当前选中" (selection) 模型
 *
 *   一张图就是一张图: 主图 / 变体₁ / 变体₂ ... 都是平等的视觉单元.
 *   作者点 strip 卡片就切到那一张; 描述输入框、大图预览、生成按钮全部跟着选中走.
 *   -  selection = 'main'    -> 描述 = character.prompt / location.prompt / prop.prompt
 *                                生成 · 替换 -> 写主图
 *   -  selection = 'v-xxx'   -> 描述 = appearanceVariants[id].prompt
 *                                生成 · 替换 -> 通过 upsert 整条替换该变体 (mediaId + prompt)
 *
 *   "加为新变体"是另一条独立路径: 内联展开 label 输入 + 确认/取消, 确认后才生成,
 *   生成完毕新变体被自动选中 (作者立刻能看到新图).
 *
 *   下游联通: character.appearanceVariants 已经在 actLoopbackContext 里被列入
 *   LOCKED ANCHORS 喂给分镜 LLM, 作者在这里设计的 "睡衣" 等变体, 后续剧情会被
 *   AI 主动认到 (见 src/llm/actLoopbackContext.ts:103-114).
 */
type Selection = 'main' | string // 'main' | variantId

export function AssetPreviewDialog({ target, onClose, onAfterUpdate, variant = 'dialog' }: Props) {
  const [selection, setSelection] = useState<Selection>('main')
  const [busy, setBusy] = useState<BusyKind>(null)
  const [busyStage, setBusyStage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  /*
   * v3.12 · "加为新变体"内联表单
   *
   *   appendingVariant !== null 时, 操作区原"加为新变体"按钮被替换为 label 输入框 +
   *   "确认生成" / "取消" 两个按钮. 这样作者只需要点一次按钮, 就在原地填写名字, 不需要
   *   先点"折叠面板"再点"生成". appendingVariant.label 留空也能确认 (兜底命名).
   */
  const [appendingVariant, setAppendingVariant] = useState<
    { label: string } | null
  >(null)
  // 点击大图 → 全屏放大预览 (作者反馈"不支持点图看细节")。
  const [zoomed, setZoomed] = useState(false)
  // v7.2 · 角色详情主预览形态：默认看试镜视频，可切回定妆照图。
  //   有试镜视频时 stage 默认放视频；图片作为「下方可选预览」。
  const [previewMode, setPreviewMode] = useState<'video' | 'image'>('video')

  const ingestDataUrl = useMediaStore((s) => s.ingestDataUrl)
  const character = useScenarioStore((s) =>
    target.kind === 'character'
      ? s.scenario.characters?.[target.id]
      : undefined,
  )
  const location = useScenarioStore((s) =>
    target.kind === 'location' ? s.scenario.locations?.[target.id] : undefined,
  )
  const prop = useScenarioStore((s) =>
    target.kind === 'prop' ? s.scenario.props?.[target.id] : undefined,
  )
  const upsertCharacter = useScenarioStore((s) => s.upsertCharacter)
  const upsertLocation = useScenarioStore((s) => s.upsertLocation)
  const upsertProp = useScenarioStore((s) => s.upsertProp)
  const setCharacterTurnaroundRef = useScenarioStore(
    (s) => s.setCharacterTurnaroundRef,
  )
  const setLocationRefImage = useScenarioStore((s) => s.setLocationRefImage)
  const setPropRefImage = useScenarioStore((s) => s.setPropRefImage)
  const addCharacterAppearanceVariant = useScenarioStore(
    (s) => s.addCharacterAppearanceVariant,
  )
  const removeCharacterAppearanceVariant = useScenarioStore(
    (s) => s.removeCharacterAppearanceVariant,
  )
  const addLocationAngleRef = useScenarioStore((s) => s.addLocationAngleRef)
  const removeLocationAngleRef = useScenarioStore((s) => s.removeLocationAngleRef)
  const addPropVariant = useScenarioStore((s) => s.addPropVariant)
  const removePropVariant = useScenarioStore((s) => s.removePropVariant)
  const mediaLookup = useMediaStore((s) => s.entries)
  const visualStyle = useScenarioStore((s) => s.scenario.visualStyle)

  const imgClient = useMemo(() => createImageProvider(), [])

  // ESC 关闭 —— 放大态优先收起放大, 再次按才关详情。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (zoomed) setZoomed(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, zoomed])

  const currentUrl =
    target.kind === 'character'
      ? character?.turnaroundRefImageId
        ? mediaLookup[character.turnaroundRefImageId]?.url
        : undefined
      : target.kind === 'location'
        ? location?.refImageId
          ? mediaLookup[location.refImageId]?.url
          : undefined
        : prop?.refImageId
          ? mediaLookup[prop.refImageId]?.url
          : undefined

  /*
   * v3.12 · 当前选中项 (selectedItem)
   *
   *   把"主图 / 某变体"两种情况收敛成同一个 shape, 让下面的 UI 和 handler
   *   都不必再开 if-else. 选中变体不存在时 (例如刚被删) 自动回退到 main.
   *   url / promptText / labelText 都从这里取, 不再分散在多处三元表达式.
   */
  const selectedVariant: { id: string; label: string; prompt: string; mediaId?: string } | null =
    selection === 'main'
      ? null
      : (() => {
          if (target.kind === 'character') {
            const v = character?.appearanceVariants?.find((x) => x.id === selection)
            return v ? { id: v.id, label: v.label, prompt: v.prompt, mediaId: v.mediaId } : null
          }
          if (target.kind === 'prop') {
            const v = prop?.variants?.find((x) => x.id === selection)
            return v ? { id: v.id, label: v.label, prompt: v.prompt, mediaId: v.mediaId } : null
          }
          const a = location?.angleRefs?.find((x) => x.id === selection)
          return a ? { id: a.id, label: a.label, prompt: a.anglePrompt, mediaId: a.mediaId } : null
        })()

  // 选中已被删除时回退到 main, 保证 UI 不显示 stale 描述.
  useEffect(() => {
    if (selection !== 'main' && selectedVariant === null) {
      setSelection('main')
    }
  }, [selection, selectedVariant])

  const mainPrompt =
    target.kind === 'character'
      ? character?.prompt ?? ''
      : target.kind === 'location'
        ? location?.prompt ?? ''
        : prop?.prompt ?? ''
  const selectedPrompt =
    selectedVariant !== null ? selectedVariant.prompt : mainPrompt
  const selectedLabel =
    selectedVariant !== null ? selectedVariant.label : '主图'
  const selectedUrl =
    selectedVariant !== null && selectedVariant.mediaId
      ? mediaLookup[selectedVariant.mediaId]?.url
      : currentUrl

  const displayUrl = selectedUrl ?? target.url

  // v7.2 · 角色试镜视频 URL（实时从 store 读，重生成后自动更新）。
  const auditionVideoUrl =
    target.kind === 'character'
      ? (character?.auditionVideoMediaId
          ? mediaLookup[character.auditionVideoMediaId]?.url
          : undefined) ?? target.videoUrl
      : undefined
  // 主预览是否放视频：仅在「选了视频形态」且确有视频时。无视频则恒回落到图片。
  const showVideoPreview = previewMode === 'video' && !!auditionVideoUrl

  // 当前大图对应的 mediaId（主图 / 选中变体），编辑器「替换原图」要写回这一处。
  const displayMediaId =
    selectedVariant !== null
      ? selectedVariant.mediaId
      : target.kind === 'character'
        ? character?.turnaroundRefImageId
        : target.kind === 'location'
          ? location?.refImageId
          : prop?.refImageId

  /*
   * v3.12 · 描述 textarea 的本地编辑态
   *
   *   prompt = 作者正在编辑的文字; baselinePrompt = selection 当前在 store 里的
   *   官方 prompt. 当 selection 切换 (作者点了别的变体) 或 store 那边 prompt
   *   被外部写入 (生成完毕回写) 时, 把 prompt 同步过去 —— 但作者本地刚改还没生
   *   的文字优先保留, 不被覆盖. 这点用 lastSyncedSelection ref 兜.
   */
  const [prompt, setPrompt] = useState(selectedPrompt)
  const lastSyncedSelectionRef = useRef<{ sel: Selection; baseline: string }>({
    sel: 'main',
    baseline: mainPrompt,
  })
  useEffect(() => {
    const last = lastSyncedSelectionRef.current
    const isSelectionChange = last.sel !== selection
    const isExternalRewrite =
      last.sel === selection && last.baseline !== selectedPrompt && prompt === last.baseline
    if (isSelectionChange || isExternalRewrite) {
      setPrompt(selectedPrompt)
      lastSyncedSelectionRef.current = { sel: selection, baseline: selectedPrompt }
    }
    // 仅 baseline 变 (作者保存了, baseline 跟上) 也要更新 ref 避免下次误判
    if (last.sel === selection && last.baseline !== selectedPrompt && !isExternalRewrite) {
      lastSyncedSelectionRef.current = { sel: selection, baseline: selectedPrompt }
    }
  }, [selection, selectedPrompt, prompt])

  /*
   * v3.12 · 修改要求 (instruction) 不再分独立框, 跟 prompt 合并到同一个 textarea.
   *   "整段就是 AI 该看的最终描述", 作者写啥就是啥.
   *   想让 AI 重写? 在描述里留一行 "// 改成夜晚雨景" 也行, 或者点变体卡再调整.
   *   这是用户反馈的核心: 当前描述跟修改要求重复了.
   */
  const promptDirty = prompt !== selectedPrompt

  /*
   * v7.1 · 角色「真正发给图像模型的提示词」
   *
   *   作者在描述框里写的是**人设核心**（定位/身份/外观…），这段会被下游分镜、
   *   剧情回环当作角色外观锚点复用，所以**不能**被多视图模板污染。
   *   真正送进图像模型的是 buildCharacterTurnaroundPrompt 拼出的「定妆照·正面/
   *   侧面/背面/全身多分格」长提示词（与初次 Forge 生成完全同一条）。
   *
   *   这里随编辑实时拼出该完整提示词，供下方只读预览展示 + 复制，让作者
   *   "调好人设 → 立刻看到最终发给模型的那条"。变体选中时核心 = 该变体描述。
   */
  const characterModelPrompt = useMemo(() => {
    if (target.kind !== 'character') return ''
    const coreChar = {
      ...(character ?? {}),
      id: target.id,
      name: target.name,
      prompt,
    } as Character
    return composeVisualPrompt(
      buildCharacterTurnaroundPrompt(coreChar, { visualStyle }),
      visualStyle,
    )
  }, [target.kind, target.id, target.name, character, prompt, visualStyle])

  // ─── 操作 handlers ───
  /*
   * v3.12 · savePrompt 按"当前选中"分流落盘.
   *
   *   selection === 'main' -> 写 character/location/prop 的主 prompt
   *   selection === variantId -> 通过 add*Variant 的 upsert 语义整条替换该变体
   *
   *   注意 variant 里也带 mediaId, 这里需要保留原 mediaId, 否则会把那张图也清掉.
   *   只想改文字、不想改图的场景 (作者点"仅保存描述") 会走这条.
   */
  function savePromptForSelection(nextPrompt: string): void {
    if (selection === 'main') {
      if (target.kind === 'character' && character && nextPrompt !== character.prompt) {
        upsertCharacter({ ...character, prompt: nextPrompt })
      } else if (target.kind === 'location' && location && nextPrompt !== location.prompt) {
        upsertLocation({ ...location, prompt: nextPrompt })
      } else if (target.kind === 'prop' && prop && nextPrompt !== prop.prompt) {
        upsertProp({ ...prop, prompt: nextPrompt })
      }
      return
    }
    if (!selectedVariant) return
    // 整条 upsert (保留 mediaId / label / id 不变, 只改 prompt)
    if (target.kind === 'character') {
      addCharacterAppearanceVariant(target.id, {
        id: selectedVariant.id,
        label: selectedVariant.label,
        prompt: nextPrompt,
        mediaId: selectedVariant.mediaId,
      })
    } else if (target.kind === 'prop') {
      addPropVariant(target.id, {
        id: selectedVariant.id,
        label: selectedVariant.label,
        prompt: nextPrompt,
        mediaId: selectedVariant.mediaId,
      })
    } else {
      addLocationAngleRef(target.id, {
        id: selectedVariant.id,
        label: selectedVariant.label,
        anglePrompt: nextPrompt,
        mediaId: selectedVariant.mediaId,
      })
    }
  }

  /*
   * v3.12 · writeMediaToSelection —— 把生图/上传产物写到"当前选中".
   *   selection === 'main' -> 替换主图字段 (turnaroundRefImageId / refImageId)
   *   selection === variantId -> 通过 upsert 把该变体的 mediaId 替换 (同时 promo 当前 prompt 落盘)
   *   返回 newSelection, 让 caller 知道写完后选中要 (不) 要变 (append-variant 路径会传新 id).
   */
  function writeMediaToSelection(
    dataUrl: string,
    mimeType: string,
    promotedPrompt: string,
  ): void {
    const mid = ingestDataUrl(dataUrl, {
      name: `${target.kind}-${target.id}.png`,
      mimeType,
    })
    if (selection === 'main') {
      if (target.kind === 'character') {
        setCharacterTurnaroundRef(target.id, mid)
        if (character && promotedPrompt !== character.prompt) {
          upsertCharacter({ ...character, prompt: promotedPrompt })
        }
      } else if (target.kind === 'location') {
        setLocationRefImage(target.id, mid)
        if (location && promotedPrompt !== location.prompt) {
          upsertLocation({ ...location, prompt: promotedPrompt })
        }
      } else {
        setPropRefImage(target.id, mid)
        if (prop && promotedPrompt !== prop.prompt) {
          upsertProp({ ...prop, prompt: promotedPrompt })
        }
      }
      return
    }
    if (!selectedVariant) return
    if (target.kind === 'character') {
      addCharacterAppearanceVariant(target.id, {
        id: selectedVariant.id,
        label: selectedVariant.label,
        prompt: promotedPrompt,
        mediaId: mid,
      })
    } else if (target.kind === 'prop') {
      addPropVariant(target.id, {
        id: selectedVariant.id,
        label: selectedVariant.label,
        prompt: promotedPrompt,
        mediaId: mid,
      })
    } else {
      addLocationAngleRef(target.id, {
        id: selectedVariant.id,
        label: selectedVariant.label,
        anglePrompt: promotedPrompt,
        mediaId: mid,
      })
    }
  }

  /*
   * v3.12 · 写入新变体. 不依赖 selection, 强制建一条新记录.
   *   生成完毕选中自动切到这条新变体, 让作者立即看到结果.
   */
  function writeMediaAsNewVariant(
    dataUrl: string,
    mimeType: string,
    label: string,
    promptText: string,
  ): string {
    const mid = ingestDataUrl(dataUrl, {
      name: `${target.kind}-${target.id}.png`,
      mimeType,
    })
    const variantId = makeVariantId(target.kind)
    const finalLabel = label.trim() || fallbackVariantLabel()
    if (target.kind === 'character') {
      addCharacterAppearanceVariant(target.id, {
        id: variantId,
        label: finalLabel,
        prompt: promptText,
        mediaId: mid,
      })
    } else if (target.kind === 'prop') {
      addPropVariant(target.id, {
        id: variantId,
        label: finalLabel,
        prompt: promptText,
        mediaId: mid,
      })
    } else {
      addLocationAngleRef(target.id, {
        id: variantId,
        label: finalLabel,
        anglePrompt: promptText,
        mediaId: mid,
      })
    }
    return variantId
  }

  function fallbackVariantLabel(): string {
    return `变体 · ${new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }

  /*
   * v3.12 · 主生成入口 —— 替换"当前选中"那一张.
   *
   *   读 prompt textarea 当前文本作为最终描述. 跟以往不同:
   *   - 不再有 instruction 字段, 描述就是描述, 整段就是给 AI 的最终 prompt.
   *   - 如果作者改了 prompt (promptDirty), 把当前主图/变体图作为参考图喂进去
   *     保住一致性 (五官 / 服装 / 光影). 没改就不带参考图, 纯文本生成保留多样性.
   *   - 生成完毕 writeMediaToSelection 自动落盘 prompt + 替换该位置的图.
   *
   *   v6.5 · location 视角的特殊路径
   *     当 target.kind === 'location' 且 selection 不是 main 时 (编辑某个视角):
   *     强制用 location 主图作为 reference image, 而不是用"被编辑的视角自己".
   *     原因: location 多视角必须共享同一空间锚点, 让 image model 走 i2i
   *     保住光源 / 材质 / 空间布局. 不这样的话每个视角各自漂, 就会出现作者
   *     反馈的"主厅 / 主厅·后门外 像两座不同的房子".
   */
  async function runReplace(): Promise<void> {
    if (busy) return
    if (!prompt.trim()) {
      setError('请先在描述里写一段文字（哪怕一句话），才能生成。')
      return
    }
    setError(null)
    setBusy('replace')
    setBusyStage(
      selection === 'main' ? '正在生成新主图…' : `正在重生「${selectedLabel}」…`,
    )
    try {
      const userPrompt = prompt.trim()
      // 参考图选择 ——
      //  · location 编辑已有视角 -> 用主图 (locationMainUrl) 当 ref, 保空间一致性
      //  · 其它情况 + promptDirty -> 用 displayUrl 当 ref (吸收作者本轮改动)
      //  · 其它情况 + !promptDirty -> 不带 ref (作者只想换种子)
      const locationMainUrl = location?.refImageId
        ? mediaLookup[location.refImageId]?.url
        : undefined
      const isLocationAngleEdit =
        target.kind === 'location' && selection !== 'main'
      const refUrl = isLocationAngleEdit && locationMainUrl
        ? locationMainUrl
        : promptDirty
          ? displayUrl
          : undefined
      // v7.1 · 角色走「定妆照多视图」模板（与初次 Forge 同一条），让详情页重生成
      //   产出的就是正面/侧面/背面/全身拼版，不再是纯人设文本生的单图。
      //   location 视角则包装为"视角变化"指令走 i2i；其它（道具/角色变体）用原文。
      const finalPrompt =
        target.kind === 'character'
          ? buildCharacterTurnaroundPrompt(
              { ...(character ?? {}), id: target.id, name: target.name, prompt: userPrompt } as Character,
              { visualStyle },
            )
          : isLocationAngleEdit
            ? wrapLocationAnglePrompt(userPrompt, selectedLabel)
            : userPrompt
      const result = await imgClient.generate({
        prompt: composeVisualPrompt(finalPrompt, visualStyle),
        referenceImageDataUrl: refUrl,
        size: target.kind === 'character' ? '1536x1024' : undefined,
      })
      // 落盘的还是作者原文, 不让 wrap 后的 "Same location as ..." 喂回 textarea
      writeMediaToSelection(result.dataUrl, result.mimeType, userPrompt)
      onAfterUpdate?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setBusyStage('')
    }
  }

  /*
   * v3.12 · 加为新变体 —— 内联 label 输入流的"确认生成"回调.
   *
   *   point of contract:
   *   - 描述 textarea 当前文本 = 新变体的 prompt (跟"替换当前"一样).
   *     即作者可以先在描述框里把新变体描述写好, 再点"加为新变体" -> 填名字 -> 确认生.
   *   - label 留空也行, 走 fallbackVariantLabel.
   *   - 生成完毕 selection 自动切到新变体, 大图、描述、strip 高亮立即一致.
   *
   *   v6.5 · location 视角的特殊路径
   *     target.kind === 'location' 时, ref 永远用 location 主图 (不是 displayUrl),
   *     且 prompt 自动加 "Same location as the reference image, camera now ..."
   *     前缀, 让模型走 i2i 切换镜头, 保持空间锚点. 解决"主图跟视角各自漂"的问题.
   */
  async function runAppendVariant(label: string): Promise<void> {
    if (busy) return
    if (!prompt.trim()) {
      setError('请先在描述里写一段文字，作为新变体的描述。')
      return
    }
    setError(null)
    setBusy('append-variant')
    setBusyStage('正在生成新变体…')
    try {
      const userPrompt = prompt.trim()
      const locationMainUrl = location?.refImageId
        ? mediaLookup[location.refImageId]?.url
        : undefined
      // location 新视角：强制用主图作 ref + 自动包装 prompt 为"视角变化"指令
      const isLocationAngle = target.kind === 'location'
      // v7.1 · 角色变体同样走「定妆照多视图」模板（用该变体描述作核心）。
      const finalPrompt =
        target.kind === 'character'
          ? buildCharacterTurnaroundPrompt(
              { ...(character ?? {}), id: target.id, name: target.name, prompt: userPrompt } as Character,
              { visualStyle },
            )
          : isLocationAngle
            ? wrapLocationAnglePrompt(userPrompt, label)
            : userPrompt
      const refUrl = isLocationAngle
        ? locationMainUrl
        : displayUrl
      // 没有主图就退化到 displayUrl (作者还没生过主图的早期阶段)
      const effectiveRef = refUrl ?? (isLocationAngle ? displayUrl : refUrl)
      const result = await imgClient.generate({
        prompt: composeVisualPrompt(finalPrompt, visualStyle),
        referenceImageDataUrl: effectiveRef,
        size: target.kind === 'character' ? '1536x1024' : undefined,
      })
      const newId = writeMediaAsNewVariant(
        result.dataUrl,
        result.mimeType,
        label,
        // 落盘的还是作者写的原文, 不让 wrap 后的 "Same location as ..." 喂回 textarea
        userPrompt,
      )
      setAppendingVariant(null)
      // 切到新变体 + 把 textarea 同步到新变体的 prompt (落盘的是 userPrompt)
      setSelection(newId)
      lastSyncedSelectionRef.current = { sel: newId, baseline: userPrompt }
      onAfterUpdate?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setBusyStage('')
    }
  }

  /*
   * v3.12 · 上传通道 —— 跟生成对称, 默认走"替换当前选中".
   *   想上传作为新变体? 用 file picker 选完文件后会询问名字 (上传也支持 append-variant).
   *   实现上跟 runReplace / runAppendVariant 共用 writeMediaTo* 函数.
   */
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadIntentRef = useRef<'replace' | 'append-variant'>('replace')
  function triggerUpload(intent: 'replace' | 'append-variant'): void {
    if (intent === 'append-variant') {
      // 先打开内联 label 输入流; 用户填好 label 点确认 -> 真正去打开 file picker.
      // 但这会阻塞两次点击, 不符合用户"顺手填写"的诉求.
      // 直接走: 弹原生 prompt 拿名字, 然后开 picker. 简单直接.
      const label = window.prompt(
        target.kind === 'location' ? '新视角的名字' : '新变体的名字',
        '',
      )
      if (label === null) return // 取消
      uploadIntentRef.current = 'append-variant'
      pendingUploadLabelRef.current = label
    } else {
      uploadIntentRef.current = 'replace'
    }
    fileInputRef.current?.click()
  }
  const pendingUploadLabelRef = useRef<string>('')
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    if (!file) return
    const intent = uploadIntentRef.current
    setError(null)
    setBusy('upload')
    try {
      const dataUrl = await fileToDataUrl(file)
      const mimeType = file.type || 'image/png'
      if (intent === 'replace') {
        // 上传不改描述; 复用当前 selection 的 prompt 落盘 (本质是"换图但保留描述")
        writeMediaToSelection(dataUrl, mimeType, prompt.trim() || selectedPrompt)
      } else {
        const newId = writeMediaAsNewVariant(
          dataUrl,
          mimeType,
          pendingUploadLabelRef.current,
          prompt.trim() || selectedPrompt,
        )
        setSelection(newId)
        lastSyncedSelectionRef.current = {
          sel: newId,
          baseline: prompt.trim() || selectedPrompt,
        }
      }
      onAfterUpdate?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
      pendingUploadLabelRef.current = ''
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleDownload(): void {
    if (!displayUrl) return
    const a = document.createElement('a')
    a.href = displayUrl
    const fileTag = selection === 'main' ? target.name : `${target.name}-${selectedLabel}`
    a.download = `${target.kind}-${fileTag}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  function handleSavePromptOnly(): void {
    savePromptForSelection(prompt)
    onAfterUpdate?.()
  }

  const card = (
    <div
      className={`ks-apv-card${variant === 'inline' ? ' is-inline' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="ks-apv-bar">
        <div className="ks-apv-titleblock">
          <div className="ks-apv-kicker ks-mono">
            {target.kind === 'character'
              ? 'CHARACTER · REFERENCE'
              : target.kind === 'location'
                ? 'LOCATION · BASE'
                : 'PROP · REFERENCE'}
          </div>
          <div className="ks-apv-title ks-cn">{target.name}</div>
        </div>
        <div className="ks-apv-tools ks-mono">
          <button
            type="button"
            className={`ks-apv-close${variant === 'inline' ? ' is-inline' : ''}`}
            onClick={onClose}
            aria-label={variant === 'inline' ? '返回参考图' : '关闭'}
            title={variant === 'inline' ? '返回参考图网格 (ESC)' : '关闭 (ESC)'}
          >
            {variant === 'inline' ? (
              <>
                <span aria-hidden>←</span>
                <span>返回</span>
                <span className="ks-apv-kbd" aria-hidden>
                  ESC
                </span>
              </>
            ) : (
              '✕'
            )}
          </button>
        </div>
      </header>

        <div className="ks-apv-body">
          {/* ─── 顶：大图主显示（角色有试镜视频时默认放视频，可切回定妆照图） ─── */}
          <section className="ks-apv-viewer">
            {auditionVideoUrl && (
              <div className="ks-apv-preview-toggle ks-mono">
                <button
                  type="button"
                  className={`ks-apv-preview-tab${showVideoPreview ? ' is-on' : ''}`}
                  onClick={() => setPreviewMode('video')}
                  title="预览试镜视频（默认）"
                >
                  ▶ 试镜视频
                </button>
                <button
                  type="button"
                  className={`ks-apv-preview-tab${!showVideoPreview ? ' is-on' : ''}`}
                  onClick={() => setPreviewMode('image')}
                  title="查看定妆照图"
                >
                  🖼 定妆照
                </button>
              </div>
            )}
            <div className="ks-apv-stage">
              {showVideoPreview ? (
                <video
                  className="ks-apv-video"
                  src={auditionVideoUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                />
              ) : displayUrl ? (
                <button
                  type="button"
                  className="ks-apv-img-btn"
                  onClick={() => setZoomed(true)}
                  title="点击放大看细节"
                  aria-label="放大查看"
                >
                  <img src={displayUrl} alt={target.name} className="ks-apv-img" />
                  <span className="ks-apv-img-zoom-hint" aria-hidden>
                    🔍 点击放大
                  </span>
                </button>
              ) : (
                <div className="ks-apv-empty ks-cn">
                  暂无参考图 —— 在右侧写描述、点「生成 · 替换主图」
                </div>
              )}
              {busy && (
                <div className="ks-apv-busy ks-mono">
                  {busyStage || '处理中…'}
                </div>
              )}
            </div>
          </section>

          {/*
           * ─── 下方两栏（2026-06 作者定稿布局）───
           *   上面是大图(主显示), 下面分两块: 左=「变体」(点卡片切换/删除多余视角),
           *   右=「场景描述 + 生成」. 整体一屏内, 不下拉.
           */}
          <div className="ks-apv-lower">
            {/* 左栏 · 变体 */}
            <section className="ks-apv-variants-col">
              <VariantStrip
                target={target}
                currentMainMediaId={
                  target.kind === 'character'
                    ? character?.turnaroundRefImageId
                    : target.kind === 'location'
                      ? location?.refImageId
                      : prop?.refImageId
                }
                selectedKey={selection}
                onSelect={(key) => {
                  setSelection(key)
                  setError(null)
                  setAppendingVariant(null)
                }}
                onRemove={(variantId) => {
                  if (target.kind === 'character') {
                    removeCharacterAppearanceVariant(target.id, variantId)
                  } else if (target.kind === 'prop') {
                    removePropVariant(target.id, variantId)
                  } else {
                    // location 视角 —— 现在也可删 (清理重复的「全貌建立镜」等)
                    removeLocationAngleRef(target.id, variantId)
                  }
                  if (selection === variantId) setSelection('main')
                }}
              />
            </section>

            {/* 右栏 · 场景描述 + 生成（v3.12）
              *   selection === 'main'    -> 描述 = 角色/场所/道具主 prompt; 生成·替换 改主图
              *   selection === variantId -> 描述 = 该变体 prompt; 生成·替换 改该变体; 提为主图 升主图
              */}
          <section className="ks-apv-panel">
            <div className="ks-apv-field">
              <div className="ks-apv-field-label ks-mono ks-apv-field-label-row">
                <span>{getDescriptionLabel(target.kind)}</span>
                <span className="ks-apv-selection-pill ks-cn">
                  {selectedLabel}
                </span>
              </div>
              <div className="ks-apv-hint ks-faint">
                {selection === 'main'
                  ? target.kind === 'character'
                    ? '这是角色"主形态"的描述。剧情中默认就引用这张图。'
                    : target.kind === 'location'
                      ? '这是场所基准图的描述。空场景 / 主光氛围 —— 后面所有视角都会以这张作为参考图，保持空间一致。'
                      : '这是道具的主形态描述。'
                  : target.kind === 'location'
                    ? `当前在编辑视角「${selectedLabel}」。这里只写"视角差异"（如：仰拍吊灯 / 从后门往里看 / 转 90 度看窗外），不用重复场所描述 —— 我们会自动把主图作为参考图喂进去保持空间一致。`
                    : `当前在编辑变体「${selectedLabel}」。后续剧情提到「${selectedLabel}」时 AI 会自动认到这张图。`}
              </div>
              <textarea
                className="ks-apv-textarea ks-cn"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={getDescriptionPlaceholder(target.kind)}
                disabled={busy !== null}
              />
              {promptDirty && (
                <div className="ks-apv-actions-row">
                  <button
                    type="button"
                    className="ks-apv-btn ks-apv-btn-sm"
                    onClick={handleSavePromptOnly}
                    disabled={busy !== null}
                    title="只保存上方文字，不生图"
                  >
                    仅保存描述
                  </button>
                  <span className="ks-apv-hint ks-faint">
                    或点下方"生成"，会自动落盘描述并出新图。
                  </span>
                </div>
              )}
              {/*
               * v7.1 · 角色「实际发送给图像模型的提示词」只读预览。
               *   上方描述 = 人设核心（下游分镜/剧情复用）；这里是真正送进图像
               *   模型的完整「定妆照·正面/侧面/背面/全身多视图」提示词，随人设
               *   实时拼出，与「生成·替换主图」用的完全一致。只读，调人设即可。
               */}
              {target.kind === 'character' && (
                <details className="ks-apv-modelprompt" open>
                  <summary className="ks-apv-modelprompt-summary ks-mono">
                    实际提示词 · 定妆照多视图（送图像模型）
                  </summary>
                  <div className="ks-apv-modelprompt-hint ks-faint">
                    这条才是真正发给图像模型的完整提示词（正面/侧面/背面/全身拼版）。
                    随上方人设实时更新，只读 —— 改人设即可调它。
                  </div>
                  <textarea
                    className="ks-apv-modelprompt-text ks-mono"
                    value={characterModelPrompt}
                    readOnly
                    rows={6}
                    spellCheck={false}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </details>
              )}
            </div>

            {/*
             * v3.12 · 终态动作区
             *   - 主按钮 "生成 · 替换当前" -> runReplace, 改 selection 那张图
             *   - 次按钮 "加为新变体" 默认 idle, 点了内联展开 label 输入 +
             *     "确认生成 / 取消", 一次点击 + 一行输入就完成.
             *   - selection 不是 main 时, 主按钮旁边出现 "提为主图".
             */}
            <div className="ks-apv-action-section">
              <div className="ks-apv-action-row-primary">
                <button
                  type="button"
                  className="ks-apv-btn is-primary ks-apv-cta-primary"
                  onClick={runReplace}
                  disabled={busy !== null || !prompt.trim()}
                  title={
                    promptDirty
                      ? '用上方描述生成新图，替换当前选中那张（参考当前图保一致性）'
                      : '描述没改，按现在的描述换种子重生一次（无参考图，多样性更高）'
                  }
                >
                  {busy === 'replace'
                    ? busyStage || '生成中…'
                    : selection === 'main'
                      ? '生成 · 替换主图'
                      : `生成 · 替换「${selectedLabel}」`}
                </button>
                {selection !== 'main' && selectedVariant?.mediaId && (
                  <button
                    type="button"
                    className="ks-apv-btn"
                    onClick={() => {
                      const mid = selectedVariant.mediaId
                      if (!mid) return
                      if (target.kind === 'character') {
                        setCharacterTurnaroundRef(target.id, mid)
                      } else if (target.kind === 'location') {
                        setLocationRefImage(target.id, mid)
                      } else {
                        setPropRefImage(target.id, mid)
                      }
                    }}
                    disabled={busy !== null}
                    title="把当前选中的这张图作为主图（剧情默认形态）"
                  >
                    提为主图
                  </button>
                )}
              </div>

              {appendingVariant === null ? (
                <button
                  type="button"
                  className="ks-apv-btn ks-apv-cta-add"
                  onClick={() => {
                    if (!prompt.trim()) {
                      setError('先在描述里写一段文字，再加为新变体。')
                      return
                    }
                    setError(null)
                    setAppendingVariant({ label: '' })
                  }}
                  disabled={busy !== null}
                  title={
                    target.kind === 'location'
                      ? '不动主基准图，新建一个视角'
                      : '不动主图，新建一个形态变体（睡衣 / 战损 / 少年时代…）'
                  }
                >
                  + {target.kind === 'location' ? '加为新视角' : '加为新变体'}
                </button>
              ) : (
                <div className="ks-apv-inline-form">
                  <div className="ks-apv-field-label ks-mono">
                    {target.kind === 'location' ? '新视角名称' : '新变体名称'}
                  </div>
                  <input
                    autoFocus
                    className="ks-apv-input ks-cn"
                    type="text"
                    value={appendingVariant.label}
                    onChange={(e) => setAppendingVariant({ label: e.target.value })}
                    placeholder={getVariantLabelPlaceholder(target.kind)}
                    disabled={busy !== null}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        runAppendVariant(appendingVariant.label)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setAppendingVariant(null)
                      }
                    }}
                  />
                  <div className="ks-apv-hint ks-faint">
                    {target.kind === 'character'
                      ? `后续剧情里提到「${appendingVariant.label.trim() || '这个名字'}」AI 会自动用这张图。留空会按时间戳起名。`
                      : '留空会按时间戳起名。'}
                  </div>
                  <div className="ks-apv-actions-row">
                    <button
                      type="button"
                      className="ks-apv-btn is-primary ks-apv-btn-sm"
                      onClick={() => runAppendVariant(appendingVariant.label)}
                      disabled={busy !== null || !prompt.trim()}
                      title="按上方描述生成新图，作为新变体"
                    >
                      {busy === 'append-variant'
                        ? busyStage || '生成中…'
                        : '确认生成'}
                    </button>
                    <button
                      type="button"
                      className="ks-apv-btn ks-apv-btn-sm"
                      onClick={() => setAppendingVariant(null)}
                      disabled={busy !== null}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="ks-apv-divider" />

            {/*
             * v3.12 · 手动通道 —— 上传/下载, 跟生成区对称.
             *   "上传覆盖" 走当前 selection (主图 or 变体);
             *   "上传为新变体" 弹原生 prompt 拿名字 + 选文件, 一次性流程.
             */}
            <div className="ks-apv-field">
              <div className="ks-apv-field-label ks-mono">手动 · MANUAL</div>
              <div className="ks-apv-actions-row">
                <button
                  type="button"
                  className="ks-apv-btn"
                  onClick={() => triggerUpload('replace')}
                  disabled={busy !== null}
                  title={
                    selection === 'main'
                      ? '选本地图片直接覆盖当前主图'
                      : `选本地图片直接覆盖变体「${selectedLabel}」`
                  }
                >
                  {busy === 'upload'
                    ? '上传中…'
                    : selection === 'main'
                      ? '上传覆盖主图'
                      : `上传覆盖「${selectedLabel}」`}
                </button>
                <button
                  type="button"
                  className="ks-apv-btn"
                  onClick={() => triggerUpload('append-variant')}
                  disabled={busy !== null}
                  title={
                    target.kind === 'location'
                      ? '选本地图片作为新视角追加'
                      : '选本地图片作为新变体追加'
                  }
                >
                  {target.kind === 'location'
                    ? '上传为新视角'
                    : '上传为新变体'}
                </button>
                <button
                  type="button"
                  className="ks-apv-btn"
                  onClick={handleDownload}
                  disabled={!displayUrl}
                  title="下载当前显示的这张图"
                >
                  下载当前图
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleUpload}
                />
              </div>
            </div>

            {error && <div className="ks-apv-error ks-cn">× {error}</div>}

            {/*
             * v7 · 角色试镜视频 + 音色 —— 仅 character target 显示。
             *
             * 取代旧的「三候选预设音色锚点」面板：以定妆照为参考生成 ~10s 试镜视频，
             * 整段音轨抽成 MP3 作角色「音色参考」，下游生该角色镜头时直接作
             * Seedance reference_audio 喂入，保证整部剧角色嗓音一致。
             *
             * 见 CharacterAuditionPanel 内部注释。
             */}
            {target.kind === 'character' && character && (
              <CharacterAuditionPanel character={character} />
            )}
          </section>
          </div>
        </div>
    </div>
  )

  /*
   * 大图查看 = 复用素材库的 AssetLightbox（画笔 / 打码 / 箭头 / 数字 / 翻转旋转 /
   *   撤销复位）。保存语义按"当前选中"分流：
   *     · 替换原图 → writeMediaToSelection（就地把主图 / 当前变体指向编辑后的新图）
   *     · 设为新变体 → writeMediaAsNewVariant（新建一条变体并自动选中）
   *   编辑只动图，不改 prompt：promotedPrompt 一律传 selectedPrompt（= store 现值）。
   */
  const zoomNode =
    zoomed && displayUrl
      ? (() => {
          const item: LightboxItem = {
            id: displayMediaId ?? `apv-${target.kind}-${target.id}`,
            mediaId: displayMediaId,
            url: displayUrl,
            kind: 'image',
            prompt: selectedPrompt,
          }
          return (
            <AssetLightbox
              title={`${target.name} · ${selectedLabel}`}
              items={[item]}
              index={0}
              onClose={() => setZoomed(false)}
              onNavigate={() => {}}
              saveReplaceLabel="替换原图"
              saveNewLabel="设为新变体"
              onSaveEdited={(_it, dataUrl, mode) => {
                if (mode === 'replace') {
                  writeMediaToSelection(dataUrl, 'image/png', selectedPrompt)
                } else {
                  const newId = writeMediaAsNewVariant(
                    dataUrl,
                    'image/png',
                    fallbackVariantLabel(),
                    selectedPrompt,
                  )
                  setSelection(newId)
                }
                onAfterUpdate?.()
              }}
            />
          )
        })()
      : null

  if (variant === 'inline') {
    return (
      <div
        className="ks-apv-inline"
        role="region"
        aria-label={`${target.name} · 预览与编辑`}
      >
        {card}
        {zoomNode}
      </div>
    )
  }

  return (
    <>
      {createPortal(
        <div
          className="ks-apv-scrim"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`${target.name} · 预览与编辑`}
        >
          {card}
        </div>,
        document.body,
      )}
      {zoomNode}
    </>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const v = reader.result
      if (typeof v === 'string') resolve(v)
      else reject(new Error('读取失败：返回类型非字符串'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

/*
 * 变体 id 生成。带 kind 前缀方便日志里一眼看出是 character / prop / location 的变体。
 * 时间戳 + 36 进制随机够用，避免引入额外依赖；如果未来上 nanoid，统一替换即可。
 */
function makeVariantId(kind: 'character' | 'location' | 'prop'): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 6)
  const prefix = kind === 'character' ? 'cv' : kind === 'prop' ? 'pv' : 'lv'
  return `${prefix}-${t}-${r}`
}

/*
 * v6.5 · location 视角 prompt 包装器
 *
 * 让作者只用大白话写"想要的视角差异" (例如"从后门往里看 / 仰拍吊灯 / 转 90 度
 * 看出窗外"), 我们把它包成一条对 image model 友好的"视角转换"指令, 配合
 * referenceImageDataUrl=主图 食用. 强调三件事:
 *   1. Same location as the reference image —— 让模型不要重画, 只切镜头
 *   2. Same lighting and time-of-day —— 主光源 / 色温 / 影子方向锁死
 *   3. Empty, no people —— location 默认空场, 角色由 shot 关键帧添加
 *
 * 调用方需要用到这条文本仅在调 image API 时, 落盘到 store 的还是作者原文,
 * 这样作者下次打开 dialog 看到的依然是 "从后门往里看", 不会被模板污染.
 */
function wrapLocationAnglePrompt(userPrompt: string, label: string): string {
  const lines: string[] = [
    `Same location as the reference image, camera angle now: ${label || 'a different angle'}.`,
    `Specifically: ${userPrompt}`,
    'Keep the same lighting direction, color temperature, materials, and spatial layout exactly as in the reference image. Empty location, no people.',
  ]
  return lines.join('\n')
}

/**
 * CharacterAuditionPanel —— 角色「音色试听」最小模块（v7）。
 *
 * 设计（作者反馈）：详情里不放大块视频预览 —— 3:4 试镜视频在外面的定妆照网格卡上替换
 * 图片展示即可。这里只保留一个**极简试听条**：
 *   - 一个生成/重生按钮（以定妆照为参考生成 ~10s 试镜视频并抽取音色，进度在按钮上滚动）；
 *   - 有音色样本时一个 <audio> 回放（下游会作 reference_audio 自动喂入）。
 *
 * 生成是异步的（Seedance 任务 ~30-90s）：点完按钮可关掉弹窗，完成后网格卡会自动从图片
 * 切换为试镜视频、本条也会出现音色试听。
 */
function CharacterAuditionPanel({ character }: { character: Character }): JSX.Element {
  const entries = useMediaStore((s) => s.entries)
  // 可生成的前提：任一可用单人参考图（headshot / fullbody / turnaround / refImage）。
  const refId =
    character.headshotMediaId ??
    character.fullbodyMediaId ??
    character.turnaroundRefImageId ??
    character.refImageId
  const hasTurnaround = !!(refId && entries[refId]?.url)
  const videoUrl = character.auditionVideoMediaId
    ? entries[character.auditionVideoMediaId]?.url
    : undefined
  const voiceUrl = character.voiceSampleMediaId
    ? entries[character.voiceSampleMediaId]?.url
    : undefined

  // 生成状态统一从队列读（与外面角色网格卡同一来源；切 tab / 关弹窗都不丢）。
  const job = useCardJob(auditionCardKey(character.id))
  const busy = job?.status === 'queued' || job?.status === 'running'
  const stage = job?.status === 'queued' ? '排队中…' : (job?.stage ?? null)
  const jobError =
    job?.status === 'failed' || job?.status === 'cancelled'
      ? job.error || '生成失败'
      : null
  const [localError, setLocalError] = useState<string | null>(null)
  const error = localError ?? jobError
  const [playing, setPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  function runGenerate(): void {
    if (busy) return
    if (!hasTurnaround) {
      setLocalError('请先生成角色定妆照，再生成试镜视频。')
      return
    }
    setLocalError(null)
    // 入队（与网格卡共享 cardKey；状态由 useCardJob 实时反映）。
    enqueueAudition({ id: character.id, name: character.name })
  }

  // 试听：只播放声音（音色 MP3），再点一次停止。视频本体在外面网格卡上看。
  function toggleListen(): void {
    const a = audioRef.current
    if (!a || !voiceUrl) return
    if (a.paused) void a.play().catch(() => {})
    else a.pause()
  }

  return (
    <div className="ks-apv-voicemini">
      <span className="ks-apv-voicemini-label ks-cn">音色试听</span>
      <button
        type="button"
        className="ks-apv-btn is-primary ks-apv-voicemini-btn"
        onClick={toggleListen}
        disabled={!voiceUrl}
        title={voiceUrl ? '试听该角色音色（仅播放声音）' : '尚无音色，先生成试镜视频'}
      >
        {playing ? '■ 停止' : '▶ 试听音色'}
      </button>
      {!voiceUrl && (
        <span className="ks-apv-voicemini-empty ks-cn ks-faint">
          {busy ? '生成中（约 30-90s）…' : '尚无音色 · 生成试镜视频后自动提取'}
        </span>
      )}
      {/* 次要动作：对当前不满意时重新生成（视频在外面卡片展示） */}
      <button
        type="button"
        className="ks-apv-voicemini-regen ks-cn"
        onClick={() => runGenerate()}
        disabled={busy || !hasTurnaround}
        title={
          hasTurnaround
            ? '不满意当前试镜？以定妆照重新生成试镜视频并重新提取音色'
            : '需先生成角色定妆照'
        }
      >
        {busy ? (stage ?? '生成中…') : videoUrl || voiceUrl ? '重新生成' : '生成试镜'}
      </button>
      {voiceUrl && (
        <audio
          ref={audioRef}
          src={voiceUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          style={{ display: 'none' }}
        />
      )}
      {error && <div className="ks-apv-voicemini-err ks-cn">× {error}</div>}
    </div>
  )
}

/*
 * CharacterVoicePanel —— 角色音色锚点编辑面板（v6.6 · 已停用，保留代码备查）。
 *
 * 设计原则:
 *   1. 锚点优先: 进入面板看到的是"当前已锚定的音色"; 没锚定就显示空态.
 *   2. 试听 -> 锚定 两步式:
 *      · 选音色 + 编辑试听文本 -> 点 "试听" -> 听到 mp3 (mediaStore 临时落盘)
 *      · 满意 -> 点 "保存为锚点" -> voiceAnchor 写到 character, 视频 / 后续
 *        旁白 / TTS 自动用它
 *      · 不满意 -> 换音色 / 改文本 / 重听, 老 sampleMediaId 被覆盖
 *   3. 已锚定的状态有"重新试听 / 解除锚点"两个动作, 前者复用上次 sampleText.
 *
 * 失败处理:
 *   - TTS API 错 (无 key 等) -> 兜底 silent mp3, 仍弹"已生成试听" 让 UI 流转;
 *     在卡上写一行小灰字 "(无 key, 占位静音)" 避免静默骗人.
 *
 * 数据 ownership:
 *   - sampleMediaId 写到 mediaStore (audio mp3); 节点本身不持有 audio bytes.
 *   - 锚点字段全在 character.voiceAnchor 里, 持久化由上层 scenarioStore 接管.
 *
 * 测试钩子:
 *   - 单测可以 _setTtsClientForTest(...) 注入假 client 不打网络.
 */
function CharacterVoicePanel({ character }: { character: Character }): JSX.Element {
  return <CharacterVoiceCastingPanel character={character} />
}

/*
 * v6.7 · CharacterVoiceCastingPanel —— "三候选" 选角交互
 *
 * 流程:
 *   1) 自动 (或点 "重新生成") 让 LLM 给当前角色挑 3 个 TTS voiceType
 *      + 生成一段 18-32 字的"角色专属基准话语"(自创不侵权)
 *   2) UI 把 3 个候选铺成横排卡片, 每张卡可独立 ▶ 试听 (TTS 合成本卡音色)
 *   3) 玩家点中其中一张 -> 锁定 -> 点 "保存为本角色音色"
 *      把 voiceType + sampleText + sampleMediaId 写到 character.voiceAnchor,
 *      下游 (视频 / 旁白合成) 自动读取
 *   4) 已锚定状态: 头部显示 "已锚定 · 灿灿 · 多情感"; 想换就重新生成
 *
 * 失败处理:
 *   - LLM 不可用 / 输出非法 -> heuristicFallback 给 3 个 + 通用兜底台词,
 *     卡上小灰字注明 "(离线推荐)"
 *   - TTS 不可用 -> silent mp3, 卡上写 "(无 key, 占位静音)"
 */
function CharacterVoiceCastingPanel({
  character,
}: { character: Character }): JSX.Element {
  const setCharacterVoiceAnchor = useScenarioStore((s) => s.setCharacterVoiceAnchor)
  const ingestDataUrl = useMediaStore((s) => s.ingestDataUrl)
  const mediaLookup = useMediaStore((s) => s.entries)

  const anchored = character.voiceAnchor
  const ttsClient = useMemo(() => getTtsClient(), [])
  const llmClient = useMemo(() => createTextProvider(), [])

  // —— 候选生成态
  const [casting, setCasting] = useState<{
    sampleText: string
    candidates: Array<{
      voiceType: string
      label: string
      reason: string
      gender: string
      style: string
    }>
    notes?: string
    fallback?: boolean
  } | null>(null)
  const [castBusy, setCastBusy] = useState(false)
  const [castError, setCastError] = useState<string | null>(null)

  // —— 当前选中的 voiceType (第几张卡); 切换 character 或重新生成时重置
  const [selectedVoiceType, setSelectedVoiceType] = useState<string | undefined>(
    anchored?.voiceType,
  )
  // —— 每张卡片自己的试听状态: voiceType -> { previewUrl, mediaId, mock }
  type PreviewState = { previewUrl: string; previewMediaId?: string; mock: boolean }
  const [previews, setPreviews] = useState<Record<string, PreviewState>>(() => {
    if (anchored?.voiceType && anchored.sampleMediaId) {
      const url = mediaLookup[anchored.sampleMediaId]?.url
      if (url) {
        return { [anchored.voiceType]: { previewUrl: url, previewMediaId: anchored.sampleMediaId, mock: false } }
      }
    }
    return {}
  })
  const [synthBusyVoice, setSynthBusyVoice] = useState<string | null>(null)
  const [savingAnchor, setSavingAnchor] = useState(false)
  const [synthError, setSynthError] = useState<string | null>(null)

  // 编辑态的 sampleText (玩家可能想改 LLM 写的台词); 切候选 / 切角色时跟随
  const [editableSampleText, setEditableSampleText] = useState<string>(
    anchored?.sampleText ?? '',
  )
  const [speedRatio, setSpeedRatio] = useState<number>(
    anchored?.speedRatio ?? 1.0,
  )

  // 切换 character (锚点跟着换) -> 重置面板 + 触发自动选角
  useEffect(() => {
    setSelectedVoiceType(anchored?.voiceType)
    setEditableSampleText(anchored?.sampleText ?? '')
    setSpeedRatio(anchored?.speedRatio ?? 1.0)
    setSynthError(null)
    setCastError(null)
    // 复用已锚定的 mediaId 渲染 audio (新 casting 跑之前先有东西可听)
    if (anchored?.voiceType && anchored.sampleMediaId) {
      const url = mediaLookup[anchored.sampleMediaId]?.url
      setPreviews(
        url
          ? { [anchored.voiceType]: { previewUrl: url, previewMediaId: anchored.sampleMediaId, mock: false } }
          : {},
      )
    } else {
      setPreviews({})
    }
    // 主动跑一次选角 (空态 / 切角色后一进面板就有 3 张卡)
    void runCasting()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id])

  async function runCasting(): Promise<void> {
    if (castBusy) return
    setCastBusy(true)
    setCastError(null)
    try {
      const result = await castCharacterVoice(llmClient, character)
      setCasting(result)
      // 默认让"已锚定"或"第一张"为选中态
      const preferVoice =
        anchored?.voiceType && result.candidates.find((c) => c.voiceType === anchored.voiceType)
          ? anchored.voiceType
          : result.candidates[0]?.voiceType
      if (preferVoice) setSelectedVoiceType(preferVoice)
      // sampleText 没改过就跟随 LLM 输出; 改过就保留作者编辑
      if (!editableSampleText.trim()) {
        setEditableSampleText(result.sampleText)
      }
    } catch (e) {
      setCastError(e instanceof Error ? e.message : String(e))
      // 二次兜底: 至少给本地 heuristic
      setCasting(heuristicFallback(character))
    } finally {
      setCastBusy(false)
    }
  }

  /**
   * 试听某一张候选卡 —— 用当前 editableSampleText 调 TTS, 把 mp3 写进 previews[voiceType].
   * 多张卡的试听互不干扰; 但同一时间只允许一个合成中, 避免火山接口被打爆.
   */
  async function previewCandidate(voiceType: string): Promise<void> {
    if (synthBusyVoice) return
    const text = editableSampleText.trim() || casting?.sampleText?.trim()
    if (!text) {
      setSynthError('试听文本不能为空。')
      return
    }
    setSynthError(null)
    setSynthBusyVoice(voiceType)
    try {
      const cand = casting?.candidates.find((c) => c.voiceType === voiceType)
      const result = await ttsClient.synth({
        text,
        voiceType,
        speedRatio,
        label: cand?.label,
      })
      const mid = ingestDataUrl(result.dataUrl, {
        name: `voice-${character.id}-${voiceType}.mp3`,
        mimeType: 'audio/mpeg',
      })
      setPreviews((prev) => ({
        ...prev,
        [voiceType]: { previewUrl: result.dataUrl, previewMediaId: mid, mock: !!result.mock },
      }))
      setSelectedVoiceType(voiceType)
    } catch (e) {
      setSynthError(e instanceof Error ? e.message : String(e))
    } finally {
      setSynthBusyVoice(null)
    }
  }

  function runSaveAnchor(): void {
    if (savingAnchor || !selectedVoiceType) return
    const cand = casting?.candidates.find((c) => c.voiceType === selectedVoiceType)
    const preview = previews[selectedVoiceType]
    setSavingAnchor(true)
    try {
      const anchor: CharacterVoiceAnchor = {
        voiceType: selectedVoiceType,
        label: cand?.label,
        sampleMediaId: preview?.previewMediaId,
        sampleText: editableSampleText.trim() || casting?.sampleText,
        speedRatio,
        savedAt: Date.now(),
      }
      setCharacterVoiceAnchor(character.id, anchor)
    } finally {
      setSavingAnchor(false)
    }
  }

  function runClearAnchor(): void {
    if (savingAnchor) return
    setCharacterVoiceAnchor(character.id, undefined)
    setSelectedVoiceType(undefined)
  }

  const candidates = casting?.candidates ?? []
  const llmNote = casting?.notes
  const isFallback = casting?.fallback === true

  return (
    <div className="ks-apv-voice-panel">
      <div className="ks-apv-voice-head">
        <span className="ks-apv-voice-title ks-cn">音色锚点 · 三候选</span>
        {anchored ? (
          <span className="ks-apv-voice-status ks-mono">
            已锚定 · {anchored.label ?? anchored.voiceType}
          </span>
        ) : (
          <span className="ks-apv-voice-status ks-mono ks-faint">未锚定</span>
        )}
        <button
          type="button"
          className="ks-apv-voice-recast ks-cn"
          onClick={() => void runCasting()}
          disabled={castBusy || synthBusyVoice !== null}
          title="基于角色描述重新让 LLM 推荐 3 个候选 + 重写基准话语"
        >
          {castBusy ? '选角中…' : '↻ 重新推荐'}
        </button>
      </div>
      <div className="ks-apv-voice-hint ks-cn ks-faint">
        基于角色描述，AI 推荐 3 个候选音色 + 一段角色专属的基准话语。
        每张卡可独立试听，挑中一张点"保存为本角色音色"，下游视频/旁白会自动用这条音色配音。
        {isFallback && (
          <span className="ks-apv-voice-fallback-hint">
            （当前为离线推荐，建议联网后点"重新推荐"获得角色定制台词。）
          </span>
        )}
      </div>

      {/* 基准话语（可编辑） */}
      <div className="ks-apv-voice-text-wrap">
        <label className="ks-apv-voice-label ks-cn">基准话语（角色台词，3 张卡共用）</label>
        <textarea
          className="ks-apv-voice-textarea ks-cn"
          rows={2}
          value={editableSampleText}
          onChange={(e) => setEditableSampleText(e.target.value)}
          disabled={synthBusyVoice !== null}
          placeholder={casting?.sampleText ?? '基于角色描述生成的一句台词，作者可改。'}
        />
      </div>

      {/* 语速 */}
      <div className="ks-apv-voice-row">
        <label className="ks-apv-voice-label ks-cn">语速</label>
        <input
          type="range"
          min="0.5"
          max="2"
          step="0.05"
          value={speedRatio}
          onChange={(e) => setSpeedRatio(Number(e.target.value))}
          disabled={synthBusyVoice !== null}
        />
        <span className="ks-apv-voice-speed ks-mono">×{speedRatio.toFixed(2)}</span>
      </div>

      {/* 三张候选卡（横排） */}
      {castBusy && candidates.length === 0 && (
        <div className="ks-apv-voice-loading ks-cn ks-faint">正在为这个角色挑音色…</div>
      )}
      {!castBusy && candidates.length === 0 && (
        <div className="ks-apv-voice-loading ks-cn ks-faint">
          没拿到候选；请点上方"重新推荐"。
        </div>
      )}
      {candidates.length > 0 && (
        <div className="ks-apv-voice-cards">
          {candidates.map((c, idx) => {
            const selected = selectedVoiceType === c.voiceType
            const preview = previews[c.voiceType]
            const synthing = synthBusyVoice === c.voiceType
            return (
              <div
                key={c.voiceType}
                className={`ks-apv-voice-card${selected ? ' is-selected' : ''}`}
                onClick={() => setSelectedVoiceType(c.voiceType)}
                role="button"
                tabIndex={0}
                aria-pressed={selected}
              >
                <div className="ks-apv-voice-card-head">
                  <span className="ks-apv-voice-card-rank ks-mono">候选 {idx + 1}</span>
                  <span className="ks-apv-voice-card-label ks-cn">{c.label}</span>
                </div>
                <div className="ks-apv-voice-card-style ks-cn ks-faint">{c.style}</div>
                <div className="ks-apv-voice-card-reason ks-cn">{c.reason}</div>
                <div className="ks-apv-voice-card-actions">
                  <button
                    type="button"
                    className="ks-apv-btn ks-apv-btn-primary"
                    onClick={(e) => {
                      e.stopPropagation()
                      void previewCandidate(c.voiceType)
                    }}
                    disabled={synthBusyVoice !== null || castBusy}
                  >
                    {synthing ? '合成中…' : preview ? '重新试听' : '▶ 试听'}
                  </button>
                </div>
                {preview && (
                  <div className="ks-apv-voice-card-player">
                    <audio
                      src={preview.previewUrl}
                      controls
                      preload="metadata"
                      onClick={(e) => e.stopPropagation()}
                    />
                    {preview.mock && (
                      <span className="ks-apv-voice-mock ks-cn ks-faint">
                        （无 TTS key，占位静音）
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {llmNote && (
        <div className="ks-apv-voice-note ks-cn ks-faint">备注：{llmNote}</div>
      )}

      <div className="ks-apv-voice-actions">
        <button
          type="button"
          className="ks-apv-btn ks-apv-btn-primary"
          onClick={runSaveAnchor}
          disabled={
            savingAnchor ||
            castBusy ||
            synthBusyVoice !== null ||
            !selectedVoiceType
          }
          title={
            !selectedVoiceType
              ? '先点选 / 试听一张候选'
              : '把当前选中的音色 + 基准话语锚定到角色'
          }
        >
          {savingAnchor ? '保存中…' : '💾 保存为本角色音色'}
        </button>
        {anchored && (
          <button
            type="button"
            className="ks-apv-btn ks-apv-btn-danger"
            onClick={runClearAnchor}
            disabled={savingAnchor}
            title="解除锚点；下游视频/旁白会回退到导演兜底音色"
          >
            解除锚点
          </button>
        )}
      </div>

      {(synthError || castError) && (
        <div className="ks-apv-error ks-cn">× {synthError || castError}</div>
      )}
    </div>
  )
}

/*
 * VariantStrip —— 在 dialog 大图正下方水平展示"主图 + 已有变体"作为可切换的视图.
 *
 * v3.12 设计变更:
 *   旧版 onPickAsMain 把变体推为主图; 新版改成纯 view-state 选择 (onSelect),
 *   想"提为主图"是另一个独立动作 (右侧 panel 按钮). 这分离了视图焦点和数据修改.
 *
 *   主图也作为 strip 的第一张卡 (key='main') 展示, 让作者在"主图 / 变体₁ / 变体₂..."
 *   之间像切 tab 一样切换. 选中卡有橙色描边 + ◆ 当前编辑标记.
 *
 *   selectedKey 来自父级 dialog 的 selection state. 变体不存在时父级 effect 会
 *   回退到 'main', 这里直接信任父级传入的值.
 */
function VariantStrip({
  target,
  currentMainMediaId,
  selectedKey,
  onSelect,
  onRemove,
}: {
  target: PreviewTarget
  /**
   * 当前主图的 mediaId. 只用来在主图卡上抓取缩略图; 不再用于 "is-main" 判定
   * (现在 is-main 由 selectedKey === 'main' 决定).
   */
  currentMainMediaId?: string
  /** 当前选中的视图 key: 'main' 或某个 variantId */
  selectedKey: 'main' | string
  /** 点卡片切换视图焦点 */
  onSelect: (key: 'main' | string) => void
  onRemove: (variantId: string) => void
}): React.ReactElement | null {
  /*
   * 关键: zustand selector 必须返回 store 里 identity 稳定的引用, 不能在
   * selector 里现 .map() 出新对象 —— 否则每次 render 都会被判 "变了" 触发
   * forceStoreRerender, 立即陷入 "Maximum update depth exceeded".
   */
  const characterVariants = useScenarioStore((s) =>
    target.kind === 'character'
      ? s.scenario.characters?.[target.id]?.appearanceVariants
      : undefined,
  )
  const propVariants = useScenarioStore((s) =>
    target.kind === 'prop' ? s.scenario.props?.[target.id]?.variants : undefined,
  )
  const locationAngles = useScenarioStore((s) =>
    target.kind === 'location'
      ? s.scenario.locations?.[target.id]?.angleRefs
      : undefined,
  )
  const variants = useMemo<
    Array<{ id: string; label: string; prompt: string; mediaId?: string }>
  >(() => {
    if (target.kind === 'character') {
      return (characterVariants ?? []).map((v) => ({
        id: v.id,
        label: v.label,
        prompt: v.prompt,
        mediaId: v.mediaId,
      }))
    }
    if (target.kind === 'prop') {
      return (propVariants ?? []).map((v) => ({
        id: v.id,
        label: v.label,
        prompt: v.prompt,
        mediaId: v.mediaId,
      }))
    }
    return (locationAngles ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      prompt: a.anglePrompt,
      mediaId: a.mediaId,
    }))
  }, [target.kind, characterVariants, propVariants, locationAngles])
  const mediaLookup = useMediaStore((s) => s.entries)
  // 主图也算一张卡 —— 永远第一位, 让作者一眼能切回主图视图.
  const mainUrl = currentMainMediaId ? mediaLookup[currentMainMediaId]?.url : undefined
  // location 视角也可删（清理 forge 早期遗留的重复「全貌建立镜」等）。主图卡本身不带删除键。
  const removable = true
  // 没有变体 + 也没有主图 -> 不展示 strip
  if (variants.length === 0 && !mainUrl) return null
  return (
    <div className="ks-apv-variants">
      <div className="ks-apv-variants-label ks-mono">
        共 {1 + variants.length} 张 ·
        <span className="ks-faint" style={{ marginLeft: 6 }}>
          点卡片切换查看 · ✕ 移除变体
        </span>
      </div>
      <div className="ks-apv-variants-strip">
        {/* 主图卡 —— 永远第一位 */}
        <div
          className={`ks-apv-variant-card is-pickable${
            selectedKey === 'main' ? ' is-current' : ''
          }`}
          title="主图（剧情默认引用）"
          onClick={() => onSelect('main')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect('main')
            }
          }}
        >
          {mainUrl ? (
            <img src={mainUrl} alt="主图" draggable={false} />
          ) : (
            <div className="ks-apv-variant-blank ks-mono">无主图</div>
          )}
          <div className="ks-apv-variant-label ks-cn">主图</div>
          {selectedKey === 'main' && (
            <span className="ks-apv-variant-main-badge ks-mono" aria-hidden>
              ◆ 编辑中
            </span>
          )}
        </div>

        {variants.map((v) => {
          const url = v.mediaId ? mediaLookup[v.mediaId]?.url : undefined
          const isCurrent = selectedKey === v.id
          return (
            <div
              className={`ks-apv-variant-card is-pickable${
                isCurrent ? ' is-current' : ''
              }`}
              key={v.id}
              title={
                isCurrent
                  ? `${v.label} · 编辑中`
                  : `点击查看/编辑「${v.label}」${v.prompt ? `\n\n${v.prompt}` : ''}`
              }
              onClick={() => onSelect(v.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(v.id)
                }
              }}
            >
              {url ? (
                <img src={url} alt={v.label} draggable={false} />
              ) : (
                <div className="ks-apv-variant-blank ks-mono">无图</div>
              )}
              <div className="ks-apv-variant-label ks-cn">{v.label}</div>
              {isCurrent && (
                <span className="ks-apv-variant-main-badge ks-mono" aria-hidden>
                  ◆ 编辑中
                </span>
              )}
              {removable && (
                <button
                  type="button"
                  className="ks-apv-variant-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(v.id)
                  }}
                  aria-label={`移除变体 ${v.label}`}
                  title="移除该变体（不影响主图）"
                >
                  ✕
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/*
 * v3.12 · 描述区文案统一从这里出, 让 JSX 更紧凑.
 */
function getDescriptionLabel(kind: 'character' | 'location' | 'prop'): string {
  return kind === 'character'
    ? '当前描述 · DESCRIPTION'
    : kind === 'location'
      ? '场所描述 · DESCRIPTION'
      : '道具描述 · DESCRIPTION'
}
function getDescriptionPlaceholder(kind: 'character' | 'location' | 'prop'): string {
  return kind === 'character'
    ? '描述角色的外观、服装、气质、光线 …'
    : kind === 'location'
      ? '描述场所的光线、时间、材质、氛围 …'
      : '描述道具的材质、颜色、形态、关键标识 …'
}
function getVariantLabelPlaceholder(kind: 'character' | 'location' | 'prop'): string {
  return kind === 'character'
    ? '如 "睡衣" / "战损" / "便服" / "少年时代"'
    : kind === 'prop'
      ? '如 "出鞘" / "破损" / "燃烧中"'
      : '如 "主厅全景" / "后门外"'
}

const css = `
.ks-apv-scrim {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: var(--ks-overlay-scrim);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  animation: ks-apv-scrim-in 200ms var(--ks-ease);
}
@keyframes ks-apv-scrim-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.ks-apv-card {
  width: min(1080px, 100%);
  max-height: 100%;
  background: var(--ks-panel-elev);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-xl);
  box-shadow: var(--ks-shadow-lift), var(--ks-shadow-inset-hi);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: ks-apv-card-in 240ms var(--ks-ease);
}
@keyframes ks-apv-card-in {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

/* ─── inline 变体（2026-06）：铺满内容区的整页详情 ───────────────
 * 图像一级界面迁到左栏后，参考图详情不再是中央浮窗，而是占满内容区，
 * 给作者更大的编辑/排布空间。去掉浮窗那套（居中、最大宽度、抬升阴影、
 * 缩放入场），改为填满父容器、可纵向滚动的整页卡片。 */
.ks-apv-inline {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.ks-apv-inline > .ks-apv-card.is-inline {
  width: 100%;
  max-width: none;
  max-height: 100%;
  flex: 1;
  min-height: 0;
  border-radius: var(--ks-radius-lg);
  box-shadow: var(--ks-shadow-inset-hi);
  animation: ks-apv-card-in 180ms var(--ks-ease);
}
/* inline 密度收紧：详情铺满内容区时，适当压缩左右内边距，让「一屏内」尽量装得下，
 * 右栏内容超出时由 .ks-apv-panel 自身 overflow-y 滚动，而不是把整页/左图撑长。 */
.ks-apv-card.is-inline .ks-apv-viewer {
  padding: 16px;
  gap: 10px;
}
.ks-apv-card.is-inline .ks-apv-panel {
  padding: 14px 18px;
  gap: 12px;
}
/*
 * 定稿布局（2026-06 作者）: 大图在上, 下面两栏(左变体 / 右描述+生成), 一屏看全不下拉.
 * 结构高度规则在基础 .ks-apv-body / .ks-apv-lower 里, 这里只做 inline 密度收紧.
 */
.ks-apv-card.is-inline .ks-apv-stage {
  min-height: 0;
}
.ks-apv-card.is-inline .ks-apv-textarea {
  min-height: 44px;
}
.ks-apv-card.is-inline .ks-apv-action-section {
  padding: 10px 12px 12px;
  gap: 8px;
}
.ks-apv-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 22px;
  border-bottom: 1px solid var(--ks-border-soft);
  flex-shrink: 0;
}
.ks-apv-titleblock {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.ks-apv-kicker {
  font-size: 10px;
  letter-spacing: 0.26em;
  color: var(--ks-amber);
  text-transform: uppercase;
}
.ks-apv-title {
  font-family: var(--ks-font-display);
  font-size: 17px;
  font-weight: 600;
  color: var(--ks-text);
  letter-spacing: -0.01em;
}
.ks-apv-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--ks-text-dim);
  flex-shrink: 0;
  white-space: nowrap;
}
.ks-apv-close {
  all: unset;
  cursor: pointer;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--ks-text-soft);
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
/* inline 形态的「返回」按钮：自适应宽度的胶囊，文字不换行（修复圆按钮塞不下「← 返回」导致多行） */
.ks-apv-close.is-inline {
  width: auto;
  height: 32px;
  padding: 0 12px;
  gap: 7px;
  border-radius: var(--ks-radius-pill);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.ks-apv-kbd {
  font-size: 9px;
  letter-spacing: 0.12em;
  padding: 1px 5px;
  border: 1px solid var(--ks-border);
  border-radius: 4px;
  color: var(--ks-text-dim);
  line-height: 1.4;
}
.ks-apv-close:hover {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
  border-color: var(--ks-border-strong);
}

/*
 * 定稿布局（2026-06 作者）：上=大图主显示, 下=两栏（左变体 / 右场景描述+生成）。
 * body 竖向 flex, 整体一屏内不下拉。
 */
.ks-apv-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 顶部 · 大图区（只放大图, 弹性占据剩余高度, 当主角） */
.ks-apv-viewer {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  background: var(--ks-surface-warm);
  border-bottom: 1px solid var(--ks-border-soft);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px;
}
/* 下方两栏容器 —— 固定占比(不随内容高度变), 其余高度全留给大图。
 * 关键: 用恒定 flex-basis 而不是 auto/max-height, 这样换图/换变体时右栏内容
 * 增减不会改变本容器高度 → 大图区高度恒定 → 切图不抖动。内容超出由两栏各自内滚。 */
.ks-apv-lower {
  flex: 0 0 46%;
  display: grid;
  grid-template-columns: minmax(140px, 0.72fr) minmax(0, 1.85fr);
  min-height: 0;
  overflow: hidden;
}
/* 左栏 · 变体（卡片换行成网格, 自身可滚） */
.ks-apv-variants-col {
  border-right: 1px solid var(--ks-border-soft);
  padding: 12px 14px;
  overflow-y: auto;
  min-height: 0;
}
.ks-apv-variants-col .ks-apv-variants {
  margin-top: 0;
}
.ks-apv-variants-col .ks-apv-variants-strip {
  flex-wrap: wrap;
  overflow-x: visible;
}
/*
 * v3.11 · stage = 大图本体的 flex 槽, 撑满 viewer 剩余空间;
 * variant strip 在 stage 下方占自己高度. 这层包装让 strip 永远贴底,
 * 大图自适应居中.
 */
.ks-apv-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* 大图按钮包装 —— 点击放大. all:unset 后再恢复 flex 居中. */
.ks-apv-img-btn {
  all: unset;
  cursor: zoom-in;
  position: relative;
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ks-apv-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-soft);
  display: block;
}
/* v7.2 · 角色试镜视频主预览（与图片同槽，3:4 完整展示不裁切） */
.ks-apv-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--ks-radius-md);
  box-shadow: var(--ks-shadow-soft);
  display: block;
  background: #000;
}
/* v7.2 · 视频/图片 预览切换条（仅角色有试镜视频时出现，置于大图区顶部） */
.ks-apv-preview-toggle {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.ks-apv-preview-tab {
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 5px 12px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  color: var(--ks-text-soft);
  border: 1px solid var(--ks-border);
  cursor: pointer;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-apv-preview-tab:hover {
  border-color: var(--ks-border-strong);
  color: var(--ks-text);
}
.ks-apv-preview-tab.is-on {
  background: var(--ks-amber);
  border-color: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
}
.ks-apv-img-zoom-hint {
  position: absolute;
  bottom: 10px;
  right: 10px;
  padding: 4px 10px;
  font-size: 11px;
  letter-spacing: 0.02em;
  border-radius: var(--ks-radius-pill);
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--ks-dur-fast) var(--ks-ease);
}
.ks-apv-img-btn:hover .ks-apv-img-zoom-hint {
  opacity: 1;
}

/* ─── 全屏放大预览层 ───────────────────────────────────────── */
.ks-apv-zoom {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  cursor: zoom-out;
  animation: ks-apv-scrim-in 160ms var(--ks-ease);
}
.ks-apv-zoom-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--ks-radius-md);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  cursor: default;
}
.ks-apv-zoom-close {
  all: unset;
  position: fixed;
  top: 20px;
  right: 24px;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(0, 0, 0, 0.5);
  color: #fff;
  font-size: 16px;
  cursor: pointer;
  transition: background var(--ks-dur-fast) var(--ks-ease);
}
.ks-apv-zoom-close:hover {
  background: rgba(0, 0, 0, 0.85);
}
.ks-apv-empty {
  font-size: 13px;
  color: var(--ks-text-dim);
  letter-spacing: 0.02em;
  text-align: center;
  padding: 20px;
}
.ks-apv-busy {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 18px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  backdrop-filter: var(--ks-glass-blur-strong);
  -webkit-backdrop-filter: var(--ks-glass-blur-strong);
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--ks-amber);
  box-shadow: var(--ks-shadow-soft);
  border: 1px solid var(--ks-border);
  animation: ks-apv-busy-pulse 1.4s var(--ks-ease) infinite;
}
@keyframes ks-apv-busy-pulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 1; }
}

.ks-apv-panel {
  padding: 18px 22px;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ks-apv-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ks-apv-field-label {
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--ks-amber);
  text-transform: uppercase;
}
.ks-apv-hint {
  font-size: 11px;
  color: var(--ks-text-dim);
  margin-top: -4px;
}
.ks-apv-textarea {
  width: 100%;
  resize: vertical;
  padding: 10px 12px;
  border-radius: var(--ks-radius-md);
  border: 1px solid var(--ks-border);
  background: var(--ks-panel-solid);
  color: var(--ks-text);
  font-size: 13px;
  line-height: 1.55;
  min-height: 64px;
  transition: border-color var(--ks-dur-fast), box-shadow var(--ks-dur-fast);
}
.ks-apv-textarea:focus {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 3px var(--ks-amber-soft);
  outline: none;
}
.ks-apv-textarea-sm {
  min-height: 48px;
}
/* v7.1 · 角色「实际提示词」只读预览（定妆照多视图） */
.ks-apv-modelprompt {
  margin-top: 2px;
  border: 1px dashed var(--ks-border);
  border-radius: var(--ks-radius-md);
  padding: 8px 10px;
  background: color-mix(in srgb, var(--ks-amber) 4%, transparent);
}
.ks-apv-modelprompt-summary {
  cursor: pointer;
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--ks-amber);
  text-transform: uppercase;
  user-select: none;
}
.ks-apv-modelprompt-summary::marker {
  color: var(--ks-text-dim);
}
.ks-apv-modelprompt-hint {
  font-size: 11px;
  line-height: 1.5;
  margin: 6px 0;
}
.ks-apv-modelprompt-text {
  width: 100%;
  resize: vertical;
  padding: 9px 11px;
  border-radius: var(--ks-radius-sm);
  border: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-solid);
  color: var(--ks-text-dim);
  font-size: 11.5px;
  line-height: 1.5;
  min-height: 90px;
  max-height: 220px;
  cursor: text;
}
.ks-apv-modelprompt-text:focus {
  outline: none;
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 2px var(--ks-amber-soft);
}
.ks-apv-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ks-apv-btn {
  font-family: var(--ks-font-ui);
  font-size: 12px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  color: var(--ks-text-soft);
  border: 1px solid var(--ks-border);
  cursor: pointer;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-apv-btn:hover:not(:disabled) {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
  border-color: var(--ks-border-strong);
}
.ks-apv-btn.is-primary {
  background: var(--ks-amber);
  border-color: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ks-amber) 28%, transparent);
}
.ks-apv-btn.is-primary:hover:not(:disabled) {
  background: var(--ks-amber-glow);
  border-color: var(--ks-amber-glow);
  color: var(--color-text-on-bright-primary);
  transform: translateY(-1px);
}
.ks-apv-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ks-apv-divider {
  height: 1px;
  background: var(--ks-border-soft);
}
.ks-apv-error {
  padding: 10px 14px;
  border: 1px solid rgba(240, 119, 157, 0.45);
  border-radius: var(--ks-radius-md);
  color: var(--ks-rose);
  font-size: 12.5px;
  line-height: 1.55;
  background: rgba(240, 119, 157, 0.08);
}

/*
 * v3.10 · 写入模式 + 变体 strip
 *
 * 风格定位：跟现有 .ks-apv-btn 是同族 pill，但加 is-on 时高亮 amber，弱化未选态
 * 让两个按钮之间的差别一眼可读。strip 走横向滚动，缩略图固定宽高 72×96，避免
 * 大图把面板撑爆 —— 真要看大图作者再点详情/选中。
 */
.ks-apv-mode-row {
  display: flex;
  gap: 8px;
}
.ks-apv-mode-btn {
  font-family: var(--ks-font-ui);
  font-size: 12px;
  padding: 7px 14px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-panel-elev);
  color: var(--ks-text-soft);
  border: 1px solid var(--ks-border);
  cursor: pointer;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-apv-mode-btn:hover:not(:disabled) {
  border-color: var(--ks-border-strong);
  color: var(--ks-text);
}
.ks-apv-mode-btn.is-on {
  background: var(--ks-amber);
  border-color: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
  box-shadow: 0 3px 10px color-mix(in srgb, var(--ks-amber) 24%, transparent);
}
.ks-apv-mode-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ks-apv-variant-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ks-apv-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: var(--ks-radius-md);
  border: 1px solid var(--ks-border);
  background: var(--ks-panel-solid);
  color: var(--ks-text);
  font-size: 13px;
  transition: border-color var(--ks-dur-fast), box-shadow var(--ks-dur-fast);
}
.ks-apv-input:focus {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 3px var(--ks-amber-soft);
  outline: none;
}
.ks-apv-variants {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}
.ks-apv-variants-label {
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--ks-text-dim);
  text-transform: uppercase;
}
.ks-apv-variants-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.ks-apv-variant-card {
  position: relative;
  flex: 0 0 auto;
  width: 72px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-radius: var(--ks-radius-md);
  transition:
    transform var(--ks-dur-fast) var(--ks-ease),
    box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-apv-variant-card.is-pickable {
  cursor: pointer;
}
.ks-apv-variant-card.is-pickable:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
}
.ks-apv-variant-card.is-pickable:hover > img {
  border-color: var(--ks-amber);
}
.ks-apv-variant-card.is-main {
  cursor: default;
}
.ks-apv-variant-card.is-main > img {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 2px var(--ks-amber-soft);
}
.ks-apv-variant-card.is-main:hover {
  transform: none;
}
.ks-apv-variant-main-badge {
  position: absolute;
  left: 4px;
  bottom: 24px;
  font-size: 9px;
  letter-spacing: 0.1em;
  padding: 1px 6px;
  background: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
  border-radius: var(--ks-radius-pill);
  pointer-events: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
.ks-apv-variant-card > img,
.ks-apv-variant-blank {
  width: 72px;
  height: 96px;
  border-radius: var(--ks-radius-md);
  object-fit: cover;
  border: 1px solid var(--ks-border);
  background: var(--ks-surface-warm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ks-text-dim);
  font-size: 10px;
  letter-spacing: 0.18em;
}
.ks-apv-variant-label {
  font-size: 11px;
  line-height: 1.3;
  color: var(--ks-text-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-apv-variant-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--ks-border);
  background: var(--ks-panel-elev);
  color: var(--ks-text-soft);
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--ks-dur-fast) var(--ks-ease),
    background var(--ks-dur-fast) var(--ks-ease);
}
.ks-apv-variant-card:hover .ks-apv-variant-remove {
  opacity: 1;
}
.ks-apv-variant-remove:hover {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
}

@media (max-width: 430px) {
  /* 极窄屏才叠成上下 —— 变体在上, 描述+生成在下 */
  .ks-apv-lower {
    grid-template-columns: 1fr;
    flex-basis: 56%;
    overflow-y: auto;
  }
  .ks-apv-variants-col {
    border-right: none;
    border-bottom: 1px solid var(--ks-border-soft);
  }
  .ks-apv-viewer {
    min-height: 200px;
  }
}

/*
 * v3.12 · 终态动作区 (生成 / 加变体) —— 跟 v3.11 的双 cta 完全不同的形态.
 *
 * 视觉目标:
 *   - 主按钮 .ks-apv-cta-primary 是单行大按钮, 文字居中, 一眼看到要做啥.
 *   - .ks-apv-action-row-primary: flex 排, 主按钮自适应宽度, "提为主图" 按钮
 *     (selection 不是 main 时才出现) 跟在右边.
 *   - .ks-apv-cta-add: 次要按钮 "+ 加为新变体", 点了切到内联输入流
 *   - .ks-apv-inline-form: 内联展开的"输入名字 + 确认/取消" form, 紧贴展开按钮.
 *   - .ks-apv-selection-pill: 描述区右侧的"当前编辑中"标签 (主图 / 睡衣 / 战损 ...).
 *   - .ks-apv-field-label-row: 让 label 行能容纳右侧 selection pill, 用 flex justify-between.
 *   - .ks-apv-variant-card.is-current: 选中态描边, 比旧的 .is-main 更醒目 (橙色描边 + soft glow).
 */
.ks-apv-action-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 14px 16px;
  border-radius: var(--ks-radius-md);
  border: 1px solid var(--ks-border);
  background: linear-gradient(
    180deg,
    rgba(255, 123, 61, 0.04) 0%,
    rgba(255, 123, 61, 0) 60%
  );
}
.ks-apv-action-row-primary {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.ks-apv-cta-primary {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  padding: 12px 16px;
  text-align: center;
  justify-content: center;
  min-height: 44px;
}
.ks-apv-cta-add {
  font-size: 12.5px;
  padding: 9px 14px;
  text-align: center;
  justify-content: center;
  border-style: dashed;
}
.ks-apv-cta-add:hover:not(:disabled) {
  border-style: solid;
  border-color: var(--ks-amber);
  color: var(--ks-amber);
}
.ks-apv-inline-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border-radius: var(--ks-radius-md);
  border: 1px solid var(--ks-amber);
  background: rgba(255, 123, 61, 0.06);
  animation: ks-apv-inline-in 160ms var(--ks-ease);
}
@keyframes ks-apv-inline-in {
  from { opacity: 0; transform: translateY(-2px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ks-apv-btn-sm {
  font-size: 11.5px;
  padding: 5px 12px;
}
.ks-apv-field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ks-apv-selection-pill {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  letter-spacing: 0.02em;
  padding: 3px 10px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
  font-weight: 600;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ks-apv-variant-card.is-current > img,
.ks-apv-variant-card.is-current > .ks-apv-variant-blank {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 2px var(--ks-amber-soft);
}

@media (max-width: 720px) {
  .ks-apv-action-row-primary {
    flex-direction: column;
  }
}

/* ─── v6.6 · 角色音色锚点面板 ─────────────────────────────── */
/* ─── v7 · 角色音色试听（最小条；3:4 视频在外面网格卡展示） ─── */
.ks-apv-voicemini {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ks-apv-voicemini-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  flex: 0 0 auto;
}
.ks-apv-voicemini-empty {
  flex: 1 1 160px;
  min-width: 0;
  font-size: 11px;
}
.ks-apv-voicemini-btn {
  flex: 0 0 auto;
}
.ks-apv-voicemini-regen {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: var(--ks-text-soft, rgba(255, 255, 255, 0.7));
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ks-apv-voicemini-regen:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.26);
}
.ks-apv-voicemini-regen:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ks-apv-voicemini-err {
  flex: 1 1 100%;
  font-size: 11px;
  color: var(--ks-rose, #f0779d);
  line-height: 1.5;
}

.ks-apv-voice-panel {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ks-apv-voice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ks-apv-voice-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.ks-apv-voice-status {
  font-size: 11px;
}
.ks-apv-voice-hint {
  font-size: 11px;
  line-height: 1.5;
}
.ks-apv-voice-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.ks-apv-voice-label {
  font-size: 12px;
  width: 60px;
  flex-shrink: 0;
  opacity: 0.8;
}
.ks-apv-voice-select {
  flex: 1;
  background: rgba(0, 0, 0, 0.3);
  color: #f0f0f0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
}
.ks-apv-voice-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ks-apv-voice-style {
  font-size: 11px;
  margin-left: 70px;
  margin-top: -4px;
}
.ks-apv-voice-speed {
  font-size: 11px;
  width: 50px;
  text-align: right;
  opacity: 0.7;
}
.ks-apv-voice-text-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ks-apv-voice-textarea {
  background: rgba(0, 0, 0, 0.3);
  color: #f0f0f0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.55;
  resize: vertical;
  min-height: 48px;
  font-family: inherit;
}
.ks-apv-voice-player {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ks-apv-voice-player audio {
  height: 32px;
  flex: 1;
  min-width: 240px;
}
.ks-apv-voice-mock {
  font-size: 11px;
}
.ks-apv-voice-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ks-apv-btn-danger {
  border-color: rgba(255, 90, 90, 0.4) !important;
  color: #ff8a8a !important;
}
.ks-apv-btn-danger:hover:not(:disabled) {
  background: rgba(255, 90, 90, 0.08) !important;
}

/* ─── v6.7 · 三候选音色卡 ─────────────────────────────── */
.ks-apv-voice-recast {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #f0f0f0;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
.ks-apv-voice-recast:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}
.ks-apv-voice-recast:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ks-apv-voice-fallback-hint {
  display: block;
  margin-top: 4px;
  color: #ffd07a;
}
.ks-apv-voice-loading {
  font-size: 12px;
  padding: 12px 4px;
  text-align: center;
}
.ks-apv-voice-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 900px) {
  .ks-apv-voice-cards {
    grid-template-columns: 1fr;
  }
}
.ks-apv-voice-card {
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  gap: 6px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
  outline: none;
}
.ks-apv-voice-card:hover {
  background: rgba(255, 255, 255, 0.04);
}
.ks-apv-voice-card:focus-visible {
  border-color: rgba(255, 200, 80, 0.5);
}
.ks-apv-voice-card.is-selected {
  border-color: #ffb84d;
  box-shadow: 0 0 0 1px rgba(255, 184, 77, 0.25) inset;
  background: rgba(255, 184, 77, 0.06);
}
.ks-apv-voice-card.is-selected::before {
  content: '◆ 当前选中';
  position: absolute;
  top: -9px;
  left: 10px;
  background: #ffb84d;
  color: #1a1a1a;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  letter-spacing: 0.05em;
}
.ks-apv-voice-card-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ks-apv-voice-card-rank {
  font-size: 10px;
  letter-spacing: 0.06em;
  opacity: 0.55;
}
.ks-apv-voice-card-label {
  font-size: 13px;
  font-weight: 600;
}
.ks-apv-voice-card-style {
  font-size: 11px;
  line-height: 1.45;
}
.ks-apv-voice-card-reason {
  font-size: 12px;
  line-height: 1.5;
  flex: 1;
}
.ks-apv-voice-card-actions {
  display: flex;
  gap: 6px;
}
.ks-apv-voice-card-actions .ks-apv-btn {
  padding: 4px 10px;
  font-size: 11px;
}
.ks-apv-voice-card-player {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.ks-apv-voice-card-player audio {
  height: 30px;
  flex: 1;
  min-width: 0;
}
.ks-apv-voice-note {
  font-size: 11px;
  line-height: 1.5;
  padding: 6px 8px;
  border: 1px dashed rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.18);
}
`
injectStyleOnce('asset-preview-dialog', css)
