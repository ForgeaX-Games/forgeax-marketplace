import type { ImageClient, ImageReference } from '../../llm/types'
import { useMediaStore } from '../../media/mediaStore'
import { cutoutToTransparent } from '../../media/cutoutToTransparent'
import type { InventoryItem } from '../../scenario/types'
import type { GenRequestRef, GenRequestSnapshot } from '../generationQueueStore'

/**
 * 道具图标美术管线 —— 背包系统。
 *
 * 作者要求：道具有「搜索图标」「抠图素材」「背景提示词约束」「统一图标风格」。
 * 这里把这些固化成一套受约束的提示词预设 + 抠图后处理：
 *   1. ICON_STYLE_PRESET：统一的「游戏道具图标」风格（单体居中、扁平纯色底、
 *      无文字、无投影、干净描边），保证所有物品图标风格一致。
 *   2. 背景约束：强制纯洋红 chroma 底(#ff00ff)，便于后续抠图——道具极少是纯洋红，
 *      抠图洪泛填充几乎不会误伤主体。
 *   3. 生成后 cutoutToTransparent 抠成透明 PNG，落 mediaStore。
 */

/** 统一图标风格前缀（中英混合，对国产/通用图像模型都稳）。 */
export const ICON_STYLE_PRESET =
  '游戏背包道具图标, single game inventory item icon, one object only, centered, ' +
  'full object in frame, clean crisp edges, soft studio lighting, subtle rim light, ' +
  '高质量, 写实质感但略带游戏化光泽, no text, no watermark, no UI, no border, no drop shadow on background'

/** 背景约束（chroma key 纯洋红，便于抠图）。 */
export const ICON_BG_CONSTRAINT =
  'on a solid flat pure magenta background (#ff00ff), uniform chroma key backdrop, ' +
  '背景必须是纯洋红色纯色平面, no gradient, no scenery, no floor, no shadow on the backdrop'

/**
 * 世界观上下文 —— 让图标契合「当前剧本的年代 / 材质 / 审美 / 科技水平」。
 * 例：同样是「钥匙」，赛博世界 → 磁卡，奇幻世界 → 锈蚀铁钥匙。
 */
export interface IconWorldContext {
  /** 剧情梗概 / 世界观设定（取前若干字做基调约束）。 */
  worldSynopsis?: string
  /** 全局美术风格指令（来自 visualStyle 的 authoringHint，中文一句）。 */
  styleHint?: string
}

/** 截断世界观文本，避免提示词被长梗概淹没主体。 */
function trimWorld(s: string | undefined, max = 180): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 组装某物品的图标生成提示词（按世界观 + 风格扩写）。 */
export function buildItemIconPrompt(
  item: InventoryItem,
  opts?: { propPrompt?: string; world?: IconWorldContext },
): string {
  const subject = (item.iconPrompt?.trim() || item.desc?.trim() || opts?.propPrompt?.trim() || item.name).trim()
  const parts: string[] = [ICON_STYLE_PRESET, `主体(item): ${subject}`]

  const world = trimWorld(opts?.world?.worldSynopsis)
  if (world) {
    parts.push(
      `世界观背景(world setting): ${world}. 道具外观需契合该世界的年代/材质/工艺/科技水平与审美，` +
        `the item's material, era and craftsmanship must match this world`,
    )
  }
  const styleHint = opts?.world?.styleHint?.trim()
  if (styleHint) parts.push(`美术风格(art direction): ${styleHint}`)

  parts.push(ICON_BG_CONSTRAINT)
  return parts.join('. ') + '.'
}

/**
 * 生成一个物品的透明图标 —— 生图 → 抠图 → ingest，返回 mediaId（失败抛错）。
 *
 * referenceImages 非空时走图生图（用关联参考道具的外观锚点保持一致）。
 */
export async function generateItemIcon(opts: {
  item: InventoryItem
  client: ImageClient
  propPrompt?: string
  /** 世界观上下文：按当前剧本梗概/风格扩写道具外观。 */
  world?: IconWorldContext
  referenceImages?: ImageReference[]
  onRequest?: (req: GenRequestSnapshot) => void
}): Promise<string> {
  const prompt = buildItemIconPrompt(opts.item, { propPrompt: opts.propPrompt, world: opts.world })
  const refs = opts.referenceImages?.length ? opts.referenceImages : undefined

  if (opts.onRequest) {
    const reqRefs: GenRequestRef[] = (refs ?? []).map((r) => ({
      role: 'reference_image',
      url: r.dataUrl,
      label: r.label ?? '参考道具',
    }))
    opts.onRequest({
      endpoint: `${opts.client.getModel?.() ?? opts.client.getProviderName?.() ?? '图像'} · ${
        refs ? '图生图(道具锚点)' : '文生图'
      } · 道具图标`,
      prompt,
      params: {
        size: '1024x1024',
        provider: opts.client.getProviderName?.() ?? '(未知)',
        model: opts.client.getModel?.() ?? '(默认)',
        mode: refs ? '图生图' : '文生图',
        postprocess: '抠图透明底',
      },
      refs: reqRefs,
      at: Date.now(),
    })
  }

  const out = await opts.client.generate({
    prompt,
    size: '1024x1024',
    ...(refs ? { referenceImages: refs } : {}),
  })
  const cut = await cutoutToTransparent(out.dataUrl)
  const mediaId = useMediaStore.getState().ingestDataUrl(cut, {
    promptKind: 'item-icon',
    tags: [`item:${opts.item.id}`],
    humanReadableName: `${opts.item.name} · 图标`,
    mimeType: 'image/png',
  })
  return mediaId
}
