import { createReadStream, statSync } from 'node:fs'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { relative, resolve, sep } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { listBakedLayers } from '../baked/store.js'
import { getLibraryService } from '../library/service.js'
import { getActiveProjectDir } from '../runtime.js'
import { buildSceneAtlases } from './atlas.js'
import { writeSceneBundle } from './bundle.js'
import { cookBakedScene } from './cooker.js'
import { decodePng } from './png.js'

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'scene'
}

function bundleId(sceneName: string, generatedAt: Date): string {
  const stamp = generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[:]/g, '-')
  return `${slugify(sceneName)}-${stamp}`
}

type HeaderValue = string | string[] | undefined
export type NetworkInterfacesProvider = () => NodeJS.Dict<NetworkInterfaceInfo[]>

function firstHeaderValue(value: HeaderValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const first = raw?.split(',')[0]?.trim()
  return first || undefined
}

function parseHost(host: string | undefined): { host: string; hostname: string; port: string } | undefined {
  if (!host) return undefined
  try {
    const url = new URL(`http://${host}`)
    return {
      host: url.host,
      hostname: url.hostname.toLowerCase(),
      port: url.port,
    }
  } catch {
    return undefined
  }
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '::1'
    || hostname === '0:0:0:0:0:0:0:1'
    || hostname.startsWith('127.')
    || hostname === '0.0.0.0'
}

function isExternalIpv4(address: NetworkInterfaceInfo): boolean {
  return !address.internal
    && address.family === 'IPv4'
    && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(address.address)
}

export function preferredExternalIpv4(provider: NetworkInterfacesProvider = networkInterfaces): string | undefined {
  for (const entries of Object.values(provider())) {
    for (const entry of entries ?? []) {
      if (isExternalIpv4(entry)) return entry.address
    }
  }
  return undefined
}

function sceneExportDownloadHost(req: FastifyRequest, provider: NetworkInterfacesProvider): string {
  const forwardedHost = parseHost(firstHeaderValue(req.headers['x-forwarded-host']))
  const requestHost = parseHost(firstHeaderValue(req.headers.host))
  const realHost = [forwardedHost, requestHost].find((candidate) => candidate && !isLocalHostname(candidate.hostname))
  if (realHost) return realHost.host

  const localHost = requestHost ?? forwardedHost
  const lanIp = preferredExternalIpv4(provider)
  if (lanIp) return localHost?.port ? `${lanIp}:${localHost.port}` : lanIp
  return localHost?.host ?? 'localhost'
}

function sceneExportDownloadProtocol(req: FastifyRequest): string {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto'])?.replace(/:$/, '')
  if (forwardedProto) return forwardedProto
  return req.protocol || 'http'
}

export function buildSceneExportDownloadUrl(
  req: FastifyRequest,
  bundleId: string,
  provider: NetworkInterfacesProvider = networkInterfaces,
): string {
  const path = `/api/v1/scene-export/download/${encodeURIComponent(bundleId)}`
  return `${sceneExportDownloadProtocol(req)}://${sceneExportDownloadHost(req, provider)}${path}`
}

async function sceneZipPathForBundle(bundleId: string): Promise<string | undefined> {
  if (!/^[A-Za-z0-9._-]+$/.test(bundleId)) return undefined
  const exportRoot = resolve(await getActiveProjectDir(), 'exports', 'scene')
  const zipPath = resolve(exportRoot, bundleId, 'scene.zip')
  const rel = relative(exportRoot, zipPath)
  if (rel.startsWith('..') || rel === '..' || rel.includes(`..${sep}`) || resolve(zipPath) === exportRoot) return undefined
  return zipPath
}

export async function registerSceneExportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/scene-export/cook', async (req, reply) => {
    const body = (req.body ?? {}) as { sceneName?: string; allowMissingAssets?: boolean }
    const sceneName = body.sceneName?.trim() || 'Scene'
    const generatedAt = new Date()
    const svc = getLibraryService()
    try {
      const cooked = cookBakedScene({
        bundleId: bundleId(sceneName, generatedAt),
        sceneName,
        layers: await listBakedLayers(),
        aliases: svc.listAliasesWithMeta('raw'),
        generatedAt,
        resolveRuleImage: (alias) => {
          const content = svc.resolveAssetContent(alias)
          if (!content) return null
          try {
            return decodePng(content.bytes)
          } catch {
            return null
          }
        },
      })
      const atlases = await buildSceneAtlases(cooked, {
        allowMissingAssets: body.allowMissingAssets === true,
        resolveAssetContent: (alias) => svc.resolveAssetContent(alias),
      })
      const out = await writeSceneBundle({
        activeProjectDir: await getActiveProjectDir(),
        cooked,
        atlases,
      })
      return {
        ...out,
        downloadUrl: buildSceneExportDownloadUrl(req, out.bundleId),
        warnings: cooked.warnings,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.code(400).send({ error: message })
    }
  })

  app.get('/api/v1/scene-export/download/:bundleId', async (req, reply) => {
    const { bundleId } = req.params as { bundleId: string }
    const zipPath = await sceneZipPathForBundle(bundleId)
    if (!zipPath) return reply.code(404).send({ error: 'scene export bundle not found' })
    let zipStats: ReturnType<typeof statSync>
    try {
      zipStats = statSync(zipPath)
      if (!zipStats.isFile()) return reply.code(404).send({ error: 'scene export bundle not found' })
    } catch {
      return reply.code(404).send({ error: 'scene export bundle not found' })
    }

    reply.header('Content-Type', 'application/octet-stream')
    reply.header('Content-Disposition', 'attachment; filename="scene.zip"')
    reply.header('Content-Length', String(zipStats.size))
    reply.header('Cache-Control', 'no-store')
    reply.header('X-Content-Type-Options', 'nosniff')
    return reply.send(createReadStream(zipPath))
  })
}
