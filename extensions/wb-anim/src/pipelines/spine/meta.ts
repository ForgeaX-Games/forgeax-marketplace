// @source wb-character/src/pipelines/spine/meta.ts
import type { PipelineMeta } from '../../core/types'

export const meta: PipelineMeta = {
  id: 'spine',
  name: 'Spine 骨骼',
  icon: '🦴',
  description: '拆分部件 → 自动绑骨 → 动作工坊 → 导出',
  version: '2.1.0',
  placement: 'main',
  inputs: ['conceptImage'],
  outputs: ['spineSkel'],
  agentTags: ['character.spine', 'bone', 'animation'],
}
