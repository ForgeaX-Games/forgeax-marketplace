import type { JSX, ReactNode } from 'react'
import type {
  NodeAction,
  Overlay,
  OverlayEventRef,
  OverlayReaction,
  Reaction,
} from '../../runtime/schema/graph-schema'
import {
  overlayReactionKey,
  resolveOverlayReaction,
} from '../../runtime/schema/overlay-events'
import { getComponentManifest } from '../../runtime/registry/component-registry'
import { NodeActionsEditor, type ActionOption } from './NodeActionsEditor'
import type { EditorPickerCtx } from './editors'

function labelOf(event: OverlayEventRef): string {
  const component = getComponentManifest(event.componentId)?.label?.trim()
  const local = event.label?.trim()
  const title = [component, local].filter(Boolean).join(' · ')
  return title ? `${title} (${event.localEventId})` : event.localEventId
}

function mountEventActions(reactions: Reaction[] | undefined, event: OverlayEventRef): NodeAction[] {
  const keys = new Set([
    event.localEventId,
    event.eventId,
    `${event.childId}:${event.localEventId}`,
    `${event.mountId}:${event.localEventId}`,
    `${event.mountId}:${event.childId}:${event.localEventId}`,
  ])
  return (reactions ?? []).flatMap((reaction) =>
    reaction.when.type === 'event' && keys.has(reaction.when.id) ? reaction.do : [])
}

export function ComponentEventsEditor({
  events,
  catalogReactions,
  mountReactions,
  mode,
  edgeOptions = [],
  spawnOptions,
  overlays,
  pickers,
  allowSpawn = true,
  renderRoute,
  onCatalogChange,
  onMountActionsChange,
}: {
  events: OverlayEventRef[]
  catalogReactions?: OverlayReaction[]
  mountReactions?: Reaction[]
  mode: 'catalog' | 'mount'
  edgeOptions?: ActionOption[]
  spawnOptions: ActionOption[]
  overlays?: Record<string, Overlay>
  pickers?: EditorPickerCtx
  allowSpawn?: boolean
  renderRoute?: (event: OverlayEventRef) => ReactNode
  onCatalogChange?: (next: OverlayReaction[] | undefined) => void
  onMountActionsChange?: (event: OverlayEventRef, actions: NodeAction[]) => void
}): JSX.Element {
  if (!events.length) {
    return <div style={{ fontSize: 11, opacity: 0.6 }}>无导出事件（组件需有 inputs.events / manifest.events）</div>
  }
  const writeCatalog = (event: OverlayEventRef, actions: NodeAction[]) => {
    const key = overlayReactionKey(event.childId, event.localEventId)
    const rest = (catalogReactions ?? []).filter((reaction) => reaction.when.id !== key)
    if (actions.length) {
      rest.push({
        when: { type: 'event', id: key },
        do: actions.filter((action) => action.kind !== 'advance' && action.kind !== 'hideOverlay'),
      })
    }
    onCatalogChange?.(rest.length ? rest : undefined)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {events.map((event) => {
        const key = overlayReactionKey(event.childId, event.localEventId)
        const inherited = resolveOverlayReaction(catalogReactions, event.childId, event.localEventId)?.do ?? []
        const appended = mountEventActions(mountReactions, event)
        const edited = mode === 'catalog' ? inherited : appended
        return (
          <section key={key} data-event-key={key} style={{ border: '1px solid #2c2c2c', borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{labelOf(event)}</div>
            <div style={{ fontSize: 10, opacity: 0.55, margin: '2px 0 6px', fontFamily: 'ui-monospace, monospace' }}>{key}</div>
            {mode === 'catalog' ? (
              <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>目录动作（所有挂载继承）</div>
            ) : null}
            <NodeActionsEditor
              actions={edited as NodeAction[]}
              edgeOptions={edgeOptions}
              spawnOptions={spawnOptions}
              overlays={overlays}
              pickers={pickers}
              allowAdvance={mode === 'mount'}
              allowSpawn={allowSpawn}
              renderAdvance={renderRoute ? () => renderRoute(event) : undefined}
              onChange={(actions) => mode === 'catalog'
                ? writeCatalog(event, actions)
                : onMountActionsChange?.(event, actions)}
            />
          </section>
        )
      })}
    </div>
  )
}
