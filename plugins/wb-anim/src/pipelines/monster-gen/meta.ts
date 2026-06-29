import type { PipelineMeta } from '../../core/types'

export const meta: PipelineMeta = {
  id: 'monster-gen',
  name: '怪物生成',
  icon: '👾',
  description: '8方向5动画怪物精灵 — 立绘生成 + 方向管线 + 自动组装打包',
  version: '1.0.0',
  placement: 'hidden',
  inputs: ['conceptImage'],
  outputs: ['spriteZip'],
  agentTags: ['monster.sprite', 'sprite', 'animation', 'internal'],
}
