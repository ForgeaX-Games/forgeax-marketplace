/** Engine external-asset-package meta shape (clean; no plugin-private fields). */

export interface ExternalAssetSubAsset {
  readonly guid: string;
  readonly sourceIndex: number;
  readonly kind: string;
  readonly name?: string;
}

export interface ExternalAssetMeta {
  schemaVersion: 1;
  kind: 'external-asset-package';
  importer: 'gltf';
  source?: string;
  importSettings: {
    defaultSceneIndex?: number;
    diagnostics?: {
      nodeNames: ReadonlyArray<string>;
      unsupportedExtensions: ReadonlyArray<string>;
      matrixTrsCoexistNodes: ReadonlyArray<string>;
    };
    colorSpace?: 'srgb' | 'linear';
    mipmap?: 'auto' | 'none';
  };
  subAssets: ReadonlyArray<ExternalAssetSubAsset>;
}

/** Engine v1 required-extension allowlist (gltf khr-extensions.test). */
export const ENGINE_REQUIRED_EXTENSION_ALLOWLIST = ['EXT_mesh_gpu_instancing'] as const;

export type CookErrorCode =
  | 'corrupt_glb'
  | 'no_meshes'
  | 'engine_unsupported_extension'
  | 'read_failed';

export interface CookSuccess {
  readonly ok: true;
  readonly meta: ExternalAssetMeta;
}

export interface CookFailure {
  readonly ok: false;
  readonly code: CookErrorCode;
  readonly message: string;
  readonly unsupportedExtensions?: ReadonlyArray<string>;
}

export type CookResult = CookSuccess | CookFailure;

export interface CookOptions {
  /** Previously written clean engine meta — reuse GUIDs by (kind, sourceIndex). */
  readonly existingMeta?: ExternalAssetMeta | null;
  /**
   * Semantic GUID registry for animation-clip rows (slotKey → guid).
   * When `animationSlotKeys[i]` is set, prefer registry[slotKey] over
   * existingMeta / deterministic hash for that clip's GUID.
   */
  readonly slotGuidRegistry?: Readonly<Record<string, string>>;
  /** Parallel to glTF animations[] order; entry may be undefined/omitted. */
  readonly animationSlotKeys?: ReadonlyArray<string | undefined>;
}

export type NormalizeErrorCode =
  | 'corrupt_glb'
  | 'decode_failed'
  | 'write_failed';

export interface NormalizeSuccess {
  readonly ok: true;
  readonly bytes: Uint8Array;
  /** True when input already had no required Draco / was rewritten. */
  readonly changed: boolean;
}

export interface NormalizeFailure {
  readonly ok: false;
  readonly code: NormalizeErrorCode;
  readonly message: string;
}

export type NormalizeResult = NormalizeSuccess | NormalizeFailure;
