import { getWorkbenchHost } from './workbench-host'

/** Resolves an extension-relative media path from the accepted handshake. */
export function pluginUrl(path: string): string {
  if (/^(?:https?:|blob:|data:)/.test(path)) return path
  return getWorkbenchHost().extension.url(path)
}

export function pluginFetch(input: string, init?: RequestInit): Promise<Response> {
  if (/^(?:https?:|blob:|data:)/.test(input)) return fetch(input, init)
  return getWorkbenchHost().extension.fetch(input, init)
}
