import type { PipelineMeta } from '../../core/types'

export const meta: PipelineMeta = {
  id: 'pixel-char',
  name: '角色动画',
  icon: '🎮',
  description: 'Q版小人四方向 sprite sheet：设计图 → 四方向参考 → 动作生成 → 帧导出',
  version: '5.0.0',
  placement: 'main',
  inputs: ['conceptImage'],
  outputs: ['spriteZip'],
  agentTags: ['character.sprite', 'pixel', 'animation'],
}
