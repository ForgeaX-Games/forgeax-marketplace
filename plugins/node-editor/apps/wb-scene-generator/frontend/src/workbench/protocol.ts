// postMessage protocol between the workbench host (the editor pane on 9555) and
// its embedded child surfaces (Renderer / AssetStore iframes). Ported from the
// legacy editor's `workbench:*` contract, trimmed to the panes the scene plugin
// ships (no Viewer).

export type WorkbenchFocus = 'editor' | 'renderer' | 'assetstore' | null
export type WorkbenchSource = 'renderer' | 'assetstore'

export interface RequestFocusMessage {
  type: 'workbench:request-focus'
  target: Exclude<WorkbenchFocus, null>
}
export interface QueryFocusMessage {
  type: 'workbench:query-focus'
}
export interface FocusChangedMessage {
  type: 'workbench:focus-changed'
  focus: WorkbenchFocus
}
export interface StatusReportMessage {
  type: 'workbench:status-report'
  source: WorkbenchSource
  payload: Record<string, unknown>
}
/**
 * Host → renderer pane: the kernel editor's current node selection, forwarded so
 * the renderer can apply the legacy editor-selection highlight (green outline /
 * tint + Layers-panel row). View-only; carries no graph mutation. Replaces the
 * legacy `editor:selection` WS event, which has no equivalent on this backend
 * (kernel selection lives client-side in the host's pipeline store).
 */
export interface EditorSelectionMessage {
  type: 'workbench:editor-selection'
  selectedNodeIds: string[]
}

/**
 * Host → renderer pane: which nodes the editor has toggled preview OFF for.
 * Replaces the legacy `preview:change` WS event: the kernel editor's preview
 * toggle (`setNodePreview`) lives client-side in the host's pipeline store and
 * is NOT persisted to the backend, so the renderer (which reads `previewEnabled`
 * from `listNodes`) would otherwise never learn of it. The renderer treats any
 * listed node as preview-off and drops its grid/voxel layers; absent nodes fall
 * back to the backend default (on). View-only — carries no graph mutation.
 */
export interface PreviewChangeMessage {
  type: 'workbench:preview-change'
  previewDisabledNodeIds: string[]
}

/**
 * Host → renderer pane: live node output VALUES pushed directly from the editor
 * the instant an execute response lands, bypassing the WS `exec:completed` →
 * `getNodeOutput` re-pull round-trip. During a slider drag the editor's
 * `incrementalExecute` already holds the freshly computed outputs in memory; we
 * forward the changed (nodeId, port) grid payloads straight to the renderer so
 * the preview repaints in the same frame instead of waiting ~200ms for the WS +
 * GET detour. The renderer projects these exactly like a `getNodeOutput` result
 * (setPreviewLayer). View-only — carries no graph mutation; the trailing
 * exec:completed / graph:applied still own GC and the durable post-drag refresh.
 */
export interface PreviewDataMessage {
  type: 'workbench:preview-data'
  /** nodeId → portName → wire value (same shape as the executor `outputs`). */
  outputs: Record<string, Record<string, unknown>>
}

/**
 * Host → renderer pane: an AI/Agent renderer-control command forwarded from the
 * backend WS/REST control channel through the host into the renderer's store.
 * Mirrors the legacy renderer commands (set-view-mode / select-layer /
 * open-all-sublayers) so an LLM/CLI can drive the preview view + selection.
 */
export interface RendererCommandMessage {
  type: 'workbench:renderer-command'
  command:
    | { kind: 'set-view-mode'; mode: string }
    | { kind: 'select-layer'; layerKey: string; subLayerValue?: number | null }
    | { kind: 'open-all-sublayers'; nodeId?: string }
}

export type WorkbenchMessage =
  | RequestFocusMessage
  | QueryFocusMessage
  | FocusChangedMessage
  | StatusReportMessage
  | EditorSelectionMessage
  | PreviewChangeMessage
  | PreviewDataMessage
  | RendererCommandMessage

export function isWorkbenchMessage(data: unknown): data is WorkbenchMessage {
  return (
    !!data &&
    typeof data === 'object' &&
    typeof (data as { type?: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('workbench:')
  )
}
