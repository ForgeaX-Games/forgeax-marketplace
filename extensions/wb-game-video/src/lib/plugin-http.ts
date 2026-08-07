import { rewriteUrl } from '@forgeax/workbench-host/browser'
import { getActiveRewriteRules } from './forgeax-http'
import { getWorkbenchHost } from './workbench-host'

/** Resolves an extension-relative media path from the accepted handshake. */
export function pluginUrl(path: string): string {
  if (/^(?:https?:|blob:|data:)/.test(path)) return path
  const rewritten = rewriteUrl(path, getActiveRewriteRules())
  if (/^(?:https?:|blob:|data:)/.test(rewritten)) return rewritten
  const queryIndex = rewritten.indexOf('?')
  if (queryIndex < 0) return getWorkbenchHost().extension.url(rewritten)
  const pathname = rewritten.slice(0, queryIndex)
  const query = rewritten.slice(queryIndex + 1)
  const hostUrl = getWorkbenchHost().extension.url(pathname)
  return query.length === 0
    ? hostUrl
    : `${hostUrl}${hostUrl.includes('?') ? '&' : '?'}${query}`
}

/**
 * Rewrite the logical path once, then dispatch through the workbench host
 * (or raw fetch for absolute/opaque URLs).
 */
export async function pluginFetch(input: string, init?: RequestInit): Promise<Response> {
  const rewritten = rewriteUrl(input, getActiveRewriteRules())
  if (/^(?:https?:|blob:|data:)/.test(rewritten)) return fetch(rewritten, init)
  const host = getWorkbenchHost()
  if (!rewritten.includes('?')) return host.extension.fetch(rewritten, init)
  await host.ready()
  return fetch(pluginUrl(rewritten), init)
}
