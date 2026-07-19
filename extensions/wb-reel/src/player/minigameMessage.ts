/**
 * 小游戏 iframe 消息契约（与 src/minigames/<id>/game.html 对应）
 *
 * 小游戏用 `window.parent.postMessage(...)` 向宿主 Player 发送事件。
 * 我们的约定：
 *
 *   {
 *     source: 'reel-minigame',
 *     id:     <minigameId>,              // 必须匹配 registry 里的 id，防止误信号
 *     type:   'minigame-ready' | 'minigame-win' | 'minigame-lose' | 'minigame-continue',
 *     score?: number,                    // 'win'/'lose' 可选携带最终分数
 *     reason?: 'give-up' | string,       // 'lose' 的可选原因
 *   }
 *
 * `parseMinigameMessage` 把 `MessageEvent.data` 严格解析为强类型
 * `MinigameEvent`，非匹配消息（其它组件也可能发 postMessage）都返回 null。
 *
 * 纯函数：不读 DOM、不访问 window。方便单元测试。
 */

export type MinigameEventType =
  | 'minigame-ready'
  | 'minigame-win'
  | 'minigame-lose'
  | 'minigame-continue'

export interface MinigameEvent {
  type: MinigameEventType
  id: string
  score?: number
  reason?: string
}

const VALID_TYPES: ReadonlySet<MinigameEventType> = new Set([
  'minigame-ready',
  'minigame-win',
  'minigame-lose',
  'minigame-continue',
])

export function parseMinigameMessage(data: unknown): MinigameEvent | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (obj.source !== 'reel-minigame') return null
  if (typeof obj.id !== 'string' || !obj.id) return null
  if (typeof obj.type !== 'string') return null
  if (!VALID_TYPES.has(obj.type as MinigameEventType)) return null

  const out: MinigameEvent = {
    type: obj.type as MinigameEventType,
    id: obj.id,
  }
  if (typeof obj.score === 'number' && Number.isFinite(obj.score)) {
    out.score = obj.score
  }
  if (typeof obj.reason === 'string' && obj.reason.length > 0) {
    out.reason = obj.reason
  }
  return out
}
