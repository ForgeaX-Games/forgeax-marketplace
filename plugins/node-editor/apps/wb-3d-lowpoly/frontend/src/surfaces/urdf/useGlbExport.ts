import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import type { UrdfSpec } from './viewer3d/urdf-parser'
import { exportAnimatedGlbBlob } from './viewer3d/export-glb'
import { cloneObject3DForExport, disposeObject3D } from './viewer3d/three-dispose'

// Accessors into the live viewer so the agent-triggered GLB export reuses the
// exact same path as the titlebar "Export ▸ glb" button.
export interface GlbExportAccessors {
  getExportObject: () => THREE.Object3D | null
  getSpec: () => UrdfSpec | null
}

// Listens on /ws for the backend's `glb:request` broadcast (emitted by
// lowpoly:export-glb → /api/v1/agent/glb/export), bakes the current URDF scene
// into a binary glTF (with joint-preview animation) via the existing
// exportAnimatedGlbBlob, and POSTs it back to /api/v1/agent/glb/store so the
// awaiting export request resolves and the backend writes the .glb to disk.
// This is the agent-facing twin of the human titlebar export.
export function useGlbExport(accessors: GlbExportAccessors): void {
  const ref = useRef(accessors)
  ref.current = accessors

  useEffect(() => {
    if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return
    const url = `${location.origin.replace(/^http/, 'ws')}/ws`
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let closed = false

    const post = (body: unknown) =>
      void fetch('/api/v1/agent/glb/store', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const onMessage = async (ev: MessageEvent) => {
      let msg: { event?: string; payload?: { requestId?: string; name?: string } }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      if (msg.event !== 'glb:request' || !msg.payload?.requestId) return
      const requestId = msg.payload.requestId
      try {
        const root = ref.current.getExportObject()
        const spec = ref.current.getSpec()
        if (!root) throw new Error('no 3D object ready to export (run the pipeline first?)')
        if (!spec) throw new Error('no URDF spec available (execute the full graph so g_to_urdf produces output)')
        root.updateMatrixWorld(true)
        const exportRoot = cloneObject3DForExport(root)
        let blob: Blob
        try {
          blob = await exportAnimatedGlbBlob(exportRoot, spec)
        } finally {
          // 导出克隆持有独立 geometry/material，用完即释放，避免每次 agent 导出泄漏。
          disposeObject3D(exportRoot)
        }
        const reader = new FileReader()
        reader.onloadend = () => post({ requestId, name: msg.payload?.name, dataUrl: reader.result, bytes: blob.size })
        reader.onerror = () => post({ requestId, error: 'failed to read glb blob' })
        reader.readAsDataURL(blob)
      } catch (e) {
        post({ requestId, error: e instanceof Error ? e.message : String(e) })
      }
    }

    // Auto-reconnect mirrors useScreenshotCapture so a transient WS drop never
    // leaves the exporter silently dead.
    const connect = () => {
      if (closed) return
      ws = new WebSocket(url)
      ws.onopen = () => { attempts = 0 }
      ws.onmessage = onMessage
      const scheduleReconnect = () => {
        if (closed || retry) return
        const delay = Math.min(5000, 500 * 2 ** attempts)
        attempts += 1
        retry = setTimeout(() => { retry = null; connect() }, delay)
      }
      ws.onclose = scheduleReconnect
      ws.onerror = () => { try { ws?.close() } catch { /* noop */ } }
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      try { ws?.close() } catch { /* noop */ }
    }
  }, [])
}
