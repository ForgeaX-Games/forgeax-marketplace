import type { IPipeline, PipelineContext, PipelinePanels } from '../../core/types'
import { meta } from './meta'
import { MonsterGenUI } from './MonsterGenUI'

let ctx: PipelineContext
let ui: MonsterGenUI | null = null

const pipeline: IPipeline = {
  meta,

  async init(context: PipelineContext) {
    ctx = context
  },

  dispose() {
    ui?.unmount()
    ui = null
  },

  createUI(container: HTMLElement, panels?: PipelinePanels) {
    if (!panels) {
      container.innerHTML = `<div style="padding:16px;color:var(--text-secondary)">
        怪物生成管线需要完整的面板布局（左/中/右/底）。
      </div>`
      return
    }
    ui = new MonsterGenUI()
    ui.mount(container, panels)
  },

  destroyUI() {
    ui?.unmount()
    ui = null
  },

  getDefaultParams() {
    return {
      api_key: '',
      model: 'nanobanana-pro',
      style: 'CEL_2D',
    }
  },
}

export default pipeline
