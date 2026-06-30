import { useEffect, useState } from 'react'
import { useScenarioStore } from './scenario/scenarioStore'
import { useShellStore } from './shell/shellStore'
import { TopBar } from './ui/TopBar'
import { ReelSidebar } from './shell/ReelSidebar'
import { Player } from './player/Player'
import { RenderStage } from './render/RenderStage'
import { ForgeTab } from './forge/ForgeTab'
import { InspectorDrawer } from './shell/InspectorDrawer'
import { ToastHost } from './ui/ToastHost'
import { resumeRunningVideoTasks } from './llm/videoTaskResume'
import { resumeGenerationQueue } from './forge/generationQueueStore'
// 副作用导入：注册可恢复任务的 recipe（orch-video / audition），
// 让 resumeGenerationQueue 在刷新/重开后能按当前剧本重建并续跑。
import './forge/orchestrateVideos'
import './forge/enqueueAudition'
import { bootAssetStore, useAssetStore } from './media/assetStore'
import { hydrateSceneImagesFromDisk } from './media/hydrateSceneImages'
import { hydrateMediaFromAssets } from './media/hydrateMediaFromAssets'
import { hydrateMediaFromIdb } from './media/hydrateMediaFromIdb'
import { getAllMedia } from './media/mediaIdb'
import { primeMediaEntry, useMediaStore } from './media/mediaStore'
import { bootScenarioPersist, flushScenarioPersist } from './scenario/scenarioPersistBoot'
import { loadReelGameFromPackIndex } from './player/loadReelGameFromPackIndex'
import { collectScenarioRefs } from './scenario/pkg/collectScenarioRefs'
import { bootUpstreamCharacter } from './scenario/upstreamCharacter'
import { bootSceneCacheReset } from './media/sceneCacheReset'
import { injectStyleOnce } from './styles/injectStyle'
import {
  installSessionRouteSync,
  resolvePreferredScenarioId,
  readSessionRoute,
  writeSessionRouteFromState,
} from './shell/sessionRoute'
import { installCrossPaneSync } from './shell/crossPaneSync'

/**
 * 顶层应用 —— 二 Tab 路由：
 *
 *   FORGE   剧本锻造工作台（内含 script / image / tree 三个二级视图，由 ForgeTab 统一驱动）
 *   PLAYER  全屏试玩
 *
 * TopBar 跨 Tab 常驻，可一键切换、保存、导出、打开 Inspector 抽屉。
 *
 * 兼容层：scenarioStore.mode ('editor' | 'player') 仍保留。Player Tab ↔ mode=player。
 * 旧代码调 setMode('editor'/'player') 时，下方 effect 把它映射为 setActiveTab。
 *
 * 2026-05 重构：原顶层 STORYTREE Tab 被吸收为 ForgeTab 内部的 forgeView='tree'，
 * StoryGraph + SceneDetailDrawer 由 ForgeTab 统一渲染。
 *
 * Workbench 集成：
 *   - 独立运行（main.tsx）时不传 hostOptions，走默认持久化
 *   - 嵌入 workbench（mount.tsx）时传 hostOptions.persistence 控制是否触发持久化 boot
 */
export interface AppHostOptions {
  persistence?: 'local' | 'memory'
}

/** 由扩展名猜 MIME（standalone pack 模式给 mediaStore 占位条目用，仅供展示）。 */
function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase()
  if (e === 'png') return 'image/png'
  if (e === 'jpg' || e === 'jpeg') return 'image/jpeg'
  if (e === 'webp') return 'image/webp'
  if (e === 'gif') return 'image/gif'
  if (e === 'mp4') return 'video/mp4'
  if (e === 'webm') return 'video/webm'
  if (e === 'mov') return 'video/quicktime'
  if (e === 'mp3') return 'audio/mpeg'
  if (e === 'wav') return 'audio/wav'
  if (e === 'ogg') return 'audio/ogg'
  if (e === 'm4a') return 'audio/mp4'
  return 'application/octet-stream'
}

export function App({ hostOptions }: { hostOptions?: AppHostOptions } = {}) {
  const activeTab = useShellStore((s) => s.activeTab)
  const setActiveTab = useShellStore((s) => s.setActiveTab)
  const setForgeView = useShellStore((s) => s.setForgeView)
  const setChatVisible = useShellStore((s) => s.setChatVisible)
  const setMode = useScenarioStore((s) => s.setMode)
  const persistence = hostOptions?.persistence ?? 'local'

  /*
   * 2026-06 主工程预览集成 · player-only 表面.
   *
   * 主工程 (interface) 的 Play 区要预览影游时, 只 iframe 这个表面:
   * URL 带 `?surface=player` → 仅渲染沉浸式 <Player />, 不挂 TopBar /
   * ReelSidebar / ForgeTab / InspectorDrawer. 这样嵌进主工程时看到的就是
   * 纯播放画面, 不会把整套工作室 UI 套进去造成「界面嵌套 / 复制整个界面」.
   *
   * 同步读 (lazy initializer) 而非 effect 里 setState —— 避免首帧先渲染完整
   * App 再切走的闪烁.
   */
  const [playerOnly] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('surface') === 'player'
    } catch {
      return false
    }
  })

  /*
   * 2026-06 节点→MP4 导出 · render-only 表面.
   *
   * `?surface=render` → 仅挂 <RenderStage />（固定 1080p 离屏画布，逐帧 seek，
   * 跳过所有交互层），给 headless 录制器逐帧截图。数据加载复用 player-only 的
   * slim boot（按 ?scn 把剧本与媒体从磁盘灌进来），不挂任何编辑器 chrome。
   */
  const [renderOnly] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('surface') === 'render'
    } catch {
      return false
    }
  })

  // player-only: 强制 player tab + 隐藏对话列, 让沉浸式 is-playing 样式生效.
  useEffect(() => {
    if (!playerOnly) return
    setChatVisible(false)
    useShellStore.getState().setActiveTab('player')
  }, [playerOnly, setChatVisible])

  /*
   * 2026-05 forgeax 集成: 启动时决定右列对话面板是否可见.
   *
   * 当前策略 (Phase 1 调试期 · 保守):
   *   - 默认 true (chatVisible 初始就是 true), 不动它.
   *   - 只在显式 URL `?chat=hidden` 时强制隐藏, `?chat=visible` 时强制显示.
   *   - **不再** 依赖 `window.parent !== window` 自动隐藏 —— 实测发现 iframe
   *     嵌入场景下整片 UI "空了", 在彻底定位之前先回退到只读 query 的形式.
   *     等 Phase 2 host-sdk 集成完成后再由 host 通过 query 显式传 ?chat=hidden.
   *
   * 只在 App mount 一次, 不订阅 URL 变化.
   */
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const explicit = params.get('chat')
      if (explicit === 'hidden') setChatVisible(false)
      else if (explicit === 'visible') setChatVisible(true)
      // 没有显式 query → 保持默认 true, 不调 setChatVisible
    } catch {
      // SSR / 沙箱环境兜底: 不动
    }
  }, [setChatVisible])

  /*
   * 2026-05 forgeax 集成 · split pane 渲染策略.
   *
   * ForgeaX Studio 给声明了 `workbench.surface=split` + `panes.left/center` 的
   * 插件挂两个 iframe (sidebar 和 mainarea), URL 分别带 `?pane=left` /
   * `?pane=center`. 老版本 wb-reel 不读这个参数 → 两个 iframe 都渲染整个 App,
   * 用户看到完全重复的 UI.
   *
   * 当前拆分 (步骤 1 · 视觉去重):
   *   - pane=left   → 只渲染 <TopBar />. 作者在 sidebar 这一栏完成"剧本切换 /
   *                   FORGE-PLAYER tab / 撤销重做 / 历史 / 主题"等高频操作.
   *                   chat=hidden 也自动应用 (sidebar 没空间放 chat).
   *   - pane=center → 只渲染 <main> 主区域 + 抽屉 / Toast / Player overlay.
   *                   不渲染 TopBar (省顶部空间, 避免与 host 的"返回工作台"
   *                   bar 双重视觉).
   *   - 无 pane     → 独立运行 (npm run dev / 直接打开 dist), 全部渲染, 行为
   *                   与改造前完全一致, 老作者无感.
   *
   * 后续步骤 2 (跨 pane 同步) 再用 BroadcastChannel 把 shellStore /
   * scenarioStore 在两个 iframe 之间镜像, 让点 left pane 的 tab 切换能立刻
   * 反映到 center. 当前两个 iframe store 互相独立, 可以正常工作但用户切 tab
   * 需要在 center 内部的二级 tab 行操作.
   */
  const [pane, setPane] = useState<'left' | 'center' | null>(null)
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('pane')
      if (p === 'left' || p === 'center') setPane(p)
      // 嵌入到 forgeax-studio 的 split pane 时, 总工程的 ChatPanel + reia
      // agent 接管对话职能 → wb-reel 自身的 ForgeChatPanel 整列隐藏.
      // (left pane 没空间放 chat, center pane 让出空间给主区域)
      if (p === 'left' || p === 'center') setChatVisible(false)
    } catch {
      // 静默兜底
    }
  }, [setChatVisible])

  /*
   * 2026-05-29 跨 pane 同步桥.
   *
   * pane !== null 时 (split-pane 嵌入态) 启用 BroadcastChannel 桥, 把
   * 两个 iframe (sidebar / mainarea) 的 UI 路由 (activeTab / forgeView /
   * studioTab) 互相镜像 —— 在 left pane 点 PLAYER 切换, center pane
   * 立刻渲染 Player; 在 sidebar 切 image 视图, center pane 立刻切到图像
   * 工作台.
   *
   * pane === null (独立运行 / npm run dev) 不启用桥, 完全没有 channel
   * 开销, 行为与改造前一致.
   *
   * 见 ./shell/crossPaneSync 的注释了解防回环细节和"同步什么/不同步什么"
   * 的取舍.
   */
  useEffect(() => {
    if (pane === null) return
    const dispose = installCrossPaneSync()
    return dispose
  }, [pane])

  useEffect(() => {
    bootAssetStore()
    // v4（2026-05-07）· App mount 时接盘未完成视频任务。延迟 500ms 保证
    //   scenarioStore 已 hydrated，避免任务完成但无法写回 scene 的脏写。
    //   resume 内部是非阻塞的（每任务一个 poll 循环），不会拖累首屏。
    //
    // player-only 预览态跳过：这是只读试玩 iframe，不应和编辑器 iframe 抢着
    // 接盘/续跑视频生成任务（否则同一任务会被两个客户端重复 poll）。
    let resumeTimer: number | undefined
    if (!playerOnly && !renderOnly) {
      resumeTimer = window.setTimeout(() => {
        resumeRunningVideoTasks({
          onLog: (m) => console.log(m),
        })
        // 接盘上次未跑完的生成队列任务（逐镜视频 / 角色试镜）——
        // 这是修复「agent 下单后刷新/切页/重开，视频凭空消失、队列里也没有」的关键：
        // 带 recipe 的 job 已落 localStorage，这里按当前剧本重建并重新入队续跑。
        resumeGenerationQueue({ onLog: (m) => console.log(m) })
      }, 500)
    }
    /*
     * 素材磁盘 → 内存周期性同步（2026-05 补丁）——
     *
     * bootAssetStore 只在 mount 时拉一次；用户可能在另一个 tab 上传新视频/图片，
     * 或 server/ 端有外部脚本往 .reel-assets/ 写盘，这里每 20s 主动 refresh 一次。
     * 若发现 records 更新，上面的 subscribe 会触发 hydrateMediaFromAssets →
     * 新 mediaId 进 mediaStore → UI 立刻能看到。
     *
     * 失败（磁盘不可用 / 静态 bundle）→ refresh 内部已经静默降级（set error），
     * 不会抛出，不影响 UI 渲染。
     *
     * 节奏：20s 比 30s 剧本轮询稍快，性价比合理；再快会给磁盘 manifest 读写加压。
     */
    const POLL_MS = 20_000
    const timer = window.setInterval(() => {
      void useAssetStore.getState().refresh()
    }, POLL_MS)
    return () => {
      window.clearInterval(timer)
      if (resumeTimer) window.clearTimeout(resumeTimer)
    }
  }, [playerOnly, renderOnly])

  /**
   * 刷新 / 首次加载 / 导入剧本时 —— 把磁盘里已存在的场景图批量灌回内存。
   *
   * 为什么放在 App 顶层：
   *   - StoryTree 节点、BranchTreeOverlay、PromptTabs 等订阅者**都**读同一个 sceneImageCache，
   *     单点 hydrate → 全局即时看到缩略图，用户不用"点一下才显示"
   *   - loadFromDisk 幂等且纯查询（不发网络请求），批量调是安全的
   *
   * 订阅策略（手写去重，避免 subscribeWithSelector middleware）：
   *   - 维护 lastAssetLoaded / lastTopology 两个闭包变量
   *   - 每次 store 变化检查：只有 asset 从 false→true 或 topology 变了才 hydrate
   *   - topology = scenarioId + sorted sceneIds.join —— 增删场景 / 换剧本都会变
   *   - 不订阅"scene 字段深层变化"，避免编辑台词、拖节点这种高频写触发 hydrate
   */
  useEffect(() => {
    /*
     * topology 签名：id + scene ids + 所有媒体引用。
     *
     * 为什么把媒体引用也算进来（2026-05 修复）：
     *   真实事故：xiaoming 另一台电脑访问同一 dev server，能看到剧情/角色/对白，但
     *   视频节点全缺。原因是 hydrateFromDisk 把 store.scenario 从"本地老版"切到
     *   "磁盘最新版"时，scenario.id 和 scenes 数**都不变**（同一本剧本、同样 19 个
     *   场景），只是 sceneVideos/sceneImages/shots.keyframeMediaRef 里的 mediaId 变了。
     *   老 topology 只比对 id + scenes keys → 判定"无变化" → 不 re-hydrate →
     *   mediaStore 里**没有新 mediaId** → UI 按 mediaId 拿不到 URL → 视频缺失。
     *
     *   把所有媒体引用纳入 topology 后，任何媒体引用变化都会触发 hydrateMediaFromAssets，
     *   把新 mediaId 桥进 mediaStore。
     *
     * 性能：这个字符串长度典型 ~500-2000 字符，比较是 O(n)，每次 scenario 变化跑一次
     * 可接受。不放到 React 渲染路径里做就没问题。
     */
    function topologyOf(): string {
      const s = useScenarioStore.getState().scenario
      const sceneIds = Object.keys(s.scenes).sort()
      const mediaRefs: string[] = []
      for (const sid of sceneIds) {
        const scene = s.scenes[sid] as
          | {
              sceneVideos?: string[]
              sceneImages?: string[]
              shots?: Array<{ keyframeMediaRef?: string }>
              media?: { ref?: string }
            }
          | undefined
        if (!scene) continue
        if (scene.media?.ref) mediaRefs.push(`m:${sid}:${scene.media.ref}`)
        for (const v of scene.sceneVideos ?? []) mediaRefs.push(`v:${sid}:${v}`)
        for (const i of scene.sceneImages ?? []) mediaRefs.push(`i:${sid}:${i}`)
        for (const sh of scene.shots ?? []) {
          if (sh.keyframeMediaRef) mediaRefs.push(`k:${sid}:${sh.keyframeMediaRef}`)
        }
      }
      // characters / props / locations 的参考图 —— 这几类是**剧本级**资产，
      // 不挂在 scene 下。xiaoming 上传角色三视图后这里的 mediaId 会变，要算进 topology，
      // 否则同 id 同 scenes 的 scenario 切换时漏 hydrate → 角色图缺失。
      const chars = (s as { characters?: Record<string, unknown> }).characters ?? {}
      for (const [cid, c] of Object.entries(chars)) {
        const cc = c as { refImageId?: string; turnaroundRefImageId?: string }
        if (cc.refImageId) mediaRefs.push(`cr:${cid}:${cc.refImageId}`)
        if (cc.turnaroundRefImageId)
          mediaRefs.push(`ct:${cid}:${cc.turnaroundRefImageId}`)
      }
      const props = (s as { props?: Record<string, unknown> }).props ?? {}
      for (const [pid, p] of Object.entries(props)) {
        const pp = p as { refImageId?: string }
        if (pp.refImageId) mediaRefs.push(`pr:${pid}:${pp.refImageId}`)
      }
      const locs = (s as { locations?: Record<string, unknown> }).locations ?? {}
      for (const [lid, l] of Object.entries(locs)) {
        const ll = l as {
          refImageId?: string
          angleRefs?: Array<{ id: string; mediaId?: string }>
        }
        if (ll.refImageId) mediaRefs.push(`lr:${lid}:${ll.refImageId}`)
        for (const a of ll.angleRefs ?? []) {
          if (a.mediaId) mediaRefs.push(`la:${lid}:${a.id}:${a.mediaId}`)
        }
      }
      return `${s.id}|${sceneIds.join(',')}|${mediaRefs.join('|')}`
    }
    let lastAssetLoaded = useAssetStore.getState().loaded
    let lastAssetRecords = useAssetStore.getState().records
    let lastTopology = topologyOf()

    function tryHydrate(): void {
      if (!useAssetStore.getState().loaded) return
      hydrateSceneImagesFromDisk(useScenarioStore.getState().scenario)
      // 同步：把 asset 里所有带 meta.mediaId 的记录反向喂回 mediaStore
      // —— 这是让「上传的角色三视图 / 参考图」刷新后依然可见的关键桥。
      // 不在 scenario 订阅里做（topology 不变也要跑一次），跟 scene images 一起走。
      //
      // v6.8: 限定 scenarioId 防止跨剧本污染。 切剧本时 topology 变 → tryHydrate
      // 自然会跑一次, 把当前剧本的 entries 灌进 mediaStore (老剧本的留在 records
      // 里不主动清, 因为 mediaId 在新剧本里写就直接覆盖。 真要严格隔离可以
      // 在切 scenario 时清空 mediaStore.entries, 但当前 mediaStore 里还有 IDB
      // 兜底, 风险更低的做法是只控 hydrate 的入口。)
      const asset = useAssetStore.getState()
      const currentScenarioId = useScenarioStore.getState().scenario.id
      const entries = hydrateMediaFromAssets(asset.records, asset.urlOf, {
        scenarioId: currentScenarioId,
      })
      for (const e of Object.values(entries)) primeMediaEntry(e)
      // IDB 兜底独立跑一次（见下方 mount 时的 getAllMedia），不在这里重复
    }

    // mount 时先跑一次（HMR 或 asset 已预热）
    tryHydrate()

    // IDB 兜底与 asset 通路独立：即便 assetStore 一直 loading / 后端挂了，
    // 也要能把"本地保存过的视频"还原回 UI。不走 tryHydrate 的 loaded 门控。
    void getAllMedia().then((records) => {
      if (records.length === 0) return
      const idbEntries = hydrateMediaFromIdb(records)
      for (const e of Object.values(idbEntries)) primeMediaEntry(e)
    })

    /*
     * 启动孤儿恢复（2026-05-21）——
     *
     * 真实事故：用户上传中文文件名视频时，`x-reel-meta` header 撞 ISO-8859-1
     * 限制，fetch 直接抛错；mediaStore 标 'failed'，但 IDB 里 blob 还在、剧本里
     * mediaId 也已写入。结果浏览器内存里看得到，但下次刷新或换 tab 就拉不到。
     * commit ad43864 修了 header 编码后，这种 failed 入口已经堵上；这里再加
     * 一层启动期兜底：扫 IDB → 找出"IDB 有 blob 但 assetStore 没有该 mediaId"
     * 的孤儿 → 静默 retryPersist（自动用最新 saveBlob 协议）→ 完成后 toast 告知。
     *
     * 设计取舍：
     *   - 等 assetStore.loaded === true 才跑（免得把 IDB 全员当孤儿误传）
     *   - 并发 3，避免 N 条孤儿一起抢带宽
     *   - 失败的不再次 retry（已在 retryPersist 内部标 failed，UI 重试入口仍在）
     *   - 静默：toast 只在最终结果出来才弹一次
     *   - 跳过 0KB blob（前端 abort 半途的占位）
     */
    void (async () => {
      // 等 asset 加载完成（不阻塞 UI，只是等到合适时机）
      let waited = 0
      while (!useAssetStore.getState().loaded && waited < 10000) {
        await new Promise((r) => setTimeout(r, 200))
        waited += 200
      }
      if (!useAssetStore.getState().loaded) return // 超时放弃

      const idb = await getAllMedia()
      if (idb.length === 0) return
      const knownMids = new Set(
        useAssetStore.getState().records
          .map((a) => a.meta?.mediaId)
          .filter((x): x is string => Boolean(x)),
      )
      const orphans = idb.filter(
        (r) => !knownMids.has(r.id) && r.blob && r.blob.size > 0,
      )
      if (orphans.length === 0) return

      // eslint-disable-next-line no-console
      console.info(
        `[orphan-recovery] 检测到 ${orphans.length} 个本地 blob 没在 server 落盘，开始静默重传…`,
      )

      const { useMediaStore } = await import('./media/mediaStore')
      const { useToastStore } = await import('./ui/toastStore')

      // 把孤儿先 prime 进 mediaStore（如果还没在），retryPersist 才认得
      const mediaStore = useMediaStore.getState()
      for (const r of orphans) {
        if (!mediaStore.entries[r.id]) {
          // 静默 prime —— 用 IDB 里的元信息构造一个临时 entry
          // 这条本来就该在 hydrateMediaFromIdb 里灌进来，这里只是兜底
          primeMediaEntry({
            id: r.id,
            name: r.name,
            mimeType: r.mimeType,
            size: r.blob.size,
            url: URL.createObjectURL(r.blob),
            createdAt: r.createdAt,
            persistState: 'failed',
          })
        }
      }

      // 并发 3 串行 retry —— retryPersist 内部会自动从 IDB 取 blob 并走最新协议
      const CONCURRENCY = 3
      let cursor = 0
      let okCount = 0
      let failCount = 0
      async function worker(): Promise<void> {
        while (cursor < orphans.length) {
          const r = orphans[cursor++]!
          try {
            const ok = await useMediaStore.getState().retryPersist(r.id)
            if (ok) okCount++
            else failCount++
          } catch {
            failCount++
          }
        }
      }
      await Promise.all(
        Array.from({ length: CONCURRENCY }, () => worker()),
      )

      // 完成后再刷新一次 assetStore.records，让 UI 能桥接到新落盘的 mediaId
      await useAssetStore.getState().refresh()

      const toast = useToastStore.getState().fire
      if (okCount > 0 && failCount === 0) {
        toast(`已为你恢复 ${okCount} 个上次未上传完的素材`, { kind: 'success' })
      } else if (okCount > 0 && failCount > 0) {
        toast(
          `已恢复 ${okCount} 个素材，另有 ${failCount} 个仍未上传（可手动重试）`,
          { kind: 'warning', ttl: 6000 },
        )
      } else if (failCount > 0) {
        toast(
          `检测到 ${failCount} 个素材未上传，自动重试失败 —— 请去资产面板手动重传`,
          { kind: 'error' },
        )
      }
      // eslint-disable-next-line no-console
      console.info(
        `[orphan-recovery] 完成：成功 ${okCount} / 失败 ${failCount}`,
      )
    })()

    /*
     * 2026-05 素材热更新修复：
     *
     * 旧订阅只在 `loaded` 从 false→true 的第一次触发 hydrate。但 assetStore.refresh()
     * 可能在已 loaded 后被反复调用（见下方 30s 轮询），新拉到的资产会导致 `records`
     * 引用变化，却**不**触发 hydrate → 新视频 mediaId 永远不会出现在 mediaStore.entries
     * 里 → UI 看不到那些视频。
     *
     * 修法：records 引用变化也算一次"有新素材可能需要桥接"，触发 hydrate。
     * hydrateMediaFromAssets 幂等（primeMediaEntry 按 id 覆盖），多跑几次无害。
     */
    const unsubAsset = useAssetStore.subscribe(() => {
      const state = useAssetStore.getState()
      const loadedChanged = state.loaded && !lastAssetLoaded
      const recordsChanged = state.records !== lastAssetRecords
      lastAssetLoaded = state.loaded
      lastAssetRecords = state.records
      if (loadedChanged || recordsChanged) tryHydrate()
    })
    /*
     * 2026-05-15 修：刷新二次后视频 NO PREVIEW 的 race —— bootAssetStore 启动的
     * fetch 可能在 subscribe 注册之前就 set state 完成（浏览器二次刷新走快路径
     * 时尤其明显），那次 loaded:false→true 的变化发生在 subscribe 注册之前 →
     * subscribe 听不到 → tryHydrate 永不被触发，直到 30s 轮询才触发一次。
     *
     * 兜底：subscribe 注册之后，主动比较"当前 store 状态"和我们记录的 last 值；
     * 如果 store 已经领先了（说明 fetch 在 subscribe 注册前就完成了），立即
     * 同步追赶。
     */
    {
      const cur = useAssetStore.getState()
      const missedLoadedFlip = cur.loaded && !lastAssetLoaded
      const missedRecordsChange = cur.records !== lastAssetRecords
      if (missedLoadedFlip || missedRecordsChange) {
        lastAssetLoaded = cur.loaded
        lastAssetRecords = cur.records
        tryHydrate()
      }
    }
    const unsubScenario = useScenarioStore.subscribe(() => {
      const now = topologyOf()
      if (now !== lastTopology) {
        lastTopology = now
        tryHydrate()
      }
    })
    return () => {
      unsubAsset()
      unsubScenario()
    }
  }, [])

  useEffect(() => {
    if (persistence === 'memory') return
    /*
     * player-only 预览态 slim boot（2026-06）——
     *   只按 ?scn 把剧本从磁盘加载进来，跳过编辑器专属副作用：
     *     · session route 把 tab 回写 URL
     *     · beforeunload「未发布草稿」拦截弹窗（预览 iframe 里弹这个很碍事）
     *     · sceneImageCache 自动重置订阅、cross-pane 同步
     *   bootScenarioPersist 仍会装持久化订阅，但只读试玩不改 scenario → 不触发写盘。
     */
    if (playerOnly || renderOnly) {
      /*
       * 独立站点试玩（Route B）——`?src=pack`：不连 dev server / 不读磁盘镜像，
       * 直接从同目录 `pack-index.json` 找到 reel-game 资产、取回整棵 Scenario，
       * 把媒体引用（已是 `./reel-media/<hash>.<ext>` 的 bundle 相对 URL）自指喂进
       * mediaStore（播放器走 entries[ref].url），再灌进 scenario store 即可播放。
       */
      const wantsPack = (() => {
        try {
          return new URLSearchParams(window.location.search).get('src') === 'pack'
        } catch {
          return false
        }
      })()
      if (wantsPack) {
        let cancelled = false
        void loadReelGameFromPackIndex('./pack-index.json')
          .then((scenario) => {
            if (cancelled) return
            const seen = new Set<string>()
            for (const cell of collectScenarioRefs(scenario as never)) {
              const ref = cell.get()
              if (!ref.startsWith('./reel-media/') || seen.has(ref)) continue
              seen.add(ref)
              primeMediaEntry({
                id: ref,
                name: ref.slice(ref.lastIndexOf('/') + 1),
                mimeType: mimeFromExt(ref.slice(ref.lastIndexOf('.') + 1)),
                size: 0,
                url: ref,
                createdAt: Date.now(),
              })
            }
            useScenarioStore.getState().loadScenario(scenario as never)
          })
          .catch((e) => {
            console.error('[reel] standalone pack boot failed:', e)
          })
        return () => {
          cancelled = true
        }
      }
      const preferredScenarioId =
        readSessionRoute().scenarioId ?? resolvePreferredScenarioId()
      const dispose = bootScenarioPersist({ preferredScenarioId })
      void bootUpstreamCharacter()
      return dispose
    }
    /*
     * URL ↔ state 路由：在 boot 之前先把 URL 读出来，决定"该加载哪本剧本"。
     * 优先级：?scn= > localStorage(lastEditedId) > db.activeId > demo 兜底。
     *
     * 同时在 URL 给了 ?tab= 时，立刻把 shellStore.activeTab 同步过去 —— 这样
     * 后续 mode↔tab 桥的 effect 不会把它刷掉为默认。
     */
    const urlRoute = readSessionRoute()
    if (urlRoute.tab) {
      useShellStore.getState().setActiveTab(urlRoute.tab)
    } else if (useShellStore.getState().activeTab === 'player') {
      // PLAYER 已迁移到主工程 Play workspace，工坊默认回 forge
      useShellStore.getState().setActiveTab('forge')
    }
    if (urlRoute.forgeView) {
      // 'assets'(素材库) 是节点级钻取视图，不作为可恢复路由 —— 强刷/分享链接落到
      // ?view=assets 时收敛回 'tree'，避免刷新后一点剧情树节点就跳进素材库
      // (2026-06-16 作者反馈；与 shellStore.merge 的同款收敛配对)。
      const bootView = urlRoute.forgeView === 'assets' ? 'tree' : urlRoute.forgeView
      useShellStore.getState().setForgeView(bootView)
    }
    const preferredScenarioId = resolvePreferredScenarioId()
    const dispose = bootScenarioPersist({ preferredScenarioId })
    // 跨工作台交接(走文件):剧本 boot 后,尝试把上游 active-character 注入为
    // 预置角色(读 .forgeax/games/<slug>/active-character.json 指针 → portrait)。
    // 无 slug / 无上游时静默 no-op,reel 仍可独立使用。
    void bootUpstreamCharacter()
    // boot 末尾先写一次 URL：保证刷新后 URL 与最终 store 状态一致（即使
    // preferred 找不到、回落到 demo，也把 demo 的 id 反写到 ?scn）
    writeSessionRouteFromState()
    const disposeRouteSync = installSessionRouteSync()
    // 挂载 sceneImageCache 的自动清理订阅 —— 每次 scenario.id 切换
    // （新建 / 切历史 / 导入）都会洗掉上一剧本的场景图缓存，避免旧图闪现。
    const disposeCacheReset = bootSceneCacheReset()
    // beforeunload / visibilitychange 双保险：关页面或切到后台前强制刷盘（只刷本地草稿）
    //   - beforeunload 在 F5、关 tab、关窗时触发
    //   - visibilitychange (hidden) 覆盖 iOS Safari / 部分移动端不触发 beforeunload 的场景
    //
    // 草稿持久化策略（2026-05）——
    //   - 本地草稿由 flushScenarioPersist 保存到 localStorage（刷新不丢），不会推磁盘
    //   - 如有未发布草稿 → 给 beforeunload 返回一个提示，阻止作者不小心关页面前没发布
    //   - 如有 mediaStore 上传 pending → 原有提示保留，优先级更高
    function flush(e?: BeforeUnloadEvent) {
      flushScenarioPersist()
      // 2026-05 · 用 atRiskIds（pending + failed）替代 pendingIds：
      //   Forge 反馈"刷新后丢 2 张图"，根因是 asset 写盘失败后 entry 变成 'failed'
      //   而 pendingIds 不包含 failed → beforeunload 不拦 → 用户一刷就悬空。
      //   现在 failed 也拦一次，至少给作者"先点重试再刷"的机会。
      const atRisk = useMediaStore.getState().atRiskIds()
      if (atRisk.length > 0 && e) {
        const msg = `还有 ${atRisk.length} 个媒体文件未落盘（可能正在保存或保存失败），刷新会丢失。建议先回 Forge 页点击失败图像重试，或稍候再刷新。`
        e.preventDefault()
        e.returnValue = msg
        return msg
      }
      return undefined
    }
    function onVis() {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onVis)
      dispose()
      disposeRouteSync()
      disposeCacheReset()
    }
  }, [persistence, playerOnly, renderOnly])

  // activeTab → mode 单向同步（activeTab 是唯一真相源，mode 仅作镜像兼容）
  //
  // 历史病根（2026-06 复盘，由 [tabdbg]/[modedbg] 运行时栈确认）：
  //   以前这里是**双向**两条 effect（mode→activeTab + activeTab→mode）。
  //   刷新后的天然失配（activeTab='player' hydrate + mode='editor' 默认）会让
  //   它们互相追逐而**永不收敛**——
  //     · mode→activeTab 读的是 *实时* useShellStore.getState().activeTab
  //     · activeTab→mode 读的是 *渲染闭包里* 的 activeTab（同一 commit 内已过期）
  //   两条 effect 在同一 commit 里看到不同的 activeTab，于是各自往相反方向纠正，
  //   每个 commit 都翻转一次 activeTab↔mode。每翻一次 activeTab，App 第 653 行就
  //   在 <ForgeTab/>↔<Player/> 之间换挂，**整棵 ForgeTab 子树被重挂**，其 mount
  //   effect 的 setState 累积成同步嵌套更新 → 触达 React 50 步上限 →
  //   "Maximum update depth exceeded"。清浏览器缓存没用，因为失配态每次都从
  //   磁盘/localStorage 重新水合出来。
  //
  // 根治：砍掉反向（mode→activeTab）那条，只留单向。activeTab 永远是源头，
  // 没有任何代码再根据 mode 回写 activeTab → 结构上不可能再 ping-pong。
  // 唯一的旧 setMode 调用方是 Player.exit()，已改为直接 setActiveTab('forge')，
  // 退出试玩仍会切回锻造台（再由本 effect 把 mode 镜像成 'editor'）。
  useEffect(() => {
    const target: 'editor' | 'player' =
      activeTab === 'player' ? 'player' : 'editor'
    if (target !== useScenarioStore.getState().mode) {
      setMode(target)
    }
  }, [activeTab, setMode])

  /*
   * player-only 表面（主工程 Play 区预览）——
   * 只渲染沉浸式 Player + Toast，零编辑器 chrome，避免界面嵌套。
   * 复用 .ks-app-root.is-playing 的全屏黑底样式。
   */
  if (renderOnly) {
    return <RenderStage />
  }

  if (playerOnly) {
    return (
      <div className="ks-app-root is-playing" data-surface="player">
        <main className="ks-app-body">
          <Player />
        </main>
        <ToastHost />
      </div>
    )
  }

  return (
    <div
      className={`ks-app-root ${
        activeTab === 'player' && pane === null ? 'is-playing' : ''
      } ${pane ? `is-pane-${pane}` : ''}`}
      data-pane={pane ?? undefined}
    >
      {/* 顶层渲染策略 (2026-05-29 重构):
       *   - pane='left'   → 渲染 <ReelSidebar />, 这是 sidebar iframe 的全部内容,
       *                     不再插入 TopBar (TopBar 默认是横向 grid 布局, 在 ~300px
       *                     侧边栏里挤不下); ReelSidebar 用 forgeax 同款控件配方,
       *                     提供文档头/视图/锻造视图/段子/状态栏 多层级线性引导.
       *   - pane='center' → 不渲染 TopBar (host 已有"返回工作台"bar 占顶部),
       *                     主区域 (ForgeTab/Player) + 抽屉 + Toast 全部正常.
       *                     PLAYER 也在中央内容区里渲染, 不再切全屏.
       *   - pane=null     → 独立运行 (npm run dev / 直接打开 dist), 行为与
       *                     改造前完全一致: TopBar 在顶 + 主区域 + 全屏 player. */}
      {pane === 'left' ? (
        <ReelSidebar />
      ) : (
        <>
          {pane !== 'center' && <TopBar />}
          <main className="ks-app-body">
            {activeTab === 'player' ? <Player /> : <ForgeTab />}
          </main>
          <InspectorDrawer />
          <ToastHost />
        </>
      )}
    </div>
  )
}

const appCss = `
.ks-app-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

/*
 * 2026-05 forgeax 集成 · split pane 适配.
 *
 * left pane 里的 .ks-app-root 不需要 100vw, 由父 iframe 决定宽度;
 * 整体竖排紧凑布局, 撑满 sidebar 列.
 *
 * .ks-topbar 默认是 grid 三列 (logo / mode tabs / 动作组), 在 ~300px
 * 的 sidebar 里挤得不能用. 这里覆盖成 flex column, 让 logo/标题/tab
 * 行/动作组依次叠在一起, 每段都拿到完整宽度. 这是 "尽量保留原 TopBar
 * 视觉" 的折中, 后续可以做 sidebar 专用的紧凑 TopBar 替换.
 */
.ks-app-root.is-pane-left,
.ks-app-root.is-pane-center {
  height: 100%;
  width: 100%;
}
/* left pane 现在渲染 ReelSidebar (而非 TopBar), sidebar 自身已撑满父容器,
 * 不需要再在 .ks-app-root 上加额外的 padding/margin. */
.ks-app-root.is-pane-left { display: flex; }
.ks-app-root.is-pane-left > .rs-sidebar { flex: 1; }
/* center pane 不渲染 TopBar, 主区域直接占满, 不需要额外样式 */
/* 嵌入 workbench 宿主（mount.tsx）时填满宿主容器 */
.ks-app-host {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.ks-app-host .ks-app-root {
  height: 100%;
  width: 100%;
}
.ks-app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  padding: 12px 16px 16px;
  gap: 16px;
}

/* ─────────────────────────────────────────────────────────
 * Playing 态 · 全屏沉浸试玩
 *   - 藏 TopBar（上移 + fade-out）
 *   - Body 内边距清零，撑满整个视口
 *   - 背景切黑，彻底吃掉浅色主题的边缘漏光
 *   - 覆盖 body::before / ::after 纸质纹理与光斑（它们在黑底上会发灰显脏）
 *   - 搭配右上角 .ks-playing-exit 悬浮返回按钮
 * ───────────────────────────────────────────────────────── */
.ks-app-root.is-playing {
  background: #000;
}
.ks-app-root.is-playing .ks-topbar {
  transform: translateY(-120%);
  opacity: 0;
  pointer-events: none;
  transition:
    transform var(--ks-dur-mid) var(--ks-ease),
    opacity var(--ks-dur-fast) var(--ks-ease);
}
.ks-app-root.is-playing .ks-app-body {
  padding: 0;
  gap: 0;
  background: #000;
}
/* 沉浸态下去掉 Player 的卡片圆角和外阴影 —— 让黑底和视频直接贴边 */
.ks-app-root.is-playing .ks-player {
  border-radius: 0;
  box-shadow: none;
}
.ks-app-root.is-playing .ks-player-empty {
  background: #000;
  color: rgba(255, 255, 255, 0.4);
}
/* 全屏播放时把 body 的背景纹理/光斑也盖掉，避免从 Player 周边透出 */
body:has(.ks-app-root.is-playing)::before,
body:has(.ks-app-root.is-playing)::after {
  opacity: 0;
}

`
injectStyleOnce('app-root', appCss)
