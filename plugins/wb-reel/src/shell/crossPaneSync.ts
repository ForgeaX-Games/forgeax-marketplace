import {
  useShellStore,
  type ShellTab,
  type ForgeView,
  type ImageSection,
} from './shellStore'
import {
  useForgeStudioStore,
  type StudioTab,
} from '../forge/studio/forgeStudioStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import type { Scenario } from '../scenario/types'

/**
 * crossPaneSync —— 在 forgeax-studio split-pane 模式下, 把 wb-reel 两个
 * iframe (pane=left sidebar / pane=center main) 的 UI 路由互相镜像.
 *
 * 为什么需要:
 *   forgeax-studio 给 surface=split 插件挂两个独立 iframe (file://...?pane=left
 *   和 ?pane=center), 它们各自有完全独立的 React tree + zustand store.
 *   sidebar 在 left iframe 里调 `setActiveTab('player')` 只改 left 的 store,
 *   center 的 store 完全不知道, 主区域不会跟着切. 反过来也一样.
 *
 *   解决方案: 同源 iframe (host 是同一个 forgeax-server origin) 之间
 *   BroadcastChannel 通讯. 不需要 host postMessage 转发, 不依赖 host-sdk;
 *   性能开销几乎为零 (浏览器原生).
 *
 * 同步什么:
 *   - shellStore.activeTab        (FORGE / PLAYER 一级)
 *   - shellStore.forgeView        (剧本 / 图像 / 剧情树 二级)
 *   - forgeStudioStore.tab        (5 段段子 三级)
 *   - shellStore.stageSceneId / sceneDetailOpen / activeEpisodeId
 *       (2026-06: 剧情树节点列表搬到 left sidebar 后, 左栏点节点要让 center
 *        二级页打开该节点 → 必须把这几个路由态镜像到 center)
 *   - scenarioStore.selectedSceneId  (左栏选中高亮跟 center 一致)
 *   - scenarioStore.scenario        (2026-06: 左栏增删/重命名节点要让 center
 *        毫秒级看到 → 直接广播整个 scenario, 对端走 applyExternalScenario 轻量套用.
 *        单个剧本体量小 (~十几 KB), BroadcastChannel 结构化克隆开销可忽略;
 *        比磁盘 polling (3s) 快两个数量级, 且不会因 random branch id 产生分歧
 *        —— 因为写操作只在发起端执行一次, 对端只是镜像结果, 不重放 action.)
 *
 * 不同步什么 (故意的):
 *   - inspectorOpen / focusIntent / selectedShotId / promptFloaterOpen
 *     这些是"当前 iframe 内部的临时游标", 各自独立反而对.
 *   - forgeProgress  生图后台进度是 center 那边的本地 effect 驱动的,
 *     广播到 left 反而会让两边互相覆盖.
 *   - chatVisible  本来就是 URL `?pane=` 决定的派生量, 不需要同步.
 *   - 剧本身份切换 (loadScenario / activeId)  scenarioPersistBoot 已经在用
 *     URL ?scn= + 磁盘 polling 协调"换哪个剧本", 这里只镜像"当前剧本的内容编辑",
 *     不碰"换剧本", 否则会撞历史栈.
 *
 * 防回环:
 *   每个 iframe 自己有一个 senderId (mount 时随机). 发出消息带 senderId,
 *   收到消息先比 senderId; 是自己的丢弃. 同时 isApplying 标志位避免在
 *   apply 远端 patch 的瞬间被 store.subscribe 听到又广播回去 -> 死循环.
 *
 * 当 pane === null (独立运行) 不启用桥, 完全不开 channel, 没有任何开销.
 */

const CHANNEL_NAME = 'forgeax:wb-reel:pane-sync'

interface SyncPayload {
  senderId: string
  /** monotonic counter, helps debug ordering */
  seq: number
  patch: {
    activeTab?: ShellTab
    forgeView?: ForgeView
    imageSection?: ImageSection
    studioTab?: StudioTab
    stageSceneId?: string | null
    sceneDetailOpen?: boolean
    activeEpisodeId?: string | null
    selectedSceneId?: string | null
    /** 「导入完整剧本」模态开关 —— sidebar(left) 触发, center 打开模态本体。 */
    importOpen?: boolean
    /**
     * 整个当前剧本 (内容编辑实时镜像). 只在 scenario 引用变更时携带;
     * 对端用 applyExternalScenario 轻量套用 (不重置选中/不重跑 migrate).
     */
    scenario?: Scenario
    /**
     * 锻造产出的**全新剧本**(换剧本 / identity switch). 与 `scenario`(同本内容
     * 镜像)不同 —— 这是"刚锻造出一本新 id 的剧本, 全 pane 都切过去看".
     *
     * 为什么单列一个字段: 平时的 scenario 字段只镜像"同一本剧本的内容编辑",
     * 故意不碰换剧本(避免和 ?scn= / 磁盘 polling 抢路由). 但 agent 经 forge-queue
     * 在某一个随机 iframe 里 adopt(create-new) 一本新剧本时, 处理它的 iframe 可能是
     * 不可见的 sidebar(pane=left), 用户看的 center 就一直停在旧剧本. 这个显式信号
     * 让所有 pane 收到后 loadScenario 切到新剧本.
     */
    adoptScenario?: Scenario
  }
}

let installed = false

// 模块级 channel 句柄 —— 供 broadcastScenarioAdopt 在 crossPaneSync 闭包外
// (forge 各入口 adopt 之后) 主动广播"换到新锻造的剧本".
let _activeChannel: BroadcastChannel | null = null
let _activeSenderId = ''
let _activeSeq = 100000

/**
 * 启动跨 pane 同步桥. 返回 dispose 函数; 重复调用安全 (已经装过就直接返回 noop).
 */
export function installCrossPaneSync(): () => void {
  if (installed) return () => {}
  if (typeof BroadcastChannel === 'undefined') {
    // SSR / 老浏览器 (IE 不在话下, 但 Safari < 15.4 也没 BroadcastChannel).
    // 静默降级: 桥没启用, 但 wb-reel 本身能跑.
    return () => {}
  }
  installed = true

  const channel = new BroadcastChannel(CHANNEL_NAME)
  const senderId = `${Math.random().toString(36).slice(2, 10)}-${Date.now()}`
  let seq = 0
  let isApplying = false
  _activeChannel = channel
  _activeSenderId = senderId

  function broadcast(patch: SyncPayload['patch']): void {
    if (isApplying) return
    if (Object.keys(patch).length === 0) return
    seq += 1
    channel.postMessage({ senderId, seq, patch } satisfies SyncPayload)
  }

  // 订阅本地 store 变化 → 广播
  // 1) shellStore: activeTab + forgeView + 剧情树路由态
  let lastActiveTab = useShellStore.getState().activeTab
  let lastForgeView = useShellStore.getState().forgeView
  let lastImageSection = useShellStore.getState().imageSection
  let lastStageSceneId = useShellStore.getState().stageSceneId
  let lastSceneDetailOpen = useShellStore.getState().sceneDetailOpen
  let lastActiveEpisodeId = useShellStore.getState().activeEpisodeId
  let lastImportOpen = useShellStore.getState().importOpen
  const unsubShell = useShellStore.subscribe((state) => {
    const patch: SyncPayload['patch'] = {}
    if (state.activeTab !== lastActiveTab) {
      lastActiveTab = state.activeTab
      patch.activeTab = state.activeTab
    }
    if (state.forgeView !== lastForgeView) {
      lastForgeView = state.forgeView
      patch.forgeView = state.forgeView
    }
    if (state.imageSection !== lastImageSection) {
      lastImageSection = state.imageSection
      patch.imageSection = state.imageSection
    }
    if (state.stageSceneId !== lastStageSceneId) {
      lastStageSceneId = state.stageSceneId
      patch.stageSceneId = state.stageSceneId
    }
    if (state.sceneDetailOpen !== lastSceneDetailOpen) {
      lastSceneDetailOpen = state.sceneDetailOpen
      patch.sceneDetailOpen = state.sceneDetailOpen
    }
    if (state.activeEpisodeId !== lastActiveEpisodeId) {
      lastActiveEpisodeId = state.activeEpisodeId
      patch.activeEpisodeId = state.activeEpisodeId
    }
    if (state.importOpen !== lastImportOpen) {
      lastImportOpen = state.importOpen
      patch.importOpen = state.importOpen
    }
    broadcast(patch)
  })

  // 2) forgeStudioStore: tab
  let lastStudioTab = useForgeStudioStore.getState().tab
  const unsubStudio = useForgeStudioStore.subscribe((state) => {
    if (state.tab !== lastStudioTab) {
      lastStudioTab = state.tab
      broadcast({ studioTab: state.tab })
    }
  })

  // 3) scenarioStore: selectedSceneId + scenario(整本, 内容编辑实时镜像)
  let lastSelectedSceneId = useScenarioStore.getState().selectedSceneId
  let lastScenario = useScenarioStore.getState().scenario
  const unsubScenario = useScenarioStore.subscribe((state) => {
    const patch: SyncPayload['patch'] = {}
    if (state.selectedSceneId !== lastSelectedSceneId) {
      lastSelectedSceneId = state.selectedSceneId
      patch.selectedSceneId = state.selectedSceneId
    }
    if (state.scenario !== lastScenario) {
      // 仅当是"同一本剧本的内容改动"才广播; 换剧本 (id 变) 交给 persistBoot,
      // 这里不掺和, 避免和 ?scn= / 磁盘 polling 抢路由.
      if (state.scenario.id === lastScenario.id) {
        patch.scenario = state.scenario
      }
      lastScenario = state.scenario
    }
    broadcast(patch)
  })

  // 接收远端广播 → apply 本地 (用 isApplying 围栏防止回环)
  function onMessage(e: MessageEvent<SyncPayload>) {
    const msg = e.data
    if (!msg || typeof msg !== 'object') return
    if (msg.senderId === senderId) return // 自己发的, 丢弃

    isApplying = true
    try {
      const { patch } = msg
      if (patch.activeTab !== undefined) {
        const shell = useShellStore.getState()
        if (shell.activeTab !== patch.activeTab) {
          // 同步 lastActiveTab, 否则 subscribe 还会广播一次 echo
          lastActiveTab = patch.activeTab
          shell.setActiveTab(patch.activeTab)
        }
      }
      if (patch.forgeView !== undefined) {
        const shell = useShellStore.getState()
        if (shell.forgeView !== patch.forgeView) {
          lastForgeView = patch.forgeView
          shell.setForgeView(patch.forgeView)
        }
      }
      if (patch.imageSection !== undefined) {
        const shell = useShellStore.getState()
        if (shell.imageSection !== patch.imageSection) {
          lastImageSection = patch.imageSection
          shell.setImageSection(patch.imageSection)
        }
      }
      if (patch.studioTab !== undefined) {
        const studio = useForgeStudioStore.getState()
        if (studio.tab !== patch.studioTab) {
          lastStudioTab = patch.studioTab
          studio.setTab(patch.studioTab)
        }
      }
      if (patch.activeEpisodeId !== undefined) {
        const shell = useShellStore.getState()
        if (shell.activeEpisodeId !== patch.activeEpisodeId) {
          lastActiveEpisodeId = patch.activeEpisodeId
          shell.setActiveEpisodeId(patch.activeEpisodeId)
        }
      }
      if (patch.importOpen !== undefined) {
        const shell = useShellStore.getState()
        if (shell.importOpen !== patch.importOpen) {
          lastImportOpen = patch.importOpen
          shell.setImportOpen(patch.importOpen)
        }
      }
      // 锻造产出新剧本(换剧本) —— 全 pane 切过去. 必须先于内容镜像处理.
      if (patch.adoptScenario !== undefined) {
        const scenarioStore = useScenarioStore.getState()
        if (patch.adoptScenario.id !== scenarioStore.scenario.id) {
          lastScenario = patch.adoptScenario
          lastSelectedSceneId = patch.adoptScenario.rootSceneId
          scenarioStore.loadScenario(patch.adoptScenario)
        }
      }
      // scenario 内容镜像必须先于 selectedSceneId/stageSceneId 套用 ——
      // 否则对端可能先指向一个还没收到的新节点.
      if (patch.scenario !== undefined) {
        const scenarioStore = useScenarioStore.getState()
        // 只镜像"同一本剧本"的内容改动; 换剧本不在此处理.
        if (patch.scenario.id === scenarioStore.scenario.id) {
          lastScenario = patch.scenario
          scenarioStore.applyExternalScenario(patch.scenario)
        }
      }
      if (patch.selectedSceneId !== undefined) {
        const scenarioStore = useScenarioStore.getState()
        if (
          patch.selectedSceneId &&
          scenarioStore.selectedSceneId !== patch.selectedSceneId
        ) {
          lastSelectedSceneId = patch.selectedSceneId
          scenarioStore.selectScene(patch.selectedSceneId)
        }
      }
      if (patch.stageSceneId !== undefined) {
        const shell = useShellStore.getState()
        // stageSceneId + sceneDetailOpen 同步: 左栏点节点 → center 打开二级页.
        if (patch.stageSceneId && shell.stageSceneId !== patch.stageSceneId) {
          lastStageSceneId = patch.stageSceneId
          lastSceneDetailOpen = true
          if (shell.forgeView === 'assets') {
            // 素材库视图: 只切舞台节点, 不改视图 —— 否则 focusSceneInStage 会把本端
            // 拉回剧情树, 再经 forgeView 广播把对端也带走 (两端齐刷刷跳出素材库).
            shell.setStageScene(patch.stageSceneId)
          } else {
            // 用 focusSceneInStage 一把设全 (同时切到 forge/tree 视图并打开抽屉).
            lastForgeView = 'tree'
            lastActiveTab = 'forge'
            shell.focusSceneInStage(patch.stageSceneId)
          }
        }
      }
      if (patch.sceneDetailOpen === false) {
        const shell = useShellStore.getState()
        if (shell.sceneDetailOpen) {
          lastSceneDetailOpen = false
          shell.closeSceneDetail()
        }
      }
    } finally {
      isApplying = false
    }
  }
  channel.addEventListener('message', onMessage)

  // mount 后立即广播一次本地完整状态 —— 让对端 (可能是后到达 iframe) 同步过来.
  // 注意: 由于双向广播, 两个 iframe 都会发一次, 先到的会被后到的覆盖.
  // 这里取舍: 后到的 iframe 通常代表"用户正在看的 pane" (host 加载顺序通常
  // sidebar 先, mainarea 后), 所以让后到的状态赢更符合用户直觉 -> 不需要
  // 选举, 自然行为就是对的.
  broadcast({
    activeTab: lastActiveTab,
    forgeView: lastForgeView,
    imageSection: lastImageSection,
    studioTab: lastStudioTab,
  })

  return () => {
    channel.removeEventListener('message', onMessage)
    channel.close()
    unsubShell()
    unsubStudio()
    unsubScenario()
    if (_activeChannel === channel) {
      _activeChannel = null
      _activeSenderId = ''
    }
    installed = false
  }
}

/**
 * 广播"刚锻造出一本新剧本, 全 pane 切过去看".
 *
 * forge 各入口(agent forge-queue / 直接导入剧本面板 / 对话锻造)在
 * adoptForgedScenario 之后调它一次, 让不可见的 sidebar pane 处理掉队列时,
 * 用户所在的 center pane 也能切到新剧本 —— 修复"智能体说锻造完成了, 但
 * workbench 还停在旧剧本"。
 *
 * 未启用桥(独立运行 pane===null / 老浏览器无 BroadcastChannel)时静默 no-op:
 * 单 iframe 自己 adopt 即可见, 不需要广播。
 */
export function broadcastScenarioAdopt(scenario: Scenario): void {
  if (!_activeChannel) return
  _activeSeq += 1
  try {
    _activeChannel.postMessage({
      senderId: _activeSenderId,
      seq: _activeSeq,
      patch: { adoptScenario: scenario },
    } satisfies SyncPayload)
  } catch {
    // 结构化克隆失败(理论上不会) —— 静默, 不影响本端已可见的 adopt
  }
}
