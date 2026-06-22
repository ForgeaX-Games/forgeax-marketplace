import type { PipelineMeta } from '../../core/types'

export const meta: PipelineMeta = {
  id: 'vehicle-design',
  name: '载具动画',
  icon: '🚀',
  description: '多视角参考 → 动画生成 → 帧导出（设定图请在角色设计工作台生成）',
  version: '1.0.0',
  placement: 'main',
  outputs: ['vehicleZip'],
  agentTags: ['vehicle', 'sprite', 'animation'],
}
