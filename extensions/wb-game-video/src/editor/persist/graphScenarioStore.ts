/**
 * 新引擎（graph）场景的**共享状态 store** —— 让「蓝图·新 / 实体 / 变量 / 规则 / 场景 / 试玩·新」
 * 这些并行视图共用**同一份 graph + 场景级 meta + 持久化**（对齐旧系统 scenarioStore 被多视图共享）。
 *
 * 持久化模型不变（见 persist-client）：磁盘 scenarios.graph.json 只读原始；版本(最近5)+未保存草稿 → localStorage；
 * 保存写 localStorage 版本、不写盘；进入优先级 草稿 > 最新版本 > 磁盘原始 > 内置 demo。
 */
import { create, useStore } from 'zustand'
import { temporal } from 'zundo'
import type { TemporalState, ZundoOptions } from 'zundo'
import type { GameGraph, GameScenario, GraphTextStylePreset } from '../../runtime/schema/graph-schema'
import type { TextStyleGroup } from '../text/text-style'
import { loadStore, saveScenario, saveDraft, clearDraft, loadVersion, loadDraft, type VersionEntry } from './persist-client'
import { computeGraphLayout } from '../../graph/edit/graph-layout'
import { normalizeSubFlowFields } from '../../graph/edit/graph-edit'
import { validateGraph } from '../../runtime/validate/validate'
import { ensureBuiltinSchemes } from '../demo/builtin-schemes'

/** 载入任意 scenario 时保证内置「通用样式」方案存在。 */
function withBuiltinSchemes(s: GameScenario): GameScenario {
  return {
    ...s,
    ui: { ...s.ui, overlays: ensureBuiltinSchemes(s.ui?.overlays) },
  }
}

export type ScenarioMetaFields = Pick<GameScenario, 'variables' | 'entities' | 'ui' | 'rng' | 'reactions' | 'textStylePresets' | 'packs'>

/**
 * 只挑「有值」的 meta 字段。草稿/磁盘常只带 graph+ui，entities/variables 为 undefined——
 * 若原样写入 meta，`scn()` 里 `{...demo, ...meta}` 会把 demo 实体抹掉，血条 bind 全空。
 */
const pickMeta = (s: GameScenario): ScenarioMetaFields => {
  const m: ScenarioMetaFields = {}
  if (s.variables !== undefined) m.variables = s.variables
  if (s.entities !== undefined) m.entities = s.entities
  if (s.ui !== undefined) m.ui = s.ui
  if (s.rng !== undefined) m.rng = s.rng
  if (s.reactions !== undefined) m.reactions = s.reactions
  if (s.textStylePresets !== undefined) m.textStylePresets = s.textStylePresets
  if (s.packs !== undefined) m.packs = s.packs
  return m
}

/** 载入草稿/版本时：缺实体/变量则回落 demo（不覆盖用户显式清空后的 `{}`）。 */
function withDemoMetaFallback(s: GameScenario, demo: GameScenario): GameScenario {
  return {
    ...s,
    entities: s.entities ?? demo.entities,
    variables: s.variables ?? demo.variables,
    reactions: s.reactions ?? demo.reactions,
    rng: s.rng ?? demo.rng,
  }
}

const EMPTY_GRAPH: GameGraph = { nodes: [], edges: [] }

/** 合并 meta→完整 scenario：undefined 字段不覆盖 base（防草稿抹掉 demo 实体）。 */
export function mergeScenario(base: GameScenario, meta: ScenarioMetaFields, graph: GameGraph): GameScenario {
  const out: GameScenario = { ...base, graph }
  if (meta.variables !== undefined) out.variables = meta.variables
  if (meta.entities !== undefined) out.entities = meta.entities
  if (meta.ui !== undefined) out.ui = meta.ui
  if (meta.rng !== undefined) out.rng = meta.rng
  if (meta.reactions !== undefined) out.reactions = meta.reactions
  if (meta.textStylePresets !== undefined) out.textStylePresets = meta.textStylePresets
  if (meta.packs !== undefined) out.packs = meta.packs
  return out
}

/** 位置全 0（未布局）→ dagre 自动排一版；顺带归一遗留 subFlowRef。 */
function layoutIfUnset(s: GameScenario): GameScenario {
  const graph = normalizeSubFlowFields(s.graph)
  const base = graph === s.graph ? s : { ...s, graph }
  const allZero = base.graph.nodes.every((n) => !n.position || (n.position.x === 0 && n.position.y === 0))
  if (!allZero) return base
  const pos = computeGraphLayout(base.graph)
  return { ...base, graph: { ...base.graph, nodes: base.graph.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) } }
}

interface GraphScenarioStore {
  game: string
  demo: GameScenario | null
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
  /** 合并出完整 scenario（保存/试玩用）。 */
  scn: () => GameScenario
  /** 首次进入某 game 时载入（草稿>最新版本>磁盘原始>demo）；已 boot 同 game 则跳过。 */
  ensureBoot: (game: string, demo: GameScenario) => void
  setGraph: (g: GameGraph | ((g: GameGraph) => GameGraph)) => void
  setMeta: (m: ScenarioMetaFields | ((m: ScenarioMetaFields) => ScenarioMetaFields)) => void
  /** 原子写回整份 scenario（graph + meta 一次 set，避免拆两次 set 产生额外历史步）。 */
  setScenario: (s: GameScenario) => void
  /** 标记未保存草稿 + 防抖写盘（撤销/重做后调用，让恢复的状态也落草稿）。 */
  touchDraft: () => void
  /** 新增/覆盖一个用户自定义文字预设（按 subtitle/overlay 分组持久化）。 */
  addTextStylePreset: (group: TextStyleGroup, preset: GraphTextStylePreset) => void
  /** 删除一个用户自定义文字预设。 */
  removeTextStylePreset: (group: TextStyleGroup, presetId: string) => void
  save: () => number
  pick: (value: string) => void
  reset: () => void
  applyLayout: () => void
  bumpRun: () => void
}

let draftTimer: ReturnType<typeof setTimeout> | null = null
const clearDraftTimer = () => { if (draftTimer) { clearTimeout(draftTimer); draftTimer = null } }

// ── 撤销/重做（zundo）─────────────────────────────────────────────────────────
/** 仅这两片进历史：图 + 场景级 meta（选中/草稿标记/版本索引等瞬态不追踪）。 */
type TrackedState = Pick<GraphScenarioStore, 'graph' | 'meta'>
const HISTORY_LIMIT = 100
// 连续 set（拖拽每帧 / 连续打字）合并进同一步的时间窗；超过则另起一步。
const HISTORY_COALESCE_MS = 400
let historyLastAt = 0

const HISTORY_OPTIONS: ZundoOptions<GraphScenarioStore, TrackedState> = {
  partialize: (s): TrackedState => ({ graph: s.graph, meta: s.meta }),
  limit: HISTORY_LIMIT,
  equality: (a, b) => a.graph === b.graph && a.meta === b.meta,
  handleSet: (record) => (pastState, replace, currentState, deltaState) => {
    const ps = pastState as unknown as Partial<TrackedState>
    const cs = currentState as unknown as Partial<TrackedState>
    // 图/meta 没变 → 是瞬态 set（isDraft / savedTip / selectedNodeId / versions…），不占历史、不占合并窗。
    if (ps.graph === cs.graph && ps.meta === cs.meta) return
    const now = Date.now()
    if (now - historyLastAt < HISTORY_COALESCE_MS) return
    historyLastAt = now
    void deltaState
    record(pastState, replace)
  },
}

export const useGraphScenario = create<GraphScenarioStore>()(temporal((set, get) => {
  // 仅由真实编辑（setGraph/setMeta）调用 → 标记未保存草稿 + 防抖写 localStorage 草稿。
  const scheduleDraft = () => {
    set({ isDraft: true })
    clearDraftTimer()
    draftTimer = setTimeout(() => saveDraft(get().scn(), get().game), 800)
  }
  return {
    game: 'game-nodia-fighting',
    demo: null,
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

    scn: () => {
      const { demo, meta, graph } = get()
      const base = demo ?? ({ schemaVersion: 'wb-game-video.graph.v1', graph: EMPTY_GRAPH } as GameScenario)
      return mergeScenario(base, meta, graph)
    },

    ensureBoot: (game, demo) => {
      const st = get()
      if (st.booted && st.game === game) {
        // 已 boot：补 demo 引用；旧草稿曾把 entities 抹成 undefined 的，从 demo 填回 meta。
        const meta = { ...st.meta }
        let dirty = !st.demo
        if (meta.entities === undefined && demo.entities) {
          meta.entities = demo.entities
          dirty = true
        }
        if (meta.variables === undefined && demo.variables) {
          meta.variables = demo.variables
          dirty = true
        }
        if (dirty) set({ demo: st.demo ?? demo, meta })
        else if (!st.demo) set({ demo })
        return
      }
      set({ game, demo, booted: true })
      void loadStore(game).then((s) => {
        // 进入优先级：未保存草稿(localStorage) > 磁盘最新已保存版本 > demo（出厂只读原始）。
        if (s.draft?.graph) {
          const laid = withBuiltinSchemes(layoutIfUnset(withDemoMetaFallback(s.draft, demo)))
          set((st) => ({ graph: laid.graph, meta: pickMeta(laid), isDraft: true, versions: s.versions, currentVersionId: s.versions[0]?.id ?? null, loadEpoch: st.loadEpoch + 1 }))
        } else if (s.scenario?.graph) {
          const laid = withBuiltinSchemes(layoutIfUnset(withDemoMetaFallback(s.scenario, demo)))
          set((st) => ({ graph: laid.graph, meta: pickMeta(laid), isDraft: false, versions: s.versions, currentVersionId: s.versions[0]?.id ?? null, loadEpoch: st.loadEpoch + 1 }))
        } else {
          // 首次（无草稿、磁盘也没有）→ 用 demo 打底，并把它作为第一个版本落盘。
          const laid = withBuiltinSchemes(layoutIfUnset(structuredClone(demo)))
          set((st) => ({ graph: laid.graph, meta: pickMeta(laid), isDraft: false, versions: [], currentVersionId: null, loadEpoch: st.loadEpoch + 1 }))
          void saveScenario(laid, game).then((vs) => set({ versions: vs, currentVersionId: vs[0]?.id ?? null }))
        }
      })
    },

    setGraph: (g) => {
      set((st) => ({ graph: typeof g === 'function' ? (g as (x: GameGraph) => GameGraph)(st.graph) : g }))
      scheduleDraft()
    },
    setScenario: (s) => {
      set({ graph: s.graph, meta: pickMeta(s) })
      scheduleDraft()
    },
    touchDraft: () => scheduleDraft(),
    setMeta: (m) => {
      set((st) => ({ meta: typeof m === 'function' ? (m as (x: ScenarioMetaFields) => ScenarioMetaFields)(st.meta) : m }))
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

    save: () => {
      clearDraftTimer()
      const scn = get().scn()
      const errs = validateGraph(scn.graph, {
        entities: Object.keys(scn.entities ?? {}),
        vars: Object.keys(scn.variables ?? {}),
        reactions: scn.reactions,
      }).filter((i) => i.level === 'error')
      set({ isDraft: false, savedTip: errs.length ? `保存中 · ⚠ ${errs.length} 处校验错误` : '保存中…' })
      // 落盘（.forgeax/games/<slug>/game-video/），完成后用磁盘版本索引回填。
      void saveScenario(scn, get().game).then((v) => {
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
      const apply = (s: GameScenario | null) => {
        if (!s?.graph) return
        clearDraftTimer()
        const laid = withBuiltinSchemes(layoutIfUnset(s))
        // 载入已保存版本 → 非草稿 + 记为当前版本；载入草稿 → 仍是草稿。
        set((st) => ({ graph: laid.graph, meta: pickMeta(laid), isDraft: value === '__draft__', loadEpoch: st.loadEpoch + 1, ...(value !== '__draft__' ? { currentVersionId: value } : {}) }))
      }
      if (value === '__draft__') apply(loadDraft(get().game))
      else void loadVersion(value, get().game).then(apply) // 版本快照在磁盘
    },

    // 重置：用内置 demo 替换当前内容，清掉未保存草稿，回到"干净"（非草稿）状态。要固化再点保存。
    reset: () => {
      const demo = get().demo
      if (!demo) return
      const d = withBuiltinSchemes(layoutIfUnset(structuredClone(demo)))
      clearDraftTimer()
      clearDraft(get().game)
      set((st) => ({ graph: d.graph, meta: pickMeta(d), isDraft: false, currentVersionId: null, savedTip: '已重置为 demo', fitSignal: st.fitSignal + 1, runKey: st.runKey + 1, loadEpoch: st.loadEpoch + 1 }))
    },

    applyLayout: () => {
      const pos = computeGraphLayout(get().graph)
      set((st) => ({ graph: { ...st.graph, nodes: st.graph.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) }, fitSignal: st.fitSignal + 1 }))
      scheduleDraft()
    },

    bumpRun: () => set((st) => ({ runKey: st.runKey + 1, savedTip: st.savedTip })),
  }
}, HISTORY_OPTIONS))

// ── 撤销/重做对外 API ─────────────────────────────────────────────────────────
/** 订阅撤销历史（past/future 深度等）；用于按钮 disabled 态。 */
export function useGraphHistory<T>(selector: (s: TemporalState<TrackedState>) => T): T {
  return useStore(useGraphScenario.temporal, selector)
}
/** 撤销一步并把恢复后的状态落草稿。 */
export function graphUndo(): void {
  useGraphScenario.temporal.getState().undo()
  useGraphScenario.getState().touchDraft()
}
/** 重做一步并落草稿。 */
export function graphRedo(): void {
  useGraphScenario.temporal.getState().redo()
  useGraphScenario.getState().touchDraft()
}
/** 清空撤销历史（载入新内容后调用）。 */
export function graphHistoryClear(): void {
  historyLastAt = 0
  useGraphScenario.temporal.getState().clear()
}
