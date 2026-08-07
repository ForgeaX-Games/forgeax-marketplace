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
}

/** Refcount so nested in-process mounts do not tear each other's host down. */
let hostCount = 0

export function applyHostInit(options: WorkbenchInitOptions = {}): void {
  acquireHostInit(options.rewrite)
  if (options.acceptReference) setInjectedAcceptReference(options.acceptReference)
  if (!options.host) return
  setWorkbenchHost(options.host)
  hostCount += 1
}

export function releaseHostInit(): void {
  releaseRewrite()
  if (hostCount <= 0) return
  hostCount -= 1
  if (hostCount === 0) {
    clearWorkbenchHost()
    setInjectedAcceptReference(null)
  }
}

export function resetHostInjectionForTests(): void {
  hostCount = 0
  clearWorkbenchHost()
  setInjectedAcceptReference(null)
}
