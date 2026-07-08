/**
 * Player 占位底（IMAGE_PROMPT 场景没有预生成图时显示）的 class/动画策略。
 *
 * 历史：曾经 pending 态叠 4s 循环扫描条 + 青蓝径向渐变，切场景时看起来
 * 是"一直闪蓝"。现在硬约束：pending / error 态**只换静态配色**，
 * 不能带任何周期性动画，否则视觉上就是在闪。
 *
 * 纯函数 + 常量，既容易被测试锁死，又让 Player.tsx 里 JSX 的 className
 * 算法不用再写 `${isPending ? 'is-pending' : ''}` 这种手工拼接。
 */

export type PlaceholderBgStatus = 'idle' | 'pending' | 'error'

export function placeholderBgClass(status: PlaceholderBgStatus): string {
  if (status === 'pending') return 'ks-player-bg is-pending'
  if (status === 'error') return 'ks-player-bg is-error'
  return 'ks-player-bg'
}

export const PLACEHOLDER_BG_ANIMATION_NONE = 'none'
