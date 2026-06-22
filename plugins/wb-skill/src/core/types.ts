// @source wb-character/src/core/types.ts
import type * as THREE from 'three'

/* ── Pipeline Plugin Interface ───────────────────────────────────── */

export type PipelinePlacement = 'main' | 'drawer' | 'hidden'

export type PipelineInput =
  | 'conceptImage'
  | 'turnaroundSheet'
  | 'spriteSheet'
  | 'vehicleSheet'

export type PipelineOutput =
  | 'spriteZip'
  | 'vehicleZip'
  | 'vfxConfig'
  | 'videoClip'
  | 'spineSkel'

/** drawer 内的子分组：variant（生产变体，默认）/ aux（辅助工具）。 */
export type PipelineGroup = 'variant' | 'aux'

export interface PipelineMeta {
  id: string
  name: string
  icon: string
  description: string
  version: string
  author?: string
  placement?: PipelinePlacement
  /** drawer 内的子分组，仅当 placement === 'drawer' 有效，缺省 'variant'。 */
  group?: PipelineGroup
  agentTags?: string[]
  inputs?: PipelineInput[]
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
