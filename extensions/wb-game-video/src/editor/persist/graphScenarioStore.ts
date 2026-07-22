/**
 * 新引擎（graph）场景的**共享状态 store** —— 让「蓝图·新 / 实体 / 变量 / 规则 / 场景 / 试玩·新」
 * 这些并行视图共用**同一份 graph + 场景级 meta + 持久化**。
 *
 * 持久化模型（v6，单文件库）：SSOT = 原 scenario 形状 + `manifest`（含 main 与全部子蓝图）。
 * 落盘只写 `scenarios.graph.json`（+ 版本快照）；无 `sharedMeta` / `blueprints/` 文件夹。
 * 进入优先级：草稿 > 磁盘最新 > 内置 demo。
 */
import { create, useStore } from 'zustand'
import { temporal } from 'zundo'
import type { TemporalState, ZundoOptions } from 'zundo'
import type {
  BlueprintDoc, GameGraph, GameScenario, GraphLibraryDocument, GraphTextStylePreset, ScenarioMetaFields,
} from '../../runtime/schema/graph-schema'
import type { TextStyleGroup } from '../text/text-style'
import { loadStore, saveProject, saveDraft, clearDraft, loadVersion, loadDraft, type VersionEntry } from './persist-client'
import { computeGraphLayout } from '../../graph/edit/graph-layout'
import { normalizeSubFlowFields } from '../../graph/edit/graph-edit'
import { validateGraph } from '../../runtime/validate/validate'
import { ensureBuiltinSchemes } from '../demo/builtin-schemes'
import { recompileFormulaUsages } from '../shell/formulaApply'
import type { Formula } from './formula-authoring'
import { toEditorScenarioDocument, toRuntimeScenario } from './formula-authoring'
import {
  documentFromBlueprints, documentFromScenario, emptyBlueprintDoc, metaFromDocument,
  normalizeDocument, playDocument,
} from './blueprint-project'
import { resolveGraphEntry } from '../../runtime/schema/graph-schema'
import { blueprintsReferencing, findReferenceCycle } from '../../graph/edit/blueprint-refs'

/** 载入 demo / 文档时保证内置「通用样式」方案存在——用于 reset()/首次落座。 */
function withBuiltinSchemes<T extends GameScenario>(s: T): T {
  return {
    ...s,
    ui: { ...s.ui, overlays: ensureBuiltinSchemes(s.ui?.overlays) },
  } as T
}

/** 位置全 0（未布局）→ dagre 自动排一版；顺带归一遗留 subFlowRef——只对主图生效（子蓝图各自持有位置）。 */
function layoutIfUnset<T extends GameScenario>(s: T): T {
  const graph = normalizeSubFlowFields(s.graph)
  const base = graph === s.graph ? s : { ...s, graph }
  const allZero = base.graph.nodes.every((n) => !n.position || (n.position.x === 0 && n.position.y === 0))
  if (!allZero) return base as T
  const pos = computeGraphLayout(base.graph)
  return { ...base, graph: { ...base.graph, nodes: base.graph.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) } } as T
}

const EMPTY_GRAPH: GameGraph = { nodes: [], edges: [] }

/**
 * 取当前选中蓝图文档 —— 所有「读/写活跃蓝图图」的动作的唯一入口。缺失（activeBlueprintId
 * 无效/过期）时返回 undefined，调用方据此把 `graph` 缓存与 `blueprints` 一并 no-op，杜绝派生
 * `graph` 与真相 `blueprints` 脱钩（Task 8 增删蓝图 + 撤销时必踩的 desync 类，机制上关死）。
 */
function resolveActiveDoc(state: Pick<GraphScenarioStore, 'blueprints' | 'activeBlueprintId'>): BlueprintDoc | undefined {
  return state.blueprints[state.activeBlueprintId]
}

/** ui.overlays 缺失内置方案则补（作用于共享 meta，不覆盖已有）。 */
function withBuiltinSchemesMeta(m: ScenarioMetaFields): ScenarioMetaFields {
  return { ...m, ui: { ...m.ui, overlays: ensureBuiltinSchemes(m.ui?.overlays) } }
}

/**
 * 只挑「有值」的 meta 字段回填：草稿/磁盘常只带 graph，entities/variables 为 undefined——
 * 若原样使用，血条 bind 全空。不覆盖用户显式清空后的 `{}`。导出供回归测试直接验证（见
 * `__tests__/withDemoMetaFallback.test.ts`）。
 */
export function withDemoMetaFallback(m: ScenarioMetaFields, demo: GameScenario): ScenarioMetaFields {
  return {
    ...m,
    entities: m.entities ?? demo.entities,
    variables: m.variables ?? demo.variables,
  }
}

/** 主蓝图未布局则自动排版；根 meta 缺字段回落 demo；ui 方案补全。 */
function normalizeLoadedDocument(doc: GraphLibraryDocument, demo: GameScenario): GraphLibraryDocument {
  const normalized = normalizeDocument(doc)
  const mainId = normalized.manifest.mainPackId
  const main = normalized.manifest.packs[mainId]
  let blueprints = normalized.manifest.packs
  if (main) {
    const laid = layoutIfUnset({ version: 'wb-game-video.graph.v1', graph: main.graph } as GameScenario)
    if (laid.graph !== main.graph) {
      blueprints = { ...blueprints, [mainId]: { ...main, graph: laid.graph } }
    }
  }
  const meta = withBuiltinSchemesMeta(withDemoMetaFallback(metaFromDocument(normalized), demo))
  return documentFromBlueprints(blueprints, mainId, meta)
}

function isLibraryDocument(v: unknown): v is GraphLibraryDocument {
  const d = v as GraphLibraryDocument | null
  return !!d && typeof d === 'object' && !!d.manifest?.packs && typeof d.manifest.mainPackId === 'string'
}

/** 出厂 demo → 库文档。已是库文档则规范化；否则把根 graph 收成仅含 main 的 manifest。 */
function seedDocumentFromDemo(demo: GameScenario): GraphLibraryDocument {
  if (isLibraryDocument(demo)) return normalizeLoadedDocument(demo, demo)
  const laid = withBuiltinSchemes(layoutIfUnset(structuredClone(demo)))
  return documentFromScenario(toEditorScenarioDocument(laid)!)
}

interface GraphScenarioStore {
  game: string
  demo: GameScenario | null
  /** 蓝图库：id → 蓝图文档（主蓝图 + 全部子蓝图）。唯一真相，graph/authoringScenario 均由此派生。 */
  blueprints: Record<string, BlueprintDoc>
  /** 当前游戏入口蓝图 id。 */
  mainBlueprintId: string
  /** 当前编辑/选中的蓝图 id（库 UI 切换目标；未切换时=主蓝图）。 */
  activeBlueprintId: string
  /** 当前选中蓝图的图（= `blueprints[activeBlueprintId].graph`，随选中/编辑同步维护）。 */
  graph: GameGraph
  meta: ScenarioMetaFields
  versions: VersionEntry[]
  /** 当前基于的已保存版本 id（草稿态时仍指其基版本，供下拉高亮"当前"）。 */
  currentVersionId: string | null
  isDraft: boolean
  booted: boolean
  /** 每次「载入内容」（boot / 切版本 / 重置）自增；宿主据此清空撤销历史，避免撤销穿越版本。 */
  loadEpoch: number
  savedTip: string
  fitSignal: number
  runKey: number
  /** 当前选中的节点 id（跨视图共享：蓝图选中 → 视频/界面等据此编辑该节点）。 */
  selectedNodeId: string | null
  setSelectedNode: (id: string | null) => void
  /** 作者态完整文档（原 scenario + manifest，落盘/校验用）。 */
  authoringProject: () => GraphLibraryDocument
  /** 作者态完整文档（= authoringProject / GraphLibraryDocument），供编辑视图消费。 */
  authoringScenario: () => GraphLibraryDocument
  /** 去除 editor sidecar 后的执行场景（全量试玩 / 保存校验：根 graph=主蓝图）。 */
  scn: () => GameScenario
  /**
   * 编辑器内试玩：开跑图换为指定蓝图（默认当前选中）；依赖仍从 manifest.packs 解析。
   * 落盘不要用这个。
   */
  playScn: (rootBlueprintId?: string) => GameScenario
  /** 首次进入某 game 时载入（草稿>磁盘最新>demo）；已 boot 同 game 则跳过。 */
  ensureBoot: (game: string, demo: GameScenario) => void
  setGraph: (g: GameGraph | ((g: GameGraph) => GameGraph)) => void
  setMeta: (m: ScenarioMetaFields | ((m: ScenarioMetaFields) => ScenarioMetaFields)) => void
  /** 原子写回整份 scenario（graph + meta 一次 set，避免拆两次 set 产生额外历史步）；写主蓝图。 */
  setScenario: (s: GameScenario) => void
  /** 标记未保存草稿 + 防抖写盘（撤销/重做后调用，让恢复的状态也落草稿）。 */
  touchDraft: () => void
  /** 新增/覆盖一个用户自定义文字预设（按 subtitle/overlay 分组持久化）。 */
  addTextStylePreset: (group: TextStyleGroup, preset: GraphTextStylePreset) => void
  /** 删除一个用户自定义文字预设。 */
  removeTextStylePreset: (group: TextStyleGroup, presetId: string) => void
  /** 新建一个空子蓝图并选中它，返回新 id。 */
  createBlueprint: (title?: string) => string
  /** 重命名一个蓝图（主/子皆可）。 */
  renameBlueprint: (id: string, title: string) => void
  /** 删除一个子蓝图；主蓝图或仍被引用中的蓝图会被拦截。 */
  deleteBlueprint: (id: string) => { ok: boolean; blockedBy?: string[] }
  /** 切换当前编辑/选中的蓝图（库 UI 用）。 */
  selectBlueprint: (id: string) => void
  /** 改变游戏入口蓝图。 */
  setMainBlueprint: (id: string) => void
  /** 插入一个既有蓝图文档（不改变当前选中）——供画布内联新建子蓝图包（`subFlowPack` 容器）用。 */
  importBlueprint: (doc: BlueprintDoc) => void
  /** 改写指定蓝图的图（不要求它是当前选中）——供画布下钻编辑子蓝图包用。 */
  updateBlueprintGraph: (id: string, g: GameGraph | ((g: GameGraph) => GameGraph)) => void
  save: () => number
  pick: (value: string) => void
  reset: () => void
  applyLayout: () => void
  bumpRun: () => void
}

let draftTimer: ReturnType<typeof setTimeout> | null = null
const clearDraftTimer = () => { if (draftTimer) { clearTimeout(draftTimer); draftTimer = null } }

// ── 撤销/重做（zundo）─────────────────────────────────────────────────────────
/** 仅这两片进历史：蓝图库 + 场景级 meta（选中/草稿标记/版本索引/graph 缓存字段等瞬态不追踪）。 */
type TrackedState = Pick<GraphScenarioStore, 'blueprints' | 'meta'>
const HISTORY_LIMIT = 100
// 连续 set（拖拽每帧 / 连续打字）合并进同一步的时间窗；超过则另起一步。
const HISTORY_COALESCE_MS = 400
let historyLastAt = 0

const HISTORY_OPTIONS: ZundoOptions<GraphScenarioStore, TrackedState> = {
  partialize: (s): TrackedState => ({ blueprints: s.blueprints, meta: s.meta }),
  limit: HISTORY_LIMIT,
  equality: (a, b) => a.blueprints === b.blueprints && a.meta === b.meta,
  handleSet: (record) => (pastState, replace, currentState, deltaState) => {
    const ps = pastState as unknown as Partial<TrackedState>
    const cs = currentState as unknown as Partial<TrackedState>
    // 蓝图库/meta 没变 → 是瞬态 set（选中/草稿标记/graph 缓存/版本索引…），不占历史、不占合并窗。
    if (ps.blueprints === cs.blueprints && ps.meta === cs.meta) return
    const now = Date.now()
    if (now - historyLastAt < HISTORY_COALESCE_MS) return
    historyLastAt = now
    void deltaState
    record(pastState, replace)
  },
}

export const useGraphScenario = create<GraphScenarioStore>()(temporal((set, get) => {
  // 仅由真实编辑（setGraph/setMeta/蓝图库增删改）调用 → 标记未保存草稿 + 防抖写 localStorage 草稿。
  const scheduleDraft = () => {
    set({ isDraft: true })
    clearDraftTimer()
    draftTimer = setTimeout(() => saveDraft(get().authoringProject(), get().game), 800)
  }
  return {
    game: 'game-nodia-fighting',
    demo: null,
    blueprints: {},
    mainBlueprintId: '',
    activeBlueprintId: '',
    graph: EMPTY_GRAPH,
    meta: {},
    versions: [],
    currentVersionId: null,
    isDraft: false,
    booted: false,
    loadEpoch: 0,
    savedTip: '',
    fitSignal: 0,
    runKey: 0,
    selectedNodeId: null,
    setSelectedNode: (id) => set({ selectedNodeId: id }),

    authoringProject: () => {
      const { blueprints, mainBlueprintId, meta } = get()
      return documentFromBlueprints(blueprints, mainBlueprintId, meta)
    },
    authoringScenario: () => get().authoringProject(),
    scn: () => toRuntimeScenario(get().authoringScenario()),
    playScn: (rootBlueprintId) => {
      const st = get()
      const rootId = rootBlueprintId ?? st.activeBlueprintId
      return toRuntimeScenario(playDocument(st.authoringProject(), rootId))
    },

    ensureBoot: (game, demo) => {
      const st = get()
      if (st.booted && st.game === game) {
        // 已 boot：补 demo 引用；旧草稿曾把 entities 抹成 undefined 的，从 demo 填回 meta。
        let meta = st.meta
        let dirty = !st.demo
        if (meta.entities === undefined && demo.entities) {
          meta = { ...meta, entities: demo.entities }
          dirty = true
        }
        if (meta.variables === undefined && demo.variables) {
          meta = { ...meta, variables: demo.variables }
          dirty = true
        }
        if (dirty) set({ demo: st.demo ?? demo, meta })
        else if (!st.demo) set({ demo })
        return
      }
      set({ game, demo, booted: true })
      void loadStore(game).then((s) => {
        const applyDoc = (doc: GraphLibraryDocument, isDraftFlag: boolean) => {
          const norm = normalizeLoadedDocument(doc, demo)
          const mainId = norm.manifest.mainPackId
          set((cur) => ({
            blueprints: norm.manifest.packs,
            mainBlueprintId: mainId,
            activeBlueprintId: mainId,
            meta: metaFromDocument(norm),
            graph: norm.manifest.packs[mainId]?.graph ?? EMPTY_GRAPH,
            isDraft: isDraftFlag,
            versions: s.versions,
            currentVersionId: s.versions[0]?.id ?? null,
            loadEpoch: cur.loadEpoch + 1,
          }))
        }
        // 进入优先级：未保存草稿 > 磁盘最新文档 > demo。
        if (isLibraryDocument(s.draft)) {
          applyDoc(s.draft, true)
        } else if (isLibraryDocument(s.project)) {
          applyDoc(s.project, false)
        } else {
          const seed = seedDocumentFromDemo(demo)
          const mainId = seed.manifest.mainPackId
          set((cur) => ({
            blueprints: seed.manifest.packs,
            mainBlueprintId: mainId,
            activeBlueprintId: mainId,
            meta: metaFromDocument(seed),
            graph: seed.manifest.packs[mainId]?.graph ?? EMPTY_GRAPH,
            isDraft: false,
            versions: [],
            currentVersionId: null,
            loadEpoch: cur.loadEpoch + 1,
          }))
          void saveProject(seed, game).then((vs) => set({ versions: vs, currentVersionId: vs[0]?.id ?? null }))
        }
      })
    },

    setGraph: (g) => {
      let changed = false
      set((st) => {
        const doc = resolveActiveDoc(st)
        if (!doc) return {}
        changed = true
        const next = typeof g === 'function' ? (g as (x: GameGraph) => GameGraph)(doc.graph) : g
        // 删掉旧入口节点后把 doc.entry 钉到仍可跑的根节点，避免引用此蓝图时 runtime 炸。
        const entry = resolveGraphEntry(next, doc.entry) ?? doc.entry
        return {
          blueprints: { ...st.blueprints, [st.activeBlueprintId]: { ...doc, graph: next, entry } },
          graph: next,
        }
      })
      if (changed) scheduleDraft()
    },
    setScenario: (s) => {
      // 图编辑只会带回它实际改过的场景字段；与 setMeta 一样浅合并，避免没参与本次
      // 编辑的作者态（如 formulas）被纯 GameScenario 覆盖掉。显式清空字段走 setMeta。
      // `s.graph` = **当前选中蓝图**的图（视频 tab / 素材编辑），写回 activeBlueprintId，不是永远主蓝图。
      set((st) => {
        const activeId = st.activeBlueprintId
        const doc = st.blueprints[activeId]
        const entry = doc
          ? (resolveGraphEntry(s.graph, doc.entry) ?? doc.entry)
          : undefined
        const blueprints = doc
          ? { ...st.blueprints, [activeId]: { ...doc, graph: s.graph, entry: entry! } }
          : st.blueprints
        const meta = { ...st.meta, ...metaFromDocument(s) }
        return { blueprints, meta, graph: s.graph }
      })
      scheduleDraft()
    },
    touchDraft: () => scheduleDraft(),
    setMeta: (m) => {
      set((st) => {
        const nextMeta = typeof m === 'function' ? (m as (x: ScenarioMetaFields) => ScenarioMetaFields)(st.meta) : m
        // 公式库引用变化（增删改一条公式）→ 回溯重新编译所有「应用公式」处的 expr 缓存，让蓝图/时间轴里
        // 已经选好公式的字段跟着公式定义的最新改动走，且这一步并进同一次 undo 历史。遍历全部蓝图（主+子），
        // 不止当前编辑的那份——公式应用处可能藏在任意子蓝图的图里。
        if (nextMeta.formulas !== st.meta.formulas) {
          const formulas = nextMeta.formulas as Record<string, Formula> | undefined
          const recompiled = recompileFormulaUsages({ blueprints: st.blueprints, meta: nextMeta }, formulas, nextMeta.entities ?? st.meta.entities)
          return { blueprints: recompiled.blueprints, meta: recompiled.meta, graph: recompiled.blueprints[st.activeBlueprintId]?.graph ?? st.graph }
        }
        return { meta: nextMeta }
      })
      scheduleDraft()
    },
    addTextStylePreset: (group, preset) => {
      set((st) => {
        const presets = st.meta.textStylePresets ?? {}
        const list = (presets[group] ?? []).filter((p) => p.id !== preset.id)
        return { meta: { ...st.meta, textStylePresets: { ...presets, [group]: [...list, preset] } } }
      })
      scheduleDraft()
    },
    removeTextStylePreset: (group, presetId) => {
      set((st) => {
        const presets = st.meta.textStylePresets ?? {}
        const list = (presets[group] ?? []).filter((p) => p.id !== presetId)
        return { meta: { ...st.meta, textStylePresets: { ...presets, [group]: list } } }
      })
      scheduleDraft()
    },

    createBlueprint: (title) => {
      const doc = emptyBlueprintDoc({ title })
      set((st) => ({
        blueprints: { ...st.blueprints, [doc.id]: doc },
        activeBlueprintId: doc.id,
        graph: doc.graph,
        selectedNodeId: null,
        // 新建后框选进视口（子蓝图节点少，不 fit 会停在上一张大图的平移/缩放上）。
        fitSignal: st.fitSignal + 1,
      }))
      scheduleDraft()
      return doc.id
    },
    renameBlueprint: (id, title) => {
      let changed = false
      set((st) => {
        if (!st.blueprints[id]) return {}
        changed = true
        return { blueprints: { ...st.blueprints, [id]: { ...st.blueprints[id]!, title } } }
      })
      if (changed) scheduleDraft()
    },
    selectBlueprint: (id) => set((st) => {
      if (id === st.activeBlueprintId) return { selectedNodeId: null }
      return {
        activeBlueprintId: id,
        graph: st.blueprints[id]?.graph ?? EMPTY_GRAPH,
        selectedNodeId: null,
        fitSignal: st.fitSignal + 1,
      }
    }),
    setMainBlueprint: (id) => {
      let changed = false
      set((st) => {
        if (!st.blueprints[id] || st.mainBlueprintId === id) return {}
        changed = true
        return { mainBlueprintId: id }
      })
      if (changed) scheduleDraft()
    },
    deleteBlueprint: (id) => {
      const st = get()
      if (id === st.mainBlueprintId) return { ok: false, blockedBy: ['__main__'] }
      const refs = blueprintsReferencing(st.authoringProject(), id)
      if (refs.length) return { ok: false, blockedBy: refs }
      const next = { ...st.blueprints }
      delete next[id]
      const nextActive = st.activeBlueprintId === id ? st.mainBlueprintId : st.activeBlueprintId
      set({ blueprints: next, activeBlueprintId: nextActive, graph: next[nextActive]?.graph ?? EMPTY_GRAPH })
      scheduleDraft()
      return { ok: true }
    },
    importBlueprint: (doc) => {
      set((st) => ({ blueprints: { ...st.blueprints, [doc.id]: doc } }))
      scheduleDraft()
    },
    updateBlueprintGraph: (id, g) => {
      let changed = false
      set((st) => {
        const doc = st.blueprints[id]
        if (!doc) return {}
        changed = true
        const next = typeof g === 'function' ? (g as (x: GameGraph) => GameGraph)(doc.graph) : g
        const blueprints = { ...st.blueprints, [id]: { ...doc, graph: next } }
        return { blueprints, graph: id === st.activeBlueprintId ? next : st.graph }
      })
      if (changed) scheduleDraft()
    },

    save: () => {
      // 引用环是阻塞级错误（不同于下面 validateGraph 的非阻塞校验警示）：一旦落盘，运行时会
      // 无限下钻直到栈溢出，且没有回头路——必须在写盘前挡住，不留「已保存但坏了」的状态。
      const cycle = findReferenceCycle(get().authoringProject())
      if (cycle) {
        set({ savedTip: `保存被拦截 · 蓝图引用成环：${cycle.join(' → ')}` })
        return -1
      }
      clearDraftTimer()
      const scn = get().scn()
      const errs = validateGraph(scn.graph, {
        entities: Object.keys(scn.entities ?? {}),
        vars: Object.keys(scn.variables ?? {}),
      }).filter((i) => i.level === 'error')
      set({ isDraft: false, savedTip: errs.length ? `保存中 · ⚠ ${errs.length} 处校验错误` : '保存中…' })
      // 落盘（.forgeax/games/<slug>/game-video/），完成后用磁盘版本索引回填。
      void saveProject(get().authoringProject(), get().game).then((v) => {
        if (v.length === 0) {
          // PUT 失败时 persist-client 已保留草稿；回滚 isDraft，别骗用户「已保存」。
          set({ isDraft: true, savedTip: '保存失败 · 草稿仍在本地，请检查 /__graph__ 端点后重试' })
          return
        }
        set({
          versions: v,
          currentVersionId: v[0]?.id ?? null,
          savedTip: errs.length ? `已保存 · ⚠ ${errs.length} 处校验错误` : `已保存 ${new Date().toLocaleTimeString()}`,
        })
      })
      // eslint-disable-next-line no-console
      if (errs.length) console.warn('[graph validate] 保存时发现校验错误：', errs)
      return errs.length
    },

    pick: (value) => {
      // 从「未保存草稿」切到别的版本 → 提示会丢失。
      if (get().isDraft && value !== '__draft__' && typeof confirm === 'function') {
        if (!confirm('当前有未保存的修改，切换版本后会丢失。继续？')) return
      }
      const apply = (doc: GraphLibraryDocument | null) => {
        if (!isLibraryDocument(doc)) return
        clearDraftTimer()
        const demo = get().demo
        const norm = demo ? normalizeLoadedDocument(doc, demo) : normalizeDocument(doc)
        const mainId = norm.manifest.mainPackId
        set((st) => ({
          blueprints: norm.manifest.packs,
          mainBlueprintId: mainId,
          activeBlueprintId: mainId,
          meta: metaFromDocument(norm),
          graph: norm.manifest.packs[mainId]?.graph ?? EMPTY_GRAPH,
          isDraft: value === '__draft__',
          loadEpoch: st.loadEpoch + 1,
          ...(value !== '__draft__' ? { currentVersionId: value } : {}),
        }))
      }
      if (value === '__draft__') apply(loadDraft(get().game))
      else void loadVersion(value, get().game).then(apply)
    },

    // 重置：用内置 demo 替换当前内容（含全部子蓝图），清掉未保存草稿。要固化再点保存。
    reset: () => {
      const demo = get().demo
      if (!demo) return
      const seed = seedDocumentFromDemo(demo)
      const mainId = seed.manifest.mainPackId
      clearDraftTimer()
      clearDraft(get().game)
      set((st) => ({
        blueprints: seed.manifest.packs,
        mainBlueprintId: mainId,
        activeBlueprintId: mainId,
        meta: metaFromDocument(seed),
        graph: seed.manifest.packs[mainId]?.graph ?? EMPTY_GRAPH,
        isDraft: false,
        currentVersionId: null,
        savedTip: '已重置为 demo',
        fitSignal: st.fitSignal + 1,
        runKey: st.runKey + 1,
        loadEpoch: st.loadEpoch + 1,
      }))
    },

    applyLayout: () => {
      let changed = false
      set((st) => {
        const doc = resolveActiveDoc(st)
        // 活跃蓝图缺失 → 两片都 no-op（不能只刷 graph 缓存，否则 graph 与 blueprints 脱钩）。
        if (!doc) return {}
        changed = true
        const pos = computeGraphLayout(doc.graph)
        const next = { ...doc.graph, nodes: doc.graph.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) }
        return { blueprints: { ...st.blueprints, [st.activeBlueprintId]: { ...doc, graph: next } }, graph: next, fitSignal: st.fitSignal + 1 }
      })
      if (changed) scheduleDraft()
    },

    bumpRun: () => set((st) => ({ runKey: st.runKey + 1, savedTip: st.savedTip })),
  }
}, HISTORY_OPTIONS))

// ── 撤销/重做对外 API ─────────────────────────────────────────────────────────
/** 订阅撤销历史（past/future 深度等）；用于按钮 disabled 态。 */
export function useGraphHistory<T>(selector: (s: TemporalState<TrackedState>) => T): T {
  return useStore(useGraphScenario.temporal, selector)
}
/** undo/redo 只追踪 `{blueprints, meta}`；zundo 绕过我们的 action 直接 setState，这里手动把
 * 派生的 `graph` 缓存字段跟当前 `activeBlueprintId` 重新对齐，再落草稿。 */
function resyncGraphAfterHistoryJump(): void {
  const st = useGraphScenario.getState()
  useGraphScenario.setState({ graph: st.blueprints[st.activeBlueprintId]?.graph ?? EMPTY_GRAPH })
}
/** 撤销一步并把恢复后的状态落草稿。 */
export function graphUndo(): void {
  useGraphScenario.temporal.getState().undo()
  resyncGraphAfterHistoryJump()
  useGraphScenario.getState().touchDraft()
}
/** 重做一步并落草稿。 */
export function graphRedo(): void {
  useGraphScenario.temporal.getState().redo()
  resyncGraphAfterHistoryJump()
  useGraphScenario.getState().touchDraft()
}
/** 清空撤销历史（载入新内容后调用）。 */
export function graphHistoryClear(): void {
  historyLastAt = 0
  useGraphScenario.temporal.getState().clear()
}
