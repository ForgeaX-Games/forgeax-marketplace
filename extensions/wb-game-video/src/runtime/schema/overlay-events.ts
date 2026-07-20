/**
 * overlay 事件聚合 + reactions → 边派生。
 *
 * 命名空间（event id）：
 * - 单挂载 + 单交互 child → `A`
 * - 单挂载 + 多交互 → `childId:A`
 * - 多挂载 → `mountId:childId:A`（该挂载仅一交互时可 `mountId:A`）
 */
import type { Overlay } from './graph-schema'
import type {
  ComponentEvent,
  ComponentManifest,
  NodeAction,
  OverlayEventRef,
  OverlayNode,
  Reaction,
} from './node-config-schema'
import { overlayMountId } from './node-config-schema'

export type ManifestResolver = (componentId: string) => ComponentManifest | undefined

/** 从 `inputs.events` 折成事件表（交互目录 SSOT；组件未在 inputs 声明时回退 manifest.events）。 */
export function eventsFromParams(inputs: Record<string, unknown> | undefined): ComponentEvent[] {
  const events = inputs?.events
  if (!Array.isArray(events)) return []
  const out: ComponentEvent[] = []
  for (const e of events) {
    if (!e || typeof e !== 'object') continue
    const rec = e as { id?: unknown; label?: unknown }
    if (typeof rec.id !== 'string') continue
    out.push({
      id: rec.id,
      ...(typeof rec.label === 'string' ? { label: rec.label } : {}),
    })
  }
  return out
}

function emittingChildren(
  overlay: Overlay,
  resolve: ManifestResolver,
): Array<{ child: Overlay['children'][number]; events: ComponentEvent[] }> {
  return overlay.children
    .map((child) => {
      const fromParams = eventsFromParams(child.inputs)
      const manifest = resolve(child.component)
      const events = fromParams.length ? fromParams : (manifest?.events ?? [])
      return { child, events }
    })
    .filter((x) => x.events.length > 0)
}

/**
 * 聚合单张 Overlay 内事件（默认单挂载语境）。
 * 多个带事件的 child → eventId = `${childId}:${localId}`；仅一个 → 直接用 localId。
 */
export function aggregateOverlayEvents(
  overlay: Overlay | undefined,
  resolve: ManifestResolver,
  opts?: { mountId?: string; prefixMount?: boolean },
): OverlayEventRef[] {
  if (!overlay) return []
  const mountId = opts?.mountId ?? overlay.id
  const emitting = emittingChildren(overlay, resolve)
  const childNs = emitting.length > 1
  const out: OverlayEventRef[] = []
  for (const { child, events } of emitting) {
    for (const ev of events) {
      const local = childNs ? `${child.id}:${ev.id}` : ev.id
      const eventId = opts?.prefixMount ? `${mountId}:${local}` : local
      out.push({
        eventId,
        mountId,
        childId: child.id,
        localEventId: ev.id,
        label: ev.label,
        componentId: child.component,
      })
    }
  }
  return out
}

/** 聚合节点上全部挂载的事件。 */
export function aggregateNodeOverlayEvents(
  mounts: readonly OverlayNode[],
  overlays: Record<string, Overlay> | undefined,
  resolve: ManifestResolver,
): OverlayEventRef[] {
  const multi = mounts.length > 1
  const out: OverlayEventRef[] = []
  for (const mount of mounts) {
    const def = overlays?.[mount.overlay]
    out.push(
      ...aggregateOverlayEvents(def, resolve, {
        mountId: overlayMountId(mount),
        prefixMount: multi,
      }),
    )
  }
  return out
}

function eventReactionsFor(reactions: Reaction[] | undefined, eventId: string): Reaction[] {
  return (reactions ?? []).filter((r) => r.when.type === 'event' && r.when.id === eventId)
}

/** 候选 event key（优先级）：精确 → child:outcome → mount:outcome → mount:child:outcome。 */
function eventKeys(outcome: string, childId?: string, mountId?: string): string[] {
  const keys = [outcome]
  if (childId) keys.push(`${childId}:${outcome}`)
  if (mountId) {
    keys.push(`${mountId}:${outcome}`)
    if (childId) keys.push(`${mountId}:${childId}:${outcome}`)
  }
  return keys
}

/**
 * 解析 event 类 reaction 候选：命中优先级最高、且存在匹配的那个 key 的**全部**候选（供加权选择）。
 */
export function resolveEventReactions(
  reactions: Reaction[] | undefined,
  outcome: string,
  childId?: string,
  mountId?: string,
): Reaction[] {
  if (!reactions?.length) return []
  for (const k of eventKeys(outcome, childId, mountId)) {
    const hits = eventReactionsFor(reactions, k)
    if (hits.length) return hits
  }
  return []
}

/**
 * 解析 event 类 reaction：精确 → child:outcome → mount:outcome → mount:child:outcome。
 * 返回首个候选的 do（不加权；加权请用 resolveEventReactions）。
 */
export function resolveEventReactionDo(
  reactions: Reaction[] | undefined,
  outcome: string,
  childId?: string,
  mountId?: string,
): NodeAction[] | undefined {
  return resolveEventReactions(reactions, outcome, childId, mountId)[0]?.do
}

/** node.data.reactions 中的 complete 类候选（保持作者顺序）。 */
export function completeReactions(reactions: Reaction[] | undefined): Reaction[] {
  return (reactions ?? []).filter((r) => r.when.type === 'complete')
}
