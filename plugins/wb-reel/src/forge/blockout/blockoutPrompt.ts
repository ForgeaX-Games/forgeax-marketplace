import type {
  Blockout,
  BlockoutCamera,
  BlockoutObject,
  ShotFraming,
  Scenario,
} from '../../scenario/types'
import { colorNameOf } from './blockoutColor'

/**
 * blockoutPrompt —— 把 3D blockout（相机 + 带色角色占位）转成「软参考」提示词。
 *
 * 关键约束（防白模泄漏，用户重点）：
 *   - BLOCKOUT_GUARD 明确告诉模型 3D 参考图仅用于构图/机位/站位，**不要**还原
 *     灰白几何体 / 彩色占位块 / 网格 / 泥膜质感；角色按各自参考图真实外观渲染。
 *   - 机位静帧在管线层强制走 reference_image（绝不 first_frame），见 AssetBoard 接入。
 */

export const BLOCKOUT_GUARD =
  '【3D 参考说明】随附的 3D 参考图（若有）仅用于相机角度、景别、构图与角色站位关系；' +
  '请勿在成片中还原其中的灰白几何体、彩色占位块、地面网格或泥膜/低模质感。' +
  '所有角色一律依据各自的角色参考图渲染真实外观，彩色占位仅代表“该位置站的是谁”。'

const FRAMING_WORD: Record<ShotFraming, string> = {
  wide: '远景 / wide shot',
  medium: '中景 / medium shot',
  close: '特写 / close-up',
  insert: '插入特写 / insert',
  ots: '过肩 / over-the-shoulder',
  pov: '主观视角 / POV',
}

const MOVE_WORD: Record<BlockoutCamera['move'], string> = {
  static: '固定机位 / static camera',
  'dolly-in': '缓慢推近 / slow dolly-in',
  'dolly-out': '缓慢拉远 / dolly-out',
  orbit: '环绕运镜 / orbit',
  pan: '横摇 / pan',
  crane: '升降 / crane',
}

function angleWord(camY: number): string {
  if (camY < 1) return '仰拍（低机位）/ low angle'
  if (camY > 2.5) return '俯拍（高机位）/ high angle'
  return '平视 / eye-level'
}

/** 相机 → 运镜/机位提示词（景别 + 焦段 + 角度 + 运镜）。 */
export function cameraToPrompt(cam: BlockoutCamera): string {
  const parts = [
    `景别：${FRAMING_WORD[cam.framing] ?? cam.framing}`,
    `镜头：约 ${Math.round(cam.fovMm)}mm`,
    `机位：${angleWord(cam.transform?.pos?.y ?? 1.6)}`,
    `运镜：${MOVE_WORD[cam.move] ?? cam.move}`,
  ]
  return `【机位】${parts.join('；')}。`
}

/** 物体相对相机的粗略画面位置词（默认朝向 -z 的水平近似）。 */
function screenPositionWord(obj: BlockoutObject, cam: BlockoutCamera): string {
  const ox = obj.transform?.pos?.x ?? 0
  const oz = obj.transform?.pos?.z ?? 0
  const cx = cam.transform?.pos?.x ?? 0
  const cz = cam.transform?.pos?.z ?? 0
  const lr = ox < cx - 0.3 ? '画面左' : ox > cx + 0.3 ? '画面右' : '画面中'
  // 相机默认看向 -z：z 越小越远离相机（越深）。用与相机的 z 差判前后景。
  const depth = Math.abs(oz - cz)
  const fb = depth < 2 ? '前景' : depth < 4 ? '中景' : '后景'
  return `${lr}${fb}`
}

export interface BuildLegendArgs {
  blockout: Blockout
  camera: BlockoutCamera
  scenario: Pick<Scenario, 'characters'>
  /** 该角色参考图在最终 refs 序列里的序号（1-based）；无则 undefined */
  anchorIndexOf: (characterId: string) => number | undefined
}

/**
 * 生成「色彩图例」：把每个角色占位的颜色 → 角色名 + 参考图序号 + 画面站位。
 * 仅列出绑定了角色锚点的占位。
 */
export function buildBlockoutLegend(args: BuildLegendArgs): string {
  const { blockout, camera, scenario, anchorIndexOf } = args
  const lines: string[] = []
  for (const obj of blockout.objects) {
    if (obj.linkedAnchor?.kind !== 'character') continue
    const charId = obj.linkedAnchor.id
    const ch = scenario.characters?.[charId]
    if (!ch) continue
    const color = obj.colorRole ? `${colorNameOf(obj.colorRole)}色占位(${obj.colorRole})` : '占位'
    const idx = anchorIndexOf(charId)
    const refTag = idx ? `（见角色参考图${idx}）` : ''
    const pos = screenPositionWord(obj, camera)
    lines.push(`${color} ＝ ${ch.name}${refTag}，位于${pos}`)
  }
  if (lines.length === 0) return ''
  return ['【布局参考（颜色↔角色↔站位）】', ...lines].join('\n')
}

export interface ComposeBlockoutPromptArgs extends BuildLegendArgs {
  /** 卡片原始 prompt（运镜/动作描述等） */
  basePrompt: string
}

/**
 * 合并：原始 prompt + 色彩图例 + 机位提示词 + 防泄漏 GUARD。
 * 始终包含 BLOCKOUT_GUARD（防白模泄漏的最后一道防线）。
 */
export function composeBlockoutVideoPrompt(args: ComposeBlockoutPromptArgs): {
  prompt: string
  warnings: string[]
} {
  const warnings: string[] = []
  const legend = buildBlockoutLegend(args)
  if (!legend) warnings.push('blockout 无绑定角色锚点的占位，图例为空')
  const cam = cameraToPrompt(args.camera)
  const prompt = [args.basePrompt.trim(), legend, cam, BLOCKOUT_GUARD]
    .filter((s) => s && s.length > 0)
    .join('\n\n')
  return { prompt, warnings }
}
