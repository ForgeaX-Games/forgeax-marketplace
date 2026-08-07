import {
  acquireHostInit,
  releaseHostInit as releaseRewrite,
  type RewriteRule,
} from './lib/forgeax-http'
import {
  clearWorkbenchHost,
  setWorkbenchHost,
  type WorkbenchHostClient,
} from './lib/workbench-host'
import { setInjectedAcceptReference } from './platform/HostSdkBridge'
import type { ContextReference } from './platform/context-reference'

export type WorkbenchInitOptions = {
  rewrite?: RewriteRule[]
  pane?: 'left' | 'center' | null
  slug?: string | null
  /**
   * A ready workbench client for in-process mounts. Without it the extension
   * falls back to the iframe handshake, which has no parent to answer it.
   */
  host?: WorkbenchHostClient
  /**
   * In-process `chat.reference.accept@1` channel. When provided, "引用到 Chat"
   * calls this directly instead of falling back to the iframe
   * `FORGEAX_COMPOSER_INSERT` postMessage handshake.
   */
  acceptReference?: (reference: ContextReference) => void | Promise<unknown>
  /**
   * Host-owned DOM slot for the node inspector panel. When set, GraphStudio
   * portals the panel here and skips the canvas-embedded inspector.
   */
  inspectorEl?: HTMLElement
  /**
   * Fired when canvas node selection changes. Pass `null` when selection clears.
   * Errors thrown by the callback are swallowed so selection still updates.
   */
  onNodeSelect?: (nodeId: string | null) => void
}

/** Refcount so nested in-process mounts do not tear each other's host down. */
let hostCount = 0
/** Matches every applyHostInit (with or without host) for inspector option lifetime. */
let initDepth = 0

let activeInspectorEl: HTMLElement | undefined
let activeOnNodeSelect: ((nodeId: string | null) => void) | undefined

export function getInspectorMountOptions(): {
  inspectorEl: HTMLElement | undefined
  onNodeSelect: ((nodeId: string | null) => void) | undefined
} {
  return { inspectorEl: activeInspectorEl, onNodeSelect: activeOnNodeSelect }
}

export function applyHostInit(options: WorkbenchInitOptions = {}): void {
  acquireHostInit(options.rewrite)
  initDepth += 1
  activeInspectorEl = options.inspectorEl
  activeOnNodeSelect = options.onNodeSelect
  if (options.acceptReference) setInjectedAcceptReference(options.acceptReference)
  if (!options.host) return
  setWorkbenchHost(options.host)
  hostCount += 1
}

export function releaseHostInit(): void {
  releaseRewrite()
  initDepth = Math.max(0, initDepth - 1)
  if (initDepth === 0) {
    activeInspectorEl = undefined
    activeOnNodeSelect = undefined
  }
  if (hostCount <= 0) return
  hostCount -= 1
  if (hostCount === 0) {
    clearWorkbenchHost()
    setInjectedAcceptReference(null)
  }
}

export function resetHostInjectionForTests(): void {
  hostCount = 0
  initDepth = 0
  activeInspectorEl = undefined
  activeOnNodeSelect = undefined
  clearWorkbenchHost()
  setInjectedAcceptReference(null)
}
