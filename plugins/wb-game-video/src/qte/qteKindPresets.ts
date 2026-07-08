import type { QTECue, QTESpec, Scene } from '../scenario/types'
import type { QteKind } from '../scenario/gameplayTypes'

const DEFAULT_TOLERANCE = { perfect: 120, great: 280, good: 500 }
const DEFAULT_SCORE = { perfect: 100, great: 60, good: 30, miss: 0 }

/** 按 qteKind 生成默认 cues（作者未手写 cues 时）。 */
export function buildQteFromKind(kind: QteKind, scene: Pick<Scene, 'durationMs' | 'qte'>): QTESpec {
  const w = scene.qte?.window
  const start = w?.startMs ?? 800
  const end = w?.endMs ?? Math.min(scene.durationMs, start + 4000)
  const mid = start + (end - start) * 0.45

  const baseCue = (id: string, shape: QTECue['shape'], targetAt: number, extra?: Partial<QTECue>): QTECue => ({
    id,
    shape,
    x: 0.5,
    y: 0.55,
    appearAt: start,
    targetAt,
    label: extra?.label ?? '!',
    ...extra,
  })

  let cues: QTECue[]
  switch (kind) {
    case 'parry':
      cues = [baseCue('parry-1', 'tap', mid, { label: '空格 · 防反' })]
      break
    case 'timing':
      cues = [baseCue('timing-1', 'tap', mid, { label: '精准时点' })]
      break
    case 'mash':
      cues = [
        baseCue('mash-1', 'tap', start + 600, { label: '连打 1' }),
        baseCue('mash-2', 'tap', start + 1200, { label: '连打 2' }),
        baseCue('mash-3', 'tap', start + 1800, { label: '连打 3' }),
      ]
      break
    case 'sequence':
      cues = [
        baseCue('seq-1', 'tap', start + 700, { label: '←', triggerKey: 'ArrowLeft' }),
        baseCue('seq-2', 'tap', start + 1400, { label: '→', triggerKey: 'ArrowRight' }),
        baseCue('seq-3', 'tap', start + 2100, { label: '↑', triggerKey: 'ArrowUp' }),
      ]
      break
    case 'sweep':
      cues = [baseCue('sweep-1', 'sweep', mid, { label: '划动', sweepDir: 'up' })]
      break
    default:
      cues = [baseCue('tap-1', 'tap', mid)]
  }

  return {
    tolerance: DEFAULT_TOLERANCE,
    score: DEFAULT_SCORE,
    passingScore: 30,
    window: { timeoutMs: end - start + 800 },
    cues,
    template: kind,
  }
}

/** 解析场景实际使用的 QTESpec —— cues 为空且有 template 时按种子生成。 */
export function resolveSceneQte(scene: Scene): QTESpec | undefined {
  const qte = scene.qte
  if (qte?.cues?.length) {
    if (qte.template === 'parry' && qte.cues.length === 1) {
      return {
        ...qte,
        cues: qte.cues.map((c) => ({
          ...c,
          label: c.label ?? '空格 · 防反',
          triggerKey: c.triggerKey ?? ' ',
        })),
      }
    }
    return qte
  }
  if (qte?.template) return buildQteFromKind(qte.template, scene)
  return qte
}

export function qteKindFromScene(scene: Scene): QteKind | undefined {
  return scene.qte?.template
}
