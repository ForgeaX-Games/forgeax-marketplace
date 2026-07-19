// @source wb-character/src/platform/Bridge.ts
declare const ForgeClient: {
  game?: {
    loading?(p: { progress: number; message: string }): void
    loaded?(): void
  }
} | undefined

// ForgeaX studio host context — when this iframe is loaded inside the
// forgeax-studio Sidebar (vs. standalone vite dev mode), the host posts a
// STUDIO_INIT { ctx } message immediately after we send STUDIO_READY. ctx
// carries slug + apiBase so LLM/asset calls target /api/wb/character/* in the
// studio server instead of the standalone vite plugin endpoints.
export interface StudioHostCtx {
  slug: string | null
  apiBase: string
  assetBase: string
  host: string
}

export class PlatformBridge {
  constructor() {
    window.addEventListener('message', (e) => {
      if (e.data?.type) this.handleMessage(e.data)
    })
  }

  private messageHandlers: Array<(msg: unknown) => void> = []
  private studioCtx: StudioHostCtx | null = null

  onMessage(handler: (msg: unknown) => void): void {
    this.messageHandlers.push(handler)
  }

  getStudioCtx(): StudioHostCtx | null { return this.studioCtx }

  private handleMessage(msg: unknown): void {
    const m = msg as Record<string, unknown>
    if (m.type === 'STUDIO_INIT') {
      if (m.ctx && typeof m.ctx === 'object') {
        this.studioCtx = m.ctx as StudioHostCtx
        for (const h of this.messageHandlers) {
          try { h({ type: 'studio:init', ctx: this.studioCtx }) } catch (e) { console.error('[Bridge]', e) }
        }
      } else if (m.payload) {
        const payload = m.payload as Record<string, unknown>
        if (payload.filePath) {
          for (const h of this.messageHandlers) {
            try { h({ type: 'loadAsset', path: payload.filePath }) } catch (e) { console.error('[Bridge]', e) }
          }
        }
      }
    } else if (m.type === 'STUDIO_CTX' && m.ctx) {
      this.studioCtx = { ...(this.studioCtx ?? {} as StudioHostCtx), ...(m.ctx as object) } as StudioHostCtx
      for (const h of this.messageHandlers) {
        try { h({ type: 'studio:ctx', ctx: this.studioCtx }) } catch (e) { console.error('[Bridge]', e) }
      }
    } else if (m.type === 'SURFACE_DISPATCH' && typeof m.toolId === 'string') {
      const w = window as typeof window & { __ceInvoke?: (id: string) => boolean }
      const toolId = m.toolId as string
      const handled = w.__ceInvoke ? w.__ceInvoke(toolId) : false
      this.post({ type: 'SURFACE_EVENT', payload: { kind: 'dispatch-ack', toolId, handled, args: m.args } })
      for (const h of this.messageHandlers) {
        try { h({ type: 'surface:dispatch', toolId, args: m.args }) } catch (e) { console.error('[Bridge]', e) }
      }
    } else if (m.type === 'STUDIO_RELOAD') {
      for (const h of this.messageHandlers) {
        try { h({ type: 'studio:reload' }) } catch (e) { console.error('[Bridge]', e) }
      }
    }
    for (const h of this.messageHandlers) {
      try { h(msg) } catch (e) { console.error('[Bridge]', e) }
    }
  }

  sendReady(): void {
    try { ForgeClient?.game?.loaded?.() } catch { /* not in sandbox */ }
    this.post({ type: 'VAG_PREVIEW_READY' })
    this.post({ type: 'STUDIO_READY' })
  }

  sendLoading(progress: number, message: string): void {
    try { ForgeClient?.game?.loading?.({ progress, message }) } catch { /* not in sandbox */ }
  }

  sendEvent(kind: string, payload?: unknown): void {
    this.post({ type: 'SURFACE_EVENT', payload: { kind, ...(payload as object ?? {}) } })
  }

  private post(data: unknown): void {
    try { window.parent?.postMessage(data, '*') } catch { /* not in iframe */ }
  }
}
