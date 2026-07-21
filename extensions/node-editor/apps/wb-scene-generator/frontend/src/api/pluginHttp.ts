const RAW_BASE =
  (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'

function basePrefix(): string {
  if (!RAW_BASE || RAW_BASE === './') return ''
  return RAW_BASE.replace(/\/$/, '')
}

export function pluginBasePath(): string {
  return basePrefix()
}

export function pluginUrl(path: string): string {
  if (/^(?:https?:|blob:|data:)/.test(path)) return path
  if (!path.startsWith('/')) return path
  const prefix = basePrefix()
  if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) return path
  return `${prefix}${path}`
}

export function pluginFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(pluginUrl(input), init)
}

export function pluginWsUrl(path = '/ws'): string {
  const url = pluginUrl(path)
  const absolute = url.startsWith('http') ? url : `${location.origin}${url.startsWith('/') ? '' : '/'}${url}`
  return absolute.replace(/^http/, 'ws')
}
