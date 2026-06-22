import type { IPipeline, PipelineMeta, PipelinePlacement } from './types'

/* ── Vite glob — eager metas, lazy modules ──────────────────────────
 *
 * `meta.ts` files are tiny pure-data modules and get pulled into the main
 * bundle synchronously: 8 pipelines × ~10 lines = trivial cost. They give
 * the host bridge / tab UI / agent manifest immediate access to pipeline
 * identity without paying for the heavy `index.ts` modules.
 *
 * `index.ts` is wrapped in a function that vite turns into `import()` — the
 * 5k-line pixel-char module + its transitive deps only loads when the user
 * (or an agent via `ce:switch-pipeline`) actually activates that pipeline.
 */
const metaModules = (import.meta as any).glob('../pipelines/*/meta.ts', { eager: true })
const indexLoaders = (import.meta as any).glob('../pipelines/*/index.ts')

/* ── Pure helpers (testable without import.meta.glob) ───────────── */

/**
 * 解析管线的顶栏显示位置。没声明时按 `'drawer'` 兜底——保证新写的
 * 管线不会无意间污染主干顶栏，必须显式标 `'main'` 才能上主 tab。
 */
export function resolvePlacement(meta: PipelineMeta): PipelinePlacement {
  return meta.placement ?? 'drawer'
}

/**
 * 按 placement 过滤元数据列表。`hidden` 管线只有显式传 `'hidden'` 才会
 * 返回——用于给 `getAgentManifest()` 做「智能体可见但 UI 不可见」的分类。
 */
export function filterByPlacement(metas: PipelineMeta[], placement: PipelinePlacement): PipelineMeta[] {
  return metas.filter(m => resolvePlacement(m) === placement)
}

/**
 * 给 workbench / 外部智能体消费的清单：只含发现能力用得到的字段。
 * 包括 `hidden` 管线——它们是给程序化调用的内部工具，智能体仍需要知道。
 */
export interface AgentPipelineEntry {
  id: string
  name: string
  icon: string
  description: string
  version: string
  placement: PipelinePlacement
  agentTags: string[]
  inputs: NonNullable<PipelineMeta['inputs']>
  outputs: NonNullable<PipelineMeta['outputs']>
}

export interface AgentManifest {
  pipelines: AgentPipelineEntry[]
}

export function toAgentManifest(metas: PipelineMeta[]): AgentManifest {
  return {
    pipelines: metas.map(m => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      description: m.description,
      version: m.version,
      placement: resolvePlacement(m),
      agentTags: m.agentTags ?? [],
      inputs: m.inputs ?? [],
      outputs: m.outputs ?? [],
    })),
  }
}

type ModuleLoader = () => Promise<{ default?: IPipeline }>

export class PipelineRegistry {
  private metas = new Map<string, PipelineMeta>()
  private loaders = new Map<string, ModuleLoader>()
  private loaded = new Map<string, IPipeline>()
  private inflight = new Map<string, Promise<IPipeline | undefined>>()

  constructor() {
    // 1) Eager metas: build slug → meta.
    const slugMeta = new Map<string, PipelineMeta>()
    for (const [path, mod] of Object.entries(metaModules)) {
      const slug = pipelineSlug(path)
      if (!slug) continue
      const meta = (mod as Record<string, unknown>).meta as PipelineMeta | undefined
      if (!meta?.id) {
        console.warn(`[PipelineRegistry] meta.ts missing 'meta' export: ${path}`)
        continue
      }
      slugMeta.set(slug, meta)
    }

    // 2) Lazy index: pair each loader with its sibling meta. Skip pipelines
    //    whose meta.id starts with `_` (template / internal).
    for (const [path, loader] of Object.entries(indexLoaders)) {
      const slug = pipelineSlug(path)
      if (!slug) continue
      const meta = slugMeta.get(slug)
      if (!meta) continue
      if (meta.id.startsWith('_')) continue
      this.metas.set(meta.id, meta)
      this.loaders.set(meta.id, loader as ModuleLoader)
    }
    console.log(`[PipelineRegistry] ${this.metas.size} pipeline meta(s) discovered (lazy-loaded)`)
  }

  /* ── Sync metadata APIs (used by tab UI + agent manifest) ────── */

  getAllMetas(): PipelineMeta[] {
    return [...this.metas.values()]
  }

  getMeta(id: string): PipelineMeta | undefined {
    return this.metas.get(id)
  }

  has(id: string): boolean {
    return this.metas.has(id)
  }

  ids(): string[] {
    return [...this.metas.keys()]
  }

  /** 按顶栏位置过滤元数据。详见 {@link filterByPlacement}。 */
  getByPlacement(placement: PipelinePlacement): PipelineMeta[] {
    return filterByPlacement(this.getAllMetas(), placement)
  }

  /** 给 workbench / 智能体消费的完整清单（含 hidden）。 */
  getAgentManifest(): AgentManifest {
    return toAgentManifest(this.getAllMetas())
  }

  /* ── Async loading (used when user activates a tab) ──────────── */

  /**
   * 懒加载并缓存指定管线模块。重复调用同一 id 会复用第一次的 promise,
   * 模块加载完成后所有调用拿到同一个 IPipeline 实例。
   */
  async load(id: string): Promise<IPipeline | undefined> {
    const cached = this.loaded.get(id)
    if (cached) return cached

    const pending = this.inflight.get(id)
    if (pending) return pending

    const loader = this.loaders.get(id)
    if (!loader) return undefined

    const promise = loader()
      .then(mod => {
        const pipeline = mod?.default
        if (!pipeline?.meta?.id) {
          console.warn(`[PipelineRegistry] index.ts missing valid default export for ${id}`)
          return undefined
        }
        this.loaded.set(id, pipeline)
        return pipeline
      })
      .catch(err => {
        console.error(`[PipelineRegistry] failed to load ${id}:`, err)
        return undefined
      })
      .finally(() => {
        this.inflight.delete(id)
      })

    this.inflight.set(id, promise)
    return promise
  }

  /** 已加载到内存的 pipeline 实例(同步,只在 `load()` 后才有值)。 */
  getLoaded(id: string): IPipeline | undefined {
    return this.loaded.get(id)
  }
}

function pipelineSlug(path: string): string | null {
  const m = path.match(/\/pipelines\/([^/]+)\/(meta|index)\.ts$/)
  return m ? m[1] : null
}
