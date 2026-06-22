import { createHash, randomBytes } from 'node:crypto'

import { activeIconModuleSpecs } from './icon-semantics'
import { createUiGenerationNonce, ensureUiGenerationNonce } from './ui-design-generation-nonce'

export { createUiGenerationNonce, ensureUiGenerationNonce }

export type UiGenerationPathBody = {
  genre?: string
  style?: string
  styleKey?: string
  genreKey?: string
  styleTone?: string
  styleBoardPrompt?: string
  assetPromptNotes?: string
  generationNonce?: string
  generationAttempt?: number
  iconModuleId?: string
  iconIndex?: number
  moduleAssetSpecs?: Array<{ id?: string; label?: string }>
}

type ModuleSpecLike = { id?: string; label?: string }

function moduleSpecsFromBody(specs?: ModuleSpecLike[]): ModuleSpecLike[] {
  return Array.isArray(specs) ? specs.filter(item => item && typeof item === 'object') : []
}

/** 会话级输出目录：nonce 变化即全新目录，避免 MCP 命中旧 png。 */
export function uiDesignSessionPrefix(body: UiGenerationPathBody): string {
  const nonce = ensureUiGenerationNonce(body.generationNonce)
  const specs = moduleSpecsFromBody(body.moduleAssetSpecs)
  const activeIconIds = activeIconModuleSpecs(specs).map(spec => spec.id || spec.label || '')
  const sig = createHash('sha1').update(JSON.stringify({
    genre: body.genre,
    style: body.style,
    styleKey: body.styleKey,
    genreKey: body.genreKey,
    styleTone: body.styleTone,
    styleBoardPrompt: body.styleBoardPrompt,
    assetPromptNotes: body.assetPromptNotes,
    generationNonce: nonce,
    generationAttempt: body.generationAttempt ?? 1,
    iconModuleIds: activeIconIds,
    iconModuleId: body.iconModuleId,
    iconIndex: body.iconIndex,
  })).digest('hex').slice(0, 12)
  const genreSlug = String(body.genreKey || body.genre || 'ui').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  const styleSlug = String(body.styleKey || body.style || 'style').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  return `workspace/images/ui-design-proto/${genreSlug}-${styleSlug}-${sig}`
}

/**
 * 每个资产单独文件路径（含时间戳 + 随机段），杜绝同路径覆盖/复用。
 */
export function buildUiDesignAssetOutputPath(
  sessionPrefix: string,
  kind: string,
  variant = '',
  attempt = 1,
): string {
  const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}-a${attempt}`
  const safeKind = kind.replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  const safeVariant = variant ? variant.replace(/[^a-z0-9-]/gi, '-').toLowerCase() : 'default'
  return `${sessionPrefix}/${safeKind}-${safeVariant}-${stamp}.png`
}

export function freshUiGenerationBody<T extends UiGenerationPathBody>(body: T): T {
  return {
    ...body,
    generationNonce: ensureUiGenerationNonce(body.generationNonce),
  }
}
