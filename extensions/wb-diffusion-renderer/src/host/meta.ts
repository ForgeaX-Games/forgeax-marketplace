export interface DiffusionRendererMeta {
  ready: boolean;
  backend?: string;
  statusText: string;
  /** Upper bound for `steps`, probed from the service `/health` (see service.md §2). */
  maxSteps?: number;
}

export async function fetchDiffusionRendererMeta(): Promise<DiffusionRendererMeta> {
  try {
    const h = await fetch('/api/wb/diffusion-renderer/health').then((r) => r.json());
    const data = h?.data as { status?: string; max_steps?: number } | undefined;
    const ready = Boolean(h?.ready && (data ? data.status === 'ready' : h.ok));
    const maxSteps =
      typeof data?.max_steps === 'number' && Number.isFinite(data.max_steps) ? data.max_steps : undefined;
    return {
      ready,
      backend: h?.backend,
      statusText: ready ? `ready · ${h?.backend ?? ''}` : (h?.error ?? data?.status ?? 'not ready'),
      maxSteps,
    };
  } catch {
    return { ready: false, statusText: 'server unreachable' };
  }
}
