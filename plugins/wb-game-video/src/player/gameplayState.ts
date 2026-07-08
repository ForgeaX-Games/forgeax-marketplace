import type { Scene } from '../scenario/types'
import { resolveInteraction } from './choiceTiming'

/**
 * 两级状态机 · 内层模式 —— 由 resolveInteraction 派生，Player 据此分派交互层。
 *
 * 外层 = 场景图导航(auto / branch)；内层 = 本模式决定挂哪套 UI：
 *   story  → 纯播放 + 台词/热点（含 calc 纯结算节点）
 *   choice → ChoiceLayer
 *   qte    → QTEOverlay
 *   battle → BossBattleOverlay
 */
export type GameplayInnerMode = 'story' | 'battle' | 'qte' | 'choice'

export function resolveInnerMode(scene: Scene | null | undefined): GameplayInnerMode {
  switch (resolveInteraction(scene).type) {
    case 'boss':
      return 'battle'
    case 'qte':
      return 'qte'
    case 'choice':
      return 'choice'
    default:
      return 'story'
  }
}

/** kind 缺省时按内层模式推断 HUD 方案。 */
export function inferHudPreset(scene: Scene): import('../scenario/gameplayTypes.js').HudPreset {
  if (scene.hudPreset) return scene.hudPreset
  switch (resolveInnerMode(scene)) {
    case 'battle':
      return 'battle'
    case 'qte':
      return 'main'
    case 'choice':
      return scene.mediaPlayMode === 'loop' ? 'main' : 'main'
    default:
      return scene.hotspots?.length ? 'explore' : 'main'
  }
}
