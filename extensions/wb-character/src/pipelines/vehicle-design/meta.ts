import type { PipelineMeta } from '../../core/types'

export const meta: PipelineMeta = {
  id: 'vehicle-design',
  name: '载具设计',
  icon: '🚀',
  description: '载具设定 → 多视角参考图，完成后跳转动画工作台',
  version: '1.0.0',
  placement: 'drawer',
  group: 'variant',
  inputs: [],
  outputs: ['vehicleSheet'],
  agentTags: ['vehicle', 'design'],
}
