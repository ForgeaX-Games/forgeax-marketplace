/**
 * intake/scenes —— **只读**跨模块适配器：把场景模块已发布到游戏沙箱的贴图/场景图映射成
 * 本 registry 的 `scene_ref` 条目（externalPath 指回对方文件，**不复制、不写对方目录**）。
 *
 * 场景侧磁盘契约（勘察自 wb-2d-scene-asset-generator 的 asset2d:publishToGame）：
 *   `.forgeax/games/<slug>/textures/index.json` = GameTextureDescriptor[]
 *      [{ assetName, assetType, sha256, file: "blobs/<sha256>.png", mimeType, ... }]
 *   实际二进制内容寻址存 `textures/blobs/<sha256>.png`。
 *
 * 幂等：ref id 由 sha256（或 file）稳定派生，重扫覆盖同一条目。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mimeForPath, upsertAsset } from '../asset-registry'
import type { MediaAsset } from '../../src/editor/assets/registry-types'

interface TextureDescriptor {
  assetName?: string
  assetType?: string
  sha256?: string
  file?: string
  mimeType?: string
}

function shortId(desc: TextureDescriptor): string {
  const key = desc.sha256 ?? desc.file ?? desc.assetName ?? Math.random().toString(36).slice(2)
  return `a-sceneref-${key.replace(/[^a-z0-9]/gi, '').slice(0, 24)}`
}

/**
 * 读 texturesDir/index.json，为每条已发布贴图 upsert 一条只读 `scene_ref`。
 * texturesDir 或 index.json 不存在 → 空。
 */
export function importSceneRefs(opts: { assetsDir: string; texturesDir: string }): MediaAsset[] {
  const { assetsDir, texturesDir } = opts
  const indexPath = resolve(texturesDir, 'index.json')
  if (!existsSync(indexPath)) return []
  let list: TextureDescriptor[]
  try {
    const parsed = JSON.parse(readFileSync(indexPath, 'utf-8'))
    list = Array.isArray(parsed) ? (parsed as TextureDescriptor[]) : []
  } catch {
    return []
  }
  const out: MediaAsset[] = []
  for (const desc of list) {
    if (!desc.file) continue
    const externalPath = resolve(texturesDir, desc.file)
    if (!existsSync(externalPath)) continue
    out.push(
      upsertAsset(assetsDir, {
        id: shortId(desc),
        kind: 'image',
        productionType: 'scene_ref',
        status: 'ready',
        label: desc.assetName || desc.assetType || 'scene',
        externalPath,
        sourceModule: 'wb-2d-scene-asset-generator',
        mime: desc.mimeType || mimeForPath(externalPath),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        meta: { assetType: desc.assetType, sha256: desc.sha256 },
      }),
    )
  }
  return out
}
