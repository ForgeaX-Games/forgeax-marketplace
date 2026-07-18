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

function withSlug(args: unknown): unknown {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>;
    if (obj.slug === undefined && activeSlug !== null) return { ...obj, slug: activeSlug };
    return obj;
  }
  return args;
}

export async function callTool<T>(toolId: string, args: unknown): Promise<ToolResult<T>> {
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
    if (/EUNKNOWN|ENOENT|EINVAL/i.test(err) && /open|write|path/i.test(err)) {
      return { ok: false, error: t('error.saveFailed'), code: body.code };
    }
  }
  return body;
}
