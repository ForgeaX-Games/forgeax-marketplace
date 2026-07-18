import type { Scenario } from '../scenario/types'
import { useSceneImageCache } from './sceneImageCache'

/**
 * hydrateSceneImagesFromDisk —— 刷新/首次加载剧本时，把磁盘里已有的场景图
 * 批量灌回 sceneImageCache（内存 store），让剧情树节点、BranchTreeOverlay 等
 * 订阅者立刻看到缩略图，而不是"点一下才显示"。
 *
 * 契约：
 *   - 仅遍历 IMAGE_* 类场景（VIDEO 走 mediaStore，不经 sceneImageCache）
 *   - 调用 loadFromDisk(id, prompt) —— 该方法幂等，且纯查询（不发网络请求、
 *     不消耗 token），因此可以安全地在每次 scenario 变更时调用
 *   - 返回成功恢复的场景数量（用于日志 / 计量 / 测试断言）
 *
 * 为什么不在 sceneImageCache 内部自动做：
 *   - cache 不应该依赖 Scenario 结构（解耦 —— cache 只管 sceneId 键值对）
 *   - 调用时机由 UI 层决定（App 挂载、Tab 切换、导入 JSON 后）
 *     —— 批量 hydrate 是"动作"，不是"状态"
 */
export function hydrateSceneImagesFromDisk(scenario: Scenario): number {
  const loader = useSceneImageCache.getState().loadFromDisk
  let restored = 0
  for (const [id, scene] of Object.entries(scenario.scenes)) {
    if (scene.media.kind === 'VIDEO') continue
    if (loader(id, scene.media.prompt)) restored += 1
  }
  return restored
}
