// @source wb-character/src/pipelines/vfx/meta.ts
import type { PipelineMeta } from '../../core/types'

export const meta: PipelineMeta = {
  id: 'vfx',
  name: 'Skill VFX',
  icon: '✨',
  description: 'Particle / shader / skill visual effects',
  version: '4.0.0',
  placement: 'main',
  inputs: ['spriteSheet'],
  outputs: ['vfxConfig'],
  agentTags: ['vfx', 'skill', 'effect'],
}
