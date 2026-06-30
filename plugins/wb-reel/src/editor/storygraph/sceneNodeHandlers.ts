/**
 * SceneNode 交互行为 —— 三个纯函数 + 一个事件常量。
 *
 * 把"用户操作 → store action"这一层从 React Flow 的事件参数里剥出来，
 * 让 StoryGraph 组件本身只剩一层薄薄的事件转发。三大好处：
 *
 *   1. 单测无需 mount react-flow / jsdom，直接验证语义。
 *   2. 行为可编排：B6 边交互、B7 工具栏 都能复用同样的"动作集合" 抽象。
 *   3. 拖拽提交策略（阈值 / 取整 / NaN 容错）集中在一处，不被 React 事件搅乱。
 *
 * 设计决策（2026-04 调整）：
 *
 *   - 单击 = selectScene + dispatchFocusStage
 *           直接打开二级详情抽屉（大画面 + Timeline + Prompt 浮层）。
 *           原「单击就地膨胀」方案已废弃：节点膨胀态与抽屉并存会让信息冗余，
 *           而且 React Flow 的双击识别在有 Handle/拖拽的节点上不稳定（实测双击
 *           常被识别成两次单击或拖拽启动，导致抽屉打不开）。改为单击直接进抽屉
 *           是更可靠的路径。
 *   - 双击 = 与单击同义（幂等再触发，兼容老肌肉记忆）
 *   - 拖停 = setScenePos（不 select；选择是单击的事，避免拖一下就误改属性面板）
 *   - 拖停坐标 round 到整数：避免 zundo history 里出现海量浮点 noise diff。
 *   - 拖动阈值 = 1px：低于这个抖动当作"误触"，不写 history。
 */

export const FOCUS_STAGE_EVENT = 'reel:focus-stage' as const

export interface SceneNodeActions {
  selectScene: (id: string) => void
  setScenePos: (id: string, pos: { x: number; y: number }) => void
  /**
   * 让 Stage 聚焦到某个场景。
   * 实现：shellStore.focusSceneInStage（打开 sceneDetailOpen + 置 stageSceneId）
   * + window 事件（过渡期兼容 StagePane 内部的 scrollIntoView/闪烁）。
   */
  dispatchFocusStage: (sceneId: string) => void
}

export function handleSceneNodeClick(id: string, a: SceneNodeActions): void {
  if (!id) return
  a.selectScene(id)
  a.dispatchFocusStage(id)
}

/**
 * 双击等同于单击 —— 保留此 handler 仅为绑定 ReactFlow onNodeDoubleClick 时的语义清晰
 * （幂等：focusSceneInStage 会 tick+1 触发 StagePane 重新滚动聚焦，不会破坏状态）。
 */
export function handleSceneNodeDoubleClick(
  id: string,
  a: SceneNodeActions,
): void {
  handleSceneNodeClick(id, a)
}

export function handleSceneNodeDragStop(
  id: string,
  pos: { x: number; y: number },
  a: SceneNodeActions,
): void {
  if (!id) return
  a.setScenePos(id, {
    x: safeInt(pos.x),
    y: safeInt(pos.y),
  })
}

/**
 * 拖动阈值 —— 移动距离不足 1 像素视为误触，不提交。
 * 用于 onNodeDrag/onNodeDragStop 之间的过滤逻辑。
 */
export function shouldCommitDrag(
  before: { x: number; y: number } | undefined,
  after: { x: number; y: number },
): boolean {
  if (!before) return true
  const dx = Math.abs(after.x - before.x)
  const dy = Math.abs(after.y - before.y)
  return dx >= 1 || dy >= 1
}

function safeInt(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n)
}
