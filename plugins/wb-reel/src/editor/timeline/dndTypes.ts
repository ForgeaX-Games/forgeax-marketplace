/**
 * 时间轴拖入 · 数据契约
 *
 * 外部素材面板（TimelineDock）与 Timeline 之间通过 HTML5 DnD 的 dataTransfer
 * 传递 JSON 字符串。MIME 统一用 `application/x-reel-timeline-drop`，避免与
 * 画布已有的 `text/x-reel-scene-id` 冲突。
 *
 * payload schema 由 DockDropPayload 联合类型描述；序列化走 JSON.stringify。
 */

import type { AudioRole, BranchKind, DialogueRole, QTECueShape } from '../../scenario/types'

export const DOCK_MIME = 'application/x-reel-timeline-drop'

export type DockDropPayload =
  | {
      kind: 'dialogue'
      role: DialogueRole
      speaker?: string
      text: string
      /** 默认 duration（ms）；落点 startMs = hoverMs */
      defaultDurationMs?: number
    }
  | {
      kind: 'cue'
      shape: QTECueShape
      label?: string
      /** shape='hold' 时的持续时长 */
      holdDurationMs?: number
      /** shape='sweep' 时的方向 */
      sweepDir?: 'up' | 'down' | 'left' | 'right'
    }
  | {
      kind: 'branch'
      targetSceneId: string
      label?: string
      /** 分支连线类型（选择 / QTE 通过 / QTE 失败 / 自动）；缺省按 makeInsertBranch 默认。 */
      branchKind?: BranchKind
    }
  | {
      kind: 'audio'
      /** 已 ingest 到 mediaStore 的 id */
      mediaId: string
      role: AudioRole
      label?: string
      /** 音频素材原长（ms）；落到时间轴时 duration 取 min(fileDuration, scene-remaining) */
      durationMs: number
    }
  | {
      kind: 'image'
      /** mediaStore id（用户上传或生成入库的场景级图片） */
      mediaId: string
      /** 可选 label，UI 展示用 */
      label?: string
    }
  | {
      kind: 'video'
      /** mediaStore id（用户上传或生成入库的场景级视频） */
      mediaId: string
      label?: string
      /** 视频原长（ms），拖入时用来决定默认 durationMs；0 = 未知 */
      durationMs?: number
    }
  | {
      kind: 'minigame'
      /** 关联 minigames/registry.ts 里的 descriptor.id */
      minigameId: string
      label?: string
      /** 时间轴块宽度默认值（ms），拖入时用（从 registry 取 defaultDurationMs） */
      defaultDurationMs: number
    }

export function serializeDockPayload(p: DockDropPayload): string {
  return JSON.stringify(p)
}

export function parseDockPayload(raw: string): DockDropPayload | null {
  try {
    const obj = JSON.parse(raw) as DockDropPayload
    if (
      obj &&
      typeof obj === 'object' &&
      typeof (obj as { kind?: string }).kind === 'string'
    ) {
      return obj
    }
    return null
  } catch {
    return null
  }
}
