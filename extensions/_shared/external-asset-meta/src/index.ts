/// <reference path="./draco3dgltf.d.ts" />
export {
  ENGINE_REQUIRED_EXTENSION_ALLOWLIST,
  type CookErrorCode,
  type CookFailure,
  type CookOptions,
  type CookResult,
  type CookSuccess,
  type ExternalAssetMeta,
  type ExternalAssetSubAsset,
  type NormalizeErrorCode,
  type NormalizeFailure,
  type NormalizeResult,
  type NormalizeSuccess,
} from './types.ts';

export { cookExternalAssetFields, cookExternalAssetMeta } from './cook.ts';
export { normalizeGlbForEngine } from './normalize.ts';
