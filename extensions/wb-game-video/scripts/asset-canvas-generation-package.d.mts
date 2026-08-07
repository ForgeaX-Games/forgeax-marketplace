export const ASSET_CANVAS_PACKAGE: string
export const ASSET_CANVAS_VERSION: string
export const ASSET_CANVAS_DIRECTORY: string
export const ASSET_CANVAS_DEV_SPEC: string
export const GENERATION_EXPORT: {
  types: string
  import: string
}

export function createGenerationPackageManifest(): Record<string, unknown>
export function validateGenerationPackage(packagePath: string): Promise<string[]>
