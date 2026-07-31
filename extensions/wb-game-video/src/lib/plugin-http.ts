const RAW_BASE = import.meta.env.BASE_URL ?? '/'

function basePrefix(rawBase: string): string {
  if (!rawBase || rawBase === './') return ''
  return rawBase.replace(/\/$/, '')
}

export function pluginUrl(path: string, rawBase = RAW_BASE): string {
  if (/^(?:https?:|blob:|data:)/.test(path)) return path
  if (!path.startsWith('/')) return path
  // Host APIs are rooted at the origin. Prefixing them with the plugin mount
  // makes Vite return its HTML fallback for GET and an empty 404 for POST.
  if (/^\/api(?:\/|$|\?)/.test(path)) return path
  const prefix = basePrefix(rawBase)
  if (!prefix || path === prefix || path.startsWith(`${prefix}/`)) return path
  return `${prefix}${path}`
}

export function pluginFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(pluginUrl(input), init)
}
