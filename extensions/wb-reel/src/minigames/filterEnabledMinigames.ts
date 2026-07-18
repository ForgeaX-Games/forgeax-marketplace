import type { MinigameDescriptor } from './registry'

/**
 * 按启用池过滤小游戏。
 * enabledIds 为空/undefined → 返回全部（向后兼容：未配置池=全部可用）。
 * 否则只返回 id 命中的，且保持 all 的原始顺序。
 */
export function filterEnabledMinigames(
  all: MinigameDescriptor[],
  enabledIds: string[] | undefined,
): MinigameDescriptor[] {
  if (!enabledIds || enabledIds.length === 0) return all
  return all.filter((m) => enabledIds.includes(m.id))
}
