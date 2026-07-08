/**
 * 新引擎（graph）场景的**共享状态 store** —— 让「蓝图·新 / 实体 / 变量 / 规则 / 场景 / 试玩·新」
 * 这些并行视图共用**同一份 graph + 场景级 meta + 持久化**（对齐旧系统 scenarioStore 被多视图共享）。
 *
 * 持久化模型不变（见 persist-client）：磁盘 scenarios.graph.json 只读原始；版本(最近5)+未保存草稿 → localStorage；
 * 保存写 localStorage 版本、不写盘；进入优先级 草稿 > 最新版本 > 磁盘原始 > 内置 demo。
 */
import { create } from 'zustand'
import type { GameGraph, GameScenario, GraphTextStylePreset } from './graph-schema'
import type { TextStyleGroup } from './text-style'
import { loadStore, saveScenario, saveDraft, clearDraft, loadVersion, loadDraft, type VersionEntry } from './persist-client'
import { computeGraphLayout } from './graph-layout'
import { validateGraph } from './validate'

export type ScenarioMetaFields = Pick<GameScenario, 'variables' | 'entities' | 'ui' | 'rng' | 'rules' | 'textStylePresets'>

const pickMeta = (s: GameScenario): ScenarioMetaFields => ({ variables: s.variables, entities: s.entities, ui: s.ui, rng: s.rng, rules: s.rules, textStylePresets: s.textStylePresets })
const EMPTY_GRAPH: GameGraph = { nodes: [], edges: [] }

/** 位置全 0（未布局）→ dagre 自动排一版。 */
function layoutIfUnset(s: GameScenario): GameScenario {
  const allZero = s.graph.nodes.every((n) => !n.position || (n.position.x === 0 && n.position.y === 0))
  if (!allZero) return s
  const pos = computeGraphLayout(s.graph)
  return { ...s, graph: { ...s.graph, nodes: s.graph.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) } }
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
  savedTip: string
  fitSignal: number
  runKey: number
  /** 合并出完整 scenario（保存/试玩用）。 */
  scn: () => GameScenario
  /** 首次进入某 game 时载入（草稿>最新版本>磁盘原始>demo）；已 boot 同 game 则跳过。 */
  ensureBoot: (game: string, demo: GameScenario) => void
  setGraph: (g: GameGraph | ((g: GameGraph) => GameGraph)) => void
  setMeta: (m: ScenarioMetaFields | ((m: ScenarioMetaFields) => ScenarioMetaFields)) => void
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

export const useGraphScenario = create<GraphScenarioStore>((set, get) => {
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
    savedTip: '',
    fitSignal: 0,
    runKey: 0,

    scn: () => {
      const { demo, meta, graph } = get()
      const base = demo ?? ({ schemaVersion: 'wb-game-video.graph.v1', graph: EMPTY_GRAPH } as GameScenario)
      return { ...base, ...meta, graph }
    },

    ensureBoot: (game, demo) => {
      const st = get()
      if (st.booted && st.game === game) {
        if (!st.demo) set({ demo })
        return
      }
      set({ game, demo, booted: true })
      void loadStore(game).then((s) => {
        // 进入优先级：未保存草稿 > 最新版本 > demo（出厂只读原始）。game 目录不参与回落。
        if (s.draft?.graph) {
          const laid = layoutIfUnset(s.draft)
          set({ graph: laid.graph, meta: pickMeta(laid), isDraft: true, versions: s.versions, currentVersionId: s.versions[0]?.id ?? null })
        } else if (s.latestVersion?.graph) {
          const laid = layoutIfUnset(s.latestVersion)
          set({ graph: laid.graph, meta: pickMeta(laid), isDraft: false, versions: s.versions, currentVersionId: s.versions[0]?.id ?? null })
        } else {
          // 首次（无草稿无版本）→ 用 demo 作第一个版本（localStorage）。
          const laid = layoutIfUnset(structuredClone(demo))
          const vs = saveScenario(laid, game)
          set({ graph: laid.graph, meta: pickMeta(laid), isDraft: false, versions: vs, currentVersionId: vs[0]?.id ?? null })
        }
      })
    },

    setGraph: (g) => {
      set((st) => ({ graph: typeof g === 'function' ? (g as (x: GameGraph) => GameGraph)(st.graph) : g }))
      scheduleDraft()
    },
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
        rules: scn.rules,
      }).filter((i) => i.level === 'error')
      const v = saveScenario(scn, get().game)
      set({ versions: v, currentVersionId: v[0]?.id ?? null, isDraft: false, savedTip: errs.length ? `已保存 · ⚠ ${errs.length} 处校验错误` : `已保存 ${new Date().toLocaleTimeString()}` })
      // eslint-disable-next-line no-console
      if (errs.length) console.warn('[graph validate] 保存时发现校验错误：', errs)
      return errs.length
    },

    pick: (value) => {
      // 从「未保存草稿」切到别的版本 → 提示会丢失。
      if (get().isDraft && value !== '__draft__' && typeof confirm === 'function') {
        if (!confirm('当前有未保存的修改，切换版本后会丢失。继续？')) return
      }
      const s = value === '__draft__' ? loadDraft(get().game) : loadVersion(value, get().game)
      if (s?.graph) {
        clearDraftTimer()
        const laid = layoutIfUnset(s)
        // 载入已保存版本 → 非草稿 + 记为当前版本；载入草稿 → 仍是草稿。
        set({ graph: laid.graph, meta: pickMeta(laid), isDraft: value === '__draft__', ...(value !== '__draft__' ? { currentVersionId: value } : {}) })
      }
    },

    // 重置：用内置 demo 替换当前内容，清掉未保存草稿，回到"干净"（非草稿）状态。要固化再点保存。
    reset: () => {
      const demo = get().demo
      if (!demo) return
      const d = layoutIfUnset(structuredClone(demo))
      clearDraftTimer()
      clearDraft(get().game)
      set((st) => ({ graph: d.graph, meta: pickMeta(d), isDraft: false, currentVersionId: null, savedTip: '已重置为 demo', fitSignal: st.fitSignal + 1, runKey: st.runKey + 1 }))
    },

    applyLayout: () => {
      const pos = computeGraphLayout(get().graph)
      set((st) => ({ graph: { ...st.graph, nodes: st.graph.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) }, fitSignal: st.fitSignal + 1 }))
      scheduleDraft()
    },

    bumpRun: () => set((st) => ({ runKey: st.runKey + 1, savedTip: st.savedTip })),
  }
})
