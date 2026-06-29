/**
 * 像素角色 sprite 渲染相关的共享类型定义。
 *
 * 这里抽出来，是为了让 `core/VfxSystem.ts` / `core/SpriteAnimator.ts` 不再
 * 反向依赖 `pipelines/pixel-char/action-lib.ts`——pixel-char 已经全部迁到
 * `wb-anim` 里去了，wb-character 只保留概念设计图产出 + 少量共享 core/UI。
 *
 * 真正的运行时逻辑（IndexedDB 存取、批次/动作库管理）在 `wb-anim` 的同名
 * `pipelines/pixel-char/action-lib.ts` 里。两边维护同一份 type 形状即可。
 */

export type VfxType = 'slash' | 'impact' | 'aura' | 'projectile'

export interface VfxBinding {
  type: VfxType
  startFrame: number
  duration: number
  color: string
  scale: number
  /**
   * 原始特效 id（例如 `starblade` / `weaponslash` / `dashtrail` / `attack`）。
   * 可选——老 manifest 里没有时退化到仅用 `type` 的通用粒子。游戏侧 VfxOverlay
   * 优先用 effectId 查富实现；没有才走 type 兜底。
   */
  effectId?: string
}

export interface SkillMeta {
  name: string
  damage: number
  range: number
  cooldown: number
  triggerFrame: number
  vfx?: VfxBinding
}
