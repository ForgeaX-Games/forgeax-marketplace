import { activeSlug } from '@/lib/gameSlug';
import { t } from '@/i18n';

export interface ToolResultOk<T> {
  ok: true;
  result: T;
}

export interface ToolResultErr {
  ok: false;
  error: string;
  code?: string;
}

export type ToolResult<T> = ToolResultOk<T> | ToolResultErr;

let reloadPromise: Promise<boolean> | null = null;

async function reloadPluginSnapshot(): Promise<boolean> {
  if (!reloadPromise) {
    reloadPromise = (async () => {
      try {
        const resp = await fetch('/api/plugins/reload', { method: 'POST' });
        return resp.ok;
      } catch {
        return false;
      } finally {
        reloadPromise = null;
      }
    })();
  }
  return reloadPromise;
}

function withSlug(args: unknown): unknown {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>;
    if (obj.slug === undefined && activeSlug !== null) return { ...obj, slug: activeSlug };
    return obj;
  }
  return args;
}

async function callToolOnce<T>(toolId: string, args: unknown): Promise<ToolResult<T>> {
  let resp: Response;
  try {
    resp = await fetch('/api/tools/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolId, args: withSlug(args), caller: { kind: 'user' } }),
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: 'network_error' };
  }
  const body = (await resp.json().catch(() => null)) as ToolResult<T> | null;
  if (!body) return { ok: false, error: `bad response (${resp.status})`, code: 'bad_response' };
  if (!body.ok) {
    const err = body.error ?? '';
    if (err.includes('does not export handler')) {
      return { ok: false, error: t('error.pluginReload'), code: body.code };
    }
    if (body.code === 'not_found' || /tool not found/i.test(err)) {
      return { ok: false, error: t('error.pluginReload'), code: 'not_found' };
    }
    if (/EUNKNOWN|ENOENT|EINVAL/i.test(err) && /open|write|path/i.test(err)) {
      return { ok: false, error: t('error.saveFailed'), code: body.code };
    }
  }
  return body;
}

export async function callTool<T>(toolId: string, args: unknown): Promise<ToolResult<T>> {
  const first = await callToolOnce<T>(toolId, args);
  if (first.ok) return first;
  const retryable = first.code === 'not_found' || first.code === 'unknown_style';
  if (!retryable) return first;

  const reloaded = await reloadPluginSnapshot();
  if (!reloaded) return first;

  return callToolOnce<T>(toolId, args);
}

export async function reloadPluginsAndRetry<T>(
  toolId: string,
  args: unknown,
): Promise<ToolResult<T>> {
  const reloaded = await reloadPluginSnapshot();
  if (!reloaded) return { ok: false, error: t('error.pluginReload'), code: 'reload_failed' };
  return callToolOnce<T>(toolId, args);
}
