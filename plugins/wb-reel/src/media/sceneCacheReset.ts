import { useScenarioStore } from '../scenario/scenarioStore'
import { useSceneImageCache } from './sceneImageCache'

/**
 * 订阅 scenario.id 变化，自动清空 sceneImageCache。
 *
 * 为什么不直接在 scenarioStore.newScenario 里 clear？
 *   sceneImageCache → scenarioStore 已经存在 import 依赖；反向 import 会
 *   形成运行时循环依赖（虽然 TS 能过，但实际执行顺序会出现
 *   "undefined 的 getState()"这种诡异错误）。
 *   把"跨 store 联动"统一挂在这个独立的 reset boot 模块里，由 App 启动时
 *   显式调一次订阅即可，代码流向单向、好测。
 *
 * 什么时候 id 会变？
 *   - newScenario() —— 作者点 ➕
 *   - loadScenarioFromHistory() —— 作者在历史下拉里切剧本
 *   - importJSON() —— 外部导入
 *   - forge 锻造完写入结果（新 id 生成）
 *
 * 不只针对"新建"，因为任意 id 切换都应该洗掉上一个剧的图片缓存，
 * 避免旧剧的图闪进新剧的画布。
 */

let _unsubscribe: (() => void) | null = null

export function bootSceneCacheReset(): () => void {
  if (_unsubscribe) {
    return _unsubscribe
  }
  let prevId = useScenarioStore.getState().scenario.id
  const unsub = useScenarioStore.subscribe((state) => {
    const nextId = state.scenario.id
    if (nextId === prevId) return
    prevId = nextId
    useSceneImageCache.getState().clear()
  })
  _unsubscribe = () => {
    unsub()
    _unsubscribe = null
  }
  return _unsubscribe
}

/** 测试用：重置内部 _unsubscribe 让下次 boot 能重新挂。 */
export function __resetSceneCacheResetForTest(): void {
  if (_unsubscribe) _unsubscribe()
}
