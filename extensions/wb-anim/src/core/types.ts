import type * as THREE from 'three'

/* ── Pipeline Plugin Interface ───────────────────────────────────── */

/**
 * 管线在顶栏里的显示位置。
 *
 * - `main`：主 tab，始终显示在顶栏（角色生产主流水线）；
 * - `drawer`：收到右上角「⋯ 更多模块 ▾」下拉里（辅助工具/变体流程/实验性）；
 * - `hidden`：注册进 PipelineRegistry 但不在任何 UI 入口里显露——
 *   留给「被别的 UI 调用但不是独立用户入口」的管线（例如 monster-gen 被
 *   角色设计里的「怪物形态」按钮内部调用）。
 *
 * 缺省时按 `'drawer'` 处理，保证新写的管线不会无意间污染主干顶栏。
 */
export type PipelinePlacement = 'main' | 'drawer' | 'hidden'

/**
 * 管线在「管线图」里消费的主要上游产物类型。给智能体 / workbench
 * 发现「哪条管线应该接在我后面」用的；UI 不强制校验。
 *
 * - `conceptImage`：角色概念设计产出的单张立绘（所有形态通用）；
 * - `turnaroundSheet`：三视图 / 四视图参考稿（pixel-char 中间产物）；
 * - `spriteSheet`：已切帧的序列帧 atlas（pixel-char 产物，vfx 消费）；
 * - `vehicleSheet`：载具多视角参考稿（vehicle-design 中间产物）。
 */
export type PipelineInput =
  | 'conceptImage'
  | 'turnaroundSheet'
  | 'spriteSheet'
  | 'vehicleSheet'

/**
 * 管线的最终输出契约——给 workbench / 游戏工程落盘时消费。
 *
 * - `spriteZip`：含 `sprite-meta.json` + `<action>/atlas_<dir>.png` 的角色
 *   资源包（pixel-char / 未来的 monster 序列帧都走这个），对应
 *   `data/workspace/scripts/import-character.sh` 的消费格式；
 * - `vehicleZip`：载具资源包（同结构，含 `sprite-meta.json`）；
 * - `vfxConfig`：技能特效的 JSON 配置（可被游戏运行时加载）；
 * - `videoClip`：视频片段（.mp4）+ 提取出的关键帧；
 * - `spineSkel`：Spine 骨骼导出（.json + .atlas + .png）。
 */
export type PipelineOutput =
  | 'spriteZip'
  | 'vehicleZip'
  | 'vfxConfig'
  | 'videoClip'
  | 'spineSkel'

/**
 * 在 drawer 抽屉内的子分组，用于把管线按性质聚类显示。
 *
 * - `variant`：生产变体（默认）；
 * - `aux`：辅助工具（调试 / 检查 / 调参等）。
 *
 * 缺省按 `'variant'` 处理。
 */
export type PipelineGroup = 'variant' | 'aux'

export interface PipelineMeta {
  id: string
  name: string
  icon: string
  description: string
  version: string
  author?: string
  /** 顶栏显示位置。缺省按 `'drawer'` 处理。 */
  placement?: PipelinePlacement
  /** drawer 内的子分组。仅当 `placement === 'drawer'` 时有效，缺省 'variant'。 */
  group?: PipelineGroup
  /** 智能体发现标签——workbench 侧按 tag 匹配任务需求。 */
  agentTags?: string[]
  /** 声明本管线消费的上游产物。 */
  inputs?: PipelineInput[]
  /** 声明本管线的最终产物。 */
  outputs?: PipelineOutput[]
}

export interface PipelineContext {
  engine: IEngine
  sceneManager: ISceneManager
  characterPreview: ICharacterPreview
  eventBus: IEventBus
  workspacePath: string
}

export interface PipelinePanels {
  left: HTMLElement
  center: HTMLElement
  right: HTMLElement
  bottom: HTMLElement
  toolbar: HTMLElement
}

export interface IPipeline {
  meta: PipelineMeta
  init(ctx: PipelineContext): Promise<void>
  dispose(): void
  createUI(container: HTMLElement, panels?: PipelinePanels): void
  destroyUI(): void
  getDefaultParams(): Record<string, unknown>
  /**
   * Called when the user picks this pipeline from the character design page
   * for a (potentially new) character. Resets step progress to the beginning.
   *
   * May return a Promise — e.g. the pixel pipeline needs to wipe the previous
   * character's IndexedDB action-lib **before** `createUI` runs and reads the
   * stale data back in. Callers should `await` when possible.
   */
  resetForNewCharacter?(): void | Promise<void>
}

/* ── Model / Scene types ─────────────────────────────────────────── */

export interface ModelHandle {
  root: THREE.Group
  animations: THREE.AnimationClip[]
  mixer: THREE.AnimationMixer | null
}

export type SceneEntryKind = 'gltf' | 'procedural'

export interface SceneEntry {
  id: string
  name: string
  /** Default 'gltf' when omitted (backward compat). */
  kind?: SceneEntryKind
  /** Required when kind === 'gltf'. Relative URL to .glb/.gltf/.fbx/.obj. */
  file?: string
  /** Required when kind === 'procedural'. Key registered in SceneGeneratorRegistry. */
  generator?: string
  /** Arbitrary generator config passed through SceneManager.loadScene. */
  generatorOptions?: Record<string, unknown>
  thumbnail?: string
  camera?: CameraPreset
  lighting?: string
}

export interface SceneManifest {
  scenes: SceneEntry[]
  defaultScene: string
}

export interface CameraPreset {
  name: string
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

/* ── Generation Result ───────────────────────────────────────────── */

export type AssetType = 'model' | 'sprite' | 'animation' | 'vfx' | 'video' | 'texture'

export interface GeneratedFile {
  name: string
  path: string
  mimeType: string
}

export interface GenerationResult {
  pipelineId: string
  type: AssetType
  files: GeneratedFile[]
  previewData?: unknown
}

/* ── Thin interfaces for decoupling ──────────────────────────────── */

export interface IEngine {
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  scene: THREE.Scene
  /** Secondary scene rendered after the main pass; useful for HUD / always-on-top sprites. */
  overlayScene: THREE.Scene
  start(): void
  pause(): void
  resume(): void
  onUpdate(cb: (dt: number) => void): void
  removeUpdate(cb: (dt: number) => void): void
}

export interface ISceneManager {
  loadScene(id: string): Promise<void>
  getCurrentSceneId(): string | null
  getManifest(): SceneManifest | null
}

export interface ICharacterPreview {
  showModel(handle: ModelHandle): void
  showSprite?(animator: { mesh: THREE.Mesh; update(dt: number): void; dispose(): void }): void
  clear(): void
}

export interface IEventBus {
  on(event: string, handler: (...args: unknown[]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
  emit(event: string, ...args: unknown[]): void
}
