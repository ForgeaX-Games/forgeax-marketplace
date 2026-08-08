import { ToolCallResultSchema, WorkbenchError } from '@forgeax/workbench-host/contracts'
import { getWorkbenchHost } from '../../../lib/workbench-host'

export const LIST_VIDEO_VISUAL_STYLES_TOOL_ID = 'wb-game-video:list-video-visual-styles'

export interface KinoVisualStylePreset {
  key: string
  label: string
  cdnUrl: string
  tags: readonly string[]
  order: number
}

export interface VisualStyleToolPort {
  call(toolId: string, args: unknown): Promise<unknown>
}

const defaultClient: VisualStyleToolPort = {
  call: (toolId, args) => getWorkbenchHost().tool.call(toolId, args),
}

export async function listVideoVisualStyles(
  toolPort: VisualStyleToolPort = defaultClient,
): Promise<readonly KinoVisualStylePreset[]> {
  const parsed = ToolCallResultSchema.safeParse(
    await toolPort.call(LIST_VIDEO_VISUAL_STYLES_TOOL_ID, {}),
  )
  if (!parsed.success) throw new Error('Visual style tool returned an invalid response')
  if (!parsed.data.ok) throw new WorkbenchError(parsed.data.error)
  return parseVisualStyles(parsed.data.result)
}

function parseVisualStyles(value: unknown): readonly KinoVisualStylePreset[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('Visual style tool returned an invalid response')
  }
  return value.items.map((item) => {
    if (
      !isRecord(item)
      || typeof item.key !== 'string'
      || typeof item.label !== 'string'
      || typeof item.cdnUrl !== 'string'
      || !Array.isArray(item.tags)
      || !item.tags.every((tag) => typeof tag === 'string')
      || typeof item.order !== 'number'
      || !Number.isFinite(item.order)
    ) {
      throw new Error('Visual style tool returned an invalid response')
    }
    return {
      key: item.key,
      label: item.label,
      cdnUrl: item.cdnUrl,
      tags: item.tags,
      order: item.order,
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
