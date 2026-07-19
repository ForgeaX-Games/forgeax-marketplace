// Shared engine external-asset-package cook (PLAN S1 / §5.1).
// Mirrors forgeax-engine toAssetPack sub-asset kinds without depending on
// @forgeax/engine-gltf (marketplace is outside the npm workspace).

import { WebIO } from '@gltf-transform/core';
import { createHash } from 'node:crypto';
import {
  ENGINE_REQUIRED_EXTENSION_ALLOWLIST,
  type CookOptions,
  type CookResult,
  type ExternalAssetMeta,
  type ExternalAssetSubAsset,
} from './types.ts';

function hexToUuid(hex: string): string {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function meshGuid(contentHash: string, sourceIndex: number): string {
  const h = createHash('sha256').update(`${contentHash}:${sourceIndex}`).digest('hex');
  return hexToUuid(h);
}

function subGuid(contentHash: string, kind: string, sourceIndex: number): string {
  const h = createHash('sha256').update(`${contentHash}:${kind}:${sourceIndex}`).digest('hex');
  return hexToUuid(h);
}

interface GlTFJson {
  readonly meshes?: ReadonlyArray<{ readonly name?: string }>;
  readonly materials?: ReadonlyArray<{ readonly name?: string }>;
  readonly scenes?: ReadonlyArray<{ readonly name?: string }>;
  readonly images?: ReadonlyArray<{ readonly name?: string }>;
  readonly skins?: ReadonlyArray<{ readonly name?: string }>;
  readonly animations?: ReadonlyArray<{ readonly name?: string }>;
  readonly scene?: number;
  readonly extensionsRequired?: ReadonlyArray<string>;
  readonly extensionsUsed?: ReadonlyArray<string>;
}

function parseGlbJson(glbBytes: Uint8Array): GlTFJson | null {
  if (glbBytes.length < 20) return null;
  const view = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return null;
  const jsonLen = view.getUint32(12, true);
  if (jsonLen <= 0 || 20 + jsonLen > glbBytes.length) return null;
  const jsonText = new TextDecoder().decode(glbBytes.subarray(20, 20 + jsonLen));
  try {
    return JSON.parse(jsonText) as GlTFJson;
  } catch {
    return null;
  }
}

function existingGuidMap(
  existingMeta: ExternalAssetMeta | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!existingMeta || existingMeta.kind !== 'external-asset-package') return map;
  for (const entry of existingMeta.subAssets) {
    map.set(`${entry.kind}\0${entry.sourceIndex}`, entry.guid);
  }
  return map;
}

function resolveGuid(args: {
  kind: string;
  sourceIndex: number;
  bareHash: string;
  reuse: Map<string, string>;
  slotKey?: string;
  slotGuidRegistry?: Readonly<Record<string, string>>;
}): string {
  if (args.kind === 'animation-clip' && args.slotKey) {
    const fromRegistry = args.slotGuidRegistry?.[args.slotKey];
    if (fromRegistry) return fromRegistry;
  }
  const reused = args.reuse.get(`${args.kind}\0${args.sourceIndex}`);
  if (reused) return reused;
  if (args.kind === 'mesh') return meshGuid(args.bareHash, args.sourceIndex);
  return subGuid(args.bareHash, args.kind, args.sourceIndex);
}

/**
 * Cook a clean engine `external-asset-package` meta from GLB bytes.
 * Returns structured success/failure (never throws on bad input).
 */
export async function cookExternalAssetMeta(
  glbBytes: Uint8Array,
  contentHash: string,
  source: string,
  options: CookOptions = {},
): Promise<CookResult> {
  const json = parseGlbJson(glbBytes);
  if (json === null) {
    return { ok: false, code: 'corrupt_glb', message: 'GLB header/JSON chunk is corrupt or not a GLB.' };
  }

  const required = json.extensionsRequired ?? [];
  const allow = new Set<string>(ENGINE_REQUIRED_EXTENSION_ALLOWLIST);
  const unsupported = required.filter((ext) => !allow.has(ext));
  if (unsupported.length > 0) {
    return {
      ok: false,
      code: 'engine_unsupported_extension',
      message: `GLB requires unsupported extensions: ${unsupported.join(', ')}. Normalize/decode before cooking.`,
      unsupportedExtensions: unsupported,
    };
  }

  // Decode guard: structurally broken GLBs (and any remaining undecodable
  // accessors) must not emit a fake-success meta.
  try {
    await new WebIO().readBinary(glbBytes);
  } catch (err) {
    return {
      ok: false,
      code: 'read_failed',
      message: err instanceof Error ? err.message : 'WebIO.readBinary failed',
    };
  }

  const meshes = json.meshes ?? [];
  if (meshes.length === 0) {
    return { ok: false, code: 'no_meshes', message: 'GLB has no meshes; engine external packages require ≥1 mesh.' };
  }

  const bareHash = contentHash.replace(/^sha256:/, '');
  const reuse = existingGuidMap(options.existingMeta);
  const subAssets: ExternalAssetSubAsset[] = [];

  const push = (kind: string, sourceIndex: number, name: string | undefined, slotKey?: string) => {
    subAssets.push({
      guid: resolveGuid({
        kind,
        sourceIndex,
        bareHash,
        reuse,
        slotKey,
        slotGuidRegistry: options.slotGuidRegistry,
      }),
      sourceIndex,
      kind,
      ...(name ? { name } : {}),
    });
  };

  meshes.forEach((mesh, i) => push('mesh', i, mesh.name));
  (json.materials ?? []).forEach((m, i) => push('material', i, m.name));
  (json.scenes ?? []).forEach((s, i) => push('scene', i, s.name));
  // TEX1: textures only from images[], never sidecar PNG/JPG.
  (json.images ?? []).forEach((img, i) => push('texture', i, img.name));
  // Engine emits skeleton + skin 1:1 from each glTF skin (parse-gltf.ts).
  (json.skins ?? []).forEach((skin, i) => {
    push('skeleton', i, skin.name);
    push('skin', i, skin.name);
  });
  (json.animations ?? []).forEach((anim, i) => {
    const slotKey = options.animationSlotKeys?.[i];
    push('animation-clip', i, anim.name ?? slotKey, slotKey);
  });

  return {
    ok: true,
    meta: {
      schemaVersion: 1,
      kind: 'external-asset-package',
      importer: 'gltf',
      source,
      importSettings: { defaultSceneIndex: json.scene ?? 0 },
      subAssets,
    },
  };
}

/**
 * Backward-compatible wrapper used by existing ai-asset call sites.
 * Maps structured failure → null (callers skip writing engine meta).
 */
export async function cookExternalAssetFields(
  glbBytes: Uint8Array,
  contentHash: string,
  source: string,
  options: CookOptions = {},
): Promise<ExternalAssetMeta | null> {
  const result = await cookExternalAssetMeta(glbBytes, contentHash, source, options);
  return result.ok ? result.meta : null;
}
