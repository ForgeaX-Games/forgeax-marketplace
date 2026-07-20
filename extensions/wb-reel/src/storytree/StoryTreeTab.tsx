import { useShellStore } from '../shell/shellStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { SceneDetailDrawer } from './SceneDetailDrawer'
import { EpisodeRail } from './EpisodeRail'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * StoryTreeTab —— 剧情树工作台「内容区」(pane=center, 2026-06 重构).
 *
 * 节点切换/增删/分支可视化都在**最左侧边栏**的 SceneMiniMap (pane=left iframe).
 *   crossPaneSync 把 left 的选中/CRUD 毫秒级镜像到 center.
 *
 * 因此 center 只剩:
 *   1. 选中某节点 → 全屏「剧情维护二级页」(SceneDetailDrawer inline)
 *   2. 没选中    → 空态引导(提示去左栏点节点)
 *
 * (2026-06-14: 去掉了原先右上角「图总览」浮层 —— 左栏 mini 连线图已经承载
 *  了分支可视化, 内容区不再需要重复的图.)
 */
export function StoryTreeTab() {
  const selectedSceneId = useScenarioStore((s) => s.selectedSceneId)
  const stageSceneId = useShellStore((s) => s.stageSceneId)
  const detailSceneId = stageSceneId ?? selectedSceneId

  const sceneExists = useScenarioStore((s) =>
    Boolean(detailSceneId && s.scenario.scenes[detailSceneId]),
  )
  /*
   * 2026-06-14 修「点节点 → 详情不打开」回归:
   *   原条件 `sceneDetailOpen && sceneExists` 依赖跨 pane 的 sceneDetailOpen 标志
   *   从 left iframe 广播到 center —— 这条 BroadcastChannel 信号偶发丢失/早于
   *   center 订阅就发出, 结果 center 一直停在空态。
   *   selectedSceneId 走 scenarioStore 镜像 (有契约测试, 左栏高亮也靠它), 是最
   *   可靠的同步量。剧情树本就是"选中节点=编辑该节点"的工作流, 故详情显示只看
   *   "选中了一个存在的节点"即可, 不再硬依赖 sceneDetailOpen。
   */
  const showDetail = sceneExists

  return (
    <div className="ks-tree-tab">
      {/* 剧情树详情(中间内容区)不再重复显示生成队列 —— 左侧边栏已有一份。 */}
      <EpisodeRail showQueue={false} />
      <section className="ks-tree-stage">
        {showDetail && detailSceneId ? (
          <SceneDetailDrawer
            key={detailSceneId}
            sceneId={detailSceneId}
            variant="inline"
          />
        ) : (
          <div className="ks-tree-stage-empty">
            <div className="ks-tree-stage-empty-glyph" aria-hidden>
              ◫
            </div>
            <div className="ks-tree-stage-empty-title">选一个节点开始编辑</div>
            <div className="ks-tree-stage-empty-hint">
              在左侧边栏的剧情树连线图里点任意节点，这里会全屏打开它的画面、时间轴与资产生成；
              连线显示节点之间的分支关系。
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

const css = `
.ks-tree-tab {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  /*
   * 2026-06-14: 内容区要"全屏铺满"——去掉毛玻璃卡的圆角/边框/背景，
   * 让 inline 节点详情直接贴满内容区边缘，不再有外圈留白/描边。
   */
  border-radius: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}
.ks-tree-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  overflow: hidden;
}

/* 空态 */
.ks-tree-stage-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}
.ks-tree-stage-empty-glyph {
  font-size: 44px;
  color: var(--ks-text-faint);
  opacity: 0.6;
}
.ks-tree-stage-empty-title {
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 15px;
  font-weight: 700;
  color: var(--ks-text);
}
.ks-tree-stage-empty-hint {
  font-size: 12px;
  color: var(--ks-text-soft);
  max-width: 360px;
  line-height: 1.6;
}
`
injectStyleOnce('tree-tab', css)
