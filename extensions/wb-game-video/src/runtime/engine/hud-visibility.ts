/**
 * HUD 可见性解析（spec §2.2 两层模型）——纯函数，给定全局 `ui.hud` 目录 + 当前节点 `node.data.hud`
 * 覆盖 + 运行时上下文（phase / 当前交互 kind），算出**应隐藏的元素键集合**。
 *
 * 设计取舍（容错、非破坏）：只产出「隐藏项」，未显式配隐藏的一律可见——这样旧数据（show:'always'
 * 或元素键与渲染键不对应）行为不变，只有明确配了 never/qte/battle 且键能对上时才隐藏。
 * 约定：`ui.hud[].element` / `node.data.hud.elements[].element` 的键应对应渲染键（实体 id / 变量 id / 'score'），
 * 键对得上才会被隐藏规则命中。
 */
import type { NodeHud } from '../schema/graph-schema'

export interface HudCtx {
  phase: string
  /** 当前挂起交互的 kind（用于 show:'qte' 判定）。 */
  interactionKind?: string
  /** 当前节点是否处于「战斗」（约定 = node.data.hud.preset === 'battle'）——用于 show:'battle' 判定。 */
  isBattle?: boolean
}

type ShowMode = 'always' | 'never' | 'battle' | 'qte' | undefined

/** 某 show 模式在当前上下文下是否应隐藏。 */
function hiddenByShow(show: ShowMode, ctx: HudCtx): boolean {
  switch (show) {
    case 'never':
      return true
    case 'battle':
      return !ctx.isBattle // 仅当前节点是战斗节点时显示；进入战斗前/离开战斗后隐藏
    case 'qte':
      return ctx.interactionKind !== 'qte' // 仅 QTE 交互时显示
    case 'always':
    default:
      return false
  }
}

export function hiddenHudKeys(uiHud: unknown, nodeHud: NodeHud | undefined, ctx: HudCtx): Set<string> {
  const hidden = new Set<string>()
  // 全局目录
  const globals = Array.isArray(uiHud) ? (uiHud as Array<{ element?: string; show?: ShowMode }>) : []
  for (const g of globals) {
    if (g && typeof g.element === 'string' && hiddenByShow(g.show, ctx)) hidden.add(g.element)
  }
  // 节点级覆盖：visible:false 直接隐藏；showDuring 同 show 语义；visible:true 取消隐藏。
  for (const el of nodeHud?.elements ?? []) {
    if (el.visible === false) {
      hidden.add(el.element)
      continue
    }
    if (el.showDuring && hiddenByShow(el.showDuring, ctx)) hidden.add(el.element)
    else if (el.visible === true) hidden.delete(el.element)
  }
  return hidden
}
