/** 浏览器与服务端均可用的生成 nonce（每次调用必须唯一）。 */
export function createUiGenerationNonce(): string {
  const rand = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  return `${Date.now()}-${rand}`
}

export function ensureUiGenerationNonce(nonce?: string): string {
  const trimmed = String(nonce ?? '').trim()
  return trimmed || createUiGenerationNonce()
}
