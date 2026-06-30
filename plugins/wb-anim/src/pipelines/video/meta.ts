// @source wb-character/src/pipelines/video/meta.ts
import type { PipelineMeta } from '../../core/types'

export const meta: PipelineMeta = {
  id: 'video',
  name: '视频角色',
  icon: '🎬',
  description: '角色视频 · 序列帧 · 场景展示',
  version: '2.0.0',
  placement: 'main',
  inputs: ['conceptImage'],
  outputs: ['videoClip', 'spriteZip'],
  agentTags: ['character.video', 'sprite', 'animation'],
}
