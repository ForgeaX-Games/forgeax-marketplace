import type { IPipeline, PipelineContext } from '../../core/types'

/**
 * 管线模板
 *
 * 复制此文件夹并重命名即可创建新管线。
 * PipelineRegistry 会自动发现所有 pipelines/xxx/index.ts 文件。
 *
 * 步骤:
 *   1. 复制 _template/ 到 pipelines/my-pipeline/
 *   2. 修改 meta.id, meta.name 等
 *   3. 实现 init()、createUI() 和生成逻辑
 *   4. Vite HMR 自动热更新
 */

let ctx: PipelineContext

const pipeline: IPipeline = {
  meta: {
    id: '_template',
    name: '模板',
    icon: '📋',
    description: '管线开发模板 — 复制此文件夹开始开发',
    version: '1.0.0',
  },

  async init(context: PipelineContext) {
    ctx = context
  },

  dispose() {},

  createUI(container: HTMLElement) {
    container.innerHTML = `
      <div style="padding: 8px; color: var(--text-secondary);">
        <p>这是管线开发模板。复制 <code>pipelines/_template/</code> 文件夹即可创建自己的管线。</p>
        <p style="margin-top: 8px;">实现 <code>IPipeline</code> 接口并 export default 导出。</p>
      </div>
    `
  },

  destroyUI() {},

  getDefaultParams() {
    return {}
  },
}

export default pipeline
