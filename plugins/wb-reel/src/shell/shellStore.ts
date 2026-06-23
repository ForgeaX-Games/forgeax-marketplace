import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * ShellStore —— 应用外壳的 UI 路由 + 跨 Tab 交互状态。
 *
 * 为什么要单独的 store（而不是把这些字段塞进 scenarioStore）：
 *   1) scenarioStore 接了 zundo undo/redo；Tab 切换、抽屉开关不应进入历史栈。
 *   2) workbench 集成时，这些字段是"UI 会话态"，刷新/mount 要独立恢复。
 *   3) 各 Tab 只订阅自己需要的切片，减少跨模块耦合。
 *
 * 字段语义：
 *   - activeTab: 顶栏二 Tab（互斥显示主区域内容）
 *       · FORGE   剧本锻造工作台 —— 内含三个二级视图（forgeView）
 *           · script 剧本对话锻造（ForgeChatPanel + 剧本预览）
 *           · image  参考图素材库（ScenarioAssetLibrary 全屏）
 *           · tree   剧情树 + 节点详情浮层（原 StoryTreeTab）
 *       · PLAYER  全屏试玩
 *     2026-05 重构：原顶栏的 STORYTREE 二级 tab 被吸收为 forgeView='tree'。
 *     旧 URL `?tab=storytree` 在 readSessionRoute 里自动迁移成
 *     `?tab=forge&view=tree`，老链接仍然能定位到剧情树视图。
 *   - forgeView: FORGE 内的二级视图选择器（仅当 activeTab='forge' 才有意义）
 *   - inspectorOpen: 右侧 Inspector 抽屉是否展开（任何 Tab 内按需弹出）
 *   - sceneDetailOpen: 剧情树视图内"场景详情浮层"是否展开
 *   - stageSceneId: 当前详情浮层聚焦的场景 id（null = 还没点）
 *   - focusIntent: 替代 FOCUS_STAGE_EVENT window 事件的纯状态 pub-sub
 *     · focusSceneInStage(sceneId) 由 StoryGraph 双击触发 —— 会同时
 *       切到 forge.tree 视图、打开详情浮层并聚焦该场景
 *     · StagePane 用 useEffect 订阅并滚动聚焦
 *     · 用 tick 字段保证"同一个 sceneId 连点两次也会重新触发"
 *   - sceneExpanded: StoryTree 节点是否膨胀为大卡编辑态
 *   - forgeProgress: ForgeWizard 后台生图队列进度（0-1），跨 Tab 可见
 */
export type ShellTab = 'forge' | 'player'

/**
 * FORGE Tab 内的二级视图。
 *
 * 切换不影响 scenarioStore，只是 UI 选择哪个面板渲染。持久化与 activeTab 同档。
 *
 * 注意 (2026-05+ 重构):
 *   原来曾短暂存在 'music' 二级 view (全局 BGM 锻造面板), 已被两个更精准的入口
 *   取代:
 *     - 角色 BGM/语音锚点 → 角色详情 (AssetPreviewDialog 的音色面板)
 *     - 场景 BGM         → 剧情树节点详情 (SceneBgmPanel) 内
 *   全局 music view 不再存在; 'music' 字符串仅在 sessionRoute / persist migrate
 *   里被白名单过滤掉, 老链接落到 'script' 兜底.
 */
export type ForgeView = 'script' | 'image' | 'tree' | 'assets'

/**
 * 「图像」视图（forgeView='image'）下的一级分区切换。
 *
 * 2026-06 重构（作者反馈）：原「图像」内容区是一条长滚动页，纵向堆叠
 *   风格（VisualStyleSelector）→ 参考图流水线（RefsPanel 网格）→ UI 风格（UIStylePanel）。
 * 现把这三块的一级切换提到左侧边栏（与「剧本」视图下「段子」子段同样式），
 * 内容区按 imageSection 只渲染当前选中那一块，腾出空间给参考图详情全屏展示。
 *
 * 切换不影响 scenarioStore，仅 UI 选择。持久化与 forgeView 同档。
 */
export type ImageSection = 'style' | 'director' | 'refs' | 'ui' | 'minigame'

export interface FocusIntent {
  sceneId: string
  /** 单调递增；即使 sceneId 不变，tick 变了就重新聚焦 */
  tick: number
}

export interface ShellState {
  activeTab: ShellTab
  /** FORGE Tab 内当前选中的二级视图（仅当 activeTab='forge' 才被消费） */
  forgeView: ForgeView
  /** 「图像」视图下的一级分区（仅当 forgeView='image' 才被消费） */
  imageSection: ImageSection
  inspectorOpen: boolean
  sceneDetailOpen: boolean
  stageSceneId: string | null
  sceneExpanded: boolean
  /**
   * 详情抽屉内 Prompt 浮层的展开状态。
   *
   * 默认 false —— 作者打开抽屉时先看到"完整画面"；
   * 点一下画面才展开 Prompt 编辑（点 › 按钮可收起）。
   * 关闭抽屉时自动复位到 false，避免下次打开还残留展开状态。
   */
  promptFloaterOpen: boolean
  /**
   * v3 · 详情抽屉内"当前选中的 shot id"。
   *
   * 为什么放在 shellStore（而不是 scenarioStore）：
   *   镜头板的选中仅是 UI 游标，进 zundo 历史会污染撤销体验。
   *   每次 focusSceneInStage 都重置为 null，详情抽屉里再按需 default 到 keyShotId。
   */
  selectedShotId: string | null
  focusIntent: FocusIntent | null
  forgeProgress: { done: number; total: number } | null
  /**
   * v4 · StoryTree 视图当前选中的剧集 id（分剧集化）。
   *
   * - 指定 id → 只渲染该集的 scene
   * - null → 旧数据 / 未初始化的兜底状态；UI 层 (StoryTreeTab + EpisodeTabs)
   *   会同步落到第一集. 不再表示"全部集"聚合视图（已于 2026-05-27 移除）.
   *
   * 持久化在 URL (?ep=) 和 shellStore persist 两处，刷新后能恢复。
   */
  activeEpisodeId: string | null
  /**
   * v5 (2026-05 forgeax 集成) · 右列锻造对话面板是否可见。
   *
   * - 独立运行（standalone main.tsx）：保持 true，作者完整体验不受影响。
   * - 嵌入 forgeax-studio 工作台 iframe：App 启动 effect 检测到
   *   `window.parent !== window` 时把它置 false，让总工程的 ChatPanel +
   *   reia agent 接管"对话锻造"职能；wb-reel 自身只显示 TopBar + 中心
   *   三视图（剧本/图像/剧情树）。
   * - 用户也能用 `?chat=hidden` / `?chat=visible` query 显式覆盖，方便
   *   开发与调试。
   *
   * 不持久化（partialize 不含此字段）—— 它是"运行环境"决定的，每次启动
   * 都需要重新评估，避免上一次嵌入会话的状态污染下一次独立运行。
   */
  chatVisible: boolean
  /**
   * 「导入完整剧本」模态是否打开。
   *
   * 触发点搬到了左侧 sidebar（pane=left iframe）底部，而模态本体渲染在
   * 内容区（pane=center / standalone 的 ForgeStudio）。两个 iframe 各自独立，
   * 故用此 store 字段 + crossPaneSync 镜像：sidebar 置 true → center 打开模态。
   * 不持久化（会话态，刷新应复位）。
   */
  importOpen: boolean

  setActiveTab: (tab: ShellTab) => void
  setForgeView: (view: ForgeView) => void
  setImageSection: (section: ImageSection) => void
  toggleInspector: () => void
  setInspectorOpen: (open: boolean) => void
  setSceneExpanded: (expanded: boolean) => void
  setPromptFloaterOpen: (open: boolean) => void
  togglePromptFloater: () => void
  setSelectedShotId: (shotId: string | null) => void
  /**
   * 打开场景详情浮层并聚焦 —— 会自动切到 forge tab + tree 视图（如果不在），
   * 置 sceneDetailOpen=true、stageSceneId=sceneId，并递增 focusIntent.tick。
   */
  focusSceneInStage: (sceneId: string) => void
  /**
   * 仅设置舞台节点(stageSceneId)+打开详情, 不改 forgeView/activeTab。
   * 用于「素材库」视图下从节点图选节点切换——保持停留在素材库, 不被 focusSceneInStage
   * 强拉回剧情树视图。
   */
  setStageScene: (sceneId: string) => void
  /** 显式关闭详情浮层（ESC / × 按钮） */
  closeSceneDetail: () => void
  clearFocusIntent: () => void
  setForgeProgress: (progress: ShellState['forgeProgress']) => void
  /** 切换活跃剧集；null 表示兜底/未初始化（UI 层会同步落到第一集） */
  setActiveEpisodeId: (episodeId: string | null) => void
  /** v5 · 显示/隐藏右列锻造对话面板（嵌入 forgeax 时通常调 false）。 */
  setChatVisible: (visible: boolean) => void
  /** 打开/关闭「导入完整剧本」模态（跨 pane 镜像）。 */
  setImportOpen: (open: boolean) => void
}

/**
 * persist 中间件 —— 仅持久化 activeTab + forgeView。
 *
 * 为什么只 partialize activeTab + forgeView：
 *   inspectorOpen / sceneDetailOpen / focusIntent / forgeProgress 都是会话态：
 *   刷新后用户期望"画面是干净的"，把这些恢复回来反而是惊吓（比如恢复一个上次
 *   误开的详情浮层）。activeTab + forgeView 是路由级状态，恢复符合预期。
 *
 * 为什么还需要 persist（URL 已有 ?tab= / ?view=）：
 *   兜底。无持久化部署环境（清空 origin 的容器/SaaS）下 URL 是真实来源；
 *   本地开发 / 用户手动剥掉 query 时 persist 仍能让"上次在哪个 tab + 视图"延续。
 *   两者配合：sessionRoute.boot 顺序里 URL > persist。
 *
 * 2026-05 迁移：v1 → v2 schema：
 *   - v1 ShellTab 枚举包含 'storytree'，被持久化的 'storytree' 会在 v2 触发 migrate
 *     变成 { activeTab: 'forge', forgeView: 'tree' }，让作者上次的位置感知不丢。
 *   - 没有 forgeView 的 v1 持久值默认 forgeView='script'，保持新作者首次刷新的
 *     体验是"看到对话锻造面板"。
 *
 * key 走 'reel-studio:shell:v1' 命名空间不变（只 bump version），与其它 'reel-studio:'
 * 前缀保持一致，便于将来按命名空间清理。
 */
export const useShellStore = create<ShellState>()(
  persist(
    (set, get) => ({
      activeTab: 'forge',
      forgeView: 'tree',
      imageSection: 'refs',
      inspectorOpen: false,
      sceneDetailOpen: false,
      stageSceneId: null,
      sceneExpanded: false,
      promptFloaterOpen: false,
      selectedShotId: null,
      focusIntent: null,
      forgeProgress: null,
      activeEpisodeId: null,
      chatVisible: true,
      importOpen: false,

      setActiveTab: (tab) => {
        // 防御: 调用方手抖传了非法值 (老的 'storytree' / 'editor'), 静默归位.
        // 老链接的二次跳转、第三方注入脚本、devtools 误调都从这里兜住.
        const nextTab = tab === 'forge' || tab === 'player' ? tab : 'forge'
        // 幂等：同值不写，避免无意义 store 通知参与 setState 嵌套风暴。
        if (get().activeTab === nextTab) return
        set({ activeTab: nextTab })
      },
      setForgeView: (view) => {
        if (view === 'script' || view === 'image' || view === 'tree' || view === 'assets') {
          set({ forgeView: view })
        } else {
          // 兜住 'music' (老 view, 已废) 等历史值, 退到默认 script
          set({ forgeView: 'script' })
        }
      },
      setImageSection: (section) => {
        // 白名单须与 ImageSection 联合类型保持一致 —— 漏列会让对应分区点击被强制
        // 回退到 'refs'（曾导致「导演风格 / 小游戏」点击无效）。
        const valid: readonly ImageSection[] = ['style', 'director', 'refs', 'ui', 'minigame']
        set({ imageSection: valid.includes(section) ? section : 'refs' })
      },
      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
      setInspectorOpen: (open) => set({ inspectorOpen: open }),
      setSceneExpanded: (expanded) => set({ sceneExpanded: expanded }),
      setPromptFloaterOpen: (open) => set({ promptFloaterOpen: open }),
      togglePromptFloater: () =>
        set((s) => ({ promptFloaterOpen: !s.promptFloaterOpen })),
      setSelectedShotId: (shotId) => {
        // 幂等：同值不写，避免无意义的 store 通知参与 setState 嵌套风暴
        // （StrictMode 下 effect 重放会把这类冗余通知放大成 React 的
        // 「Maximum update depth exceeded」崩溃）。
        if (get().selectedShotId === shotId) return
        set({ selectedShotId: shotId })
      },
      focusSceneInStage: (sceneId) => {
        const prev = get().focusIntent
        set({
          activeTab: 'forge',
          forgeView: 'tree',
          sceneDetailOpen: true,
          stageSceneId: sceneId,
          promptFloaterOpen: false,
          selectedShotId: null,
          focusIntent: { sceneId, tick: (prev?.tick ?? 0) + 1 },
        })
      },
      setStageScene: (sceneId) => {
        const prev = get().focusIntent
        // 不动 forgeView/activeTab —— 素材库视图下切节点保持停留。
        set({
          sceneDetailOpen: true,
          stageSceneId: sceneId,
          selectedShotId: null,
          focusIntent: { sceneId, tick: (prev?.tick ?? 0) + 1 },
        })
      },
      closeSceneDetail: () =>
        set({
          sceneDetailOpen: false,
          promptFloaterOpen: false,
          selectedShotId: null,
        }),
      clearFocusIntent: () => set({ focusIntent: null }),
      setForgeProgress: (progress) => set({ forgeProgress: progress }),
      setActiveEpisodeId: (episodeId) => set({ activeEpisodeId: episodeId }),
      setChatVisible: (visible) => set({ chatVisible: visible }),
      setImportOpen: (open) => set({ importOpen: open }),
    }),
    {
      name: 'reel-studio:shell:v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        activeTab: s.activeTab,
        forgeView: s.forgeView,
        imageSection: s.imageSection,
      }),
      version: 2,
      migrate: (persisted, fromVersion) => {
        // 只关心 v1 → v2：把 'storytree' tab 折叠进 forgeView='tree'
        if (fromVersion < 2 && persisted && typeof persisted === 'object') {
          const p = persisted as Record<string, unknown>
          if (p.activeTab === 'storytree') {
            return {
              activeTab: 'forge',
              forgeView: 'tree',
            } as Partial<ShellState>
          }
          if (typeof p.forgeView !== 'string') {
            return {
              activeTab: (p.activeTab as ShellTab) ?? 'forge',
              forgeView: 'script',
            } as Partial<ShellState>
          }
        }
        return persisted as Partial<ShellState>
      },
      /**
       * Hydrate 兜底 —— migrate 之后、最终 setState 之前再过一道白名单.
       *
       * 必要性 (2026-05 救火复盘):
       *   现实里 localStorage 可能因为各种原因混进非法 activeTab (枚举之外的字符串):
       *     · 老版本枚举值, migrate 没显式处理的
       *     · 用户手动改了 localStorage / 第三方扩展乱写
       *     · 跨分支切换时 schemaVersion 没 bump 但枚举改了
       *   这些情况下用户会卡在"白屏 / 无可见 tab"状态, 只能在控制台手敲
       *     useShellStore.getState().setActiveTab('forge')
       *   这里在 hydrate 阶段把白名单守在最后一道, 永远把非法值掰回 forge / script.
       *
       * 实现取舍: persist 中间件的 merge 钩子拿到的是 (persistedState, currentState),
       * 我们对 currentState 做覆盖式合并 —— 已知合法字段从 persisted 来, 非法字段
       * 用 currentState 的 default 值. 比直接 mutate persisted 更稳, 因为后者可能
       * 被 zustand persist 内部缓存引用.
       */
      merge: (persistedState, currentState) => {
        const merged: ShellState = { ...currentState }
        if (
          persistedState &&
          typeof persistedState === 'object' &&
          !Array.isArray(persistedState)
        ) {
          const p = persistedState as Partial<ShellState>
          if (
            typeof p.activeTab === 'string' &&
            (['forge', 'player'] as readonly string[]).includes(p.activeTab)
          ) {
            merged.activeTab = p.activeTab as ShellTab
          }
          if (
            typeof p.forgeView === 'string' &&
            (['script', 'image', 'tree', 'assets'] as readonly string[]).includes(p.forgeView)
          ) {
            // 'assets'(素材库) 是从节点「打开素材库」按钮进入的节点级钻取视图，
            // 不是可恢复的顶层路由 —— 强刷后若恢复成 'assets'，SceneMiniMap 会按
            // forgeView==='assets' 把"点节点"解释成"在素材库里切节点"，造成
            // "刷新后一点剧情树节点就跳进素材库"(2026-06-16 作者反馈)。
            // 落盘允许，但 hydrate 时收敛回 'tree'(剧情树)。
            merged.forgeView = p.forgeView === 'assets' ? 'tree' : (p.forgeView as ForgeView)
          }
          if (
            typeof p.imageSection === 'string' &&
            (['style', 'director', 'refs', 'ui', 'minigame'] as readonly string[]).includes(
              p.imageSection,
            )
          ) {
            merged.imageSection = p.imageSection as ImageSection
          }
        }
        return merged
      },
    },
  ),
)

/**
 * 选择器：把 scenarioStore.mode 映射到 shellStore.activeTab。
 * Player Tab 激活 = 进入 player mode；其他 tab = editor mode。
 * 这个映射让旧的 setMode 调用（PlayerMenu / TopBar legacy）继续生效：
 * 监听者在 App 层把 mode 变化回写到 activeTab。
 */
export function tabFromMode(
  mode: 'editor' | 'player',
  currentTab: ShellTab,
): ShellTab {
  if (mode === 'player') return 'player'
  // editor 模式下：如果当前在 player tab 才需要回退；否则保持用户所在 tab
  return currentTab === 'player' ? 'forge' : currentTab
}
