// postMessage protocol between the workbench host (the editor pane) and its
// embedded child surfaces (the URDF viewer iframe). Ported from the scene
// generator's `workbench:*` contract, trimmed to what the 3d plugin ships: the
// host → child editor-selection forwarding only (no renderer/assetstore focus
// or status members).

export type WorkbenchFocus = 'editor' | 'urdf' | null

/**
 * Host → URDF pane: the kernel editor's current node selection, forwarded so the
 * viewer can react to selection. View-only; carries no graph mutation.
 */
export interface EditorSelectionMessage {
  type: 'workbench:editor-selection'
  selectedNodeIds: string[]
}

export type WorkbenchMessage = EditorSelectionMessage

export function isWorkbenchMessage(data: unknown): data is WorkbenchMessage {
  return (
    !!data &&
    typeof data === 'object' &&
    typeof (data as { type?: unknown }).type === 'string' &&
    (data as { type: string }).type.startsWith('workbench:')
  )
}
