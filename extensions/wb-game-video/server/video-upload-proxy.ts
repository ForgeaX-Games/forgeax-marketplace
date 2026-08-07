import type { IncomingMessage, ServerResponse } from 'node:http'

export const VIDEO_UPLOAD_PROXY_ROUTE_PREFIX = '/__video-upload-proxy'
const MAX_PROXY_ERROR_BODY_LENGTH = 8192
const GENERIC_BAD_GATEWAY_MESSAGE = 'Video upload proxy upstream request failed'

const SAFE_REQUEST_HEADER_PREFIXES = ['x-amz-', 'x-cos-'] as const
const SAFE_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-type',
  'etag',
  'x-amz-request-id',
  'x-cos-request-id',
])

export type VideoUploadTargetValidation =
  | { ok: true; url: URL }
  | { ok: false; reason: string }

export interface VideoUploadProxyHandlerOptions {
  allowedExtraHosts?: readonly string[]
  fetchImpl?: typeof fetch
}

type VideoUploadProxyNext = () => void
export type VideoUploadProxyHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next: VideoUploadProxyNext,
) => void

type StreamingRequestInit = RequestInit & { duplex: 'half' }

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return true
  }
  if (host === '::1' || host === '[::1]') {
    return true
  }

  const ipv4Match = /^\d{1,3}(?:\.\d{1,3}){3}$/.exec(host)
  if (!ipv4Match) {
    return false
  }

  const parts = host.split('.').map((part) => Number(part))
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

function hasQueryParam(url: URL, name: string): boolean {
  for (const key of url.searchParams.keys()) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return url.searchParams.get(key)?.trim()
        ? true
        : false
    }
  }
  return false
}

function isAwsS3Host(hostname: string): boolean {
  return hostname.toLowerCase().endsWith('.amazonaws.com')
}

function hasCosSignature(url: URL): boolean {
  return (
    hasQueryParam(url, 'q-sign-algorithm') &&
    hasQueryParam(url, 'q-signature') &&
    hasQueryParam(url, 'q-ak')
  )
}

function hasS3Signature(url: URL): boolean {
  return (
    hasQueryParam(url, 'X-Amz-Algorithm') &&
    hasQueryParam(url, 'X-Amz-Signature') &&
    hasQueryParam(url, 'X-Amz-Credential')
  )
}

export function parseAllowedExtraHosts(raw: string | undefined): string[] {
  if (!raw?.trim()) {
    return []
  }
  return raw
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

export function validateVideoUploadTargetUrl(
  rawUrl: string,
  allowedExtraHosts: readonly string[] = [],
): VideoUploadTargetValidation {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'https_required' }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'userinfo_forbidden' }
  }
  if (url.hash) {
    return { ok: false, reason: 'fragment_forbidden' }
  }

  const hostname = url.hostname.toLowerCase()
  const allowlisted = allowedExtraHosts.map((host) => host.toLowerCase()).includes(hostname)
  const privateHost = isPrivateOrLocalHost(hostname)

  if (privateHost && !allowlisted) {
    return { ok: false, reason: 'private_host_forbidden' }
  }

  if (allowlisted) {
    if (hasCosSignature(url) || hasS3Signature(url)) {
      return { ok: true, url }
    }
    return { ok: false, reason: 'missing_signature' }
  }

  // Built-in public object storage allowlist: AWS S3 only. Every other upload
  // host must be configured explicitly via VIDEO_UPLOAD_PROXY_ALLOWED_HOSTS.
  if (isAwsS3Host(hostname)) {
    return hasS3Signature(url)
      ? { ok: true, url }
      : { ok: false, reason: 'missing_s3_signature' }
  }

  return { ok: false, reason: 'host_not_allowed' }
}

function isSafeRequestHeader(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  if (normalized === 'content-type') {
    return true
  }
  return SAFE_REQUEST_HEADER_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

function collectSafeRequestHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [rawName, rawValue] of Object.entries(req.headers)) {
    if (!isSafeRequestHeader(rawName) || rawValue === undefined) {
      continue
    }
    const value = Array.isArray(rawValue) ? rawValue.join(',') : rawValue
    if (/[\r\n\0]/.test(value)) {
      continue
    }
    headers[rawName] = value
  }
  return headers
}

function relaySafeResponseHeaders(upstream: Response, res: ServerResponse): void {
  upstream.headers.forEach((value, name) => {
    if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) {
      res.setHeader(name, value)
    }
  })
}

async function readLimitedErrorBody(upstream: Response): Promise<string> {
  const reader = upstream.body?.getReader()
  if (!reader) {
    return ''
  }
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < MAX_PROXY_ERROR_BODY_LENGTH) {
    const { done, value } = await reader.read()
    if (done || !value) {
      break
    }
    const remaining = MAX_PROXY_ERROR_BODY_LENGTH - total
    if (value.byteLength <= remaining) {
      chunks.push(value)
      total += value.byteLength
    } else {
      chunks.push(value.slice(0, remaining))
      total = MAX_PROXY_ERROR_BODY_LENGTH
      break
    }
  }
  await reader.cancel().catch(() => undefined)
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

function sendPlainText(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(message)
}

function readTargetUrl(req: IncomingMessage): string | null {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  const rawTarget = requestUrl.searchParams.get('url')?.trim()
  return rawTarget && rawTarget.length > 0 ? rawTarget : null
}

export function createVideoUploadProxyHandler(
  options: VideoUploadProxyHandlerOptions = {},
): VideoUploadProxyHandler {
  const fetchImpl = options.fetchImpl ?? fetch
  const allowedExtraHosts = options.allowedExtraHosts ?? []

  return (req, res, next) => {
    void (async () => {
      const method = (req.method ?? 'GET').toUpperCase()

      if (method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('allow', 'PUT')
        res.setHeader('cache-control', 'no-store')
        res.end()
        return
      }

      if (method !== 'PUT') {
        sendPlainText(res, 405, 'Method Not Allowed')
        return
      }

      const rawTarget = readTargetUrl(req)
      if (!rawTarget) {
        sendPlainText(res, 400, 'Missing upload target')
        return
      }

      const validation = validateVideoUploadTargetUrl(rawTarget, allowedExtraHosts)
      if (!validation.ok) {
        sendPlainText(res, 400, 'Invalid upload target')
        return
      }

      const upstreamHeaders = collectSafeRequestHeaders(req)

      try {
        const upstream = await fetchImpl(
          validation.url.toString(),
          {
            method: 'PUT',
            headers: upstreamHeaders,
            body: req as unknown as BodyInit,
            duplex: 'half',
            redirect: 'manual',
            credentials: 'omit',
          } as StreamingRequestInit,
        )

        res.statusCode = upstream.status
        res.setHeader('cache-control', 'no-store')
        relaySafeResponseHeaders(upstream, res)

        if (upstream.status >= 400) {
          const errorBody = await readLimitedErrorBody(upstream)
          res.end(errorBody)
          return
        }

        if (!upstream.body) {
          res.end()
          return
        }

        const reader = upstream.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          if (value) {
            res.write(Buffer.from(value))
          }
        }
        res.end()
      } catch {
        sendPlainText(res, 502, GENERIC_BAD_GATEWAY_MESSAGE)
      }
    })().catch(() => {
      if (!res.headersSent) {
        sendPlainText(res, 502, GENERIC_BAD_GATEWAY_MESSAGE)
      } else {
        res.end()
      }
    })
  }
}
