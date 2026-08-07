import * as React from 'react'
import type { ComponentType } from 'react'
import type { ComponentDef } from '../../runtime/registry/component-registry'
import type { ComponentManifest } from '../../runtime/schema/node-config-schema'
import { getWorkbenchHost } from '../../lib/workbench-host'

interface ProjectComponentModule {
  // Project-owned modules are untyped ESM at this boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register?: (host: any) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default?: { register?: (host: any) => void } | ((host: any) => void)
}

export interface ProjectComponentAsset {
  source: 'project-component'
  componentId: string
  manifest: ComponentManifest
  renderer: ComponentType<Record<string, unknown>>
}

function projectComponentRegister<Host>(
  module: ProjectComponentModule,
): ((host: Host) => void) | null {
  if (typeof module.register === 'function') return module.register as (host: Host) => void
  if (typeof module.default === 'function') return module.default as (host: Host) => void
  if (typeof module.default === 'object' && typeof module.default?.register === 'function') {
    return module.default.register as (host: Host) => void
  }
  return null
}

async function importProjectComponentModule(): Promise<ProjectComponentModule | null> {
  let url: string | null
  try {
    url = getWorkbenchHost().gameComponents.moduleUrl('index.js')
  } catch {
    return null
  }
  if (!url) return null
  try {
    const module = (await import(/* @vite-ignore */ url)) as ProjectComponentModule
    return projectComponentRegister(module) ? module : null
  } catch {
    return null
  }
}

interface ProjectComponentCollector {
  React: typeof React
  registerComponent(id: string, definition: ComponentDef): void
  registerOverlayRenderer(
    id: string,
    renderer: ComponentType<Record<string, unknown>>,
    manifest?: ComponentManifest,
  ): void
  registerInteractionSkin(): void
  registerHpBar(): void
}

function manifestFromDefinition(id: string, definition: ComponentDef): ComponentManifest {
  return {
    id,
    ...(definition.label ? { label: definition.label } : {}),
    ...(definition.inputs?.length ? { inputs: definition.inputs } : {}),
    events: definition.events ?? [],
  }
}

export function collectProjectComponentAssets(module: ProjectComponentModule): ProjectComponentAsset[] {
  const pending = new Map<string, Partial<ProjectComponentAsset>>()
  const entryFor = (componentId: string): Partial<ProjectComponentAsset> => {
    let entry = pending.get(componentId)
    if (!entry) {
      entry = { source: 'project-component', componentId }
      pending.set(componentId, entry)
    }
    return entry
  }
  const collector: ProjectComponentCollector = {
    React,
    registerComponent(componentId, definition) {
      entryFor(componentId).manifest = manifestFromDefinition(componentId, definition)
    },
    registerOverlayRenderer(componentId, renderer, manifest) {
      const entry = entryFor(componentId)
      entry.renderer = renderer
      if (manifest) entry.manifest = manifest
    },
    registerInteractionSkin() {},
    registerHpBar() {},
  }
  projectComponentRegister<ProjectComponentCollector>(module)?.(collector)
  return [...pending.values()].filter((entry): entry is ProjectComponentAsset =>
    entry.source === 'project-component'
      && typeof entry.componentId === 'string'
      && entry.manifest != null
      && entry.renderer != null,
  )
}

export async function loadProjectComponentAssets(): Promise<ProjectComponentAsset[]> {
  const module = await importProjectComponentModule()
  return module ? collectProjectComponentAssets(module) : []
}
