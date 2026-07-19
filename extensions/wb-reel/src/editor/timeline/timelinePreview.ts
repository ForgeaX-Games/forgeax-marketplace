import type { Branch, DialogueLine, QTECue } from '../../scenario/types'
import type { SnapModifiers } from './timelineMath'

/**
 * Timeline 拖拽时的「即时预览」共享类型。
 *
 * 抬到 StagePane 后供两处共用：
 *   - Timeline 自己内部用来画 clip / pin / band 的位移、显示 DragHud / SnapGuide
 *   - StagePane 的 EditorCueMarker / 活跃 dialogue / 分支 pin 也用同一份 preview，
 *     拖动期间画面立刻反映新位置（不污染 store / 不进 undo 栈）
 *
 * 释放（pointerup）时 Timeline 才一次性 dispatch updateXxx，做到「一拖一格 undo」。
 */
export type TimelinePreviewBase = {
  deltaMs: number
  modifiers: SnapModifiers
}

export type TimelinePreview =
  | (TimelinePreviewBase & {
      kind: 'dialogue'
      id: string
      patch: Partial<DialogueLine>
    })
  | (TimelinePreviewBase & {
      kind: 'cue'
      id: string
      patch: Partial<QTECue>
    })
  | (TimelinePreviewBase & {
      kind: 'branch'
      id: string
      patch: Partial<Branch>
    })

/** 把当前 preview 投影到 dialogue 上，得到「视觉用」的最新值。 */
export function previewedDialogue(
  d: DialogueLine,
  preview: TimelinePreview | null,
): DialogueLine {
  if (preview?.kind === 'dialogue' && preview.id === d.id) {
    return { ...d, ...(preview.patch as Partial<DialogueLine>) }
  }
  return d
}

/** 把当前 preview 投影到 QTE cue 上。 */
export function previewedCue(
  c: QTECue,
  preview: TimelinePreview | null,
): QTECue {
  if (preview?.kind === 'cue' && preview.id === c.id) {
    return { ...c, ...(preview.patch as Partial<QTECue>) }
  }
  return c
}

/** 把当前 preview 投影到 branch 上。 */
export function previewedBranch(
  b: Branch,
  preview: TimelinePreview | null,
): Branch {
  if (preview?.kind === 'branch' && preview.id === b.id) {
    return { ...b, ...(preview.patch as Partial<Branch>) }
  }
  return b
}
