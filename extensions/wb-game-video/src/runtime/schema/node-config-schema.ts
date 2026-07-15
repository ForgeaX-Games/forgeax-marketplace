/**
 * node-config-schema — 视频覆盖物类型 SSOT。
 *
 * 统一命名（HTML 心智）：
 * - **Overlay**：界面编辑器配好的可复用覆盖物（`children` = 包内组件）
 * - **OverlayNode**：演出节点上的 overlay 配置（含 `reactions` 作者 SSOT）
 * - **OverlayInstance**：运行态展开结果（不落盘）
 *
 * 视频上只能挂 overlay（经 OverlayNode），不能把裸组件直接贴视频。
 * 作者面：组件导出事件 → Overlay 聚合 → `reactions`（when/do）；边可由 goto 派生。
 *
 * 接入：`GameScenario.ui.overlays` / `NodeData.overlayNodes`。
 */

import type {
  EdgeRouting,
  GameEdge,
  GameGraph,
  GameNode,
  GameScenario,
  GraphCondition,
  GraphEffect,
  Trigger,
} from './graph-schema'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 组件导出契约（In · Events）
// ═══════════════════════════════════════════════════════════════════════════

/** State → 展示：常量或 `{ expr }`（声明式，无函数入库）。 */
export type BindValue = string | number | boolean | { expr: string }

/** 编辑器可渲染的输入槽（In）。 */
export interface ComponentInput {
  key: string
  label?: string
  valueType: 'string' | 'number' | 'boolean' | 'color' | 'bind' | 'json'
  required?: boolean
  default?: BindValue
  options?: { value: string; label: string }[]
}

/**
 * 组件对外抛出的事件（作者面）。
 * 运行时 submit / resolve → 归一成这些 id；≠ 图边条件。
 */
export interface ComponentEvent {
  id: string
  label?: string
  payload?: Record<string, 'string' | 'number' | 'boolean' | 'unknown'>
}

/**
 * 一张可复用组件的导出清单（注册表声明；不落盘到 OverlayChild）。
 * Overlay 聚合 `events` → 挂载 `reactions`（event 类）编辑。
 */
export interface ComponentManifest {
  /** = OverlayChild.component */
  id: string
  label?: string
  inputs?: ComponentInput[]
  events: ComponentEvent[]
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Reaction（作者 SSOT：when → do；瘦形态，无 scope/preempt）
// ═══════════════════════════════════════════════════════════════════════════

/** 闭合动作原语（改状态 / 跳转）。表现走 overlay 组件，不进动作袋。 */
export type NodeAction =
  | { kind: 'effect'; effects: GraphEffect[] }
  | { kind: 'goto'; targetNodeId: string }

/**
 * 触发面（闭合）——节点生命周期 + 事件 + 状态。effect 一律挂 reactions，按 `when` 绑到生命周期相位。
 * - enter：进入节点（演出开始）
 * - at(ms)：演出播到第 ms 毫秒
 * - exit：离开节点前
 * - complete：节点收尾自动推进（`if` 缺省 = 无条件）
 * - event：组件事件（挂 mount.reactions；do 仅 effect，走向由边）
 * - state：仅挂 scenario.reactions（硬打断 goto）；节点级不求值
 */
export type ReactionTrigger =
  | { type: 'enter' }
  | { type: 'at'; ms: number }
  | { type: 'exit' }
  | { type: 'complete'; if?: GraphCondition }
  | { type: 'event'; id: string }
  | { type: 'state'; condition: GraphCondition }

/**
 * 瘦 Reaction：when + do。作用域由挂载位置决定。
 * do 仅承载副作用（effect）；**走向由边负责**（state 类的 goto 例外，用于全局硬打断）。
 */
export interface Reaction {
  when: ReactionTrigger
  do: NodeAction[]
}

/** Overlay 聚合后的事件（编辑器下拉项）。 */
export interface OverlayEventRef {
  eventId: string
  mountId: string
  childId: string
  localEventId: string
  label?: string
  componentId: string
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Overlay + children（界面包）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 绝对定位排版（CSS inset 心智）—— overlay 内组件、挂载相对视频等共用。
 *
 * `number` = 相对父框的 0~1 比例（含负值，如 translateY: -0.5）；
 * 也可用 `'50%'` / `'12px'` 字符串。
 */
export type LayoutValue = number | `${number}%` | `${number}px`

export interface Layout {
  top?: LayoutValue
  right?: LayoutValue
  bottom?: LayoutValue
  left?: LayoutValue
  width?: LayoutValue
  height?: LayoutValue
  /** 自身偏移，对齐 CSS `transform: translate(...)` */
  translateX?: LayoutValue
  translateY?: LayoutValue
  /** 叠层顺序，对齐 CSS `z-index` */
  zIndex?: number
}

/**
 * Overlay 内一个 **组件实例**。
 * - `component`：唯一类型键（行为 + 皮均由此查注册表）
 * - layout：overlay 内排版与叠层（含 zIndex）
 * - trigger / window：出现时机
 * - params：玩法 / 表现入参（不含摆放）
 */
export interface OverlayChild {
  id: string
  /** 组件 id（注册表键）。 */
  component: string
  layout?: Layout
  trigger?: Trigger
  window?: { startMs?: number; endMs?: number }
  /**
   * 组件参数袋（In）。
   * 禁止：pos / layout / component（摆放用 layout 字段；component 用顶栏字段）
   */
  params?: Record<string, unknown>
  note?: string
}

/**
 * 一张可复用 **Overlay**。
 * 键 = `scenario.ui.overlays[id]`。`children.length === 1` 也合法。
 */
export interface Overlay {
  id: string
  title?: string
  children: OverlayChild[]
}

/** scenario.ui：overlay 目录。 */
export interface GameScenarioUi {
  overlays: Record<string, Overlay>
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. OverlayNode（节点上的 overlay 配置）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **OverlayNode** — 演出节点上的一份 overlay **挂载**（`NodeData.overlayNodes[]` 之一）。
 * - `id`：挂载键（多挂载时事件命名空间用）；缺省 = `overlay`
 * - `overlay`：引用哪张可复用 Overlay
 * - `layout`：整块相对视频画面（与组件 `layout` 同型 `Layout`；缺省铺满）
 * - `reactions`：本挂载 when→do（多为 event；边可由 goto 派生）
 *
 * 子组件内容（时机 / params）只改目录模板；挂载侧不补丁 child。
 */
export interface OverlayNode {
  /**
   * 挂载键。缺省 = `overlay`。
   * 同一节点多次挂同一张 overlay 时必须显式且唯一。
   */
  id?: string
  /** `scenario.ui.overlays` 中的 overlay id。 */
  overlay: string
  /** 整块相对本节点视频；缺省 = 铺满 `{ left:0, top:0, width:1, height:1 }`。 */
  layout?: Layout
  reactions?: Reaction[]
}

/** 挂载键：显式 id 优先，否则 overlay 目录 id。 */
export function overlayMountId(mount: OverlayNode): string {
  return mount.id ?? mount.overlay
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. OverlayInstance（运行态；不落盘）
// ═══════════════════════════════════════════════════════════════════════════

/** 展开后单个 child（由目录 OverlayChild 投影；不落盘）。 */
export interface OverlayInstanceChild {
  /**
   * 运行态 id：始终 `${source.mountId}/${source.childId}`（单挂载同样），避免跨挂载撞名。
   */
  id: string
  component: string
  trigger: Trigger
  window?: { startMs?: number; endMs?: number }
  layout?: Layout
  params: Record<string, unknown>
  /** 溯源：挂载 / 模板 / 目录 child / 节点。多挂载路由与 id 派生均依赖此字段。 */
  source: { mountId: string; overlayId: string; childId: string; nodeId: string }
}

/**
 * 一份挂载展开后的运行态信封（不落盘）。
 * 节点可有多份；调度扁平遍历各 instance 的 children。
 */
export interface OverlayInstance {
  mountId: string
  overlayId: string
  nodeId: string
  layout?: Layout
  children: OverlayInstanceChild[]
  reactions?: Reaction[]
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Demo（reactions 作者 SSOT；边可由 goto 派生对照）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * video → OverlayNode 挂上 overlay{ playerHp, bossHp, parry }
 * 扣血在 event reaction 的 effect；走向只靠边（无 goto）。
 */
export const OVERLAY_DEMO = {
  schemaVersion: 'wb-game-video.overlay.v1',
  rng: { seed: 42 },
  variables: {
    lastHit: { id: 'lastHit', initial: 0 },
  },
  entities: {
    'ent-player': {
      id: 'ent-player',
      name: '少主',
      attrs: { hp: 100, attack: 20, defense: 8 },
      attrMeta: { hp: { max: 100, initial: 100, label: '气血' } },
    },
    'ent-boss': {
      id: 'ent-boss',
      name: '刀狂',
      attrs: { hp: 120, attack: 24, defense: 10 },
      attrMeta: { hp: { max: 120, initial: 120, label: '气血' } },
    },
  },
  ui: {
    overlays: {
      battleHud: {
        id: 'battleHud',
        title: '战斗覆盖物（双血条 + 防反 + 飘字）',
        children: [
          {
            id: 'playerHp',
            component: 'battleHpBar',
            trigger: { when: 'enter' },
            params: { bind: 'ent-player', label: '少主' },
          },
          {
            id: 'bossHp',
            component: 'battleHpBar',
            trigger: { when: 'enter' },
            params: { bind: 'ent-boss', label: '刀狂' },
          },
          {
            id: 'parry',
            component: 'battleParry',
            layout: { left: 0.5, top: 0.5, translateX: -0.5, translateY: -0.5 },
            trigger: { when: 'at', ms: 1200 },
            params: {
              exits: [
                { key: 'A', label: '防反' },
                { key: 'B', label: '闪避' },
                { key: 'miss', label: '失手' },
              ],
              defaultKey: 'miss',
              timeoutMs: 900,
            },
          },
        ],
      } satisfies Overlay,
    },
  } satisfies GameScenarioUi,
  graph: {
    nodes: [
      {
        id: 'n-boss-slash',
        type: 'perf',
        position: { x: 0, y: 0 },
        data: {
          name: 'Boss 横斩',
          media: { kind: 'VIDEO', ref: 'difanggongjiqianyao' },
          durationMs: 3200,
          overlayNodes: [{
            overlay: 'battleHud',
            layout: { left: 0, top: 0, width: 1, height: 1 },
            reactions: [
              {
                when: { type: 'event', id: 'A' },
                do: [{
                  kind: 'effect',
                  effects: [
                    { kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: { expr: '-(entity.ent-player.attr.attack)' } } satisfies GraphEffect,
                    { kind: 'var', varId: 'lastHit', op: 'set', value: { expr: 'entity.ent-player.attr.attack' } } satisfies GraphEffect,
                  ],
                }],
              },
              {
                when: { type: 'event', id: 'miss' },
                do: [{
                  kind: 'effect',
                  effects: [
                    { kind: 'attr', entityId: 'ent-player', attr: 'hp', op: 'add', value: { expr: '-(entity.ent-boss.attr.attack)' } } satisfies GraphEffect,
                  ],
                }],
              },
            ],
          } satisfies OverlayNode],
        },
      },
      {
        id: 'n-counter',
        type: 'perf',
        position: { x: 280, y: -80 },
        data: {
          name: '防反追击',
          media: { kind: 'VIDEO', ref: 'fangfan' },
          overlayNodes: [{ overlay: 'battleHud' }],
        },
      },
      {
        id: 'n-dodge',
        type: 'perf',
        position: { x: 280, y: 40 },
        data: {
          name: '闪避后摇',
          media: { kind: 'VIDEO', ref: 'shanbi' },
          overlayNodes: [{ overlay: 'battleHud' }],
        },
      },
      {
        id: 'n-hurt',
        type: 'perf',
        position: { x: 280, y: 160 },
        data: {
          name: '受击',
          media: { kind: 'VIDEO', ref: 'shouji' },
          overlayNodes: [{ overlay: 'battleHud' }],
        },
      },
    ] as GameNode[],
    edges: [
      {
        id: 'e-A',
        source: 'n-boss-slash',
        target: 'n-counter',
        sourceHandle: 'A',
        targetHandle: 'in',
        data: { label: '防反成功' } satisfies EdgeRouting,
      },
      {
        id: 'e-B',
        source: 'n-boss-slash',
        target: 'n-dodge',
        sourceHandle: 'B',
        targetHandle: 'in',
        data: { label: '闪避' } satisfies EdgeRouting,
      },
      {
        id: 'e-miss',
        source: 'n-boss-slash',
        target: 'n-hurt',
        sourceHandle: 'miss',
        targetHandle: 'in',
        data: { label: '被砍中' } satisfies EdgeRouting,
      },
    ] as GameEdge[],
  } as GameGraph,
} as const satisfies Partial<GameScenario> & {
  ui: GameScenarioUi
  graph: GameGraph
}

/** n-boss-slash 展开 IR 示意（不落盘）。 */
export const OVERLAY_DEMO_INSTANCE: OverlayInstance = {
  mountId: 'battleHud',
  overlayId: 'battleHud',
  nodeId: 'n-boss-slash',
  layout: { left: 0, top: 0, width: 1, height: 1 },
  reactions: OVERLAY_DEMO.graph.nodes[0]!.data.overlayNodes![0]!.reactions,
  children: [
    {
      id: 'battleHud/playerHp',
      component: 'battleHpBar',
      trigger: { when: 'enter' },
      params: { bind: 'ent-player', label: '少主' },
      source: { mountId: 'battleHud', overlayId: 'battleHud', childId: 'playerHp', nodeId: 'n-boss-slash' },
    },
    {
      id: 'battleHud/bossHp',
      component: 'battleHpBar',
      trigger: { when: 'enter' },
      params: { bind: 'ent-boss', label: '刀狂' },
      source: { mountId: 'battleHud', overlayId: 'battleHud', childId: 'bossHp', nodeId: 'n-boss-slash' },
    },
    {
      id: 'battleHud/parry',
      component: 'battleParry',
      trigger: { when: 'at', ms: 1200 },
      layout: { left: 0.5, top: 0.5, translateX: -0.5, translateY: -0.5 },
      params: {
        exits: [
          { key: 'A', label: '防反' },
          { key: 'B', label: '闪避' },
          { key: 'miss', label: '失手' },
        ],
        defaultKey: 'miss',
        timeoutMs: 900,
      },
      source: { mountId: 'battleHud', overlayId: 'battleHud', childId: 'parry', nodeId: 'n-boss-slash' },
    },
  ],
}
