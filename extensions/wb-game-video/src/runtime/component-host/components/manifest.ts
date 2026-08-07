/**
 * 组件包本地契约形状 —— 不依赖平台 schema。
 * 宿主注册时再 `as ComponentManifest` / `as ComponentDef`。
 */
export type LocalComponentInput = {
  key: string
  label?: string
  valueType: 'string' | 'number' | 'boolean'
  required?: boolean
  default?: unknown
  options?: { value: string; label: string }[]
  min?: number
  step?: number
  component?: string
}

export type LocalComponentEvent = {
  id: string
  label?: string
}

export type LocalComponentManifest = {
  id: string
  label?: string
  inputs?: LocalComponentInput[]
  events: LocalComponentEvent[]
}
