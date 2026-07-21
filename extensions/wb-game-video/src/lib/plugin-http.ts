const RAW_BASE = import.meta.env.BASE_URL ?? '/'

function basePrefix(): string {
  if (!RAW_BASE || RAW_BASE === './') return ''
  return RAW_BASE.replace(/\/$/, '')
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
