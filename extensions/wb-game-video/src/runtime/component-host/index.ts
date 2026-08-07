/**
 * component-host —— 「组件基建」SSOT（注册表宿主 + 每游戏组件加载器 + 宿主 API）。
 * 归属 runtime：来源/依赖/使用都在 runtime 层（只消费 registry / skins；被 editor+runtime 消费）。
 *
 * 分层（对齐 2026-07-22 game-package-storage-design D2/D5/D6/D10）：
 *   · **平台内建集**（`runtime/component-host/components` 的默认表现/交互/overlay 组件）——
 *     作为 built-in / fallback，永远先注册，保证运行时可用。
 *   · **公共组件** `runtime/component-host/components/`（真正跨游戏共享；现可空）。
 *   · **游戏专属组件** 住各游戏仓 `components/` → 构建产物 `dist/components/index.js`，
 *     运行时经 `loadGameComponents(slug)` 动态加载并注册（失败静默回落内建集）。
 *
 * 游戏组件包契约：`dist/components/index.js` 导出 `register(host)`，用宿主注入的
 * `ComponentHostApi`（含共享 React / 注册函数）挂组件与渲染器——游戏产物不自带 React
 * 副本，也不重复实现注册表。
 */
import * as React from 'react'
import { registerComponent, type ComponentDef } from '../registry/component-registry'
import { registerOverlayRenderer } from './rendererRegistry'
import { registerCoreSkins, INTERACTION_SKINS, HP_BAR_COMPONENTS, type SkinPositioning } from './components'

/** 交互皮肤登记项（编辑器下拉/定位查询用）。commons 内建 + 游戏仓贡献合并。 */
export interface InteractionSkinEntry {
  id: string
  label: string
  positioning: SkinPositioning
  defaultAnchor?: { x: number; y: number }
  defaultEvents: Array<{ id: string; label?: string; condition?: unknown }>
}

/** 血条类 overlay 登记项。 */
export interface HpBarEntry {
  id: string
  label: string
}

export interface ComponentHostApi {
  /** 共享 React（游戏产物 externalize react → 用这份，避免双实例）。 */
  React: typeof React
  registerComponent: (id: string, def: ComponentDef) => void
  registerOverlayRenderer: typeof registerOverlayRenderer
  /** 游戏可贡献交互皮肤元信息（进编辑器下拉/定位）。同 id 幂等。 */
  registerInteractionSkin: (entry: InteractionSkinEntry) => void
  /** 游戏可贡献血条组件元信息（进编辑器下拉）。同 id 幂等。 */
  registerHpBar: (entry: HpBarEntry) => void
}

// 游戏仓贡献的元信息（loadGameComponents 时经 register(host) 累积）；合并在 commons 内建之上。
const gameInteractionSkins: InteractionSkinEntry[] = []
const gameHpBars: HpBarEntry[] = []

/** 合并后的交互皮肤清单（commons 内建 + 游戏贡献）。编辑器由此派生下拉/定位，不再静态 import。 */
export function interactionSkins(): InteractionSkinEntry[] {
  return [...(INTERACTION_SKINS as InteractionSkinEntry[]), ...gameInteractionSkins]
}

/** 合并后的血条组件清单。 */
export function hpBarComponents(): HpBarEntry[] {
  return [...(HP_BAR_COMPONENTS as HpBarEntry[]), ...gameHpBars]
}

/** 皮肤定位类型（未知/未选→'fixed'）。 */
export function skinPositioning(id: string | undefined): SkinPositioning {
  return interactionSkins().find((s) => s.id === id)?.positioning ?? 'fixed'
}

/** point 皮肤默认锚点；无则 undefined。 */
export function skinDefaultAnchor(id: string | undefined): { x: number; y: number } | undefined {
  return interactionSkins().find((s) => s.id === id)?.defaultAnchor
}

export interface GameComponentModule {
  register?: (host: ComponentHostApi) => void
  default?: { register?: (host: ComponentHostApi) => void } | ((host: ComponentHostApi) => void)
}

function hostApi(): ComponentHostApi {
  return {
    React,
    registerComponent,
    registerOverlayRenderer,
    registerInteractionSkin: (entry) => {
      if (!gameInteractionSkins.some((s) => s.id === entry.id)) gameInteractionSkins.push(entry)
    },
    registerHpBar: (entry) => {
      if (!gameHpBars.some((s) => s.id === entry.id)) gameHpBars.push(entry)
    },
  }
}

let builtinsBooted = false
/** 注册平台内建组件集（幂等，永远先跑）。 */
export function registerBuiltins(): void {
  if (builtinsBooted) return
  builtinsBooted = true
  registerCoreSkins()
}

const loadedGames = new Set<string>()

function pickRegister(mod: GameComponentModule): ((host: ComponentHostApi) => void) | null {
  if (typeof mod.register === 'function') return mod.register
  if (typeof mod.default === 'function') return mod.default
  if (typeof mod.default === 'object' && typeof mod.default?.register === 'function') return mod.default.register
  return null
}

/**
 * 加载并注册某游戏仓的专属组件。**免构建优先**：
 *   1. dev —— 直接吃游戏仓 `components/index.tsx` **源码**，经扩展 vite 现场编译
 *      （`/@game-components/<slug>/index.js`，见 vite.config `gameComponentsDevPlugin`）；
 *   2. 构建产物（可选）—— `GET /api/game-host/games/:slug/components/index.js`（`dist/components`）；
 * 都拿不到 / 无 `register` → 静默 false，运行时继续用内建集（fail-soft）。
 * `base` 用于非同源场景显式指定源（dev 一般同源，留空即可）。
 */
export async function loadGameComponents(slug: string | undefined, base = ''): Promise<boolean> {
  if (!slug || loadedGames.has(slug)) return false
  loadedGames.add(slug)
  const s = encodeURIComponent(slug)
  const isDev = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV)
  const candidates = [
    ...(isDev ? [`${base}/@game-components/${s}/index.js`] : []),
    `${base}/api/game-host/games/${s}/components/index.js`,
  ]
  for (const url of candidates) {
    try {
      const mod = (await import(/* @vite-ignore */ url)) as GameComponentModule
      const reg = pickRegister(mod)
      if (reg) {
        reg(hostApi())
        return true
      }
    } catch {
      /* 未构建 / 无源码 / 加载失败 → 试下一个 */
    }
  }
  loadedGames.delete(slug)
  return false
}

/** Boot：先内建集（必成），再尽力加载游戏专属组件（可失败）。 */
export async function bootComponents(slug?: string): Promise<void> {
  registerBuiltins()
  await loadGameComponents(slug)
}
