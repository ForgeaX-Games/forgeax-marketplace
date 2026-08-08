import type { ComponentType } from 'react'
import type { ComponentManifest } from '../../runtime/schema/node-config-schema'
import { pickComponentCatalog } from '../../runtime/component-host'
import { getWorkbenchHost } from '../../lib/workbench-host'

export interface ProjectComponentAsset {
  source: 'project-component'
  componentId: string
  manifest: ComponentManifest
  renderer: ComponentType<Record<string, unknown>>
}

async function importProjectComponentModule(): Promise<unknown | null> {
  let url: string | null
  try {
    url = getWorkbenchHost().gameComponents.moduleUrl('index.js')
  } catch {
    return null
  }
  if (!url) return null
  try {
    return await import(/* @vite-ignore */ url)
  } catch {
    return null
  }
}

/** 从 catalog 模块收集可预览的项目控件（须同时有 manifest + component）。 */
export function collectProjectComponentAssets(module: unknown): ProjectComponentAsset[] {
  const catalog = pickComponentCatalog(module)
  if (!catalog) return []
  return catalog.map(({ component, manifest }) => ({
    source: 'project-component' as const,
    componentId: manifest.id,
    manifest: manifest as unknown as ComponentManifest,
    renderer: component,
  }))
}

export async function loadProjectComponentAssets(): Promise<ProjectComponentAsset[]> {
  const module = await importProjectComponentModule()
  return module ? collectProjectComponentAssets(module) : []
}
