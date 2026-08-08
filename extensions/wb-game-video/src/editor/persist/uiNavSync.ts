import { create } from 'zustand'
import type { Overlay, UiTree, UiTreeNode } from '../../runtime/schema/graph-schema'
import { countOverlayReferences } from '../../graph/edit/overlay-edit'
import { useGraphScenario } from './graphScenarioStore'
import {
  BASIC_UI_FOLDER_ID,
  addUiTreeFolder,
  addUiTreeScheme,
  collectUiTreeNodeIds,
  ensureUiTree,
  findUiTreeNode,
  removeUiTreeNode,
  renameUiTreeFolder,
  validateUiTree,
} from './ui-tree'
import { useUiSelection } from './uiSelectionStore'
import { nextUniqueOverlayTitle, overlayTitleExists } from '../shell/overlay-title'
import { gameKeySuffix } from './gameScope'

// 按 game 隔离频道，避免同源多开不同 game 时 left/center pane 桥接跨 tab 串台。
// 后缀在 install 时才求值：进程内挂载的 game 标识由宿主注入，晚于本模块求值。
const CHANNEL_BASE = 'wb-game-video:ui-nav-sync'
const PROTOCOL_VERSION = 1

export type UiNavRole = 'standalone' | 'left' | 'center'

export interface UiNavOverlaySummary {
  id: string
  title: string
}

export interface UiNavSnapshot {
  uiTree: UiTree
  overlays: Record<string, UiNavOverlaySummary>
  usage: Record<string, number>
  selectedTreeNodeId: string | null
  selectedOverlayId: string | null
}

export type UiNavCommand =
  | { type: 'select'; treeNodeId: string | null; overlayId: string | null }
  | { type: 'add-root-folder'; name?: string }
  | { type: 'add-folder'; parentId: string; name?: string }
  | { type: 'add-scheme'; parentId: string; name?: string }
  | { type: 'rename'; nodeId: string; name: string }
  | { type: 'remove'; nodeId: string }

type UiNavMessage =
  | { version: 1; type: 'request' }
  | { version: 1; type: 'snapshot'; snapshot: UiNavSnapshot }
  | { version: 1; type: 'command'; command: UiNavCommand }

interface UiNavMirrorState {
  role: UiNavRole
  snapshot: UiNavSnapshot | null
}

export const useUiNavMirror = create<UiNavMirrorState>(() => ({
  role: 'standalone',
  snapshot: null,
}))

let leftChannel: BroadcastChannel | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function isStringRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
}

function isSnapshot(value: unknown): value is UiNavSnapshot {
  if (!isRecord(value) || !validateUiTree(value.uiTree).valid) return false
  if (!hasOnlyKeys(value, ['uiTree', 'overlays', 'usage', 'selectedTreeNodeId', 'selectedOverlayId'])) return false
  if (!isRecord(value.overlays) || !isStringRecord(value.usage)) return false
  if (!isNullableString(value.selectedTreeNodeId) || !isNullableString(value.selectedOverlayId)) return false
  return Object.entries(value.overlays).every(([id, summary]) =>
    isRecord(summary)
    && hasOnlyKeys(summary, ['id', 'title'])
    && summary.id === id
    && typeof summary.title === 'string',
  )
}

function isCommand(value: unknown): value is UiNavCommand {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'select':
      return hasOnlyKeys(value, ['type', 'treeNodeId', 'overlayId'])
        && isNullableString(value.treeNodeId) && isNullableString(value.overlayId)
    case 'add-root-folder':
      return (
        hasOnlyKeys(value, ['type'])
        || (
          hasOnlyKeys(value, ['type', 'name'])
          && typeof value.name === 'string'
          && value.name.trim().length > 0
        )
      )
    case 'add-folder':
    case 'add-scheme':
      return (
        hasOnlyKeys(value, ['type', 'parentId'])
        || (
          hasOnlyKeys(value, ['type', 'parentId', 'name'])
          && typeof value.name === 'string'
          && value.name.trim().length > 0
        )
      )
        && typeof value.parentId === 'string' && value.parentId.length > 0
    case 'rename':
      return hasOnlyKeys(value, ['type', 'nodeId', 'name'])
        && typeof value.nodeId === 'string' && value.nodeId.length > 0
        && typeof value.name === 'string' && value.name.trim().length > 0
    case 'remove':
      return hasOnlyKeys(value, ['type', 'nodeId'])
        && typeof value.nodeId === 'string' && value.nodeId.length > 0
    default:
      return false
  }
}

function parseMessage(value: unknown): UiNavMessage | null {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || typeof value.type !== 'string') return null
  if (value.type === 'request' && hasOnlyKeys(value, ['version', 'type'])) {
    return { version: 1, type: 'request' }
  }
  if (value.type === 'snapshot' && hasOnlyKeys(value, ['version', 'type', 'snapshot']) && isSnapshot(value.snapshot)) {
    return { version: 1, type: 'snapshot', snapshot: value.snapshot }
  }
  if (value.type === 'command' && hasOnlyKeys(value, ['version', 'type', 'command']) && isCommand(value.command)) {
    return { version: 1, type: 'command', command: value.command }
  }
  return null
}

function nextId(prefix: string, used: Set<string>): string {
  let index = used.size
  let id = `${prefix}${index}`
  while (used.has(id)) id = `${prefix}${++index}`
  return id
}

function collectOverlayIds(node: UiTreeNode): string[] {
  if (node.kind === 'scheme') return [node.overlayId]
  return node.children.flatMap(collectOverlayIds)
}

function collectNodeIds(node: UiTreeNode): string[] {
  if (node.kind === 'scheme') return [node.id]
  return [node.id, ...node.children.flatMap(collectNodeIds)]
}

function makeSnapshot(): UiNavSnapshot {
  const state = useGraphScenario.getState()
  const overlays = state.meta.ui?.overlays ?? {}
  const selection = useUiSelection.getState()
  return {
    uiTree: ensureUiTree(state.meta.uiTree, overlays),
    overlays: Object.fromEntries(Object.entries(overlays).map(([id, overlay]) => [
      id,
      { id, title: overlay.title ?? id },
    ])),
    usage: countOverlayReferences(Object.values(state.blueprints).map((blueprint) => blueprint.graph)),
    selectedTreeNodeId: selection.selectedTreeNodeId,
    selectedOverlayId: selection.selectedOverlayId,
  }
}

/**
 * 在 SSOT 所在文档执行一条目录命令。导出供 standalone 和集成测试复用；
 * split left 只能通过 `sendUiNavCommand` 间接触发。
 */
export function executeUiNavCommand(command: UiNavCommand): boolean {
  if (!isCommand(command)) return false
  const state = useGraphScenario.getState()
  const overlays = state.meta.ui?.overlays ?? {}
  const tree = ensureUiTree(state.meta.uiTree, overlays)

  if (command.type === 'select') {
    if (command.treeNodeId === null) {
      useUiSelection.getState().clearUiSelection()
      return true
    }
    const node = findUiTreeNode(tree, command.treeNodeId)
    if (!node) return false
    const overlayId = node.kind === 'scheme' ? node.overlayId : null
    if (command.overlayId !== overlayId) return false
    useUiSelection.getState().selectUiNode(node.id, overlayId)
    return true
  }

  if (command.type === 'add-root-folder' || command.type === 'add-folder') {
    const parentId = command.type === 'add-folder' ? command.parentId : null
    if (parentId !== null && findUiTreeNode(tree, parentId)?.kind !== 'folder') return false
    const id = nextId('ui-folder:', collectUiTreeNodeIds(tree))
    const nextTree = addUiTreeFolder(tree, parentId, { id, name: command.name?.trim() || '新文件夹' })
    if (nextTree === tree) return false
    state.setMeta((current) => ({ ...current, uiTree: nextTree }))
    useUiSelection.getState().selectUiNode(id, null)
    return true
  }

  if (command.type === 'add-scheme') {
    if (findUiTreeNode(tree, command.parentId)?.kind !== 'folder') return false
    const overlayId = nextId('scheme-', new Set(Object.keys(overlays)))
    const nodeId = nextId('ui-scheme:', collectUiTreeNodeIds(tree))
    const nextTree = addUiTreeScheme(tree, command.parentId, { id: nodeId, overlayId })
    if (nextTree === tree) return false
    const nextOverlays: Record<string, Overlay> = {
      [overlayId]: {
        id: overlayId,
        title: command.name?.trim() || nextUniqueOverlayTitle(overlays),
        children: [],
      },
      ...overlays,
    }
    state.setMeta((current) => ({
      ...current,
      ui: { ...current.ui, overlays: nextOverlays },
      uiTree: nextTree,
    }))
    useUiSelection.getState().selectUiNode(nodeId, overlayId)
    return true
  }

  const node = findUiTreeNode(tree, command.nodeId)
  if (!node) return false

  if (command.type === 'rename') {
    const name = command.name.trim()
    if (!name || node.id === BASIC_UI_FOLDER_ID) return false
    if (node.kind === 'folder') {
      const nextTree = renameUiTreeFolder(tree, node.id, name)
      if (nextTree === tree) return false
      state.setMeta((current) => ({ ...current, uiTree: nextTree }))
      return true
    }
    if (node.overlayId.startsWith('base:') || overlayTitleExists(overlays, name, node.overlayId)) return false
    const overlay = overlays[node.overlayId]
    if (!overlay) return false
    state.setMeta((current) => ({
      ...current,
      ui: {
        ...current.ui,
        overlays: { ...(current.ui?.overlays ?? {}), [node.overlayId]: { ...overlay, title: name } },
      },
    }))
    return true
  }

  const removedOverlayIds = collectOverlayIds(node)
  const removedNodeIds = collectNodeIds(node)
  if (node.id === BASIC_UI_FOLDER_ID || removedOverlayIds.some((id) => id.startsWith('base:'))) return false
  const nextTree = removeUiTreeNode(tree, node.id)
  if (nextTree === tree) return false
  const nextOverlays = { ...overlays }
  for (const overlayId of removedOverlayIds) delete nextOverlays[overlayId]
  state.setMeta((current) => ({
    ...current,
    ui: { ...current.ui, overlays: nextOverlays },
    uiTree: nextTree,
  }))
  const selection = useUiSelection.getState()
  if (
    removedNodeIds.includes(selection.selectedTreeNodeId ?? '')
    || removedOverlayIds.includes(selection.selectedOverlayId ?? '')
  ) {
    selection.clearUiSelection()
  }
  return true
}

export function sendUiNavCommand(
  command: UiNavCommand,
  role: UiNavRole = useUiNavMirror.getState().role,
): boolean {
  if (!isCommand(command)) return false
  if (role === 'left') {
    if (!leftChannel) return false
    leftChannel.postMessage({ version: 1, type: 'command', command } satisfies UiNavMessage)
    return true
  }
  return executeUiNavCommand(command)
}

export function requestUiNavSnapshot(): void {
  leftChannel?.postMessage({ version: 1, type: 'request' } satisfies UiNavMessage)
}

/**
 * 安装 split-pane 的窄域界面导航桥。center 发布摘要并执行命令；left 只镜像摘要和发命令。
 */
export function installUiNavSync(role: 'left' | 'center'): () => void {
  useUiNavMirror.setState({ role, snapshot: role === 'left' ? null : makeSnapshot() })
  if (typeof BroadcastChannel === 'undefined') {
    return () => useUiNavMirror.setState({ role: 'standalone', snapshot: null })
  }

  const channel = new BroadcastChannel(`${CHANNEL_BASE}${gameKeySuffix()}`)
  if (role === 'left') leftChannel = channel

  const publish = (): void => {
    channel.postMessage({ version: 1, type: 'snapshot', snapshot: makeSnapshot() } satisfies UiNavMessage)
  }

  channel.onmessage = (event: MessageEvent) => {
    const message = parseMessage(event.data)
    if (!message) return
    if (role === 'center') {
      if (message.type === 'request') publish()
      if (message.type === 'command' && executeUiNavCommand(message.command)) publish()
      return
    }
    if (message.type !== 'snapshot') return
    useUiNavMirror.setState({ snapshot: message.snapshot })
    useUiSelection.getState().selectUiNode(
      message.snapshot.selectedTreeNodeId,
      message.snapshot.selectedOverlayId,
    )
  }

  const unsubScenario = role === 'center'
    ? useGraphScenario.subscribe((next, previous) => {
      if (
        next.meta.uiTree !== previous.meta.uiTree
        || next.meta.ui?.overlays !== previous.meta.ui?.overlays
        || next.blueprints !== previous.blueprints
      ) publish()
    })
    : () => {}
  const unsubSelection = role === 'center'
    ? useUiSelection.subscribe((next, previous) => {
      if (
        next.selectedTreeNodeId !== previous.selectedTreeNodeId
        || next.selectedOverlayId !== previous.selectedOverlayId
      ) publish()
    })
    : () => {}

  if (role === 'left') requestUiNavSnapshot()
  else publish()

  return () => {
    unsubScenario()
    unsubSelection()
    channel.close()
    if (leftChannel === channel) leftChannel = null
    useUiNavMirror.setState({ role: 'standalone', snapshot: null })
  }
}
