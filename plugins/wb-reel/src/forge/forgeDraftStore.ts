import { create } from 'zustand'
import type { Outline } from '../llm/scenarioFlow'
import type { ScriptShapeReport } from './detectScriptShape'

/**
 * ForgeDraft —— 作者正在 Forge 页里敲的**草稿**。
 *
 * 为什么要独立 store（不走组件 useState）：
 *   作者粘完 5K 字剧本，立刻切到剧情树想看看之前的内容，回到 Forge 发现
 *   textarea 空了 —— 这是因为 ForgeTab 在 App.tsx 里条件渲染，切 tab 即 unmount，
 *   组件局部 state 随之销毁。
 *
 * 解决：把这几个草稿字段提到模块级 zustand store，并落到 localStorage，
 * 切 tab / 刷新 / 关页 全部保留。
 *
 * 落盘策略：手写 localStorage persist（不用 zustand/middleware/persist，
 * 因为仓库里其它 store 都没用 persist 中间件，保持一致性；同时避免引入
 * 额外 bundle 体积 + SSR 兼容坑）。
 *
 * v2 新增（多阶段 idea 流程）：
 *   flow.stage         —— 当前处于哪一步（idle/outlining/outlined/expanding/expanded/structuring）
 *   flow.outline       —— Stage A 产物（一句话→大纲），可空
 *   flow.perAct        —— Stage B 中每一幕的扩写文本（下标对齐 outline.acts），可部分完成
 *   flow.assembledScript —— Stage B 完成后拼好的剧本原文，交给 script-structurer
 *
 * 刷新恢复语义：
 *   作者扩写到第 2/3 幕时刷新，回来能看到前 2 幕已扩写完、Stage 卡在
 *   "expanding"、可以一键"继续"或"从头 reroll"。
 */

export type ForgeMode = 'idea' | 'script' | 'image'

export interface ScriptMeta {
  filename: string
  bytes: number
}

/**
 * idea 多阶段流程 state。
 *
 *   idle         刚打开，还没点"锻造"
 *   outlining    Stage A 进行中
 *   outlined     Stage A 已完成，outline 可见；作者此时可以"继续扩写"或"重 roll 大纲"
 *   expanding    Stage B 至少一幕在扩写
 *   expanded     Stage B 全部完成，assembledScript 可用；作者可以"继续结构化" / 整段改
 *   structuring  进入 forgeScenarioFromScript（结构化解析剧本树）
 *   done         整条链路结束，loadScenario 已写入 scenarioStore
 *   error        任何阶段失败；message 在本地 state 里（非 persist），此处只记最近 stage
 */
export type FlowStage =
  | 'idle'
  | 'outlining'
  | 'outlined'
  | 'expanding'
  | 'expanded'
  | 'structuring'
  | 'done'

export interface FlowState {
  stage: FlowStage
  /** Stage A 产物，可空 */
  outline: import('../llm/scenarioFlow').Outline | null
  /**
   * Stage B 各幕已扩写文本，下标对齐 outline.acts。
   * 进行中的幕留 null，完成的填字符串。
   */
  perAct: (string | null)[]
  /** Stage B 完成后拼好的剧本原文 —— 喂给 script-structurer 的实际输入 */
  assembledScript: string
}

const EMPTY_FLOW: FlowState = {
  stage: 'idle',
  outline: null,
  perAct: [],
  assembledScript: '',
}

interface ForgeDraftState {
  mode: ForgeMode
  idea: string
  script: string
  scriptMeta: ScriptMeta | null
  /** idea 多阶段流程（script 模式不使用） */
  flow: FlowState

  /**
   * 入口判别器报告 —— 仅 script 模式使用。
   *
   * 仅本次锻造会话内有效（**不持久化**）：
   *   - 作者一次性的"看到 → 决策 → 进入"动作，跨刷新意义不大
   *   - 持久化反而会让作者下次粘新剧本时看到旧报告，混淆
   *
   * 作者点"解析剧本树"时由 IdeaForge 调用 detectScriptShape() 计算并写入；
   * 选择完路径或取消后清空。
   */
  pendingShape: ScriptShapeReport | null
  /**
   * 作者已选择的下游路径 —— 用于 ScriptShapeConfirm 弹层 → IdeaForge.forge() 之间传值。
   * 五档语义：
   *   - 'p1-direct'      直通（已是结构化 / 强制按结构化跑）
   *   - 'p2-curate'      整理（重组不创作）
   *   - 'p3-expand'      扩写（小说体 → 交互式 beats 审阅）
   *   - 'p4-image'       图生种子 → idea 模式（暂时占位，Phase 5 落地）
   *   - 'goto-idea'      改去 idea 模式（兜底逃生口）
   *
   * 不持久化，理由同 pendingShape。
   */
  chosenPath: ChosenPath | null

  setMode: (m: ForgeMode) => void
  setIdea: (s: string) => void
  setScript: (s: string) => void
  setScriptMeta: (m: ScriptMeta | null) => void
  clearScript: () => void

  // flow 操作
  setFlowStage: (s: FlowStage) => void
  setOutline: (o: FlowState['outline']) => void
  setPerAct: (p: (string | null)[]) => void
  setPerActAt: (i: number, text: string | null) => void
  setAssembledScript: (s: string) => void
  resetFlow: () => void

  // 入口判别 · 路径选择
  setPendingShape: (r: ScriptShapeReport | null) => void
  setChosenPath: (p: ChosenPath | null) => void
  clearShapeChoice: () => void
}

/** 见 ForgeDraftState.chosenPath 字段注释。 */
export type ChosenPath =
  | 'p1-direct'
  | 'p2-curate'
  | 'p3-expand'
  | 'p4-image'
  | 'goto-idea'

const STORAGE_KEY = 'reel-studio:forge-draft:v2'

interface PersistedShape {
  version: 2
  mode: ForgeMode
  idea: string
  script: string
  scriptMeta: ScriptMeta | null
  flow: FlowState
}

const EMPTY: PersistedShape = {
  version: 2,
  mode: 'idea',
  idea: '',
  script: '',
  scriptMeta: null,
  flow: EMPTY_FLOW,
}

function loadInitial(): PersistedShape {
  if (typeof window === 'undefined') return EMPTY
  try {
    // v1 → v2 迁移：v1 没有 flow 字段，直接读它当历史一半，flow 用 EMPTY_FLOW
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const legacy = window.localStorage.getItem('reel-studio:forge-draft:v1')
      if (legacy) {
        const lv1 = JSON.parse(legacy) as Partial<
          Omit<PersistedShape, 'version' | 'flow'>
        >
        return {
          version: 2,
          mode: normalizeMode(lv1.mode),
          idea: typeof lv1.idea === 'string' ? lv1.idea : '',
          script: typeof lv1.script === 'string' ? lv1.script : '',
          scriptMeta:
            lv1.scriptMeta &&
            typeof lv1.scriptMeta === 'object' &&
            typeof lv1.scriptMeta.filename === 'string' &&
            typeof lv1.scriptMeta.bytes === 'number'
              ? lv1.scriptMeta
              : null,
          flow: EMPTY_FLOW,
        }
      }
      return EMPTY
    }
    const parsed = JSON.parse(raw) as Partial<PersistedShape>
    if (!parsed || parsed.version !== 2) return EMPTY
    return {
      version: 2,
      mode: normalizeMode(parsed.mode),
      idea: typeof parsed.idea === 'string' ? parsed.idea : '',
      script: typeof parsed.script === 'string' ? parsed.script : '',
      scriptMeta:
        parsed.scriptMeta &&
        typeof parsed.scriptMeta === 'object' &&
        typeof parsed.scriptMeta.filename === 'string' &&
        typeof parsed.scriptMeta.bytes === 'number'
          ? parsed.scriptMeta
          : null,
      flow: normalizeFlow(parsed.flow),
    }
  } catch {
    return EMPTY
  }
}

/** 防御：把磁盘上读到的 mode 归一化到合法值 —— v3 之前没有 'image'，要兼容 */
function normalizeMode(raw: unknown): ForgeMode {
  if (raw === 'script') return 'script'
  if (raw === 'image') return 'image'
  return 'idea'
}

/** 防御：磁盘数据形状坏掉时回 EMPTY_FLOW，避免整个 store 加载失败 */
function normalizeFlow(f: unknown): FlowState {
  if (!f || typeof f !== 'object') return EMPTY_FLOW
  const fo = f as Record<string, unknown>
  const stageRaw = fo.stage
  const stage: FlowStage =
    stageRaw === 'outlining' ||
    stageRaw === 'outlined' ||
    stageRaw === 'expanding' ||
    stageRaw === 'expanded' ||
    stageRaw === 'structuring' ||
    stageRaw === 'done'
      ? (stageRaw as FlowStage)
      : 'idle'
  return {
    stage,
    outline:
      fo.outline && typeof fo.outline === 'object'
        ? (fo.outline as FlowState['outline'])
        : null,
    perAct: Array.isArray(fo.perAct)
      ? (fo.perAct as unknown[]).map((v) =>
          typeof v === 'string' ? v : null,
        )
      : [],
    assembledScript:
      typeof fo.assembledScript === 'string' ? fo.assembledScript : '',
  }
}

function saveSnapshot(s: PersistedShape): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // 常见：QuotaExceeded —— 单人粘贴的剧本不太可能超 5MB，直接吞掉
  }
}

const initial = loadInitial()

export const useForgeDraftStore = create<ForgeDraftState>((set, get) => ({
  mode: initial.mode,
  idea: initial.idea,
  script: initial.script,
  scriptMeta: initial.scriptMeta,
  flow: initial.flow,

  // 非持久化字段（pendingShape / chosenPath）开始为 null —— 每次会话从零开始
  pendingShape: null,
  chosenPath: null,

  setMode: (m) => {
    set({ mode: m })
    persist(get)
  },
  setIdea: (s) => {
    set({ idea: s })
    persist(get)
  },
  setScript: (s) => {
    set({ script: s })
    persist(get)
  },
  setScriptMeta: (m) => {
    set({ scriptMeta: m })
    persist(get)
  },
  clearScript: () => {
    set({ script: '', scriptMeta: null })
    persist(get)
  },

  setFlowStage: (s) => {
    set({ flow: { ...get().flow, stage: s } })
    persist(get)
  },
  setOutline: (o) => {
    const prev = get().flow
    // 新 outline 落地时，perAct 要跟着 outline.acts 同步长度
    const nextPerAct =
      o && o.acts.length !== prev.perAct.length
        ? new Array<string | null>(o.acts.length).fill(null)
        : prev.perAct
    set({
      flow: {
        ...prev,
        outline: o,
        perAct: nextPerAct,
        assembledScript: '',
      },
    })
    persist(get)
  },
  setPerAct: (p) => {
    set({ flow: { ...get().flow, perAct: p } })
    persist(get)
  },
  setPerActAt: (i, text) => {
    const prev = get().flow.perAct
    const next = prev.slice()
    while (next.length <= i) next.push(null)
    next[i] = text
    set({ flow: { ...get().flow, perAct: next } })
    persist(get)
  },
  setAssembledScript: (s) => {
    set({ flow: { ...get().flow, assembledScript: s } })
    persist(get)
  },
  resetFlow: () => {
    set({ flow: EMPTY_FLOW })
    persist(get)
  },

  setPendingShape: (r) => {
    set({ pendingShape: r })
    // 不进 persist —— 这是会话内字段
  },
  setChosenPath: (p) => {
    set({ chosenPath: p })
    // 不进 persist —— 这是会话内字段
  },
  clearShapeChoice: () => {
    set({ pendingShape: null, chosenPath: null })
  },
}))

function persist(get: () => ForgeDraftState): void {
  const s = get()
  saveSnapshot({
    version: 2,
    mode: s.mode,
    idea: s.idea,
    script: s.script,
    scriptMeta: s.scriptMeta,
    flow: s.flow,
  })
}

/** 测试/调试专用：重置 store 到空态并清本地缓存 */
export function __resetForgeDraftForTest(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
      window.localStorage.removeItem('reel-studio:forge-draft:v1')
    } catch {
      // 测试环境 localStorage 可能是内存 mock，忽略
    }
  }
  useForgeDraftStore.setState({
    mode: 'idea',
    idea: '',
    script: '',
    scriptMeta: null,
    flow: EMPTY_FLOW,
    pendingShape: null,
    chosenPath: null,
  })
}

export const __FORGE_DRAFT_STORAGE_KEY__ = STORAGE_KEY
