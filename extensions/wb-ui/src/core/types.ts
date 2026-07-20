export type PipelinePlacement = 'main' | 'drawer' | 'hidden'

export interface PipelineMeta {
  id: string
  name: string
  icon: string
  description: string
  version: string
  placement?: PipelinePlacement
  agentTags?: string[]
  inputs?: unknown[]
  outputs?: unknown[]
}

export interface PipelineContext {
  workspacePath?: string
}

export interface PipelinePanels {
  center: HTMLElement
  right: HTMLElement
  bottom: HTMLElement
  toolbar: HTMLElement
}

export interface IPipeline {
  meta: PipelineMeta
  init(context: PipelineContext): Promise<void> | void
  dispose?(): void
  createUI(container: HTMLElement, panels?: PipelinePanels): void
  destroyUI?(): void
  getDefaultParams?(): Record<string, unknown>
  resetForNewCharacter?(): void
}
