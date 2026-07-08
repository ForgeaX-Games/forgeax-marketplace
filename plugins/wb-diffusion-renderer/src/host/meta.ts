export interface DiffusionRendererMeta {
  ready: boolean;
  backend?: string;
  statusText: string;
  loraPresets: string[];
}

export async function fetchDiffusionRendererMeta(): Promise<DiffusionRendererMeta> {
  try {
    const [h, b] = await Promise.all([
      fetch('/api/wb/diffusion-renderer/health').then((r) => r.json()),
      fetch('/api/wb/diffusion-renderer/backends').then((r) => r.json()).catch(() => null),
    ]);
    const data = h?.data as { status?: string } | undefined;
    const ready = Boolean(h?.ready && (data ? data.status === 'ready' : h.ok));
    const caps = b?.backends?.find((x: { name: string }) => x.name === h?.backend) ?? b?.backends?.[0];
    return {
      ready,
      backend: h?.backend,
      statusText: ready ? `ready · ${h?.backend ?? ''}` : (h?.error ?? data?.status ?? 'not ready'),
      loraPresets: caps?.capabilities?.loraPresets ?? [],
    };
  } catch {
    return { ready: false, statusText: 'server unreachable', loraPresets: [] };
  }
}
