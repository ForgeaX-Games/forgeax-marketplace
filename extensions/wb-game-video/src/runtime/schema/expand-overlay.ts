/**
 * expandOverlay — Overlay ⊕ OverlayNode[] → OverlayInstance[]（运行前展开，不落盘）。
 */
import type { GameNode, GameScenario } from './graph-schema'
import type {
  Overlay,
  OverlayChild,
  OverlayInstance,
  OverlayInstanceChild,
  OverlayNode,
} from './node-config-schema'
import { overlayMountId } from './node-config-schema'

/** 运行态 child id：始终 mount/catalog，单挂载同形。 */
export function overlayInstanceChildId(mountId: string, childId: string): string {
  return `${mountId}/${childId}`
}

/** 节点上的挂载列表。 */
export function nodeOverlayMounts(node: GameNode | undefined): OverlayNode[] {
  return node?.data.overlayNodes ?? []
}

function toInstanceChild(
  def: OverlayChild,
  meta: { mountId: string; overlayId: string; nodeId: string },
): OverlayInstanceChild {
  const catalogId = def.id
  const runtimeId = overlayInstanceChildId(meta.mountId, catalogId)
  const params = { ...(def.params ?? {}) }
  if (params.component == null) params.component = def.component
  return {
    id: runtimeId,
    component: def.component,
    trigger: def.trigger ?? { when: 'enter' },
    window: def.window,
    layout: def.layout,
    params,
    source: {
      mountId: meta.mountId,
      overlayId: meta.overlayId,
      childId: catalogId,
      nodeId: meta.nodeId,
    },
  }
}

/** 展开单份挂载；目录缺失则 null。 */
export function expandOverlayMount(
  overlays: Record<string, Overlay> | undefined,
  node: GameNode,
  mount: OverlayNode,
): OverlayInstance | null {
  const def = overlays?.[mount.overlay]
  if (!def) return null
  const mountId = overlayMountId(mount)
  const children: OverlayInstanceChild[] = []
  for (const child of def.children) {
    children.push(
      toInstanceChild(child, {
        mountId,
        overlayId: def.id,
        nodeId: node.id,
      }),
    )
  }
  return {
    mountId,
    overlayId: def.id,
    nodeId: node.id,
    layout: mount.layout,
    children,
    reactions: mount.reactions,
  }
}

/** 展开节点上全部挂载。 */
export function expandNodeOverlays(
  overlays: Record<string, Overlay> | undefined,
  node: GameNode,
): OverlayInstance[] {
  const out: OverlayInstance[] = []
  for (const mount of nodeOverlayMounts(node)) {
    const inst = expandOverlayMount(overlays, node, mount)
    if (inst) out.push(inst)
  }
  return out
}

/** 从 scenario 展开节点全部 children（扁平）。 */
export function expandNodeChildren(scenario: GameScenario, node: GameNode): OverlayInstanceChild[] {
  return expandNodeOverlays(scenario.ui?.overlays, node).flatMap((i) => i.children)
}

/** 引擎 / 校验用：当前节点可调度的 children。 */
export function nodeOverlayChildren(scenario: GameScenario, node: GameNode | undefined): OverlayInstanceChild[] {
  if (!node) return []
  return expandNodeChildren(scenario, node)
}
