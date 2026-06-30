/**
 * GLB export service: async lifecycle for agent-triggered .glb exports.
 *   - createExport: mints a requestId + pending Promise (auto-rejects on timeout)
 *   - resolveExport: the renderer frontend POSTs the baked glb back → resolve
 * Mirrors screenshot.service, but the /store route persists the .glb to disk
 * (the result carries the written path) instead of caching base64.
 */
import { randomUUID } from 'crypto';

export interface GlbExportResult {
  requestId: string;
  path: string; // absolute path written on disk
  relPath: string; // path relative to projectRoot
  bytes: number;
}

interface PendingExport {
  resolve: (r: GlbExportResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

class GlbService {
  private pending = new Map<string, PendingExport>();

  createExport(timeoutMs = 30000): { requestId: string; promise: Promise<GlbExportResult> } {
    const requestId = randomUUID();
    const promise = new Promise<GlbExportResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        console.warn(`[Glb] export timeout: ${requestId}`);
        reject(new Error('timeout'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
    console.log(`[Glb] export requested: ${requestId} (timeout=${timeoutMs}ms)`);
    return { requestId, promise };
  }

  /** Renderer reported an error baking the glb. */
  rejectExport(requestId: string, message: string): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.reject(new Error(message));
    return true;
  }

  resolveExport(requestId: string, result: GlbExportResult): boolean {
    const p = this.pending.get(requestId);
    if (!p) {
      console.warn(`[Glb] no pending export for id: ${requestId}`);
      return false;
    }
    clearTimeout(p.timer);
    this.pending.delete(requestId);
    p.resolve(result);
    console.log(`[Glb] exported: ${requestId} → ${result.relPath} (${(result.bytes / 1024).toFixed(1)}KB)`);
    return true;
  }
}

let instance: GlbService | null = null;
export function getGlbService(): GlbService {
  if (!instance) instance = new GlbService();
  return instance;
}
