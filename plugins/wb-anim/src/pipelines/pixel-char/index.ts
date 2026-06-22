import type { IPipeline, PipelineContext, PipelinePanels } from '../../core/types'
import { meta } from './meta'
import { globalState } from '../../shared/GlobalState'
import type { ImageModel } from '../../shared/ImageModel'
import { forgeaxHost } from '../../platform/HostSdkBridge'
import { apiModelIdForImageModel } from '../../shared/promptRouter'
import { adaptPromptForImageModel } from '../../shared/promptAdapter'
import { CHIBI_ACTIONS, DIR_LABELS, getAction, type ChibiAction, type Direction } from './actions'
import { generateTurnaroundPrompt, generateSheetPrompt, generateTemplatePrompt, generatePoseTransferPrompt, generateSingleDirectionPrompt, type StyleContext, type TurnaroundModel } from './prompt-engine'
import { ART_STYLES, DEFAULT_ART_STYLE_ID, getArtStyleOrDefault } from './art-styles'
import { GAMEPLAY_MODES, DEFAULT_GAMEPLAY_MODE, applyGameplayMode, filterActionsForMode, getGameplayMode, type GameplayMode } from './gameplay-modes'
import { CHARACTER_TYPES, DEFAULT_CHARACTER_TYPE, applyCharacterType, getCharacterType, type CharacterType } from './character-types'
import {
  composeChibiTemplate, splitSheetByDirection,
  removeAnyBackground, ensureAllFramesBgRemoved, ensureFrameBgRemoved,
  unifyActionFrames, autoCenterCanvases,
  expandGreenBackground,   extractReferenceAnchors,
  validateSheetGrid,
  normalizeFrameSize, getMaxFrameSize, normalizeAllActions,
  ALIGN_MODES,
  createGifPreview, canvasArrayToDataUrls,
  measureActionContentHeight, clampScale, rescaleDirections,
  type GifPreviewHandle, type AlignMode, type AnchorPoint,
} from './sprite-processor'
import { computeSheetLayout } from './sheet-layout'
import { applyHideableTo } from '../../shared/HideableImage'
import {
  savePixelAction, loadAllPixelActions, removePixelAction, removePixelActionsByActionId,
  clearPixelActionLib, clearAllBatches, updatePixelActionScale,
  saveBatch, listBatches, loadBatch, deleteBatch,
  type PixelActionLibEntry, type GenerationBatchEntry, type BatchActionResult,
  type SkillMeta, type VfxBinding, type VfxType,
} from './action-lib'
import {
  MANIFEST_SCHEMA_VERSION,
  type CharacterManifest,
  type ExportedAction,
  type ExportedDirection,
  type ExportedSkill,
  type ExportDirection,
} from './exportManifest'
import { MountPointId } from './types/MountPointId'
import { SpriteAnimator, type SpriteActionData } from '../../core/SpriteAnimator'
import { VfxSystem } from '../../core/VfxSystem'
import { getCharacterRenderPanel } from '../../core/CharacterRenderPanel'
import { CharacterController, getCharacterController, snapMeshToGround } from '../../core/CharacterController'
import {
  sessionAutoSave, sessionLoad, sessionDelete,
} from '../../shared/PipelineSessionStore'
import { notifyDetectedDims, registerSpriteMesh, unregisterSpriteMesh } from '../../vfx/mount/SharedAdapter'
import { trackCharSprite, untrackCharSprite } from '../../vfx/mount/CharPosTracker'
import { getVFXManager } from '../../vfx/VFXManager'

/* ── Constants ────────────────────────────────────────────────────── */

const CSS_ID = 'pixel-pipeline-css'
const STORAGE_KEY = 'pixel-pipeline:cfg'
const PIPELINE_ID = 'pixel-char'

function pxIcon(name: string, cls = 'px-icon'): string {
  const paths: Record<string, string> = {
    directions: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M12 5v14M5 12h14"/>',
    sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    map: '<path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/>',
    jump: '<path d="M6 19c5-10 9-10 12 0"/><path d="M8 15h3l2-4 3 2"/><circle cx="13" cy="6" r="2"/>',
    mirror: '<path d="M12 3v18"/><path d="M8 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3"/><path d="M16 7h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3"/>',
    pixels: '<rect x="4" y="4" width="5" height="5"/><rect x="15" y="4" width="5" height="5"/><rect x="4" y="15" width="5" height="5"/><rect x="15" y="15" width="5" height="5"/>',
    mosaic: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/><path d="M8 8h8v8H8z"/>',
    fold: '<path d="M4 20 20 4"/><path d="M5 5h14v14"/><path d="M8 16h8V8"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    brush: '<path d="M9 18c-2 0-4 1-5 3 3 0 6 0 7-2"/><path d="M20 4 10 14"/><path d="m14 6 4 4"/>',
    frame: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 5v14M16 5v14M4 9h16M4 15h16"/>',
    vector: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M8 5h8v8"/>',
    scissors: '<circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.6 8.6 19 19M8.6 15.4 19 5"/>',
    palette: '<path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 4-4 4h-1.5a1.5 1.5 0 0 0 0 3H17c1 0 1.5.7 1.2 1.4A10 10 0 0 1 12 22Z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/><circle cx="16.5" cy="11.5" r="1"/>',
    cube: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    pen: '<path d="m12 19 7-7 3 3-7 7-4 1 1-4Z"/><path d="m18 13-7-7-6 6 7 7"/>',
    box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12A9 9 0 0 1 18.3 5.6"/><path d="M3 19v-5h5"/><path d="M21 5v5h-5"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    users: '<path d="M16 21a6 6 0 0 0-12 0"/><circle cx="10" cy="7" r="4"/><path d="M22 21a5 5 0 0 0-4-4.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-5-5L5 19"/>',
    film: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 5v14M16 5v14M4 9h16M4 15h16"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    sparkles: '<path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/><path d="m5 14 .8 1.8L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-1.2L5 14Z"/>',
  }
  const icon = paths[name] ?? paths.pixels
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg>`
}

function pixelArtStyleIcon(id: string): string {
  const map: Record<string, string> = {
    'match-reference': 'mirror',
    'pixel-16bit': 'pixels',
    'pixel-32bit': 'mosaic',
    origami: 'fold',
    'hd-2d': 'layers',
    'hand-drawn-cartoon': 'brush',
    'cel-anime': 'frame',
    'vector-flat': 'vector',
    'paper-cut': 'scissors',
    watercolor: 'palette',
    voxel: 'cube',
    crayon: 'pen',
  }
  return pxIcon(map[id] ?? 'pixels', 'px-icon px-style-svg')
}

/**
 * Translate the in-memory `collectBlobs()` keys (turnaround, sheet:<id>,
 * clean:<id>, frames:<actionId>:<dir>:<i>) into the stable on-disk path under
 * <projectRoot>/.forgeax/games/<slug>/characters/<charId>/pixel/. Returns
 * null for keys we don't want to mirror (currently: nothing, but keep the
 * escape hatch for future blob types like preview gifs).
 */
function blobKeyToRel(key: string): string | null {
  if (key === 'turnaround') return 'pixel/turnaround.png'
  if (key.startsWith('sheet:')) return `pixel/sheets/${key.slice('sheet:'.length)}.png`
  if (key.startsWith('clean:')) return `pixel/clean/${key.slice('clean:'.length)}.png`
  if (key.startsWith('frames:')) {
    const rest = key.slice('frames:'.length).replace(/:/g, '/')
    return `pixel/frames/${rest}.png`
  }
  return null
}

type Step = 1 | 2
type GenMode = 'direct' | 'template'

/* ── State: config (persisted) + images (memory only) ──────────── */

interface PixelConfig {
  activeStep: Step
  turnaroundUserDesc: string
  pixelStyle: string
  /** Gameplay mode: 'rpg' (4-direction top-down) | 'platformer' (side-view). */
  gameplayMode: GameplayMode
  /** Art-style preset id from ART_STYLES, e.g. 'pixel-16bit'. */
  artStyleId: string
  /** Character type: 'humanoid' (biped rules) | 'monster' (anatomy-driven). */
  characterType: CharacterType
  fps: number
  genMode: GenMode
  selectedActions: string[]
  alignMode: AlignMode
  targetFrameSize: number // 0 = auto (max across all actions), >0 = fixed px
  turnaroundModel: TurnaroundModel
}

interface ImageCache {
  turnaroundImage: string | null
  actionSheets: Record<string, string>
  cleanSheets: Record<string, string>
  splitFrames: Record<string, Record<string, string[]>>
  referenceAnchors: Record<string, AnchorPoint>
  actionPrompts: Record<string, string>
}

/**
 * 空 `ImageCache`——"刚进入像素管线 / 刚切到新角色"时应该看到的图像状态。
 *
 * 抽成独立函数的原因：
 *   - class 构造器里用它做字段初值；
 *   - `clearWorkspace()` 里用同一份 shape 做「清空」——避免两处手写漏掉某个
 *     新加字段（`referenceAnchors` / `actionPrompts` 就是历史上补充上来的）；
 *   - 单测直接断言它返回的每个桶都为空，不用把整个 PixelPipelineUI 拉起来。
 */
export function createEmptyImageCache(): ImageCache {
  return {
    turnaroundImage: null,
    actionSheets: {},
    cleanSheets: {},
    splitFrames: {},
    referenceAnchors: {},
    actionPrompts: {},
  }
}

/**
 * 纯函数版本——把 profile 作为参数传入，便于测试。
 * `inferCharacterTypeFromProfile()` 是基于 `globalState.profile` 的 wrapper。
 */
export function pickCharacterTypeForProfile(
  p: { characterRole?: string; monsterThreat?: string; monsterBodyType?: string; bodyType?: string } | null | undefined,
): CharacterType {
  if (!p) return DEFAULT_CHARACTER_TYPE

  // hero / npc：永远是 humanoid——即便用户在"形态"里挑了 mascot / beast /
  // mecha 这类非人形 preset，那也是**角色设计阶段**的美术风格输入（吉祥物形
  // 的主角仍然按双足动画来走），不应该覆盖像素管线的 characterType。
  if (p.characterRole === 'hero' || p.characterRole === 'npc') return 'humanoid'

  if (p.characterRole === 'monster') {
    if (p.monsterThreat === 'boss' || p.monsterThreat === 'elite') return 'monster'
    if (p.monsterBodyType === 'giant' || p.monsterBodyType === 'heavy') return 'monster'
    return 'creature-small'
  }

  // 纯旧数据兼容：没 characterRole 字段的 localStorage，此时才让 bodyType 兜底。
  if (p.bodyType && p.bodyType !== 'humanoid') return 'monster'
  return DEFAULT_CHARACTER_TYPE
}

/**
 * 从上游角色设计（CharacterDesign 阶段写入的 globalState.profile）推导出像素
 * 管线要用的 characterType。
 *
 * 用户显式要求："动画生成这里的角色类型就不用了，按照设定生成即可"——所以
 * 这条管线不再有独立 UI 字段，而是每次 refresh 时都重新推导，保证跟上游一致。
 *
 * 映射规则：
 *   - characterRole = hero / npc       → humanoid
 *   - characterRole = monster
 *       · monsterThreat ∈ { boss, elite }       → monster（大型 BOSS）
 *       · monsterBodyType ∈ { giant, heavy }    → monster（大型）
 *       · 其他（含 default / agile / compact / 未设）  → creature-small
 *   - 旧数据：bodyType !== 'humanoid'    → monster（保持向后兼容）
 */
export function inferCharacterTypeFromProfile(): CharacterType {
  try {
    return pickCharacterTypeForProfile(globalState.profile)
  } catch { /* ignore — globalState may not be initialised yet */ }
  return DEFAULT_CHARACTER_TYPE
}

/** @deprecated 保留旧名兼容，等同于 `inferCharacterTypeFromProfile()` */
function inferDefaultCharacterType(): CharacterType {
  return inferCharacterTypeFromProfile()
}

/**
 * Fresh-install default for `selectedActions`.
 *
 * - Hero (default): idle / walk / attack / death — 一个可玩的最小子集，覆盖
 *   走动 + 基础战斗 + 死亡。
 * - NPC (职业路人): idle / walk — 路人没有武器、没有大招，生成 attack /
 *   ultimate 纯属浪费模型调用。用户可以在 Step 2 勾选框里自己加回来。
 *
 * 说明：这只影响「第一次使用」的默认值。已有 localStorage 配置的用户切换
 * 角色定位时不会被自动覆写——Step 2 的 UI 上会提示建议选择范围，让他们自
 * 己决定。
 */
function inferDefaultSelectedActions(): string[] {
  try {
    if (globalState.profile?.characterRole === 'npc') return ['idle', 'walk']
  } catch { /* ignore — globalState may not be initialised yet */ }
  return ['idle', 'walk', 'attack', 'death']
}

function loadConfig(): PixelConfig {
  const defaults: PixelConfig = {
    activeStep: 1,
    turnaroundUserDesc: '',
    pixelStyle: '',
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
    artStyleId: DEFAULT_ART_STYLE_ID,
    characterType: inferDefaultCharacterType(),
    fps: 8,
    genMode: 'direct',
    selectedActions: inferDefaultSelectedActions(),
    alignMode: 'waist',
    targetFrameSize: 0,
    // 动画生图统一走 nano(Gemini)。早期把它默认成 gpt-image-2、并为 image 重写过
    // 提示词,反而把调好的 nano 效果弄乱(跳跃侧视图把整张设定图都画上去等)。
    // UI 的模型选择器已移除,这里强制 gemini;持久化里若有旧的 gpt-image-2 也在
    // 下面 merge 时被强制纠正回来。
    turnaroundModel: 'gemini',
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PixelConfig>
      const merged = { ...defaults, ...parsed } as PixelConfig
      // Legacy configs may predate gameplayMode/artStyleId/characterType or carry invalid ids.
      if (!GAMEPLAY_MODES.some(m => m.id === merged.gameplayMode)) merged.gameplayMode = DEFAULT_GAMEPLAY_MODE
      if (!ART_STYLES.some(s => s.id === merged.artStyleId)) merged.artStyleId = DEFAULT_ART_STYLE_ID
      if (!CHARACTER_TYPES.some(t => t.id === merged.characterType)) merged.characterType = defaults.characterType
      // If storage predated characterType entirely, infer from profile now.
      if (parsed.characterType === undefined) merged.characterType = defaults.characterType
      // 动画统一走 nano:无视旧档里残留的 gpt-image-2 选择,一律纠正为 gemini。
      merged.turnaroundModel = 'gemini'
      return merged
    }
  } catch { /* ignore */ }
  return defaults
}

function saveConfig(c: PixelConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

function migrateOldStorage(): string | null {
  try {
    const old = localStorage.getItem('pixel-pipeline:state')
    if (old) {
      const parsed = JSON.parse(old)
      localStorage.removeItem('pixel-pipeline:state')
      return parsed.turnaroundImage || parsed.fourViewImage || null
    }
  } catch { /* ignore */ }
  return null
}

async function apiPost(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/**
 * 探测一个 pose-template 资源是否真的可作为图片加载。
 *
 * 仅看 HTTP 200 不够:dev server 对不存在的静态路径会回退 SPA index.html
 * (200 + text/html),那不是图片。这里先发 HEAD 看 content-type 是否 image/*,
 * 拿不到头信息(HEAD 不被支持等)时再真正用 <img> 试加载一次兜底。任何失败都
 * 返回 false,让调用方走标准生成路径,而不是整条动作生成失败。
 */
async function templateAssetLoadable(src: string): Promise<boolean> {
  try {
    const res = await fetch(src, { method: 'HEAD' })
    if (res.ok) {
      const ct = res.headers.get('content-type') || ''
      if (ct.startsWith('image/')) return true
      if (ct) return false // 明确不是图片(多半是 SPA 回退的 text/html)
    }
  } catch { /* HEAD 不支持 → 下面真加载兜底 */ }
  try {
    await loadImageElement(src)
    return true
  } catch {
    return false
  }
}

/**
 * Aspect ratios actually accepted by `gemini-3-pro-image-preview`.
 *
 * The previous list included `1:4 / 1:8 / 4:1 / 8:1` which the image model
 * rejects with `Aspect ratio X:Y is not supported for this model`. Keep this
 * list in sync with what the upstream model publishes; going wider than 21:9
 * or taller than 9:21 is currently impossible, so we cap at those and let
 * the sprite-sheet logic below wrap wide strips into multiple rows when
 * needed.
 */
const GEMINI_RATIOS: [number, number, string][] = [
  [1, 1, '1:1'],
  [2, 3, '2:3'], [3, 2, '3:2'],
  [3, 4, '3:4'], [4, 3, '4:3'],
  [4, 5, '4:5'], [5, 4, '5:4'],
  [9, 16, '9:16'], [16, 9, '16:9'],
  [9, 21, '9:21'], [21, 9, '21:9'],
]

const MAX_RATIO = 21 / 9
const MIN_RATIO = 9 / 21

function nearestGeminiRatio(w: number, h: number): string {
  // Cap ratios that would otherwise snap to unsupported extremes (e.g. a 7:1
  // boss strip) to the widest/tallest supported shape. Callers that need
  // more aggressive shapes must wrap their layout into multiple rows/cols
  // (see `layoutGrid()` below).
  const raw = w / h
  const target = Math.max(MIN_RATIO, Math.min(MAX_RATIO, raw))

  let best = GEMINI_RATIOS[0][2]
  let bestDist = Infinity
  for (const [rw, rh, label] of GEMINI_RATIOS) {
    const dist = Math.abs(rw / rh - target)
    if (dist < bestDist) { bestDist = dist; best = label }
  }
  return best
}


/* ── UI Class ─────────────────────────────────────────────────────── */

let ctx: PipelineContext

class PixelPipelineUI {
  private cfg: PixelConfig
  private img: ImageCache = createEmptyImageCache()
  private panels: PipelinePanels | null = null
  private leftEl: HTMLElement | null = null
  private generating = false
  private regenQueue: Array<{ type: 'action'; actionId: string } | { type: 'direction'; actionId: string; direction: Direction }> = []
  private gifHandles = new Map<string, GifPreviewHandle[]>()
  private actionLib: PixelActionLibEntry[] = []
  private batchHistory: GenerationBatchEntry[] = []
  private batchHistoryExpanded = false
  private leftTab: 'edit' | 'lib' = 'edit'
  private selectedLibActionId: string | null = null
  private expandedBatchId: string | null = null
  private viewingBatchId: string | null = null

  private currentSpriteAnimator: SpriteAnimator | null = null
  private spriteUpdateCb: ((dt: number) => void) | null = null
  private vfxSystem: VfxSystem | null = null
  private vfxUpdateCb: ((dt: number) => void) | null = null
  private charController: CharacterController | null = null
  private restoreReady = false
  /** Guards the one-shot "partial generation recovered" toast (see restoreSession). */
  private _partialChecked = false

  // Module 16 split-pane sync — see CharacterDesign for full rationale. The
  // pixel pipeline lives in two same-origin iframes; user-facing generation
  // happens in left, results are written to IDB (sessionAutoSave) and to
  // localStorage (saveConfig). Without an explicit signal the center iframe's
  // PixelPipelineUI never sees the new turnaround / actionSheets and renders
  // an empty Step 1 grid. We bridge state via:
  //   - BroadcastChannel for "IDB changed, please reload session"
  //   - storage event for cfg-only changes (activeStep, selectedActions, …)
  private _bc: BroadcastChannel | null = null
  private _bcSelfId = Math.random().toString(36).slice(2, 10)
  private _applyingBroadcast = false
  // Live progress text the user should see in BOTH panes during a long gen.
  // The active pane sets it via showProgress(); the sibling pane mirrors it
  // via the `pixel-char-progress` broadcast so the user gets feedback in the
  // center preview while the 60s turnaround / per-action pipeline runs.
  private progressText: string | null = null
  private progressActive = false

  private setupBroadcast(): void {
    if (this._bc) return
    try {
      this._bc = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-character.pixel-char-state')
    } catch {
      this._bc = null
    }
    if (this._bc) {
      this._bc.onmessage = (e) => { void this.handleBroadcast(e) }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (ev: StorageEvent) => {
        if (ev.key !== STORAGE_KEY) return
        if (this._applyingBroadcast) return
        try {
          const next = loadConfig()
          Object.assign(this.cfg, next)
        } catch { /* ignore */ }
        if (this.panels && this.leftEl) this.refresh()
      })
    }
  }

  private async handleBroadcast(e: MessageEvent): Promise<void> {
    const data = (e.data ?? {}) as { type?: string; source?: string; text?: string; active?: boolean }
    if (data.source === this._bcSelfId) return
    if (data.type === 'pixel-char-progress') {
      // Live progress mirror — sibling pane is generating, surface its status
      // in our preview area so the user sees activity instead of an empty grid.
      const wasActive = this.progressActive
      this.progressText = typeof data.text === 'string' ? data.text : null
      this.progressActive = !!data.active
      // On the active-edge transition, rebuild the center pane so the right
      // cell switches to/from the in-cell loading skeleton (renderCenterStep1
      // branches on progressActive). Pure overlay update is not enough — the
      // loading text/spinner only exist if the cell is in its loading state.
      if (wasActive !== this.progressActive && this.panels && this.leftEl) {
        this.refresh()
      } else {
        this.renderProgressOverlay()
      }
      return
    }
    if (data.type !== 'pixel-char-state') return
    if (!this.leftEl || !this.panels) return // not mounted yet — nothing to refresh
    this._applyingBroadcast = true
    try {
      // Pull fresh cfg + blobs from disk-of-record (localStorage + IDB).
      try {
        const next = loadConfig()
        Object.assign(this.cfg, next)
      } catch { /* ignore */ }
      this.img = createEmptyImageCache()
      await this.restoreSession()
      await this.refreshBatchHistory()
      this.refresh()
    } finally {
      this._applyingBroadcast = false
    }
  }

  private broadcastState(): void {
    if (this._applyingBroadcast) return
    if (!this._bc) return
    try {
      this._bc.postMessage({ type: 'pixel-char-state', source: this._bcSelfId })
    } catch { /* ignore */ }
  }

  private broadcastProgress(): void {
    if (!this._bc) return
    try {
      this._bc.postMessage({
        type: 'pixel-char-progress',
        source: this._bcSelfId,
        text: this.progressText,
        active: this.progressActive,
      })
    } catch { /* ignore */ }
  }

  constructor() {
    injectCSS()
    this.cfg = loadConfig()
    const migrated = migrateOldStorage()
    if (migrated) this.img.turnaroundImage = migrated
    this.setupBroadcast()
    Promise.all([
      this.refreshActionLib(),
      this.refreshBatchHistory(),
      this.restoreSession({ checkPartial: true }),
    ]).then(() => {
      this.restoreReady = true
      if (this.panels) this.refresh()
    })
  }

  mount(left: HTMLElement, panels: PipelinePanels): void {
    this.leftEl = left
    this.panels = panels

    // 软提示：未完成角色设计时仍渲染完整左侧编辑 UI，只在顶部插一条警告条
    // 提醒用户去 wb-character 完成角色设计——便于调试动画工作台本身。
    // 真正生成时各步骤里的 `this.img.designImage` 等检查会兜底拦截。
    this.renderLeft()
    this.renderCenter()
    if (!globalState.hasCharacter) this.injectNoCharacterBanner(left)
  }

  /** 在 leftEl 顶部塞一条「未完成角色设计」的软提示条，不阻断后续 UI。 */
  private injectNoCharacterBanner(left: HTMLElement): void {
    const banner = document.createElement('div')
    banner.style.cssText = 'padding:10px 12px;margin-bottom:8px;background:color-mix(in srgb, var(--color-status-warning) 14%, transparent);border:1px solid color-mix(in srgb, var(--color-status-warning) 40%, transparent);border-radius:6px;color:var(--color-text-secondary);font-size:12px;line-height:1.5;'
    banner.innerHTML = `<strong style="color:var(--color-status-warning);">提示：还未完成角色设计</strong><br>
      去 <code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;">wb-character</code> 生成角色后再来跑像素流水线；当前可预览/调试 UI 但生成会缺基础图。`
    left.insertBefore(banner, left.firstChild)
  }

  unmount(): void {
    this.stopAllGifs()
    saveConfig(this.cfg)
    this.leftEl = null
    this.panels = null
  }

  dispose(): void {
    this.stopAllGifs()
    saveConfig(this.cfg)
  }

  private async refreshActionLib(): Promise<void> {
    try { this.actionLib = await loadAllPixelActions() } catch { this.actionLib = [] }
  }

  /**
   * 一键清空像素角色工作区——把**所有**上一个角色残留的数据抹掉，回到刚打开
   * 像素管线的初始状态。
   *
   * 清理范围（按 IndexedDB 读写 + 内存状态分两块）：
   *   - IDB：`ce-pixel-action-lib` 的 actions 表、batches 表、会话快照
   *     （`sessionDelete('current:pixel-char')`）。
   *   - 内存：`this.img` 的参考图/splitFrames/sheet 全清空；`this.actionLib`、
   *     `this.batchHistory`、`this.selectedLibActionId`、GIF 句柄、撤销队列。
   *   - 配置：`cfg.activeStep` 回到 1，其它用户偏好（FPS / 对齐模式 / 选中动作列表）
   *     保留——这些是「我习惯这样用」的个人设置，不应该跟着角色清掉。
   *
   * 被两个入口复用：
   *   1. 用户在工作区底部点「🗑️ 清空工作区」按钮（带二次确认）。
   *   2. `resetForNewCharacter()` 在「新角色进入像素管线」时自动触发——修掉
   *      用户反馈的「新角色 2 个动画混进旧角色库」这个 bug。
   */
  public async clearWorkspace(opts: { silent?: boolean } = {}): Promise<void> {
    try { await clearPixelActionLib() } catch (e) { console.warn('[PixelChar] clear action-lib failed:', e) }
    try { await clearAllBatches() } catch (e) { console.warn('[PixelChar] clear batches failed:', e) }
    try { await sessionDelete(`current:${PIPELINE_ID}`) } catch (e) { console.warn('[PixelChar] clear session failed:', e) }

    this.img = createEmptyImageCache()
    this.actionLib = []
    this.batchHistory = []
    this.batchHistoryExpanded = false
    this.selectedLibActionId = null
    this.expandedBatchId = null
    this.viewingBatchId = null
    this.regenQueue = []
    this.stopAllGifs()

    this.cfg.activeStep = 1
    saveConfig(this.cfg)
    this.broadcastState()

    if (this.leftEl && this.panels) this.refresh()
    if (!opts.silent) this.toast('工作区已清空')
  }

  /* ── StyleContext helpers (gameplay mode + art style) ───────────── */

  /** StyleContext bundle passed to every prompt-engine function. */
  private styleCtx(): StyleContext {
    return {
      gameplayMode: this.cfg.gameplayMode,
      artStyleId: this.cfg.artStyleId,
      characterType: this.cfg.characterType,
      customStyle: this.cfg.pixelStyle,
      charDesc: this.cfg.turnaroundUserDesc,
    }
  }

  /**
   * 像素角色动画一律走 nano(Gemini)。提示词体系里 nano 是「主路线」
   * (booru/tag 友好、四方向/动作 sheet 都按它调过),gpt-image-2 的那套自然语言
   * 改写反而把效果弄乱。模型选择器已从 UI 移除,这里集中返回 gemini,避免散落的
   * globalState.getImageModel() 把全局(可能被角色设计改成 gpt-image-2)的选择漏进来。
   */
  private animImageModel(): ImageModel {
    return 'gemini'
  }

  /**
   * Apply both axes on top of the canonical action:
   *   1) characterType (monster → more frames + extra expand factor)
   *   2) gameplayMode  (platformer → collapse to single right-facing row)
   *
   * Order matters: we bump the frame count FIRST so the platformer
   * right-facing strip carries the full bumped frame count too.
   */
  private effectiveAction(action: ChibiAction): ChibiAction {
    return applyGameplayMode(
      applyCharacterType(action, this.cfg.characterType),
      this.cfg.gameplayMode,
    )
  }

  /** Catalogue of actions applicable to the current gameplay mode. */
  private availableActions(): ChibiAction[] {
    return filterActionsForMode(CHIBI_ACTIONS, this.cfg.gameplayMode)
  }

  /* ── Left Panel ──────────────────────────────────────────────────── */

  private renderLeft(): void {
    if (!this.leftEl) return

    const scrollTop = this.leftEl.scrollTop

    const libCount = new Set(this.actionLib.map(e => e.actionId)).size

    this.leftEl.innerHTML = `
      <div class="px-panel">
        <div class="px-header">
          <span class="px-header-title">角色动画工作台</span>
          <span class="px-header-pill">角色动画</span>
        </div>

        <div class="px-tab-bar">
          <button class="px-tab-btn${this.leftTab === 'edit' ? ' active' : ''}" data-px-tab="edit">编辑</button>
          <button class="px-tab-btn${this.leftTab === 'lib' ? ' active' : ''}" data-px-tab="lib">动作库${libCount ? ` (${libCount})` : ''}</button>
        </div>

        <div class="px-tab-body" data-px="tab-body"></div>
      </div>
    `

    this.leftEl.querySelectorAll<HTMLButtonElement>('[data-px-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.leftTab = btn.dataset.pxTab as 'edit' | 'lib'
        this.renderLeft()
        this.renderCenter()
      })
    })

    const body = this.leftEl.querySelector('[data-px="tab-body"]') as HTMLElement
    if (this.leftTab === 'edit') {
      this.renderLeftEditTab(body)
    } else {
      this.renderLeftLibTab(body)
    }

    this.leftEl.scrollTop = scrollTop
  }

  private renderLeftEditTab(body: HTMLElement): void {
    body.innerHTML = `
      <div class="px-section">
        <div class="px-label">工作流程</div>
        <div class="px-steps" data-px="steps"></div>
      </div>

      <div class="px-progress" data-px="gen-progress" style="display:none">
        <div class="px-progress-bar"><div class="px-progress-fill"></div></div>
        <div class="px-progress-text" data-px="gen-text">处理中...</div>
      </div>

      ${this.renderBatchHistorySection()}
    `

    const steps: { id: Step; label: string; icon: string }[] = [
      { id: 1, label: '四方向参考', icon: 'directions' },
      { id: 2, label: '动作生成与处理', icon: 'sword' },
    ]

    const stepsEl = body.querySelector('[data-px="steps"]') as HTMLElement
    for (const step of steps) {
      const isActive = step.id === this.cfg.activeStep
      const isDone = this.isStepDone(step.id)
      const el = document.createElement('div')
      el.className = `px-step${isActive ? ' active' : ''}${isDone ? ' done' : ''}`
      el.innerHTML = `
        <div class="px-step-head">
          <span class="px-step-icon">${pxIcon(isDone ? 'check' : step.icon, 'px-icon px-step-svg')}</span>
          <span class="px-step-label">${step.label}</span>
          ${isDone ? '<span class="px-step-done">已完成</span>' : ''}
        </div>
        ${isActive ? `<div class="px-step-detail">${this.renderStepDetail(step.id)}</div>` : ''}
      `
      el.querySelector('.px-step-head')?.addEventListener('click', () => {
        this.cfg.activeStep = step.id
        saveConfig(this.cfg)
        this.refresh()
      })
      stepsEl.appendChild(el)
    }

    this.bindEvents()
    this.bindBatchHistoryEvents()
  }

  private renderLeftLibTab(body: HTMLElement): void {
    const groups = new Map<string, PixelActionLibEntry[]>()
    for (const entry of this.actionLib) {
      if (!groups.has(entry.actionId)) groups.set(entry.actionId, [])
      groups.get(entry.actionId)!.push(entry)
    }

    if (groups.size === 0) {
      body.innerHTML = `
        <div class="px-lib-empty">
          <div class="px-lib-empty-icon">${pxIcon('box', 'px-icon px-empty-svg')}</div>
          <div class="px-lib-empty-text">动作库为空</div>
          <div class="px-lib-empty-hint">在「编辑」标签页生成动作后，保存到动作库即可在此查看</div>
        </div>`
      return
    }

    let cards = ''
    for (const [actionId, entries] of groups) {
      const entry = entries[0]
      const label = entry?.actionLabel || actionId
      const firstDir = Object.keys(entry.directions)[0]
      const thumb = firstDir ? entry.directions[firstDir]?.[0] : null
      const hasSkill = !!entry.skill
      const isSelected = this.selectedLibActionId === actionId
      const scale = clampScale(entry.scale ?? 1)
      const pct = Math.round(scale * 100)
      // Non-destructive visual scale: CSS transform on the <img>. Size changes
      // take effect instantly without touching stored pixels.
      const scaleStyle = scale !== 1 ? ` style="transform: scale(${scale})"` : ''

      cards += `
        <div class="px-lib-card${isSelected ? ' selected' : ''}" data-lib-card-action="${actionId}">
          <div class="px-lib-card-thumb-box">
            ${thumb
              ? `<img src="${thumb}" class="px-lib-card-thumb checkerboard" draggable="false"${scaleStyle} />`
              : '<div class="px-lib-card-thumb-empty">?</div>'}
          </div>
          <div class="px-lib-card-name">${label}${hasSkill ? ' <span style="color:var(--color-accent-orange-default)">⚔</span>' : ''}</div>
          <div class="px-lib-card-scale" title="缩放（双击重置）">
            <button class="px-scale-btn" data-lib-scale-down="${entry.id}" title="缩小 5%">−</button>
            <span class="px-scale-pct" data-lib-scale-reset="${entry.id}">${pct}%</span>
            <button class="px-scale-btn" data-lib-scale-up="${entry.id}" title="放大 5%">+</button>
          </div>
          <div class="px-lib-card-ops">
            <button class="px-btn tiny" data-lib-card-apply="${entry.id}" title="应用到工作区">↻</button>
            <button class="px-btn tiny" data-lib-card-del="${actionId}" title="删除">×</button>
          </div>
        </div>`
    }

    body.innerHTML = `
      <div class="px-lib-toolbar">
        <button class="px-btn-pill" data-px="auto-align-scales" title="以待机动作的角色身高为基准，自动统一所有动作的缩放"><span class="px-btn-pill-icon">${pxIcon('target', 'px-icon')}</span> 自动统一大小</button>
        <button class="px-btn-pill" data-px="reset-scales" title="清除所有动作的缩放调整">重置缩放</button>
      </div>
      <div class="px-lib-grid">${cards}</div>
      <div class="px-lib-footer">
        <div class="px-lib-footer-row px-lib-footer-primary">
          <button class="px-btn-pill primary xl" data-px="publish-as-player" title="一键写入到 data/workspace/games/&lt;gameId&gt;/public/assets/art/characters/player/，刷新游戏即可作为主角"><span class="px-btn-pill-icon">${pxIcon('user', 'px-icon')}</span> 导入到游戏作为主角</button>
          <button class="px-btn-pill accent xl" data-px="publish-as-npc" title="批量把当前动作库发布到游戏里的 NPC 槽位。默认只填充'空'槽位，已有的不会被顶替。"><span class="px-btn-pill-icon">${pxIcon('users', 'px-icon')}</span> 批量发布到 NPC</button>
        </div>
        <div class="px-lib-footer-row px-lib-footer-secondary">
          <button class="px-btn-pill ghost" data-px="apply-all-lib" title="把动作库里的所有动作应用到当前工作区"><span class="px-btn-pill-icon">↻</span> 全部应用</button>
          <button class="px-btn-pill ghost" data-px="inject-scene" title="把动作库发布到当前场景（Kino Studio 预览用）"><span class="px-btn-pill-icon">${pxIcon('film', 'px-icon')}</span> 放入场景</button>
          <button class="px-btn-pill ghost" data-px="export-game" title="把动作库打包成 ZIP 导出"><span class="px-btn-pill-icon">${pxIcon('upload', 'px-icon')}</span> 导出</button>
          <button class="px-btn-pill ghost" data-px="publish-game" title="发布到 phaser-2d 模板工程（共享卷）"><span class="px-btn-pill-icon">${pxIcon('play', 'px-icon')}</span> 发布到 phaser-2d</button>
          <button class="px-btn-pill ghost danger" data-px="clear-lib" title="清空动作库、批次历史与内存中的参考图/帧，恢复到刚打开像素管线时的初始状态。换角色前建议先清一次。"><span class="px-btn-pill-icon">${pxIcon('trash', 'px-icon')}</span> 清空工作区</button>
        </div>
      </div>`

    this.bindLibTabEvents(body)
  }

  private bindLibTabEvents(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-lib-card-action]').forEach(card => {
      card.addEventListener('click', () => {
        const actionId = card.dataset.libCardAction!
        this.selectedLibActionId = this.selectedLibActionId === actionId ? null : actionId
        this.renderLeft()
        this.renderCenter()
      })
    })

    root.querySelectorAll<HTMLButtonElement>('[data-lib-card-del]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const actionId = btn.dataset.libCardDel!
        await removePixelActionsByActionId(actionId)
        await this.refreshActionLib()
        if (this.selectedLibActionId === actionId) this.selectedLibActionId = null
        this.renderLeft()
        this.renderCenter()
      })
    })

    root.querySelectorAll<HTMLButtonElement>('[data-lib-card-apply]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const entryId = btn.dataset.libCardApply!
        const entry = this.actionLib.find(e => e.id === entryId)
        if (!entry) { this.toast('找不到该动作'); return }
        this.replaceActionFromSource(entry.actionId, entry.directions, entry.sheetDataUrl)
        this.btnFlash(btn, 'done')
      })
    })

    // Per-entry scale tweaks — non-destructive, IDB-persisted. Updates DOM
    // in-place so the user sees the change without a full card re-render
    // (which would momentarily blank all thumbnails).
    const stepScale = (entryId: string, delta: number): void => {
      const entry = this.actionLib.find(e => e.id === entryId)
      if (!entry) return
      const next = clampScale((entry.scale ?? 1) + delta)
      entry.scale = next
      const pct = Math.round(next * 100)
      const card = root.querySelector(`[data-lib-card-action="${entry.actionId}"]`) as HTMLElement | null
      const img = card?.querySelector<HTMLImageElement>('.px-lib-card-thumb')
      const pctEl = card?.querySelector<HTMLElement>('.px-scale-pct')
      if (img) img.style.transform = next === 1 ? '' : `scale(${next})`
      if (pctEl) pctEl.textContent = `${pct}%`
      void updatePixelActionScale(entryId, next)
    }

    root.querySelectorAll<HTMLButtonElement>('[data-lib-scale-down]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        stepScale(btn.dataset.libScaleDown!, -0.05)
      })
    })
    root.querySelectorAll<HTMLButtonElement>('[data-lib-scale-up]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        stepScale(btn.dataset.libScaleUp!, 0.05)
      })
    })
    root.querySelectorAll<HTMLElement>('[data-lib-scale-reset]').forEach(el => {
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        const entryId = el.dataset.libScaleReset!
        const entry = this.actionLib.find(e => e.id === entryId)
        if (!entry) return
        const delta = 1 - (entry.scale ?? 1)
        stepScale(entryId, delta)
      })
    })

    root.querySelector('[data-px="auto-align-scales"]')?.addEventListener('click', async () => {
      const btn = root.querySelector('[data-px="auto-align-scales"]') as HTMLElement
      this.btnFlash(btn, 'busy')
      await this.autoAlignLibScales()
      this.btnFlash(btn, 'done')
    })

    root.querySelector('[data-px="reset-scales"]')?.addEventListener('click', async () => {
      for (const entry of this.actionLib) {
        entry.scale = 1
        await updatePixelActionScale(entry.id, 1)
      }
      this.renderLeft()
      this.toast(`已重置 ${this.actionLib.length} 个动作的缩放`)
    })

    root.querySelector('[data-px="apply-all-lib"]')?.addEventListener('click', () => {
      const seen = new Set<string>()
      for (const entry of this.actionLib) {
        if (seen.has(entry.actionId)) continue
        seen.add(entry.actionId)
        this.img.splitFrames[entry.actionId] = entry.directions
        if (entry.sheetDataUrl) this.img.actionSheets[entry.actionId] = entry.sheetDataUrl
      }
      this.autoSave()
      this.toast(`${seen.size} 个动作已应用到工作区`)
      this.btnFlash(root.querySelector('[data-px="apply-all-lib"]') as HTMLElement, 'done')
    })

    root.querySelector('[data-px="inject-scene"]')?.addEventListener('click', () => {
      // fire-and-forget; injectToScene toasts + handles its own errors
      void this.injectToScene()
    })

    root.querySelector('[data-px="export-game"]')?.addEventListener('click', () => {
      this.exportLibToGame()
    })

    root.querySelector('[data-px="publish-game"]')?.addEventListener('click', async () => {
      const btn = root.querySelector('[data-px="publish-game"]') as HTMLElement
      this.btnFlash(btn, 'busy')
      const promptedId = prompt('角色 ID (留空自动生成):', '') || undefined
      const safeId = promptedId && /^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(promptedId) ? promptedId : undefined
      if (promptedId && !safeId) {
        this.toast('ID 格式不合法，已自动生成')
      }
      await this.publishToGame(safeId)
      this.btnFlash(btn, 'done')
    })

    root.querySelector('[data-px="publish-as-player"]')?.addEventListener('click', async () => {
      const btn = root.querySelector('[data-px="publish-as-player"]') as HTMLElement
      this.btnFlash(btn, 'busy')
      await this.onClickPublishAsPlayer()
      this.btnFlash(btn, 'done')
    })

    root.querySelector('[data-px="publish-as-npc"]')?.addEventListener('click', async () => {
      const btn = root.querySelector('[data-px="publish-as-npc"]') as HTMLElement
      this.btnFlash(btn, 'busy')
      await this.onClickBatchPublishAsNpc()
      this.btnFlash(btn, 'done')
    })

    root.querySelector('[data-px="clear-lib"]')?.addEventListener('click', async () => {
      const btn = root.querySelector('[data-px="clear-lib"]') as HTMLElement
      const libCount = new Set(this.actionLib.map(e => e.actionId)).size
      // 二次确认——按下去要抹掉的东西不少（动作库 + 批次 + 参考图/帧 + 会话），
      // 比旧版「清空」只清 action-lib 后果更大，没提示容易误点。
      const ok = window.confirm(
        `确定要清空当前像素角色工作区吗？\n\n` +
        `将清除：\n` +
        `  • 动作库中的 ${libCount} 个动作\n` +
        `  • 全部生成批次历史\n` +
        `  • 当前的四方向参考图与拆分帧\n\n` +
        `个人偏好（FPS / 对齐模式 / 勾选的动作）会保留。\n` +
        `此操作不可撤销。`,
      )
      if (!ok) return
      this.btnFlash(btn, 'busy')
      await this.clearWorkspace()
    })
  }

  private renderStepDetail(step: Step): string {
    return step === 1 ? this.renderStep1Detail() : this.renderStep2Detail()
  }

  /* ── Step 1: 四方向参考 ──────────────────────────────────────────── */

  private renderStep1Detail(): string {
    const hasDesign = !!globalState.get().characterImage
    const mode = getGameplayMode(this.cfg.gameplayMode)
    const isPlatformer = mode.id === 'platformer'
    // 每次 render 都重新根据 profile 推导 characterType——用户在角色设计阶段
    // 切换 hero/npc/monster，这里就立即跟随。保存回 cfg 以便后续 generate 用。
    const inferredType = inferCharacterTypeFromProfile()
    if (this.cfg.characterType !== inferredType) {
      this.cfg.characterType = inferredType
      saveConfig(this.cfg)
    }
    const typePreset = getCharacterType(this.cfg.characterType)
    const isMonster = !typePreset.humanoidGuards

    const entityWord = isMonster ? (typePreset.id === 'creature-small' ? '小型怪物' : '怪物/BOSS') : '角色'
    const layoutWord = isPlatformer ? '侧面' : '2×2 四方向'
    const stepDesc = `基于参考图，生成 ${layoutWord} ${entityWord} 参考图（支持拖拽上传）`

    let html = `<div class="px-step-desc">${stepDesc}</div>`

    if (hasDesign) {
      html += `
        <div class="px-source-preview">
          <img src="${globalState.get().characterImage}" class="px-source-thumb" />
          <span class="px-source-label">当前设定图</span>
          <label class="px-link-btn" style="margin-left:auto;">
            ${pxIcon('refresh', 'px-icon')} 替换
            <input type="file" data-px="upload-character-sheet" accept="image/*" style="display:none" />
          </label>
        </div>`
    } else {
      html += `
        <div class="px-hint-box">
          提示：还没有角色设定图。去「角色设计」标签页生成，或者
          <label class="px-link-btn" style="display:inline-block;margin-left:4px;">
            ${pxIcon('upload', 'px-icon')} 直接上传作为设定图
            <input type="file" data-px="upload-character-sheet" accept="image/*" style="display:none" />
          </label>
        </div>`
    }

    // 角色类型不做 UI 展示——从 CharacterDesign 阶段的 profile 静默推导，直接
    // 驱动下游提示词。任何可见的"人形/BOSS/小怪"标签都会干扰用户（比如做非人
    // 型主角时看到"人形"提示会以为走错管线了）。cfg.characterType 仍然每次
    // render 时从 profile 推导并 save，用于 applyCharacterType/prompt-engine。

    // Gameplay mode selector (RPG / Platformer)
    html += `<div class="px-label" style="margin-top:10px">玩法模式</div>`
    html += `<div class="px-ta-mode-row">`
    for (const m of GAMEPLAY_MODES) {
      const active = m.id === this.cfg.gameplayMode ? ' active' : ''
      const title = this.esc(m.description)
      html += `<button class="px-ta-mode-btn${active}" data-gameplay-mode="${m.id}" title="${title}">${pxIcon(m.id === 'platformer' ? 'jump' : 'map', 'px-icon px-mode-svg')}<span>${m.label}</span></button>`
    }
    html += `</div>`
    html += `<div class="px-mode-hint">${this.esc(mode.description)}</div>`

    // Art-style picker grid
    html += `<div class="px-label" style="margin-top:10px">画风预设</div>`
    html += `<div class="px-style-grid">`
    for (const s of ART_STYLES) {
      const active = s.id === this.cfg.artStyleId ? ' active' : ''
      const title = this.esc(s.description)
      html += `<button class="px-style-chip${active}" data-art-style="${s.id}" title="${title}">
        <span class="px-style-chip-icon">${pixelArtStyleIcon(s.id)}</span>
        <span class="px-style-chip-label">${this.esc(s.label)}</span>
      </button>`
    }
    html += `</div>`

    const currentStyle = getArtStyleOrDefault(this.cfg.artStyleId)
    html += `<div class="px-mode-hint">${this.esc(currentStyle.description)}</div>`

    html += `
      <div class="px-label" style="margin-top:10px">画风补充（可选） <span style="font-size:10px;color:var(--text-secondary)">将叠加在预设之上</span></div>
      <textarea class="px-textarea" data-px="style-prompt" placeholder="如：偏冷色调、带淡淡辉光、参考《极乐迪斯科》"
        rows="2">${this.esc(this.cfg.pixelStyle)}</textarea>

      <button class="px-btn primary" data-px="gen-turnaround" style="margin-top:10px"
        ${!hasDesign ? 'disabled' : ''}>
        ${isPlatformer
          ? (isMonster ? `用参考图生成侧面${entityWord}图` : '用设定图生成侧面参考')
          : (isMonster ? `用参考图生成四方向${entityWord}图` : '用设定图生成四方向参考')}
      </button>

      <div class="px-upload-row" style="margin-top:8px">
        <span style="font-size:10px;color:var(--text-secondary)">已有参考图？</span>
        <label class="px-link-btn">
          直接作为参考上传
          <input type="file" data-px="upload-turnaround" accept="image/*" style="display:none" />
        </label>
      </div>`

    return html
  }

  /* ── Step 2: 动作生成与处理 ──────────────────────────────────────── */

  private renderStep2Detail(): string {
    const c = this.cfg
    const hasRef = !!this.img.turnaroundImage
    const hasSplit = Object.keys(this.img.splitFrames).length > 0

    let h = `<div class="px-step-desc">一键完成：生成 → 去背景 → 拆帧预览</div>`

    if (!hasRef) {
      h += `<div class="px-hint-box">提示：请先完成 Step 1（四方向参考图）</div>`
      return h
    }

    h += `<div class="px-label">生成模式（无预制模板的动作适用）</div>`
    h += `<div class="px-ta-mode-row">`
    h += `<button class="px-ta-mode-btn${c.genMode === 'direct' ? ' active' : ''}" data-gen-mode="direct">提示词直出</button>`
    h += `<button class="px-ta-mode-btn${c.genMode === 'template' ? ' active' : ''}" data-gen-mode="template">模板填充</button>`
    h += `</div>`

    h += `<div class="px-label">帧对齐方式</div>`
    h += `<select class="px-select" data-px="align-mode">`
    for (const m of ALIGN_MODES) {
      const sel = c.alignMode === m.id ? ' selected' : ''
      h += `<option value="${m.id}"${sel}>${m.label} — ${m.desc}</option>`
    }
    h += `</select>`

    if (hasSplit) {
      h += `<button class="px-btn" data-px="realign" style="margin-top:4px;font-size:10px">应用新对齐方式</button>`
    }

    const frameSizeOptions = [
      { value: 0, label: '自动（取最大帧）' },
      { value: 32, label: '32×32' },
      { value: 48, label: '48×48' },
      { value: 64, label: '64×64' },
      { value: 96, label: '96×96' },
      { value: 128, label: '128×128' },
    ]
    h += `<div class="px-label" style="margin-top:6px">帧输出尺寸</div>`
    h += `<select class="px-select" data-px="frame-size">`
    for (const opt of frameSizeOptions) {
      const sel = c.targetFrameSize === opt.value ? ' selected' : ''
      h += `<option value="${opt.value}"${sel}>${opt.label}</option>`
    }
    h += `</select>`

    const availableActions = this.availableActions()
    const allSelected = availableActions.every(a => c.selectedActions.includes(a.id))
    // 路人 NPC 没有武器 / 大招，生成战斗动画纯属浪费模型调用——给一个视觉
    // 提示让用户先考虑只勾选「待机 + 走路」，需要战斗的再手动加回来。
    const isNpc = globalState.profile?.characterRole === 'npc'
    const npcHint = isNpc
      ? `<div style="margin-top:8px;padding:6px 8px;border-radius:4px;background:var(--color-interaction-selected-brand);border:1px solid rgba(212,255,72,.25);font-size:11px;color:var(--text-secondary);line-height:1.4">
        💡 <b>职业 NPC / 路人</b>：建议只勾选「待机 / 走路」这类日常动画，路人没有武器与大招，生成战斗动画容易产出不合身份的姿态。
      </div>`
      : ''
    h += npcHint
    h += `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">
      <div class="px-label" style="margin:0">选择动作</div>
      <button class="px-btn tiny" data-px="toggle-all-actions" style="font-size:10px;width:auto;padding:2px 8px">${allSelected ? '取消全选' : '全选'}</button>
    </div>`
    for (const action of availableActions) {
      const checked = c.selectedActions.includes(action.id) ? 'checked' : ''
      const eff = this.effectiveAction(action)
      const dirCount = eff.directions.length
      const dirWord = dirCount === 1 ? '侧面' : `${dirCount}方向`
      const badge = action.templateAsset
        ? '<span style="font-size:9px;color:var(--accent);margin-left:4px">📋预制模板</span>'
        : ''
      h += `<label class="px-checkbox-label">
        <input type="checkbox" data-action-id="${action.id}" ${checked} />
        ${action.label} <span style="font-size:10px;color:var(--text-secondary)">(${dirWord}×${eff.framesPerDir}帧)</span>${badge}
      </label>`
    }

    const hasAnyResult = c.selectedActions.some(id =>
      this.img.splitFrames[id] && Object.keys(this.img.splitFrames[id]).length > 0,
    )
    const allHaveResult = hasAnyResult && c.selectedActions.every(id =>
      this.img.splitFrames[id] && Object.keys(this.img.splitFrames[id]).length > 0,
    )

    h += `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">`
    h += `<button class="px-btn primary" data-px="gen-actions-force" style="flex:1">
      ${pxIcon('film', 'px-icon px-btn-svg')}生成选中动作
    </button>`
    if (hasAnyResult && !allHaveResult) {
      h += `<button class="px-btn" data-px="gen-actions-continue" style="flex:1">
        ▶ 继续生成未完成项
      </button>`
    }
    h += `</div>`

    if (hasSplit) {
      const items: string[] = []
      for (const [actionId, dirMap] of Object.entries(this.img.splitFrames)) {
        const action = getAction(actionId)
        const dirs = Object.keys(dirMap).length
        const frames = Object.values(dirMap).reduce((n, arr) => n + arr.length, 0)
        items.push(`${action?.label || actionId}: ${dirs}方向 ${frames}帧`)
      }
      h += `<div class="px-hint-box" style="margin-top:8px;color:var(--color-status-success);background:color-mix(in srgb, var(--color-status-success) 12%, transparent);border-color:color-mix(in srgb, var(--color-status-success) 25%, transparent)">${items.join('<br/>')}</div>`

      h += `<div class="px-label" style="margin-top:8px">GIF 播放速度</div>`
      h += `<div style="display:flex;align-items:center;gap:8px;">
        <input type="range" min="4" max="24" value="${c.fps}" data-px="fps-slider" style="flex:1" />
        <span data-px="fps-val" style="font-size:11px;min-width:40px">${c.fps} fps</span>
      </div>`

      h += `<div class="px-step2-actions">
        <button class="px-btn-pill accent" data-px="save-to-lib"><span class="px-btn-pill-icon">${pxIcon('box', 'px-icon')}</span> 保存到动作库</button>
        <button class="px-btn-pill" data-px="export-all"><span class="px-btn-pill-icon">${pxIcon('upload', 'px-icon')}</span> 导出全部 (ZIP)</button>
      </div>`
    }

    return h
  }

  /* ── Center Panel ────────────────────────────────────────────────── */

  private renderCenter(): void {
    if (!this.panels) return
    this.stopAllGifs()
    this.panels.center.classList.add('active')

    if (this.leftTab === 'lib') {
      this.renderCenterLibDetail()
    } else if (this.viewingBatchId) {
      this.renderCenterBatchDetail(this.viewingBatchId)
    } else if (this.cfg.activeStep === 1) {
      this.renderCenterStep1()
    } else {
      this.renderCenterStep2()
    }

    // Re-attach the progress overlay after every center rerender — center
    // panel innerHTML wipes it otherwise, so an in-flight gen would lose
    // its visual feedback the moment any state change refresh()es the pane.
    this.renderProgressOverlay()
  }

  private renderCenterStep1(): void {
    const designImg = globalState.get().characterImage
    const turnaround = this.img.turnaroundImage
    const typePreset = getCharacterType(this.cfg.characterType)
    const isMonster = !typePreset.humanoidGuards
    const isSmall = typePreset.id === 'creature-small'
    const creatureWord = isSmall ? '小怪' : '怪物'
    const isPlatformer = this.cfg.gameplayMode === 'platformer'

    const leftLabel = isMonster ? '参考原图（可拖拽）' : '角色设计图（可拖拽）'
    const rightLabel = isPlatformer
      ? (isMonster ? `侧面${creatureWord}参考` : '侧面角色参考')
      : (isMonster ? `2×2 ${creatureWord}四方向` : '2×2 四方向图')

    const regenBtn = turnaround
      ? `<button class="px-btn secondary" data-px="regen-turnaround" style="margin-top:8px">不满意？重新生成</button>`
      : ''
    const nextBtn = turnaround
      ? `<button class="px-btn primary" data-px="goto-step2" style="margin-top:8px">进入动作生成与处理 →</button>`
      : ''

    const leftEmpty = `<div class="px-grid-empty px-droppable-hint">
      <div class="px-empty-icon">${pxIcon('image', 'px-icon px-empty-svg')}</div>
      <div class="px-empty-title">拖拽角色图到这里</div>
      <div class="px-empty-sub">或点击选择文件</div>
    </div>`

    // Right cell is a state machine: empty → generating → done.
    // The loading state is INLINE in the cell where the result will appear,
    // so the user's eyes don't need to chase a bottom progress bar.
    let rightCellContent: string
    if (turnaround) {
      rightCellContent = `<img src="${turnaround}" class="px-grid-img px-result-fresh" data-px-hideable="turnaround" />`
    } else if (this.progressActive) {
      rightCellContent = `<div class="px-grid-empty px-cell-loading">
        <div class="px-cell-skeleton"></div>
        <div class="px-cell-spinner"></div>
        <div class="px-cell-loading-text">${this.esc(this.progressText || '正在生成...')}</div>
        <div class="px-cell-loading-hint">AI 正在工作 · 完成后这里会出现新图</div>
      </div>`
    } else {
      rightCellContent = `<div class="px-grid-empty px-droppable-hint">
        <div class="px-empty-icon">${pxIcon('sparkles', 'px-icon px-empty-svg')}</div>
        <div class="px-empty-title">等 AI 给你生成${isPlatformer ? '侧面' : '4 方向'}参考图</div>
        <div class="px-empty-sub">点击左侧『生成${isPlatformer ? '侧面' : '四方向'}参考图』开始</div>
        <div class="px-empty-hint">或直接拖拽成品参考图到这里</div>
      </div>`
    }

    this.panels!.center.innerHTML = `
      <div class="px-center">
        ${this.renderStageStrip()}
        <div class="px-center-title">四方向参考图</div>
        <div class="px-grid px-grid-ref">
          <div class="px-grid-cell px-droppable" data-drop-target="source" tabindex="0">
            <div class="px-grid-label">${leftLabel}</div>
            ${designImg ? `<img src="${designImg}" class="px-grid-img" data-px-hideable="source" />` : leftEmpty}
          </div>
          <div class="px-grid-cell px-droppable ${this.progressActive ? 'px-cell-active' : ''}" data-drop-target="turnaround" tabindex="0">
            <div class="px-grid-label">${rightLabel}</div>
            ${rightCellContent}
          </div>
        </div>
        ${regenBtn}
        ${nextBtn}
      </div>
    `

    // Only wrap generated output slots — the source slot is an upload target
    // (hiding it would obscure the drag-drop affordance). `turnaround` is
    // always a generated artefact so it gets the × button.
    applyHideableTo(this.panels!.center, 'img.px-grid-img[data-px-hideable="turnaround"]', {
      idFrom: () => 'pixel-char:turnaround',
    })

    this.panels!.center.querySelector('[data-px="regen-turnaround"]')?.addEventListener('click', () => this.execStep1())

    this.panels!.center.querySelector('[data-px="goto-step2"]')?.addEventListener('click', () => {
      this.cfg.activeStep = 2
      saveConfig(this.cfg)
      this.refresh()
    })

    this.bindStep1CenterDnD()
  }

  /**
   * Wire up drag-and-drop + click-to-upload on the two preview cells of
   * Step 1. Dropping on 「参考原图」 writes to globalState.characterImage (so
   * the normal "generate turnaround from source" path works). Dropping on
   * 「四方向/侧面 参考」 writes directly to this.img.turnaroundImage for
   * users who already have a ready-made reference (typical for monsters).
   */
  private bindStep1CenterDnD(): void {
    const center = this.panels?.center
    if (!center) return

    const cells = center.querySelectorAll<HTMLElement>('[data-drop-target]')
    cells.forEach(cell => {
      const target = cell.dataset.dropTarget as 'source' | 'turnaround'

      const stop = (ev: DragEvent) => { ev.preventDefault(); ev.stopPropagation() }
      const setHover = (on: boolean) => cell.classList.toggle('px-droppable-hover', on)

      cell.addEventListener('dragenter', (ev) => { stop(ev); setHover(true) })
      cell.addEventListener('dragover', (ev) => { stop(ev); setHover(true) })
      cell.addEventListener('dragleave', (ev) => { stop(ev); setHover(false) })
      cell.addEventListener('drop', async (ev) => {
        stop(ev); setHover(false)
        const file = ev.dataTransfer?.files?.[0]
        if (!file || !file.type.startsWith('image/')) {
          this.toast('请拖入一张图片文件')
          return
        }
        await this.ingestDroppedImage(file, target)
      })

      // Also allow click-to-upload on the cell itself (opens a hidden file input).
      cell.addEventListener('click', () => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (!file) return
          await this.ingestDroppedImage(file, target)
        }
        input.click()
      })
    })
  }

  private async ingestDroppedImage(file: File, target: 'source' | 'turnaround'): Promise<void> {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.onerror = () => reject(new Error('read failed'))
      r.readAsDataURL(file)
    })

    if (target === 'source') {
      globalState.setCharacterImage(dataUrl)
      this.toast('已设为角色/怪物源图')
    } else {
      this.img.turnaroundImage = dataUrl
      await this.updateReferenceAnchors()
      this.autoSave()
      this.toast('已设为参考图，可直接进入动作生成')
    }
    this.refresh()
  }

  /**
   * Pipeline progression strip — gives the user a constant "I am here" anchor
   * across the four stages. Stage status is derived from `this.img` so it
   * reflects reality without needing manual bookkeeping. Active stage shows
   * a spinning ring while `progressActive` is true; completed stages get a
   * check, future stages stay grey.
   */
  private renderStageStrip(): string {
    const img = this.img
    const hasSource = !!globalState.get().characterImage
    const hasTurnaround = !!img.turnaroundImage
    const hasSheets = Object.keys(img.actionSheets).length > 0
    const hasFrames = Object.keys(img.splitFrames).length > 0

    const activeStep = this.cfg.activeStep
    const generating = this.progressActive

    type StageState = 'done' | 'active' | 'pending'
    const stages: { id: string; label: string; state: StageState }[] = [
      {
        id: 'source',
        label: '角色',
        state: hasSource ? 'done' : 'active',
      },
      {
        id: 'turnaround',
        label: '四视图',
        state: hasTurnaround ? 'done' : (hasSource && activeStep === 1 ? (generating ? 'active' : 'active') : 'pending'),
      },
      {
        id: 'sheets',
        label: '动作 Sheet',
        state: hasSheets ? 'done' : (hasTurnaround && activeStep === 2 ? (generating ? 'active' : 'active') : 'pending'),
      },
      {
        id: 'split',
        label: '拆帧 + 去背',
        state: hasFrames ? 'done' : (hasSheets ? (generating ? 'active' : 'active') : 'pending'),
      },
    ]

    const items = stages.map((s, i) => {
      const isLast = i === stages.length - 1
      const dotIcon = s.state === 'done' ? '✓' : (s.state === 'active' && generating ? '' : (s.state === 'active' ? '·' : '·'))
      const dotClass = `px-stage-dot px-stage-${s.state}${s.state === 'active' && generating ? ' px-stage-spinning' : ''}`
      const labelClass = `px-stage-label px-stage-label-${s.state}`
      const connector = isLast ? '' : `<div class="px-stage-connector px-stage-connector-${s.state === 'done' ? 'done' : 'pending'}"></div>`
      return `<div class="px-stage-item">
        <div class="${dotClass}">${dotIcon}</div>
        <div class="${labelClass}">${s.label}</div>
      </div>${connector}`
    }).join('')

    return `<div class="px-stage-strip">${items}</div>`
  }

  private renderCenterStep2(): void {
    const img = this.img
    const hasResults = Object.keys(img.splitFrames).length > 0
      || Object.keys(img.actionSheets).length > 0

    if (!hasResults) {
      this.panels!.center.innerHTML = `
        <div class="px-center">
          ${this.renderStageStrip()}
          <div class="px-center-title">动作帧预览</div>
          ${this.progressActive ? `<div class="px-step2-loading">
            <div class="px-cell-spinner"></div>
            <div class="px-cell-loading-text">${this.esc(this.progressText || '正在生成...')}</div>
            <div class="px-cell-loading-hint">完成的动作会自动出现在下方</div>
          </div>` : `<div class="px-grid-empty px-droppable-hint" style="margin-top:32px">
            <div class="px-empty-icon">${pxIcon('film', 'px-icon px-empty-svg')}</div>
            <div class="px-empty-title">勾选动作 → 点击『一键生成』</div>
            <div class="px-empty-sub">每个动作走 4 阶段：生成 → 扩图 → 去背景 → 拆帧</div>
          </div>`}
        </div>`
      return
    }

    this.initCenterStep2()
    const actionIds = [
      ...Object.keys(img.splitFrames),
      ...Object.keys(img.actionSheets).filter(id => !img.splitFrames[id]),
    ]
    for (const id of actionIds) this.appendActionResult(id)
    this.createGifPreviews()
  }

  private initCenterStep2(): void {
    this.panels!.center.innerHTML = `
      <div class="px-center">
        ${this.renderStageStrip()}
        <div class="px-center-title">动作帧预览</div>
        <div class="px-action-results" data-px="action-results"></div>
      </div>`
    this.renderProgressOverlay()
  }

  private appendActionResult(actionId: string): void {
    const img = this.img
    // 生成是 async；用户点「一键生成」后可能切走 pipeline、重渲 / unmount，
    // 等 promise resolve 时 this.panels 已经被置 null。此时直接跳过 DOM 追加即可
    // —— 数据（splitFrames / actionSheets / …）已经在更上游写进 this.img 了，
    // 等下次回到这个 tab 重新 render 时会重建卡片。
    const center = this.panels?.center
    if (!center) return
    const container = center.querySelector('[data-px="action-results"]')
    if (!container) return

    const existing = container.querySelector(`[data-action-card="${actionId}"]`)
    if (existing) existing.remove()

    const action = getAction(actionId)
    const dirFrames = img.splitFrames[actionId]
    const rawSheetUrl = img.actionSheets[actionId]
    const cleanSheetUrl = img.cleanSheets[actionId]
    const storedPrompt = img.actionPrompts[actionId]

    let html = `<div class="px-action-card" data-action-card="${actionId}">`
    html += `<div class="px-action-card-head">`
    html += `<span class="px-action-card-name">${action?.label || actionId}</span>`

    if (dirFrames) {
      const dirCount = Object.keys(dirFrames).length
      const frameCount = Object.values(dirFrames).reduce((n, arr) => n + arr.length, 0)
      html += `<span class="px-action-card-meta">${action?.framesPerDir || '?'}帧 × ${dirCount}方向 = ${frameCount}帧</span>`
    } else {
      html += `<span class="px-action-card-meta">⏳ 处理中...</span>`
    }
    html += `</div>`

    if (rawSheetUrl || cleanSheetUrl || storedPrompt) {
      html += `<details class="px-sheet-toggle"><summary>▶ 原始 Sheet 与 Prompt（点击展开，可编辑后重生成）</summary>`
      html += `<div class="px-sheet-prompt-row">`
      html += `<div class="px-sheet-col">`
      if (rawSheetUrl) {
        html += `<div class="px-sheet-label">AI 原始输出</div><img class="px-sheet-img" src="${rawSheetUrl}" alt="raw sheet">`
      }
      if (cleanSheetUrl && cleanSheetUrl !== rawSheetUrl) {
        html += `<div class="px-sheet-label">去背景后</div><img class="px-sheet-img" src="${cleanSheetUrl}" alt="clean sheet">`
      }
      html += `</div>`
      if (storedPrompt !== undefined) {
        html += `<div class="px-prompt-col">`
        html += `<div class="px-sheet-label">提示词（可修改后重生成）</div>`
        html += `<textarea class="px-prompt-textarea" data-px-prompt-text="${actionId}" spellcheck="false">${this.esc(storedPrompt)}</textarea>`
        html += `<div class="px-prompt-actions">`
        html += `<button class="px-btn small" data-px-regen-prompt="${actionId}">${pxIcon('refresh', 'px-icon')} 用当前提示词重生成</button>`
        html += `<button class="px-btn small" data-px-reset-prompt="${actionId}" title="恢复默认模板生成的提示词">↺ 恢复默认</button>`
        html += `</div></div>`
      }
      html += `</div></details>`
    }

    if (dirFrames) {
      for (const [dir, frameUrls] of Object.entries(dirFrames)) {
        html += `<div class="px-dir-strip" data-dir-strip="${actionId}:${dir}">`
        html += `<div class="px-dir-strip-left">`
        html += `<span class="px-dir-strip-name">${DIR_LABELS[dir as Direction] || dir}</span>`
        html += `<div class="px-dir-strip-gif" data-gif="${actionId}:${dir}"></div>`
        html += `</div>`
        html += `<div class="px-dir-strip-right">`
        for (let i = 0; i < frameUrls.length; i++) {
          html += this.renderFrameCell(actionId, dir, i, frameUrls[i], false)
        }
        html += `</div></div>`
      }

      html += `<div class="px-action-card-footer">`
      html += `<button class="px-btn small" data-regen-action="${actionId}">${pxIcon('refresh', 'px-icon')} 重新生成此动作</button>`
      html += `<button class="px-btn small" data-autocenter-action="${actionId}">⊙ 全部居中</button>`
      html += `</div>`
    }

    html += `</div>`

    const tmp = document.createElement('div')
    tmp.innerHTML = html
    const card = tmp.firstElementChild!
    container.appendChild(card)

    this.bindActionCardEvents(card as HTMLElement, actionId)
    this.createGifPreviewsForAction(actionId)

    // Wrap the generated sheet previews (raw + cleaned) so the user can hide
    // them during recording without losing the underlying data. Individual
    // split frames stay plain — those are the working material the user
    // still needs to see while editing.
    applyHideableTo(card as HTMLElement, 'img.px-sheet-img', {
      idFrom: img => `pixel-char:sheet:${actionId}:${img.alt || 'img'}`,
    })
  }

  private renderFrameCell(actionId: string, dir: string, idx: number, url: string, readonly = false): string {
    const key = `${actionId}:${dir}:${idx}`
    if (readonly) {
      return `<div class="px-frame-cell" data-frame="${key}">
        <div class="px-frame-drag-zone">
          <img src="${url}" class="px-frame-img checkerboard" draggable="false" />
        </div>
        <span class="px-frame-idx">#${idx + 1}</span>
      </div>`
    }
    return `<div class="px-frame-cell" data-frame="${key}">
      <div class="px-frame-drag-zone" data-drag-frame="${key}" title="拖拽移动角色位置">
        <img src="${url}" class="px-frame-img checkerboard" draggable="false" />
      </div>
      <span class="px-frame-idx">#${idx + 1}</span>
      <div class="px-frame-ops">
        <button class="px-btn tiny" data-frame-replace="${key}" title="上传替换">↻</button>
        <button class="px-btn tiny" data-frame-copy="${key}" title="从其他帧复制">📋</button>
        <button class="px-btn tiny" data-frame-flip="${key}" title="左右翻转">↔</button>
        <button class="px-btn tiny" data-frame-autocenter="${key}" title="自动居中">⊙</button>
      </div>
    </div>`
  }

  private bindActionCardEvents(card: HTMLElement, actionId: string): void {
    card.querySelectorAll<HTMLButtonElement>('[data-regen-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.regenAction(btn.dataset.regenAction!)
      })
    })

    card.querySelector<HTMLButtonElement>(`[data-px-regen-prompt="${actionId}"]`)?.addEventListener('click', () => {
      const textarea = card.querySelector<HTMLTextAreaElement>(`[data-px-prompt-text="${actionId}"]`)
      if (!textarea) return
      this.img.actionPrompts[actionId] = textarea.value
      this.regenAction(actionId)
    })

    card.querySelector<HTMLButtonElement>(`[data-px-reset-prompt="${actionId}"]`)?.addEventListener('click', () => {
      delete this.img.actionPrompts[actionId]
      this.appendActionResult(actionId)
    })

    card.querySelectorAll<HTMLButtonElement>('[data-autocenter-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.autoCenterAction(btn.dataset.autocenterAction!)
      })
    })

    card.querySelectorAll<HTMLButtonElement>('[data-frame-replace]').forEach(btn => {
      btn.addEventListener('click', () => {
        const parts = btn.dataset.frameReplace!.split(':')
        this.replaceFrame(parts[0], parts[1], parseInt(parts[2]))
      })
    })

    card.querySelectorAll<HTMLButtonElement>('[data-frame-copy]').forEach(btn => {
      btn.addEventListener('click', () => {
        const parts = btn.dataset.frameCopy!.split(':')
        this.copyFrameFrom(parts[0], parts[1], parseInt(parts[2]))
      })
    })

    card.querySelectorAll<HTMLButtonElement>('[data-frame-flip]').forEach(btn => {
      btn.addEventListener('click', () => {
        const parts = btn.dataset.frameFlip!.split(':')
        this.flipFrame(parts[0], parts[1], parseInt(parts[2]))
      })
    })

    card.querySelectorAll<HTMLButtonElement>('[data-frame-autocenter]').forEach(btn => {
      btn.addEventListener('click', () => {
        const parts = btn.dataset.frameAutocenter!.split(':')
        this.autoCenterFrame(parts[0], parts[1], parseInt(parts[2]))
      })
    })

    // Drag-to-move on frame images
    card.querySelectorAll<HTMLElement>('[data-drag-frame]').forEach(zone => {
      this.bindFrameDrag(zone)
    })
  }

  private createGifPreviews(): void {
    for (const actionId of Object.keys(this.img.splitFrames)) {
      this.createGifPreviewsForAction(actionId)
    }
  }

  private createGifPreviewsForAction(actionId: string): void {
    this.stopGifsForAction(actionId)

    const dirFrames = this.img.splitFrames[actionId]
    if (!dirFrames) return
    const action = getAction(actionId)
    const delay = Math.round(1000 / this.cfg.fps)
    const handles: GifPreviewHandle[] = []

    for (const [dir, frameUrls] of Object.entries(dirFrames)) {
      const el = this.panels?.center.querySelector(`[data-gif="${actionId}:${dir}"]`)
      if (!el || frameUrls.length === 0) continue
      el.innerHTML = ''

      const canvases: HTMLCanvasElement[] = new Array(frameUrls.length)
      let loaded = 0

      frameUrls.forEach((url, idx) => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = img.width; c.height = img.height
          c.getContext('2d')!.drawImage(img, 0, 0)
          canvases[idx] = c
          loaded++
          if (loaded === frameUrls.length) {
            const handle = createGifPreview(canvases.filter(Boolean), {
              delay,
              pingPong: action?.looping ?? true,
              holdLastFrameMs: action?.holdLastFrameMs ?? 0,
            })
            handle.canvas.className = 'px-gif-canvas'
            el.textContent = ''
            el.appendChild(handle.canvas)
            handles.push(handle)
          }
        }
        img.src = url
      })
    }

    this.gifHandles.set(actionId, handles)
  }

  /* ── Event Binding ──────────────────────────────────────────────── */

  private bindEvents(): void {
    if (!this.leftEl) return

    // characterType 由 profile 驱动（见 renderLeft 里的 inferCharacterTypeFromProfile），
    // 不再有独立的点击切换——以免和上游角色设定冲突。

    this.leftEl.querySelectorAll<HTMLButtonElement>('[data-gameplay-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.gameplayMode as GameplayMode | undefined
        if (!next || next === this.cfg.gameplayMode) return
        this.cfg.gameplayMode = next
        // Prune selected actions that don't exist in the new mode (e.g. 'jump' → RPG).
        const allowed = new Set(this.availableActions().map(a => a.id))
        this.cfg.selectedActions = this.cfg.selectedActions.filter(id => allowed.has(id))
        saveConfig(this.cfg)
        this.renderLeft()
        this.renderCenter()
      })
    })

    this.leftEl.querySelectorAll<HTMLButtonElement>('[data-art-style]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.artStyle
        if (!id || id === this.cfg.artStyleId) return
        this.cfg.artStyleId = id
        saveConfig(this.cfg)
        this.renderLeft()
      })
    })

    this.leftEl.querySelector('[data-px="style-prompt"]')?.addEventListener('input', (e) => {
      this.cfg.pixelStyle = (e.target as HTMLTextAreaElement).value
      saveConfig(this.cfg)
    })

    this.leftEl.querySelector('[data-px="gen-turnaround"]')?.addEventListener('click', () => this.execStep1())

    this.leftEl.querySelector('[data-px="upload-turnaround"]')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = async () => {
        this.img.turnaroundImage = reader.result as string
        await this.updateReferenceAnchors()
        this.autoSave()
        this.refresh()
        this.toast('已上传四方向参考图')
      }
      reader.readAsDataURL(file)
    })

    /*
     * 「上传为角色设定图」— 绕过 CharacterDesign 管线，直接把用户的图
     *  写入 globalState.characterImage，让 Step1 / Step2 所有后续流程
     *  把它当作详细设定图处理。
     *  同一个 data-px 在 hasDesign / !hasDesign 两个分支里都可能出现，
     *  所以用 querySelectorAll。
     */
    this.leftEl.querySelectorAll('[data-px="upload-character-sheet"]').forEach(input => {
      input.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          globalState.setCharacterImage(dataUrl)
          this.refresh()
          this.toast('已上传为角色设定图，后续管线将使用此图')
        }
        reader.readAsDataURL(file)
      })
    })

    this.leftEl.querySelectorAll<HTMLButtonElement>('[data-gen-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.cfg.genMode = btn.dataset.genMode as GenMode
        saveConfig(this.cfg)
        this.refresh()
      })
    })

    this.leftEl.querySelectorAll<HTMLInputElement>('[data-action-id]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.actionId!
        const set = new Set(this.cfg.selectedActions)
        if (cb.checked) set.add(id); else set.delete(id)
        this.cfg.selectedActions = [...set]
        saveConfig(this.cfg)
        const pool = this.availableActions()
        const allNow = pool.every(a => this.cfg.selectedActions.includes(a.id))
        const toggleBtn = this.leftEl?.querySelector('[data-px="toggle-all-actions"]')
        if (toggleBtn) toggleBtn.textContent = allNow ? '取消全选' : '全选'
      })
    })

    this.leftEl.querySelector('[data-px="toggle-all-actions"]')?.addEventListener('click', () => {
      const pool = this.availableActions()
      const allSelected = pool.every(a => this.cfg.selectedActions.includes(a.id))
      this.cfg.selectedActions = allSelected ? [] : pool.map(a => a.id)
      saveConfig(this.cfg)
      this.leftEl?.querySelectorAll<HTMLInputElement>('[data-action-id]').forEach(cb => {
        cb.checked = this.cfg.selectedActions.includes(cb.dataset.actionId!)
      })
      const toggleBtn = this.leftEl?.querySelector('[data-px="toggle-all-actions"]')
      if (toggleBtn) toggleBtn.textContent = allSelected ? '全选' : '取消全选'
    })

    this.leftEl.querySelector('[data-px="gen-actions-continue"]')?.addEventListener('click', () => this.execGenPipeline(false))
    this.leftEl.querySelector('[data-px="gen-actions-force"]')?.addEventListener('click', () => this.execGenPipeline(true))

    this.leftEl.querySelector('[data-px="fps-slider"]')?.addEventListener('input', (e) => {
      this.cfg.fps = Number((e.target as HTMLInputElement).value)
      const valEl = this.leftEl?.querySelector('[data-px="fps-val"]')
      if (valEl) valEl.textContent = `${this.cfg.fps} fps`
      saveConfig(this.cfg)
    })

    this.leftEl.querySelector('[data-px="save-to-lib"]')?.addEventListener('click', async () => {
      const btn = this.leftEl?.querySelector('[data-px="save-to-lib"]') as HTMLElement
      this.btnFlash(btn, 'busy')
      await this.saveToLib()
      this.btnFlash(btn, 'done')
    })
    this.leftEl.querySelector('[data-px="export-all"]')?.addEventListener('click', async () => {
      const btn = this.leftEl?.querySelector('[data-px="export-all"]') as HTMLElement
      this.btnFlash(btn, 'busy')
      await this.exportAll()
      this.btnFlash(btn, 'done')
    })

    this.leftEl.querySelector('[data-px="align-mode"]')?.addEventListener('change', async (e) => {
      this.cfg.alignMode = (e.target as HTMLSelectElement).value as AlignMode
      saveConfig(this.cfg)
      await this.updateReferenceAnchors()
    })

    this.leftEl.querySelector('[data-px="frame-size"]')?.addEventListener('change', (e) => {
      this.cfg.targetFrameSize = parseInt((e.target as HTMLSelectElement).value, 10) || 0
      saveConfig(this.cfg)
    })

    this.leftEl.querySelector('[data-px="realign"]')?.addEventListener('click', () => this.realignAllFrames())
  }

  /* ── Step 1: Generate Turnaround ─────────────────────────────────── */

  private async execStep1(): Promise<void> {
    if (this.generating) return
    const designImage = globalState.get().characterImage
    if (!designImage) { this.toast('请先完成角色设计'); return }

    this.generating = true
    this.showProgress(true, '正在生成四方向参考图...')
    // Re-render so the right cell switches to the in-cell loading skeleton
    // (instead of the empty placeholder) — without this the cell stays in its
    // pre-click state until refresh is triggered by autoSave.
    this.refresh()

    try {
      const base64 = designImage.replace(/^data:[^;]+;base64,/, '')
      // 动画统一走 nano(Gemini):提示词体系以 nano 为主路线,turnaround/动作 sheet
      // 都按它调过。模型选择器已从 UI 移除。
      const model = this.animImageModel()
      const rawPrompt = generateTurnaroundPrompt(this.styleCtx(), model)
      const prompt = adaptPromptForImageModel(rawPrompt, model)
      const aspect = getGameplayMode(this.cfg.gameplayMode).turnaroundLayout === 'single-side'
        ? '2:3'
        : '1:1'

      const body: Record<string, unknown> = {
        prompt,
        aspectRatio: aspect,
        inputImageBase64: base64,
        model: apiModelIdForImageModel(model),
      }

      const result = await apiPost('/__ce-api__/generate-image', body)

      if (result.success && result.imageBase64) {
        this.img.turnaroundImage = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
        await this.updateReferenceAnchors()
        this.toast('四方向参考图生成完成')
        // Await autoSave so the IDB write + state broadcast complete BEFORE we
        // flip generating=false. Otherwise the sibling pane briefly sees both
        // "no progress" (we just cleared it) AND "no result" (broadcast hasn't
        // landed yet) and renders an empty grid for ~1s.
        await this.autoSave()
        this.refresh()
      } else {
        this.toast('生成失败: ' + (result.error || result.message || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    }

    this.generating = false
    this.showProgress(false)
  }

  /* ── Step 2: Full Pipeline (generate → bg removal → split) ────── */

  private async execGenPipeline(forceAll = false): Promise<void> {
    if (this.generating) return
    const c = this.cfg
    const img = this.img

    if (!img.turnaroundImage) { this.toast('请先完成四方向参考图'); return }
    if (c.selectedActions.length === 0) { this.toast('请至少勾选一个动作'); return }

    this.generating = true

    const pendingActions: string[] = []
    const skippedActions: string[] = []

    if (forceAll) {
      for (const id of c.selectedActions) {
        delete img.actionSheets[id]
        delete img.cleanSheets[id]
        delete img.splitFrames[id]
        pendingActions.push(id)
      }
      this.toast(`全部重新生成 ${pendingActions.length} 个动作`)
    } else {
      for (const id of c.selectedActions) {
        const hasSplitFrames = img.splitFrames[id] && Object.keys(img.splitFrames[id]).length > 0
        if (hasSplitFrames) {
          skippedActions.push(id)
        } else {
          delete img.actionSheets[id]
          delete img.cleanSheets[id]
          delete img.splitFrames[id]
          pendingActions.push(id)
        }
      }

      if (skippedActions.length > 0 && pendingActions.length > 0) {
        const skippedLabels = skippedActions.map(id => getAction(id)?.label || id).join('、')
        this.toast(`跳过已有结果: ${skippedLabels}，继续生成剩余 ${pendingActions.length} 个动作`)
      }

      if (pendingActions.length === 0) {
        this.toast('所有动作已有结果，点击「全部重新生成」可重新生成', 4000)
        this.generating = false
        return
      }
    }

    this.initCenterStep2()

    const total = pendingActions.length
    let done = 0

    for (const actionId of pendingActions) {
      const rawAction = getAction(actionId)
      if (!rawAction) continue
      const action = this.effectiveAction(rawAction)

      // ── Generate ──
      this.showProgress(true, `[1/4 生成] ${action.label} (${done + 1}/${total})`)
      try {
        await this.generateAction(action)
        done++
      } catch (e: any) {
        console.error(`[PixelChar] gen failed ${actionId}:`, e)
        this.toast(`${action.label} 生成失败: ${e.message}`)
        continue
      }

      this.appendActionResult(actionId)

      // ── Validate grid ──
      const layout = computeSheetLayout(action)
      let dataUrl = img.actionSheets[actionId]
      if (dataUrl) {
        try {
          const validation = await validateSheetGrid(dataUrl, layout.physCols, layout.physRows)
          if (!validation.valid) {
            console.warn(`[PixelChar] Grid mismatch for ${actionId}:`, validation.warning)
            this.toast(`⚠️ ${action.label}: ${validation.warning}`)
          }
        } catch (e) {
          console.warn(`[PixelChar] Grid validation failed for ${actionId}:`, e)
        }
      }

      // ── Expand green background ──
      if (dataUrl) {
        const factor = action.expandFactor ?? 2
        this.showProgress(true, `[2/4 扩图 ×${factor}] ${action.label}`)
        try {
          const el = await loadImageElement(dataUrl)
          const srcCanvas = document.createElement('canvas')
          srcCanvas.width = el.naturalWidth
          srcCanvas.height = el.naturalHeight
          srcCanvas.getContext('2d')!.drawImage(el, 0, 0)
          const expanded = expandGreenBackground(
            srcCanvas, layout.physCols, layout.physRows, factor,
          )
          dataUrl = expanded.toDataURL('image/png')
          img.actionSheets[actionId] = dataUrl
        } catch (e: any) {
          console.warn(`[PixelChar] expand failed ${actionId}:`, e)
        }
        this.appendActionResult(actionId)
      }

      // ── Background Removal ──
      if (dataUrl) {
        this.showProgress(true, `[3/4 去背景] ${action.label}`)
        try {
          const el = await loadImageElement(dataUrl)
          const srcCanvas = document.createElement('canvas')
          srcCanvas.width = el.naturalWidth
          srcCanvas.height = el.naturalHeight
          srcCanvas.getContext('2d')!.drawImage(el, 0, 0)
          const cleaned = removeAnyBackground(srcCanvas, { tolerance: 50, shrinkPx: 2 })
          img.cleanSheets[actionId] = cleaned.toDataURL('image/png')
        } catch (e: any) {
          console.warn(`[PixelChar] bg removal failed ${actionId}:`, e)
          img.cleanSheets[actionId] = dataUrl
        }

        this.appendActionResult(actionId)
      }

      // ── Split Frames ──
      const source = img.cleanSheets[actionId] || img.actionSheets[actionId]
      if (source) {
        this.showProgress(true, `[4/4 拆帧] ${action.label} (${action.framesPerDir}×${action.directions.length})`)
        try {
          const dirFramesList = await splitSheetByDirection(source, action)
          let rawDirFrames: Record<string, HTMLCanvasElement[]> = {}
          for (const df of dirFramesList) {
            rawDirFrames[df.direction] = df.frames
          }
          rawDirFrames = ensureAllFramesBgRemoved(rawDirFrames)
          img.splitFrames[actionId] = await this.postProcessFrames(rawDirFrames, actionId)
        } catch (e: any) {
          console.warn(`[PixelChar] split failed ${actionId}:`, e)
        }

        this.appendActionResult(actionId)
      }

      // Incremental save: persist each completed action immediately so
      // progress survives a page refresh mid-pipeline.
      this.autoSave()
    }

    if (done > 0 && this.cfg.targetFrameSize === 0) {
      this.showProgress(true, '统一帧尺寸...')
      const maxSize = getMaxFrameSize(img.splitFrames)
      if (maxSize > 0) {
        await normalizeAllActions(img.splitFrames, maxSize)
      }
    }

    this.generating = false
    this.showProgress(false)
    if (done > 0) {
      this.toast(`${done} 个动作处理完成`)
      this.autoSave()
      await this.saveCurrentBatch(c.selectedActions)
      await this.autoSaveAndAlignPreviewActions(pendingActions)
    }

    if (this.regenQueue.length > 0) {
      this.toast(`管线完成，开始执行队列中 ${this.regenQueue.length} 个任务...`, 2000)
      await this.drainRegenQueue()
    }
  }

  /**
   * 生成结束后自动把「刚生成好的动作」塞进动作库并跑一次自动统一大小，
   * 用户进入编辑页预览时就已经是按身高对齐过的效果；再进动作库可手动微调。
   *
   * 只处理本轮新生成的 actionIds——用户可能在库里还有其他动作，保持它们的
   * 手动调整不被覆盖；auto-align 针对的是 splitFrames 里刚落盘的那批。
   */
  private async autoSaveAndAlignPreviewActions(actionIds: string[]): Promise<void> {
    const img = this.img
    const fresh = actionIds.filter(id => img.splitFrames[id] && Object.keys(img.splitFrames[id]).length > 0)
    if (fresh.length === 0) return

    try {
      for (const actionId of fresh) {
        const action = getAction(actionId)
        if (!action) continue
        await this.saveOneActionToLib(
          actionId, action.label, img.actionSheets[actionId] || '', img.splitFrames[actionId],
        )
      }
      await this.autoAlignLibScalesSilent()
    } catch (e) {
      console.warn('[PixelChar] auto save & align after gen failed:', e)
    }
  }

  /**
   * 与 {@link autoAlignLibScales} 行为一致，但不弹 toast，用于自动流程里静默完成。
   */
  private async autoAlignLibScalesSilent(): Promise<void> {
    if (this.actionLib.length === 0) return

    const seen = new Set<string>()
    const entries: PixelActionLibEntry[] = []
    for (const e of this.actionLib) {
      if (seen.has(e.actionId)) continue
      seen.add(e.actionId)
      entries.push(e)
    }

    const measurements = new Map<string, number>()
    for (const e of entries) {
      const h = await measureActionContentHeight(e.directions)
      if (h > 0) measurements.set(e.id, h)
    }
    if (measurements.size === 0) return

    const idleEntry = entries.find(e => e.actionId === 'idle' && measurements.has(e.id))
    let reference: number
    if (idleEntry) {
      reference = measurements.get(idleEntry.id)!
    } else {
      const heights = [...measurements.values()].sort((a, b) => a - b)
      reference = heights[Math.floor(heights.length / 2)]
    }

    for (const e of entries) {
      const h = measurements.get(e.id)
      const scale = h && h > 0 ? clampScale(reference / h) : 1
      e.scale = scale
      await updatePixelActionScale(e.id, scale)
    }

    for (const entry of this.actionLib) {
      const leader = entries.find(e => e.actionId === entry.actionId)
      if (leader && entry.id !== leader.id) {
        entry.scale = leader.scale
        await updatePixelActionScale(entry.id, leader.scale ?? 1)
      }
    }

    this.renderLeft()
  }

  /* ── Generation Methods ──────────────────────────────────────────── */

  private async generateAction(action: ChibiAction): Promise<void> {
    // pose-template 模式需要一张随插件发布的姿态模板图(action.templateAsset)。
    // 但部分动作(如 walk → '/pixel-templates/walk.png')的模板资源从未实际打包,
    // dev server 对未知路径回退到 SPA 的 index.html(Content-Type: text/html),
    // <img> 加载 HTML 当然 onerror「图片加载失败」,导致该动作在批量生成里被
    // 跳过(用户:选了待机+走路,只出了待机)。这里改为:模板能加载才走 pose-
    // template,否则优雅回退到与待机相同的 turnaround 生成路径(motion 文本里
    // 已含完整走路循环描述,质量足够),保证每个勾选的动作都能产出。
    if (action.templateAsset && await templateAssetLoadable(action.templateAsset)) {
      await this.genFromPoseTemplate(action)
    } else if (this.cfg.genMode === 'direct') {
      await this.genDirect(action)
    } else {
      await this.genTemplate(action)
    }
  }

  private sheetAspectRatio(action: ChibiAction): string {
    // Aspect must match the PHYSICAL canvas the AI will draw, not the logical
    // (framesPerDir × directions) grid. Otherwise wide single-row strips get
    // assigned an unsupported ratio (7:1 etc.), the model silently wraps to
    // 2 rows, and the downstream grid crop slices every frame in half. See
    // `computeSheetLayout()` for the wrap policy.
    const layout = computeSheetLayout(action)
    return nearestGeminiRatio(layout.physCols, layout.physRows)
  }

  /** Unify + auto-center + normalize size + convert to data URLs. */
  private async postProcessFrames(rawDirFrames: Record<string, HTMLCanvasElement[]>, actionId?: string): Promise<Record<string, string[]>> {
    const unified = unifyActionFrames(rawDirFrames, this.cfg.alignMode, this.img.referenceAnchors, 10)
    let result: Record<string, string[]> = {}
    for (const [dir, frames] of Object.entries(unified)) {
      result[dir] = canvasArrayToDataUrls(autoCenterCanvases(frames))
    }
    if (this.cfg.targetFrameSize > 0) {
      result = await normalizeFrameSize(result, this.cfg.targetFrameSize)
    }
    return result
  }

  private async genDirect(action: ChibiAction): Promise<void> {
    const rawPrompt = this.img.actionPrompts[action.id]
      || generateSheetPrompt(action, this.styleCtx())
    const prompt = adaptPromptForImageModel(rawPrompt, this.animImageModel())
    const refBase64 = this.img.turnaroundImage!.replace(/^data:[^;]+;base64,/, '')

    const result = await apiPost('/__ce-api__/generate-image', {
      prompt,
      inputImageBase64: refBase64,
      aspectRatio: this.sheetAspectRatio(action),
      model: apiModelIdForImageModel(this.animImageModel()),
    })

    if (result.success && result.imageBase64) {
      this.img.actionSheets[action.id] = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
      this.img.actionPrompts[action.id] = rawPrompt
    } else {
      throw new Error(result.error || '生成失败')
    }
  }

  private async genTemplate(action: ChibiAction): Promise<void> {
    if (!this.img.turnaroundImage) throw new Error('无参考图')

    const refImages: Record<Direction, string> = {} as any
    for (const d of action.directions) refImages[d] = this.img.turnaroundImage

    const templateDataUrl = await composeChibiTemplate(refImages, action)
    const templateBase64 = templateDataUrl.replace(/^data:[^;]+;base64,/, '')
    const rawPrompt = this.img.actionPrompts[action.id]
      || generateTemplatePrompt(action, this.styleCtx())
    const prompt = adaptPromptForImageModel(rawPrompt, this.animImageModel())

    const result = await apiPost('/__ce-api__/generate-image', {
      prompt,
      inputImageBase64: templateBase64,
      aspectRatio: this.sheetAspectRatio(action),
      model: apiModelIdForImageModel(this.animImageModel()),
    })

    if (result.success && result.imageBase64) {
      this.img.actionSheets[action.id] = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
      this.img.actionPrompts[action.id] = rawPrompt
    } else {
      throw new Error(result.error || '生成失败')
    }
  }

  private async genFromPoseTemplate(action: ChibiAction): Promise<void> {
    if (!this.img.turnaroundImage) throw new Error('无参考图')

    const templateImg = await loadImageElement(action.templateAsset!)
    const tCanvas = document.createElement('canvas')
    tCanvas.width = templateImg.naturalWidth
    tCanvas.height = templateImg.naturalHeight
    tCanvas.getContext('2d')!.drawImage(templateImg, 0, 0)
    const templateBase64 = tCanvas.toDataURL('image/png').replace(/^data:[^;]+;base64,/, '')
    const turnaroundBase64 = this.img.turnaroundImage.replace(/^data:[^;]+;base64,/, '')

    const rawPrompt = this.img.actionPrompts[action.id]
      || generatePoseTransferPrompt(action, this.styleCtx())
    const prompt = adaptPromptForImageModel(rawPrompt, this.animImageModel())

    const result = await apiPost('/__ce-api__/generate-image', {
      prompt,
      inputImages: [
        { base64: turnaroundBase64, mimeType: 'image/png' },
        { base64: templateBase64, mimeType: 'image/png' },
      ],
      aspectRatio: this.sheetAspectRatio(action),
      model: apiModelIdForImageModel(this.animImageModel()),
    })

    if (result.success && result.imageBase64) {
      this.img.actionSheets[action.id] = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
      this.img.actionPrompts[action.id] = rawPrompt
    } else {
      throw new Error(result.error || '生成失败')
    }
  }

  /* ── Session Persistence ───────────────────────────────────────── */

  private collectBlobs(): Record<string, string> {
    const blobs: Record<string, string> = {}
    if (this.img.turnaroundImage) blobs['turnaround'] = this.img.turnaroundImage
    for (const [id, url] of Object.entries(this.img.actionSheets)) blobs[`sheet:${id}`] = url
    for (const [id, url] of Object.entries(this.img.cleanSheets)) blobs[`clean:${id}`] = url
    for (const [actionId, dirMap] of Object.entries(this.img.splitFrames)) {
      for (const [dir, frames] of Object.entries(dirMap)) {
        for (let i = 0; i < frames.length; i++) {
          blobs[`frames:${actionId}:${dir}:${i}`] = frames[i]
        }
      }
    }
    return blobs
  }

  private async updateReferenceAnchors(): Promise<void> {
    if (!this.img.turnaroundImage) { this.img.referenceAnchors = {}; return }
    try {
      const el = await loadImageElement(this.img.turnaroundImage)
      const c = document.createElement('canvas')
      c.width = el.naturalWidth; c.height = el.naturalHeight
      c.getContext('2d')!.drawImage(el, 0, 0)
      this.img.referenceAnchors = extractReferenceAnchors(c, this.cfg.alignMode)
    } catch (e) {
      console.warn('[PixelChar] anchor extraction failed:', e)
      this.img.referenceAnchors = {}
    }
  }

  private _uploadedBlobKeys: Map<string, string> = new Map()

  private async autoSave(): Promise<void> {
    try {
      const blobs = this.collectBlobs()
      const thumbnail = this.img.turnaroundImage || undefined
      await sessionAutoSave(PIPELINE_ID, { ...this.cfg } as any, blobs, undefined, thumbnail)
      this.broadcastState()
      // Mirror this session's artifacts to <projectRoot>/.forgeax/games/<slug>/
      // characters/<charId>/pixel/. Fire-and-forget per blob; we skip blobs
      // whose fingerprint hasn't changed since the last write so subsequent
      // autoSave() calls (10+ per generation) don't replay every byte.
      this.uploadBlobsToProject(blobs)
    } catch (e) {
      console.warn('[PixelChar] auto-save failed:', e)
    }
  }

  private uploadBlobsToProject(blobs: Record<string, string>): void {
    for (const [key, dataUrl] of Object.entries(blobs)) {
      if (!dataUrl) continue
      const fp = `${dataUrl.length}:${dataUrl.slice(-32)}`
      if (this._uploadedBlobKeys.get(key) === fp) continue
      this._uploadedBlobKeys.set(key, fp)
      const rel = blobKeyToRel(key)
      if (!rel) continue
      void globalState.uploadAsset(rel, dataUrl)
    }
  }


  private async restoreSession(opts: { checkPartial?: boolean } = {}): Promise<void> {
    try {
      const data = await sessionLoad(`current:${PIPELINE_ID}`)
      if (!data) return

      const { meta, blobs } = data

      if (meta.config) {
        const forceStep = pendingReset ? 1 as Step : undefined
        Object.assign(this.cfg, meta.config)
        if (forceStep !== undefined) this.cfg.activeStep = forceStep
        pendingReset = false
        saveConfig(this.cfg)
      }

      this.restoreBlobs(blobs)
      await this.updateReferenceAnchors()

      // The "partial generation recovered" toast must fire AT MOST ONCE — only
      // on the first restore of this instance's lifetime. Without this guard it
      // re-fired on every cross-iframe `pixel-char-state` broadcast sync
      // (onBroadcastState → restoreSession), so the banner kept popping up
      // forever even though nothing changed. Broadcast-driven restores pass
      // `checkPartial:false`.
      if (opts.checkPartial && !this._partialChecked) {
        this._partialChecked = true
        this.checkPartialGeneration()
      }
    } catch (e) {
      console.warn('[PixelChar] session restore failed:', e)
    }
  }

  private checkPartialGeneration(): void {
    const selected = this.cfg.selectedActions
    if (selected.length === 0) return

    const completed = selected.filter(id =>
      this.img.splitFrames[id] && Object.keys(this.img.splitFrames[id]).length > 0,
    )
    const missing = selected.filter(id => !completed.includes(id))

    if (completed.length > 0 && missing.length > 0) {
      const missingLabels = missing.map(id => getAction(id)?.label || id).join('、')
      this.toast(
        `检测到上次未完成的生成，已恢复 ${completed.length} 个动作。` +
        `点击「一键生成」可继续生成剩余: ${missingLabels}`,
        6000,
      )
    }
  }

  private restoreBlobs(blobs: Record<string, string>): void {
    if (blobs['turnaround']) this.img.turnaroundImage = blobs['turnaround']

    for (const [key, value] of Object.entries(blobs)) {
      if (key.startsWith('sheet:')) {
        this.img.actionSheets[key.slice(6)] = value
      } else if (key.startsWith('clean:')) {
        this.img.cleanSheets[key.slice(6)] = value
      } else if (key.startsWith('frames:')) {
        const parts = key.split(':')
        const actionId = parts[1]
        const dir = parts[2]
        const idx = parseInt(parts[3])
        if (!this.img.splitFrames[actionId]) this.img.splitFrames[actionId] = {}
        if (!this.img.splitFrames[actionId][dir]) this.img.splitFrames[actionId][dir] = []
        this.img.splitFrames[actionId][dir][idx] = value
      }
    }
  }

  private async refreshBatchHistory(): Promise<void> {
    try {
      this.batchHistory = await listBatches()
    } catch (e) {
      console.warn('[PixelChar] batch list failed:', e)
      this.batchHistory = []
    }
  }

  private async saveCurrentBatch(actionIds: string[]): Promise<void> {
    const img = this.img
    const actions: BatchActionResult[] = []
    for (const id of actionIds) {
      const action = getAction(id)
      const dirMap = img.splitFrames[id]
      if (!action || !dirMap) continue
      const dirsCopy: Record<string, string[]> = {}
      for (const [dir, frames] of Object.entries(dirMap)) {
        dirsCopy[dir] = [...frames]
      }
      actions.push({
        actionId: id,
        actionLabel: action.label,
        sheetDataUrl: img.actionSheets[id] || '',
        cleanSheetDataUrl: img.cleanSheets[id],
        directions: dirsCopy,
      })
    }
    if (actions.length === 0) return
    const now = Date.now()
    const ts = new Date(now).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const names = actions.map(a => a.actionLabel.replace(/\s*\(.*\)/, '')).join(', ')
    const batch: GenerationBatchEntry = {
      id: `batch:${now}`,
      createdAt: now,
      label: `${ts} (${names})`,
      thumbnailUrl: img.turnaroundImage || undefined,
      actions,
    }
    try {
      await saveBatch(batch)
      await this.refreshBatchHistory()
      this.renderLeft()
    } catch (e) {
      console.warn('[PixelChar] save batch failed:', e)
    }
  }

  /**
   * Re-split and re-align all existing clean sheets with the current
   * alignment mode without regenerating images from the AI.
   */
  private async realignAllFrames(): Promise<void> {
    if (this.generating) { this.toast('正在生成中，请稍候'); return }

    const actionIds = Object.keys(this.img.splitFrames)
    if (actionIds.length === 0) { this.toast('无可对齐的帧'); return }

    this.generating = true
    await this.updateReferenceAnchors()

    let done = 0
    for (const actionId of actionIds) {
      const rawAction = getAction(actionId)
      if (!rawAction) continue
      const action = this.effectiveAction(rawAction)
      const source = this.img.cleanSheets[actionId] || this.img.actionSheets[actionId]
      if (!source) continue

      this.showProgress(true, `重新对齐 ${action.label} (${done + 1}/${actionIds.length})`)

      try {
        const dirFramesList = await splitSheetByDirection(source, action)
        let rawDirFrames: Record<string, HTMLCanvasElement[]> = {}
        for (const df of dirFramesList) {
          rawDirFrames[df.direction] = df.frames
        }
        rawDirFrames = ensureAllFramesBgRemoved(rawDirFrames)
        this.img.splitFrames[actionId] = await this.postProcessFrames(rawDirFrames, actionId)
        done++
      } catch (e: any) {
        console.warn(`[PixelChar] realign failed ${actionId}:`, e)
      }
    }

    this.generating = false
    this.showProgress(false)
    this.autoSave()
    this.toast(`${done} 个动作已按「${ALIGN_MODES.find(m => m.id === this.cfg.alignMode)?.label}」重新对齐`)
    this.refresh()
  }

  /* ── Regeneration queue drain ──────────────────────────────────── */

  private async drainRegenQueue(): Promise<void> {
    while (this.regenQueue.length > 0) {
      const task = this.regenQueue.shift()!
      if (task.type === 'action') {
        const label = getAction(task.actionId)?.label || task.actionId
        this.toast(`▶ 队列执行: ${label} (剩余 ${this.regenQueue.length})`, 2000)
        await this.regenAction(task.actionId)
      } else {
        const label = getAction(task.actionId)?.label || task.actionId
        const dirLabel = DIR_LABELS[task.direction] || task.direction
        this.toast(`▶ 队列执行: ${label}·${dirLabel} (剩余 ${this.regenQueue.length})`, 2000)
        await this.regenDirection(task.actionId, task.direction)
      }
    }
  }

  /* ── Action-level regeneration ─────────────────────────────────── */

  private async regenAction(actionId: string): Promise<void> {
    if (this.generating) {
      const existing = this.regenQueue.find(t => t.type === 'action' && t.actionId === actionId)
      if (!existing) {
        this.regenQueue.push({ type: 'action', actionId })
        const label = getAction(actionId)?.label || actionId
        this.toast(`⏳ ${label} 已加入队列 (${this.regenQueue.length} 个待执行)`, 2000)
      } else {
        this.toast('该动作已在队列中')
      }
      return
    }
    const rawAction = getAction(actionId)
    if (!rawAction) return
    const action = this.effectiveAction(rawAction)
    if (!this.img.turnaroundImage) { this.toast('无参考图'); return }

    this.generating = true
    this.showProgress(true, `重新生成 ${action.label}...`)

    try {
      // 1. Generate sheet
      await this.generateAction(action)
      const dataUrl = this.img.actionSheets[actionId]
      const layout = computeSheetLayout(action)

      // 1b. Validate grid
      if (dataUrl) {
        try {
          const validation = await validateSheetGrid(dataUrl, layout.physCols, layout.physRows)
          if (!validation.valid) {
            console.warn(`[PixelChar] Grid mismatch for ${actionId}:`, validation.warning)
            this.toast(`⚠️ ${action.label}: ${validation.warning}`)
          }
        } catch (e) {
          console.warn(`[PixelChar] Grid validation failed:`, e)
        }
      }

      // 2. Expand green background
      if (dataUrl) {
        const factor = action.expandFactor ?? 2
        this.showProgress(true, `扩图 ×${factor} ${action.label}...`)
        const el = await loadImageElement(dataUrl)
        const rawCanvas = document.createElement('canvas')
        rawCanvas.width = el.naturalWidth; rawCanvas.height = el.naturalHeight
        rawCanvas.getContext('2d')!.drawImage(el, 0, 0)
        const expanded = expandGreenBackground(rawCanvas, layout.physCols, layout.physRows, factor)
        this.img.actionSheets[actionId] = expanded.toDataURL('image/png')
      }

      // 3. Background removal
      const sheetUrl = this.img.actionSheets[actionId]
      if (sheetUrl) {
        this.showProgress(true, `去背景 ${action.label}...`)
        const el = await loadImageElement(sheetUrl)
        const srcCanvas = document.createElement('canvas')
        srcCanvas.width = el.naturalWidth; srcCanvas.height = el.naturalHeight
        srcCanvas.getContext('2d')!.drawImage(el, 0, 0)
        const cleaned = removeAnyBackground(srcCanvas, { tolerance: 50, shrinkPx: 2 })
        this.img.cleanSheets[actionId] = cleaned.toDataURL('image/png')
      }

      // 4. Split + post-process
      const source = this.img.cleanSheets[actionId] || this.img.actionSheets[actionId]
      if (source) {
        this.showProgress(true, `拆帧 ${action.label}...`)
        const dirFramesList = await splitSheetByDirection(source, action)
        let rawDirFrames: Record<string, HTMLCanvasElement[]> = {}
        for (const df of dirFramesList) {
          rawDirFrames[df.direction] = df.frames
        }
        rawDirFrames = ensureAllFramesBgRemoved(rawDirFrames)
        this.img.splitFrames[actionId] = await this.postProcessFrames(rawDirFrames, actionId)
      }

      this.appendActionResult(actionId)
      this.autoSave()
      await this.saveCurrentBatch([actionId])
      this.toast(`${action.label} 重新生成完成`)
    } catch (e: any) {
      this.toast(`重新生成失败: ${e.message}`)
    } finally {
      this.generating = false
      this.showProgress(false)
      if (this.regenQueue.length > 0) await this.drainRegenQueue()
    }
  }

  private autoCenterAction(actionId: string): void {
    const dirFrames = this.img.splitFrames[actionId]
    if (!dirFrames) return

    for (const dir of Object.keys(dirFrames)) {
      const frames = dirFrames[dir]
      for (let i = 0; i < frames.length; i++) {
        this.autoCenterFrame(actionId, dir, i)
      }
    }
    this.toast(`${getAction(actionId)?.label || actionId} 全部帧已居中`)
  }

  /* ── Per-direction regeneration + frame operations ─────────────── */

  private async regenDirection(actionId: string, direction: Direction): Promise<void> {
    if (this.generating) {
      const existing = this.regenQueue.find(
        t => t.type === 'direction' && t.actionId === actionId && t.direction === direction,
      )
      if (!existing) {
        this.regenQueue.push({ type: 'direction', actionId, direction })
        const label = getAction(actionId)?.label || actionId
        const dirLabel = DIR_LABELS[direction] || direction
        this.toast(`⏳ ${label}·${dirLabel} 已加入队列 (${this.regenQueue.length} 个待执行)`, 2000)
      } else {
        this.toast('该方向已在队列中')
      }
      return
    }
    const rawAction = getAction(actionId)
    if (!rawAction) return
    const action = this.effectiveAction(rawAction)
    if (!this.img.turnaroundImage) { this.toast('无参考图'); return }

    this.generating = true
    this.showProgress(true, `重新生成 ${action.label} / ${DIR_LABELS[direction]}...`)

    try {
      const rawPrompt = generateSingleDirectionPrompt(action, direction, this.styleCtx())
      const prompt = adaptPromptForImageModel(rawPrompt, this.animImageModel())
      const refBase64 = this.img.turnaroundImage.replace(/^data:[^;]+;base64,/, '')

      // Virtual action with only THIS direction — so the layout helper sees
      // the actual canvas shape (not the full 4-dir action's shape).
      const singleDirAction: ChibiAction = { ...action, directions: [direction] }
      const stripLayout = computeSheetLayout(singleDirAction)

      const result = await apiPost('/__ce-api__/generate-image', {
        prompt,
        inputImageBase64: refBase64,
        aspectRatio: nearestGeminiRatio(stripLayout.physCols, stripLayout.physRows),
        model: apiModelIdForImageModel(this.animImageModel()),
      })

      if (!result.success || !result.imageBase64) throw new Error(result.error || '生成失败')

      let stripDataUrl = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`

      // Expand green background using the SINGLE-direction layout so wrap
      // (when rowsPerDir > 1) is handled correctly.
      const rawEl = await loadImageElement(stripDataUrl)
      const rawCanvas = document.createElement('canvas')
      rawCanvas.width = rawEl.naturalWidth
      rawCanvas.height = rawEl.naturalHeight
      rawCanvas.getContext('2d')!.drawImage(rawEl, 0, 0)
      const expanded = expandGreenBackground(rawCanvas, stripLayout.physCols, stripLayout.physRows, action.expandFactor ?? 2)
      stripDataUrl = expanded.toDataURL('image/png')

      // Background removal
      const el = await loadImageElement(stripDataUrl)
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = el.naturalWidth
      srcCanvas.height = el.naturalHeight
      srcCanvas.getContext('2d')!.drawImage(el, 0, 0)
      const cleaned = removeAnyBackground(srcCanvas, { tolerance: 50, shrinkPx: 2 })

      // Split — reuse the singleDirAction declared above so split sees the
      // same wrap layout that the expand-bg pass used.
      const dirFramesList = await splitSheetByDirection(cleaned.toDataURL('image/png'), singleDirAction)
      if (dirFramesList.length > 0) {
        // Collect existing direction frames + new direction, then re-unify all together
        const existing = this.img.splitFrames[actionId] || {}
        const rawDirFrames: Record<string, HTMLCanvasElement[]> = {}
        for (const [dir, urls] of Object.entries(existing)) {
          if (dir === direction) continue
          rawDirFrames[dir] = await Promise.all(urls.map(async (url: string) => {
            const el = await loadImageElement(url)
            const c = document.createElement('canvas')
            c.width = el.naturalWidth; c.height = el.naturalHeight
            c.getContext('2d')!.drawImage(el, 0, 0)
            return c
          }))
        }
        rawDirFrames[direction] = dirFramesList[0].frames.map(f => ensureFrameBgRemoved(f))
        this.img.splitFrames[actionId] = await this.postProcessFrames(rawDirFrames, actionId)
      }

      this.appendActionResult(actionId)
      this.autoSave()
      this.toast(`${action.label} / ${DIR_LABELS[direction]} 重新生成完成`)
    } catch (e: any) {
      this.toast(`重新生成失败: ${e.message}`)
    } finally {
      this.generating = false
      this.showProgress(false)
      if (this.regenQueue.length > 0) await this.drainRegenQueue()
    }
  }

  private replaceFrame(actionId: string, dir: string, idx: number): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        if (this.img.splitFrames[actionId]?.[dir]) {
          this.img.splitFrames[actionId][dir][idx] = dataUrl
          this.appendActionResult(actionId)
          this.autoSave()
          this.toast('帧已替换')
        }
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  private copyFrameFrom(actionId: string, dir: string, idx: number): void {
    const dirFrames = this.img.splitFrames[actionId]
    if (!dirFrames) return

    const allFrames: { label: string, dir: string, idx: number }[] = []
    for (const [d, frames] of Object.entries(dirFrames)) {
      for (let i = 0; i < frames.length; i++) {
        if (d === dir && i === idx) continue
        allFrames.push({ label: `${DIR_LABELS[d as Direction] || d} #${i + 1}`, dir: d, idx: i })
      }
    }
    if (allFrames.length === 0) { this.toast('无可选帧'); return }

    const dialog = document.createElement('div')
    dialog.className = 'px-copy-dialog'
    dialog.innerHTML = `
      <div class="px-copy-dialog-inner">
        <div class="px-copy-dialog-title">选择来源帧</div>
        <div class="px-copy-dialog-list">
          ${allFrames.map((f, i) => `<button class="px-btn small" data-copy-src="${i}">${f.label}</button>`).join('')}
        </div>
        <button class="px-btn small" data-copy-cancel>取消</button>
      </div>`

    dialog.querySelector('[data-copy-cancel]')?.addEventListener('click', () => dialog.remove())
    dialog.querySelectorAll<HTMLButtonElement>('[data-copy-src]').forEach(btn => {
      btn.addEventListener('click', () => {
        const src = allFrames[parseInt(btn.dataset.copySrc!)]
        this.img.splitFrames[actionId][dir][idx] = dirFrames[src.dir][src.idx]
        this.appendActionResult(actionId)
        dialog.remove()
        this.autoSave()
        this.toast('帧已复制')
      })
    })

    document.body.appendChild(dialog)
  }

  private flipFrame(actionId: string, dir: string, idx: number): void {
    const frames = this.img.splitFrames[actionId]?.[dir]
    if (!frames || !frames[idx]) return

    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const ctx2d = c.getContext('2d')!
      ctx2d.translate(c.width, 0)
      ctx2d.scale(-1, 1)
      ctx2d.drawImage(img, 0, 0)
      frames[idx] = c.toDataURL('image/png')

      const cell = this.panels?.center.querySelector(`[data-frame="${actionId}:${dir}:${idx}"]`)
      const imgEl = cell?.querySelector('.px-frame-img') as HTMLImageElement | null
      if (imgEl) imgEl.src = frames[idx]

      this.createGifPreviewsForAction(actionId)
      this.autoSave()
      this.toast('帧已翻转')
    }
    img.src = frames[idx]
  }

  private bindFrameDrag(zone: HTMLElement): void {
    const key = zone.dataset.dragFrame!
    const [actionId, dir, idxStr] = key.split(':')
    const idx = parseInt(idxStr)

    let startX = 0, startY = 0
    let dragging = false

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const imgEl = zone.querySelector('.px-frame-img') as HTMLImageElement | null
      if (imgEl) {
        imgEl.style.transform = `translate(${dx}px, ${dy}px)`
      }
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging) return
      dragging = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      zone.classList.remove('dragging')

      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return

      const imgEl = zone.querySelector('.px-frame-img') as HTMLImageElement | null
      if (imgEl) imgEl.style.transform = ''

      this.applyFrameShift(actionId, dir, idx, dx, dy)
    }

    zone.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()
      startX = e.clientX; startY = e.clientY
      dragging = true
      zone.classList.add('dragging')
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    })
  }

  private applyFrameShift(actionId: string, dir: string, idx: number, dx: number, dy: number): void {
    const frames = this.img.splitFrames[actionId]?.[dir]
    if (!frames || !frames[idx]) return

    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      c.getContext('2d')!.drawImage(img, dx, dy)
      frames[idx] = c.toDataURL('image/png')

      const cell = this.panels?.center.querySelector(`[data-frame="${actionId}:${dir}:${idx}"]`)
      const imgEl = cell?.querySelector('.px-frame-img') as HTMLImageElement | null
      if (imgEl) imgEl.src = frames[idx]

      this.createGifPreviewsForAction(actionId)
      this.autoSave()
    }
    img.src = frames[idx]
  }

  private autoCenterFrame(actionId: string, dir: string, idx: number): void {
    const frames = this.img.splitFrames[actionId]?.[dir]
    if (!frames || !frames[idx]) return

    const img = new Image()
    img.onload = () => {
      const src = document.createElement('canvas')
      src.width = img.width; src.height = img.height
      const srcCtx = src.getContext('2d')!
      srcCtx.drawImage(img, 0, 0)

      const d = srcCtx.getImageData(0, 0, src.width, src.height).data
      let minX = src.width, maxX = 0, minY = src.height, maxY = 0
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          if (d[(y * src.width + x) * 4 + 3] > 10) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX < minX) return

      const contentCx = (minX + maxX) / 2
      const contentCy = (minY + maxY) / 2
      const canvasCx = src.width / 2
      const canvasCy = src.height / 2
      const dx = Math.round(canvasCx - contentCx)
      const dy = Math.round(canvasCy - contentCy)

      if (dx === 0 && dy === 0) { this.toast('已经居中'); return }

      const out = document.createElement('canvas')
      out.width = src.width; out.height = src.height
      out.getContext('2d')!.drawImage(src, dx, dy)
      frames[idx] = out.toDataURL('image/png')

      const cell = this.panels?.center.querySelector(`[data-frame="${actionId}:${dir}:${idx}"]`)
      const imgEl = cell?.querySelector('.px-frame-img') as HTMLImageElement | null
      if (imgEl) imgEl.src = frames[idx]

      this.createGifPreviewsForAction(actionId)
      this.autoSave()
      this.toast('已居中')
    }
    img.src = frames[idx]
  }



  /* ── Save / Export ──────────────────────────────────────────────── */

  /**
   * Auto-align the per-entry `scale` across the action library so the
   * character looks the same size in every thumbnail.
   *
   * Algorithm:
   *   1. Measure each entry's content height (median over sampled frames).
   *   2. Pick a reference height H₀: prefer idle's measurement when present,
   *      otherwise fall back to the median of all measured heights. Idle is
   *      the natural baseline for RPG/platformer characters — attacks and
   *      ultimates routinely overshoot it, so calibrating off a non-idle
   *      action would shrink everything else.
   *   3. For each entry, scale = clamp(H₀ / H_entry). Entries whose content
   *      is unmeasurable (fully transparent) keep scale = 1.
   */
  private async autoAlignLibScales(): Promise<void> {
    if (this.actionLib.length === 0) { this.toast('动作库为空'); return }

    // Dedupe by actionId (action-lib may hold multiple versions per action
    // but we only want to scale each action once based on its latest entry).
    const seen = new Set<string>()
    const entries: PixelActionLibEntry[] = []
    for (const e of this.actionLib) {
      if (seen.has(e.actionId)) continue
      seen.add(e.actionId)
      entries.push(e)
    }

    const measurements = new Map<string, number>()
    for (const e of entries) {
      const h = await measureActionContentHeight(e.directions)
      if (h > 0) measurements.set(e.id, h)
    }
    if (measurements.size === 0) {
      this.toast('无法测量角色高度（帧全透明?）')
      return
    }

    const idleEntry = entries.find(e => e.actionId === 'idle' && measurements.has(e.id))
    let reference: number
    if (idleEntry) {
      reference = measurements.get(idleEntry.id)!
    } else {
      const heights = [...measurements.values()].sort((a, b) => a - b)
      reference = heights[Math.floor(heights.length / 2)]
    }

    let adjusted = 0
    for (const e of entries) {
      const h = measurements.get(e.id)
      const scale = h && h > 0 ? clampScale(reference / h) : 1
      if (Math.abs(scale - (e.scale ?? 1)) > 0.005) adjusted++
      e.scale = scale
      await updatePixelActionScale(e.id, scale)
    }

    // Also propagate scale to any duplicate entries sharing the same actionId
    // so switching between versions doesn't revert to "unaligned".
    for (const entry of this.actionLib) {
      const leader = entries.find(e => e.actionId === entry.actionId)
      if (leader && entry.id !== leader.id) {
        entry.scale = leader.scale
        await updatePixelActionScale(entry.id, leader.scale ?? 1)
      }
    }

    this.renderLeft()
    const basis = idleEntry ? 'idle' : '中位数'
    this.toast(`已对齐 ${entries.length} 个动作 (基准: ${basis}, 调整 ${adjusted} 项)`)
  }

  private async saveToLib(): Promise<void> {
    if (Object.keys(this.img.splitFrames).length === 0) { this.toast('无数据可保存'); return }

    let saved = 0
    for (const [actionId, dirMap] of Object.entries(this.img.splitFrames)) {
      const action = getAction(actionId)
      if (!action) continue
      await this.saveOneActionToLib(actionId, action.label, this.img.actionSheets[actionId] || '', dirMap)
      saved++
    }
    this.toast(`${saved} 个动作已保存到动作库`)
  }

  private async saveOneActionToLib(
    actionId: string, actionLabel: string, sheetDataUrl: string,
    directions: Record<string, string[]>,
    sourceBatchId?: string, sourceBatchLabel?: string,
  ): Promise<void> {
    const existing = this.actionLib.filter(e => e.actionId === actionId)
    if (existing.length > 0) {
      for (const old of existing) {
        await removePixelAction(old.id)
      }
    }
    const now = Date.now()
    await savePixelAction({
      id: `${actionId}:${now}`,
      actionId,
      actionLabel,
      sheetDataUrl,
      directions,
      addedAt: now,
      sourceBatchId,
      sourceBatchLabel,
    })
    await this.refreshActionLib()
    this.renderLeft()
  }

  private replaceActionFromSource(actionId: string, directions: Record<string, string[]>, sheetDataUrl?: string): void {
    this.img.splitFrames[actionId] = directions
    if (sheetDataUrl) this.img.actionSheets[actionId] = sheetDataUrl
    this.autoSave()
    this.appendActionResult(actionId)
    this.toast(`${getAction(actionId)?.label || actionId} 已替换到当前工作区`)
  }

  private async exportAll(): Promise<void> {
    if (Object.keys(this.img.splitFrames).length === 0) { this.toast('无可导出数据'); return }

    try {
      const targetSize = this.cfg.targetFrameSize > 0
        ? this.cfg.targetFrameSize
        : getMaxFrameSize(this.img.splitFrames)
      if (targetSize > 0) {
        await normalizeAllActions(this.img.splitFrames, targetSize)
      }

      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      const meta: Record<string, {
        frameSize: number; fps: number; looping?: boolean; holdLastFrameMs?: number
        anchorX: number; anchorY: number
        directions: Record<string, { frames: number; atlasFile: string }>
      }> = {}

      for (const [actionId, dirMap] of Object.entries(this.img.splitFrames)) {
        const action = getAction(actionId)
        const label = action?.label || actionId
        const folder = zip.folder(label)!

        let frameSize = 0
        const dirMeta: Record<string, { frames: number; atlasFile: string }> = {}

        for (const [dir, frameUrls] of Object.entries(dirMap)) {
          const dirFolder = folder.folder(dir)!
          const images: HTMLImageElement[] = []

          for (let i = 0; i < frameUrls.length; i++) {
            const b64 = frameUrls[i].replace(/^data:[^;]+;base64,/, '')
            dirFolder.file(`frame_${String(i).padStart(2, '0')}.png`, b64, { base64: true })
            images.push(await loadImageElement(frameUrls[i]))
          }

          // Build a row-atlas for this direction (all frames in a single horizontal strip)
          if (images.length > 0) {
            frameSize = images[0].naturalWidth
            const atlasCanvas = document.createElement('canvas')
            atlasCanvas.width = frameSize * images.length
            atlasCanvas.height = frameSize
            const ctx = atlasCanvas.getContext('2d')!
            for (let i = 0; i < images.length; i++) {
              ctx.drawImage(images[i], i * frameSize, 0)
            }
            const atlasB64 = atlasCanvas.toDataURL('image/png').replace(/^data:[^;]+;base64,/, '')
            const atlasName = `atlas_${dir}.png`
            folder.file(atlasName, atlasB64, { base64: true })
            dirMeta[dir] = { frames: images.length, atlasFile: atlasName }
          }
        }

        meta[label] = {
          frameSize,
          fps: this.cfg.fps,
          looping: action?.looping ?? true,
          holdLastFrameMs: action?.holdLastFrameMs ?? 0,
          anchorX: Math.floor(frameSize / 2),
          anchorY: Math.floor(frameSize / 2),
          directions: dirMeta,
        }

        if (this.img.actionSheets[actionId]) {
          const sheetB64 = this.img.actionSheets[actionId].replace(/^data:[^;]+;base64,/, '')
          folder.file('spritesheet_raw.png', sheetB64, { base64: true })
        }
      }

      zip.file('sprite-meta.json', JSON.stringify(meta, null, 2))

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'pixel-character-sprites.zip'; a.click()
      URL.revokeObjectURL(url)
      this.toast('导出完成')
    } catch (e: any) {
      this.toast('导出失败: ' + e.message)
    }
  }

  private showSkillEditor(entryId: string): void {
    const entry = this.actionLib.find(e => e.id === entryId)
    if (!entry) { this.toast('找不到该动作'); return }

    const row = this.leftEl?.querySelector(`[data-action-id="${entry.actionId}"]`) as HTMLElement | null
    if (!row) return

    let existing = row.querySelector('.px-skill-editor') as HTMLElement | null
    if (existing) { existing.remove(); return }

    const skill: SkillMeta = entry.skill ?? {
      name: entry.actionLabel,
      damage: 10,
      range: 50,
      cooldown: 1000,
      triggerFrame: 0,
    }

    const firstDir = Object.keys(entry.directions)[0]
    const frames = firstDir ? entry.directions[firstDir] : []
    const vfx: VfxBinding = skill.vfx ?? { type: 'slash', startFrame: 0, duration: 3, color: '#ff6b35', scale: 1 }

    const editor = document.createElement('div')
    editor.className = 'px-skill-editor'
    editor.innerHTML = `
      <div class="px-skill-section-title">基础属性</div>
      <div class="px-skill-row"><label>名称</label><input data-sf="name" value="${skill.name}" /></div>
      <div class="px-skill-row"><label>伤害</label><input data-sf="damage" type="number" value="${skill.damage}" min="0" /></div>
      <div class="px-skill-row"><label>范围</label><input data-sf="range" type="number" value="${skill.range}" min="0" /></div>
      <div class="px-skill-row"><label>冷却</label><input data-sf="cooldown" type="number" value="${skill.cooldown}" min="0" step="100" /><span style="font-size:10px;color:#999">ms</span></div>

      <div class="px-skill-section-title">触发帧 (点击选择)</div>
      <div class="px-skill-frames-strip">
        ${frames.map((url, i) => `<img src="${url}" class="px-skill-frame-thumb ${i === skill.triggerFrame ? 'trigger' : ''}" data-fidx="${i}" />`).join('')}
      </div>

      <div class="px-skill-section-title">特效绑定</div>
      <div class="px-skill-row">
        <label>类型</label>
        <select data-sf="vfx-type">
          ${(['slash', 'impact', 'aura', 'projectile'] as VfxType[]).map(t => `<option value="${t}" ${vfx.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="px-skill-row"><label>起始帧</label><input data-sf="vfx-start" type="number" value="${vfx.startFrame}" min="0" max="${frames.length - 1}" /></div>
      <div class="px-skill-row"><label>持续帧</label><input data-sf="vfx-dur" type="number" value="${vfx.duration}" min="1" /></div>
      <div class="px-skill-row"><label>颜色</label><input data-sf="vfx-color" type="color" value="${vfx.color}" /></div>
      <div class="px-skill-row"><label>缩放</label><input data-sf="vfx-scale" type="number" value="${vfx.scale}" min="0.1" max="5" step="0.1" /></div>

      <div class="px-skill-row" style="margin-top:6px">
        <button class="px-btn small" data-sf="save">保存</button>
        <button class="px-btn small" data-sf="clear" style="color:var(--color-status-error)">清除技能</button>
      </div>
    `

    row.appendChild(editor)

    editor.querySelectorAll<HTMLImageElement>('.px-skill-frame-thumb').forEach(img => {
      img.addEventListener('click', () => {
        editor.querySelectorAll('.px-skill-frame-thumb.trigger').forEach(el => el.classList.remove('trigger'))
        img.classList.add('trigger')
      })
    })

    editor.querySelector('[data-sf="save"]')?.addEventListener('click', async () => {
      const get = (key: string) => (editor.querySelector(`[data-sf="${key}"]`) as HTMLInputElement)?.value ?? ''
      const triggerThumb = editor.querySelector('.px-skill-frame-thumb.trigger') as HTMLElement
      const triggerIdx = triggerThumb ? parseInt(triggerThumb.dataset.fidx ?? '0', 10) : 0

      const newSkill: SkillMeta = {
        name: get('name') || entry.actionLabel,
        damage: parseFloat(get('damage')) || 0,
        range: parseFloat(get('range')) || 0,
        cooldown: parseFloat(get('cooldown')) || 0,
        triggerFrame: triggerIdx,
        vfx: {
          type: (get('vfx-type') as VfxType) || 'slash',
          startFrame: parseInt(get('vfx-start'), 10) || 0,
          duration: parseInt(get('vfx-dur'), 10) || 3,
          color: get('vfx-color') || '#ff6b35',
          scale: parseFloat(get('vfx-scale')) || 1,
        },
      }

      entry.skill = newSkill
      await savePixelAction(entry)
      await this.refreshActionLib()
      this.renderLeft()
      this.toast(`技能「${newSkill.name}」已保存`)
    })

    editor.querySelector('[data-sf="clear"]')?.addEventListener('click', async () => {
      delete entry.skill
      await savePixelAction(entry)
      await this.refreshActionLib()
      this.renderLeft()
      this.toast('已清除技能数据')
    })
  }

  private async injectToScene(): Promise<void> {
    if (this.actionLib.length === 0) { this.toast('动作库为空'); return }

    // Bake per-entry scale into the frames we hand to SpriteAnimator. Without
    // this step the animator would render the unscaled originals, so the
    // user's "自动统一大小 / ±5%" adjustments would silently be lost when a
    // character is dropped into the preview scene — the exact complaint the
    // unified-scale feature was built to fix.
    const seen = new Set<string>()
    const spriteActions: SpriteActionData[] = []
    for (const entry of this.actionLib) {
      if (seen.has(entry.actionId)) continue
      seen.add(entry.actionId)
      const actionDef = getAction(entry.actionId)
      const scale = clampScale(entry.scale ?? 1)
      const directions = scale !== 1
        ? await rescaleDirections(entry.directions, scale)
        : entry.directions
      spriteActions.push({
        actionId: entry.actionId,
        actionLabel: entry.actionLabel,
        directions,
        fps: actionDef?.fps ?? 8,
        looping: actionDef?.looping !== false,
        holdLastFrameMs: actionDef?.holdLastFrameMs,
        skill: entry.skill,
      })
    }

    if (spriteActions.length === 0) { this.toast('无有效动作数据'); return }

    this.cleanupSceneSprite()
    const animator = new SpriteAnimator(spriteActions)
    this.currentSpriteAnimator = animator

    const vfx = new VfxSystem(ctx.engine.overlayScene)
    this.vfxSystem = vfx

    const vfxUpdate = (dt: number) => vfx.update(dt)
    this.vfxUpdateCb = vfxUpdate
    ctx.engine.onUpdate(vfxUpdate)

    animator.setFrameCallback((_actionId, frame, skill) => {
      if (skill?.vfx && frame === skill.vfx.startFrame) {
        vfx.trigger(animator.mesh.position, skill.vfx)
      }
    })

    // 动作→VFX 桥接：playAction 切换时通知 VFXManager 自动匹配攻击特效
    animator.setActionStartCallback((actionId) => {
      getVFXManager()?.onCharacterAction(actionId)
    })

    animator.mesh.position.set(0, 0.75, 0)
    // 延迟显示 sprite 直到所有帧图片加载完成 + canvas 尺寸锁定。
    // 否则图片加载回来触发 finalizeLock 会把 canvas 从 128 扩到实际 max，
    // 这会让 sprite 在 plane 上的视觉占比跳变（俗称"交互瞬间角色放大"）。
    animator.mesh.visible = false
    ctx.engine.scene.add(animator.mesh)
    animator.ready.then(() => {
      if (this.currentSpriteAnimator === animator) animator.mesh.visible = true
    })

    // 通知挂点适配器：像素角色已加载，注册 sprite mesh（Level 1.5）
    const spriteWorldHeight = 1.5  // SpriteAnimator 默认 size=1.5 世界单位
    {
      // 根据美术风格推断头身比
      const artStyle = globalState.profile.artStyle
      const bodyRatio =
        artStyle === 'chibi'    ? 2.5 :
        artStyle === 'pixel'    ? 4.0 :
        artStyle === 'anime'    ? 6.5 :
        artStyle === 'realistic'? 8.0 :
        artStyle === 'painterly'? 7.5 : 6.0
      notifyDetectedDims(spriteWorldHeight, bodyRatio, 0)
      // 注册 sprite mesh 到挂点系统（Level 1.5），之后特效会跟随角色位置
      registerSpriteMesh(animator.mesh, spriteWorldHeight, bodyRatio)
      // Level 0：直接追踪 mesh 位置（最高优先级，绕开 adapter 时序）
      trackCharSprite(animator.mesh, spriteWorldHeight)
      // 注入角色 sprite 给 VFXManager：护盾/传送/溶解直接作用在角色身上，
      // 同时传入世界高度以自适应护盾球半径（把角色整个罩在中间）
      getVFXManager()?.setCharacterSprite(animator.mesh, spriteWorldHeight)

      // 注入 playAction 回调：让 VFXManager（受击按钮）能触发 sprite 动画
      getVFXManager()?.setPlayActionCallback((actionId: string) => {
        if (this.currentSpriteAnimator !== animator) return
        animator.playAction(actionId)
        // 非循环动作播完后自动恢复 idle
        const actionDef = animator.getAction(actionId)
        if (actionDef && !actionDef.looping) {
          const frameCount = Object.values(actionDef.directions)[0]?.length ?? 3
          const durationMs = Math.ceil(frameCount / actionDef.fps * 1000) + 120
          setTimeout(() => {
            if (this.currentSpriteAnimator === animator) animator.playAction('idle')
          }, durationMs)
        }
      })

      // 注入受击白闪回调：VFXManager 控制 animator.flashIntensity，
      // 由 drawCurrentFrame 内的 source-atop canvas 叠白实现全像素（含深色轮廓）白闪
      getVFXManager()?.setFlashIntensityCallback((intensity: number) => {
        if (this.currentSpriteAnimator !== animator) return
        const prev = animator.flashIntensity
        animator.flashIntensity = intensity
        // Must redraw on the falling edge too (e.g. final 0.05 → 0), not only
        // when intensity > 0. Otherwise the canvas stays in the last overlaid
        // state until the next natural frame change — and on a slow action
        // like idle (6 fps / ~166ms per frame) that looks exactly like "角色
        // 过一会变成白色面片". When the spriteUpdate callback is detached
        // (tab switch / cleanup) there IS no next natural frame, so the white
        // would stick indefinitely. Skip the redraw only for the degenerate
        // 0→0 case to avoid pointless work.
        if (intensity > 0 || prev > 0) animator.redrawCurrentFrame()
      })
    }

    const spriteUpdate = (dt: number) => {
      const ctrl = getCharacterController()
      if (ctrl?.isActive) return
      animator.update(dt)
      animator.mesh.quaternion.copy(ctx.engine.camera.quaternion)
    }
    this.spriteUpdateCb = spriteUpdate
    ctx.engine.onUpdate(spriteUpdate)

    animator.playAction(spriteActions[0].actionId)

    getCharacterRenderPanel()?.attach(animator.mesh, {
      animatorCallbacks: {
        animator,
        dirLabels: DIR_LABELS,
        onRemove: () => {
          this.cleanupSceneSprite()
          this.toast('已移除场景精灵')
        },
        onControl: () => {
          if (!this.charController) {
            this.charController = new CharacterController(ctx.engine)
          }
          this.charController.toggle(animator)
        },
        isControlActive: () => this.charController?.isActive ?? false,
      },
    })

    // attach() 会把 mesh.position 强制同步到 panel 的 params（默认 posY=0.75），
    // 会覆盖之前的位置。所以必须在 attach 之后做地面对齐，并用 updateParam
    // 把落地 Y 持久化到 params + localStorage，这样：
    //   (a) 后续任何 applyTransform（切 tab / 切模块 / slider 变化）都会用地面 Y
    //   (b) 下次"放入场景"也能直接落在地面（localStorage 记住了）
    const groundY = snapMeshToGround(ctx.engine.scene, animator.mesh, spriteWorldHeight / 2)
    if (groundY !== null) {
      getCharacterRenderPanel()?.updateParam('posY', animator.mesh.position.y)
    }

    this.toast('已放入场景')
  }

  private cleanupSceneSprite(): void {
    this.charController?.dispose()
    this.charController = null
    if (this.spriteUpdateCb) {
      ctx.engine.removeUpdate(this.spriteUpdateCb)
      this.spriteUpdateCb = null
    }
    if (this.vfxUpdateCb) {
      ctx.engine.removeUpdate(this.vfxUpdateCb)
      this.vfxUpdateCb = null
    }
    this.vfxSystem?.dispose()
    this.vfxSystem = null
    getCharacterRenderPanel()?.detach()
    if (this.currentSpriteAnimator) {
      ctx.engine.scene.remove(this.currentSpriteAnimator.mesh)
      this.currentSpriteAnimator.dispose()
      this.currentSpriteAnimator = null
      // 注销 sprite mesh 挂点（Level 1.5 降级到 geometric/static）
      unregisterSpriteMesh()
      untrackCharSprite()
      // 通知 VFXManager 角色退场，避免悬空引用
      getVFXManager()?.setCharacterSprite(null)
      getVFXManager()?.setPlayActionCallback(null)
      getVFXManager()?.setFlashIntensityCallback(null)
    }
  }

  private async exportLibToGame(): Promise<void> {
    if (this.actionLib.length === 0) { this.toast('动作库为空'); return }

    try {
      const seen = new Set<string>()
      const libFrames: Record<string, Record<string, string[]>> = {}
      const libSheets: Record<string, string> = {}
      for (const entry of this.actionLib) {
        if (seen.has(entry.actionId)) continue
        seen.add(entry.actionId)
        // Bake per-entry scale into pixels here — thumbnails use CSS transform
        // for live preview, but the game consumes raw PNGs and must see the
        // already-rescaled character.
        const scale = clampScale(entry.scale ?? 1)
        libFrames[entry.actionId] = scale !== 1
          ? await rescaleDirections(entry.directions, scale)
          : entry.directions
        libSheets[entry.actionId] = entry.sheetDataUrl
      }

      const targetSize = this.cfg.targetFrameSize > 0
        ? this.cfg.targetFrameSize
        : getMaxFrameSize(libFrames)
      if (targetSize > 0) {
        await normalizeAllActions(libFrames, targetSize)
      }

      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      const meta: Record<string, {
        actionId: string; frameSize: number; fps: number
        looping: boolean; holdLastFrameMs: number
        anchorX: number; anchorY: number
        directions: Record<string, { frames: number; atlasFile: string }>
      }> = {}

      for (const [actionId, dirMap] of Object.entries(libFrames)) {
        const action = getAction(actionId)
        const folder = zip.folder(actionId)!

        let frameSize = 0
        const dirMeta: Record<string, { frames: number; atlasFile: string }> = {}

        for (const [dir, frameUrls] of Object.entries(dirMap)) {
          const images: HTMLImageElement[] = []
          for (let i = 0; i < frameUrls.length; i++) {
            const b64 = frameUrls[i].replace(/^data:[^;]+;base64,/, '')
            folder.file(`${dir}_${String(i).padStart(2, '0')}.png`, b64, { base64: true })
            images.push(await loadImageElement(frameUrls[i]))
          }

          if (images.length > 0) {
            frameSize = images[0].naturalWidth
            const atlasCanvas = document.createElement('canvas')
            atlasCanvas.width = frameSize * images.length
            atlasCanvas.height = frameSize
            const ctx = atlasCanvas.getContext('2d')!
            ctx.imageSmoothingEnabled = false
            for (let i = 0; i < images.length; i++) {
              ctx.drawImage(images[i], i * frameSize, 0)
            }
            const atlasB64 = atlasCanvas.toDataURL('image/png').replace(/^data:[^;]+;base64,/, '')
            const atlasName = `atlas_${dir}.png`
            folder.file(atlasName, atlasB64, { base64: true })
            dirMeta[dir] = { frames: images.length, atlasFile: atlasName }
          }
        }

        meta[actionId] = {
          actionId,
          frameSize,
          fps: this.cfg.fps,
          looping: action?.looping ?? true,
          holdLastFrameMs: action?.holdLastFrameMs ?? 0,
          anchorX: Math.floor(frameSize / 2),
          anchorY: Math.floor(frameSize / 2),
          directions: dirMeta,
        }
      }

      zip.file('sprite-meta.json', JSON.stringify(meta, null, 2))

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'game-character-sprites.zip'; a.click()
      URL.revokeObjectURL(url)
      this.toast(`${seen.size} 个动作已导出为游戏资源`)
    } catch (e: any) {
      this.toast('导出失败: ' + e.message)
    }
  }

  /**
   * Build a CharacterManifest + file payload from the current action library.
   *
   * Extracted from {@link publishToGame} so the same artifact can be re-used
   * by multiple publish targets (phaser-2d shared volume, or a specific
   * workspace game's public/assets/art/characters/<slot>).
   *
   * Returns `null` if the action library is empty.
   */
  private async buildCharacterPackage(characterId?: string): Promise<{
    manifest: CharacterManifest
    files: Record<string, string>
    actions: ExportedAction[]
    skills: ExportedSkill[]
  } | null> {
    if (this.actionLib.length === 0) return null

    // De-duplicate by actionId (action-lib may contain multiple versions)
    const seen = new Set<string>()
    const libFrames: Record<string, Record<string, string[]>> = {}
    const entriesByAction: Record<string, PixelActionLibEntry> = {}
    for (const entry of this.actionLib) {
      if (seen.has(entry.actionId)) continue
      seen.add(entry.actionId)
      // Bake per-entry scale into pixels before atlas assembly (see
      // exportLibToGame for rationale).
      const scale = clampScale(entry.scale ?? 1)
      libFrames[entry.actionId] = scale !== 1
        ? await rescaleDirections(entry.directions, scale)
        : entry.directions
      entriesByAction[entry.actionId] = entry
    }

    // Unify frame size across all actions (otherwise atlases would differ by action)
    const targetSize = this.cfg.targetFrameSize > 0
      ? this.cfg.targetFrameSize
      : getMaxFrameSize(libFrames)
    if (targetSize > 0) {
      await normalizeAllActions(libFrames, targetSize)
    }

    // Which anchor slot does the current alignMode map to? Exporting under the
    // matching key so the game side can read a real pixel coord (not frame center).
    const anchorKey: keyof NonNullable<ExportedDirection['referenceAnchors']> =
      this.cfg.alignMode === 'bottom-center' ? 'feet'
      : this.cfg.alignMode === 'top-center' ? 'head'
      : 'waist'

    const actions: ExportedAction[] = []
    const files: Record<string, string> = {}  // relPath → base64 (raw, no dataurl prefix)

    for (const [actionId, dirMap] of Object.entries(libFrames)) {
      const actionDef = getAction(actionId)
      const directions: Partial<Record<ExportDirection, ExportedDirection>> = {}

      let frameSize = 0
      for (const [dir, frameUrls] of Object.entries(dirMap)) {
        if (!frameUrls || frameUrls.length === 0) continue

        // Build horizontal atlas (frame0 | frame1 | ...)
        const images: HTMLImageElement[] = []
        for (const url of frameUrls) images.push(await loadImageElement(url))
        frameSize = images[0].naturalWidth

        const atlasCanvas = document.createElement('canvas')
        atlasCanvas.width = frameSize * images.length
        atlasCanvas.height = frameSize
        const ctx = atlasCanvas.getContext('2d')!
        ctx.imageSmoothingEnabled = false
        for (let i = 0; i < images.length; i++) ctx.drawImage(images[i], i * frameSize, 0)

        const atlasRel = `sprites/${actionId}/atlas_${dir}.png`
        const atlasB64 = atlasCanvas.toDataURL('image/png').replace(/^data:[^;]+;base64,/, '')
        files[atlasRel] = atlasB64

        // referenceAnchors: only include if we actually have a value from turnaround
        const src = this.img.referenceAnchors[dir]
        const anchors: ExportedDirection['referenceAnchors'] = src
          ? { [anchorKey]: { x: Math.round(src.x), y: Math.round(src.y) } }
          : undefined

        directions[dir as ExportDirection] = {
          atlasFile: atlasRel,
          frameCount: images.length,
          ...(anchors ? { referenceAnchors: anchors } : {}),
        }
      }

      if (frameSize === 0) continue
      actions.push({
        id: actionId,
        frameSize,
        fps: this.cfg.fps,
        looping: actionDef?.looping ?? true,
        holdLastFrameMs: actionDef?.holdLastFrameMs ?? 0,
        directions,
      })
    }

    // Collect skills from action-lib entries. A skill is "slotted" by actionId:
    //   actionId starting with 'attack' → normal slot (basic attack)
    //   actionId == 'skill1'/'skill2'/'skill3'/'skill4' → same slot
    //   actionId == 'ultimate' → ultimate slot
    //   otherwise: skipped (not a skill-triggering action)
    const skills: ExportedSkill[] = []
    const slotsUsed = new Set<ExportedSkill['slotId']>()
    for (const entry of Object.values(entriesByAction)) {
      if (!entry.skill) continue
      const slotId = this.deriveSkillSlotId(entry.actionId)
      if (!slotId || slotsUsed.has(slotId)) continue
      slotsUsed.add(slotId)

      const vfx: VfxBinding = entry.skill.vfx ?? {
        type: 'slash',
        startFrame: entry.skill.triggerFrame,
        duration: 8,
        color: '#ffffff',
        scale: 1,
      }

      skills.push({
        slotId,
        name: entry.skill.name || entry.actionLabel,
        actionId: entry.actionId,
        triggerFrame: entry.skill.triggerFrame,
        damage: entry.skill.damage,
        range: entry.skill.range,
        cooldown: entry.skill.cooldown,
        targeting: 'nearest',
        vfx,
        mountPointId: MountPointId.WEAPON_ROOT,
      })
    }

    const manifest: CharacterManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      id: characterId || this.deriveCharacterId(),
      name: `Pixel Character ${new Date().toLocaleString()}`,
      headBodyRatio: 4,  // Q-style pixel chars default to 4-head-body; configurable later
      defaultAction: 'idle',
      actions,
      skills,
      exportedAt: Date.now(),
      exportedBy: 'character-editor/pixel-char@1',
    }

    return { manifest, files, actions, skills }
  }

  /**
   * Publish character + skills + mount data to the game engine (phaser-2d).
   *
   * Unlike exportLibToGame (downloads a zip), this:
   *   1. Builds a CharacterManifest conforming to the shared schema
   *   2. Carries real referenceAnchors (instead of hardcoded frame-center)
   *   3. Carries all SkillMeta entries from the action library
   *   4. POSTs atlases + manifest to /__ce-api__/publish-character, which
   *      writes them to /app/character-export (docker-compose shared volume).
   * After a successful publish, the game at phaser-2d picks up the files live.
   */
  private async publishToGame(characterId?: string): Promise<void> {
    const pkg = await this.buildCharacterPackage(characterId)
    if (!pkg) { this.toast('动作库为空，无可发布角色'); return }

    try {
      // Doc 01 §P4 funnel: prefer host.tool.call; fall back to direct POST.
      const payload = { characterId: pkg.manifest.id, manifest: pkg.manifest, files: pkg.files }
      let result: any = null
      if (forgeaxHost.available) {
        try {
          const r = await forgeaxHost.tool.call('character:publish-character', payload)
          if (r.ok) result = r.result
        } catch { /* fall through */ }
      }
      if (!result) {
        const resp = await fetch('/__ce-api__/publish-character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        result = await resp.json()
      }
      if (!result.success) throw new Error(result.error || '发布失败')

      this.toast(`✓ 已发布到游戏 (${pkg.actions.length} 动作 / ${pkg.skills.length} 技能 → ${pkg.manifest.id})`)
    } catch (e: any) {
      console.error('[publishToGame]', e)
      this.toast('发布失败: ' + e.message)
    }
  }

  /**
   * Publish current action library as a character into a specific **workspace
   * game** project's `public/assets/art/characters/<slot>/`.
   *
   * Concretely: the user has a Vite-based game (e.g. 霓虹血契,
   * `data/workspace/games/<uuid>/`) whose `createPlayer.ts` reads
   * `/assets/art/characters/player/character.manifest.json`. This method
   * writes exactly there, so a page reload in the game immediately picks up
   * 阿飞 as the protagonist (or enemy_thug, or whatever `slot` is chosen).
   *
   * Server routes:
   *  - `GET  /__ce-api__/list-workspace-games` — enumerate available game UUIDs
   *  - `POST /__ce-api__/publish-to-workspace-game` — write the package
   *
   * Caller is responsible for prompting for `gameId` + `slot`. The single-
   * game auto-pick convenience lives in {@link onClickPublishAsPlayer}.
   */
  private async publishToWorkspaceGame(gameId: string, slot: string): Promise<void> {
    const pkg = await this.buildCharacterPackage(slot)
    if (!pkg) { this.toast('动作库为空，无可发布角色'); return }

    try {
      // Overwrite manifest.id to match the slot — 游戏端 ForgeaCharacter 按目录名
      // 认角色，不读 manifest.id，所以这里主要是让 JSON 内容更可读。
      pkg.manifest.id = slot

      const payload = { gameId, characterId: slot, manifest: pkg.manifest, files: pkg.files }
      let result: any = null
      if (forgeaxHost.available) {
        try {
          const r = await forgeaxHost.tool.call('character:publish-to-workspace-game', payload)
          if (r.ok) result = r.result
        } catch { /* fall through */ }
      }
      if (!result) {
        const resp = await fetch('/__ce-api__/publish-to-workspace-game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        result = await resp.json()
      }
      if (!result.success) throw new Error(result.error || '导入失败')

      this.toast(`✓ 已导入到 ${gameId} / ${slot} (${pkg.actions.length} 动作 / ${pkg.skills.length} 技能)`)
    } catch (e: any) {
      console.error('[publishToWorkspaceGame]', e)
      this.toast('导入失败: ' + e.message)
    }
  }

  /**
   * "导入到游戏作为主角" 按钮的入口。流程：
   *   1. 查 /__ce-api__/list-workspace-games 拿到工作区游戏清单
   *   2. 若只有一个 → 直接用；多个 → 用 select 提示选一个（带 localStorage 记忆）
   *   3. slot 默认 'player'，允许改（少数人想叫 'hero' 之类）
   *   4. 调 publishToWorkspaceGame
   */
  private async onClickPublishAsPlayer(): Promise<void> {
    if (this.actionLib.length === 0) { this.toast('动作库为空，无可导入'); return }

    let games: { gameId: string; hasPlayerSlot: boolean }[] = []
    try {
      const resp = await fetch('/__ce-api__/list-workspace-games')
      const data = await resp.json()
      if (!data.success) throw new Error(data.error || '列出游戏失败')
      games = data.games || []
    } catch (e: any) {
      this.toast('读取工作区游戏失败: ' + e.message)
      return
    }

    if (games.length === 0) {
      this.toast('工作区 data/workspace/games 下没有游戏工程')
      return
    }

    // 记忆上次选择
    const LS_GAME_KEY = 'pixelchar.lastWorkspaceGameId'
    const LS_SLOT_KEY = 'pixelchar.lastWorkspaceSlot'
    const remembered = localStorage.getItem(LS_GAME_KEY) || ''

    let gameId: string
    if (games.length === 1) {
      gameId = games[0].gameId
    } else {
      const options = games.map((g, i) => `${i + 1}) ${g.gameId}${g.hasPlayerSlot ? '  (已有 player)' : ''}`).join('\n')
      const defaultIdx = Math.max(1, games.findIndex(g => g.gameId === remembered) + 1)
      const input = prompt(
        `选择要导入的游戏（输入编号或 UUID）：\n\n${options}`,
        String(defaultIdx),
      )
      if (!input) return
      const asNum = parseInt(input, 10)
      if (!isNaN(asNum) && asNum >= 1 && asNum <= games.length) {
        gameId = games[asNum - 1].gameId
      } else {
        const match = games.find(g => g.gameId === input.trim())
        if (!match) { this.toast('无效的游戏 ID'); return }
        gameId = match.gameId
      }
    }

    const defaultSlot = localStorage.getItem(LS_SLOT_KEY) || 'player'
    const slot = prompt(
      `作为哪个角色槽位导入到游戏？\n\n• player = 主角（推荐）\n• enemy_thug / enemy_elite_red / ka_ming / gweilo = 覆盖对应敌人/NPC\n• 其他任意 id 会创建新角色`,
      defaultSlot,
    )
    if (!slot) return
    const trimmed = slot.trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(trimmed)) {
      this.toast('槽位 ID 不合法（只能 a-zA-Z0-9_-）')
      return
    }

    localStorage.setItem(LS_GAME_KEY, gameId)
    localStorage.setItem(LS_SLOT_KEY, trimmed)

    await this.publishToWorkspaceGame(gameId, trimmed)
  }

  /**
   * "👥 批量发布到 NPC" — 把当前 actionLib 发布到游戏里**一个或多个** NPC 槽位。
   *
   * UX 要求（user ask）：
   *   - 列出游戏的 NPC 清单，每个槽位标注"已有/空"
   *   - 默认只勾"空"的，避免顶替用户已经做好的角色
   *   - 已经有内容的 slot 必须用户**显式**勾选才会被覆盖
   *   - 多选一次性发布
   *
   * 游戏侧：依赖 `<game>/public/npcs.json`（声明 NPC 列表）。没有 JSON 时
   * 服务端会回 error，这里 toast 提示用户先在游戏 workspace 里加这个文件。
   */
  private async onClickBatchPublishAsNpc(): Promise<void> {
    if (this.actionLib.length === 0) { this.toast('动作库为空，无可发布'); return }

    // 1. 选 game（沿用 player 那套的 LS key + 交互）
    let games: { gameId: string; hasPlayerSlot: boolean }[] = []
    try {
      const resp = await fetch('/__ce-api__/list-workspace-games')
      const data = await resp.json()
      if (!data.success) throw new Error(data.error || '列出游戏失败')
      games = data.games || []
    } catch (e: any) { this.toast('读取工作区游戏失败: ' + e.message); return }
    if (games.length === 0) { this.toast('工作区里没有游戏工程'); return }

    const LS_GAME_KEY = 'pixelchar.lastWorkspaceGameId'
    const remembered = localStorage.getItem(LS_GAME_KEY) || ''
    let gameId: string
    if (games.length === 1) {
      gameId = games[0].gameId
    } else {
      const opts = games.map((g, i) => `${i + 1}) ${g.gameId}`).join('\n')
      const defaultIdx = Math.max(1, games.findIndex(g => g.gameId === remembered) + 1)
      const input = prompt(`选游戏：\n\n${opts}`, String(defaultIdx))
      if (!input) return
      const asNum = parseInt(input, 10)
      if (!isNaN(asNum) && asNum >= 1 && asNum <= games.length) gameId = games[asNum - 1].gameId
      else { const m = games.find(g => g.gameId === input.trim()); if (!m) { this.toast('无效 ID'); return } gameId = m.gameId }
    }

    // 2. 拉 NPC 列表
    type NpcInfo = { kind: 'npc' | 'civilian_pool'; tag: string; name: string; manifestId: string; hasManifest: boolean }
    let npcs: NpcInfo[] = []
    try {
      const resp = await fetch(`/__ce-api__/list-workspace-game-npcs?gameId=${encodeURIComponent(gameId)}`)
      const data = await resp.json()
      if (!data.success) { this.toast(`读取 NPC 失败：${data.error}`); return }
      npcs = data.npcs || []
    } catch (e: any) { this.toast('读取 NPC 失败: ' + e.message); return }
    if (npcs.length === 0) { this.toast('游戏里还没定义 NPC（需要 public/npcs.json）'); return }

    // 3. 紧凑渲染：浏览器 prompt 对话框能显示的行数有限（Chrome 大约 10-15 行），
    //    所以用"每行多个编号"的格子布局，20+ 槽位也能一屏看完。
    //
    //    默认只预选下一个空槽，方便"一个个生成 → 一个个填"的小白工作流。
    const firstEmptyIdx = npcs.findIndex(n => !n.hasManifest)
    const defaultSel = firstEmptyIdx >= 0 ? String(firstEmptyIdx + 1) : '1'

    const compactList = (kind: 'npc' | 'civilian_pool'): string => {
      const items = npcs
        .map((n, i) => ({ n, i: i + 1 }))
        .filter(x => x.n.kind === kind)
      if (items.length === 0) return '(无)'
      // 每项 "N:空位" 或 "N✓家明"；4 列一行
      const COLS = 4
      const cells = items.map(({ n, i }) =>
        `${String(i).padStart(2)}${n.hasManifest ? '✓' : '·'}${(n.name || n.manifestId).slice(0, 6)}`.padEnd(14))
      const rows: string[] = []
      for (let i = 0; i < cells.length; i += COLS) {
        rows.push(cells.slice(i, i + COLS).join(' '))
      }
      return rows.join('\n')
    }

    const emptyCount = npcs.filter(n => !n.hasManifest).length
    const prompt1 =
      `输入编号（多选逗号分隔）。✓=已有 ·=空\n\n` +
      `【剧情 NPC】\n${compactList('npc')}\n\n` +
      `【路人池 · 空 ${emptyCount}/${npcs.filter(n => n.kind === 'civilian_pool').length}】\n${compactList('civilian_pool')}\n\n` +
      `默认：${defaultSel}（下一个空槽）`
    const input = prompt(prompt1, defaultSel)
    if (!input) return

    const selected: NpcInfo[] = []
    for (const tok of input.split(',').map(s => s.trim()).filter(Boolean)) {
      const n = parseInt(tok, 10)
      if (isNaN(n) || n < 1 || n > npcs.length) { this.toast(`无效编号：${tok}`); return }
      selected.push(npcs[n - 1])
    }
    if (selected.length === 0) { this.toast('没选任何 NPC'); return }

    // 4. 显式覆盖确认：任何"✓"被勾中都要二次确认
    const willOverwrite = selected.filter(n => n.hasManifest)
    if (willOverwrite.length > 0) {
      const msg = `以下 ${willOverwrite.length} 个 NPC 已经有角色，将被**覆盖**：\n\n` +
        willOverwrite.map(n => `  • ${n.tag} (${n.manifestId})`).join('\n') +
        `\n\n确定继续？`
      if (!confirm(msg)) { this.toast('已取消'); return }
    }

    // 5. 依次发布。复用已有 publishToWorkspaceGame（失败时它自己 toast）
    localStorage.setItem(LS_GAME_KEY, gameId)
    let ok = 0; let fail = 0
    for (const n of selected) {
      try {
        await this.publishToWorkspaceGame(gameId, n.manifestId)
        ok++
      } catch { fail++ }
    }
    this.toast(`发布完成：${ok} 成功${fail > 0 ? ` / ${fail} 失败` : ''}`)
  }

  private deriveSkillSlotId(actionId: string): ExportedSkill['slotId'] | null {
    const lowered = actionId.toLowerCase()
    if (lowered === 'attack' || lowered.startsWith('attack')) return 'normal'
    if (lowered === 'skill1') return 'skill1'
    if (lowered === 'skill2') return 'skill2'
    if (lowered === 'skill3') return 'skill3'
    if (lowered === 'skill4') return 'skill4'
    if (lowered === 'ultimate') return 'ultimate'
    return null
  }

  private deriveCharacterId(): string {
    // URL-safe id based on timestamp; user can override via UI prompt later
    return `char-${Date.now().toString(36)}`
  }

  /* ── Batch History UI ─────────────────────────────────────────────── */

  private renderBatchHistorySection(): string {
    const count = this.batchHistory.length

    let html = `
      <div class="px-ws-divider"></div>
      <div class="px-ws-header" data-px="toggle-batches">
        <span class="px-ws-icon">📋</span>
        <span class="px-ws-title">生成历史</span>
        <span class="px-ws-badge">${count} 条</span>
        <span class="px-ws-arrow">${this.batchHistoryExpanded ? '▲' : '▼'}</span>
      </div>`

    if (this.batchHistoryExpanded) {
      html += `<div class="px-ws-body">`
      if (count === 0) {
        html += `<div style="font-size:10px;color:var(--text-secondary);padding:4px 0">生成动作后自动记录</div>`
      } else {
        html += `<div class="px-batch-list">`
        for (const b of this.batchHistory) {
          const isExpanded = this.expandedBatchId === b.id
          const isViewing = this.viewingBatchId === b.id
          const actionNames = b.actions.map(a => a.actionLabel.replace(/\s*\(.*\)/, '')).join(', ')
          html += `
            <div class="px-batch-item${isExpanded ? ' expanded' : ''}${isViewing ? ' viewing' : ''}">
              <div class="px-batch-head" data-batch-toggle="${b.id}">
                <div class="px-batch-info">
                  <div class="px-batch-label">${this.esc(b.label)}</div>
                  <div class="px-batch-actions-summary">${this.esc(actionNames)}</div>
                </div>
                <div class="px-batch-ops">
                  <button class="px-btn tiny" data-batch-view="${b.id}" title="查看详情">👁</button>
                  <button class="px-btn tiny" data-batch-del="${b.id}" title="删除">×</button>
                </div>
              </div>`

          if (isExpanded) {
            html += `<div class="px-batch-body">`
            for (const a of b.actions) {
              const dirCount = Object.keys(a.directions).length
              const frameCount = Object.values(a.directions).reduce((n, arr) => n + arr.length, 0)
              const firstDir = Object.keys(a.directions)[0]
              const firstFrame = firstDir ? a.directions[firstDir]?.[0] : null
              html += `
                <div class="px-batch-action-row">
                  ${firstFrame ? `<img src="${firstFrame}" class="px-batch-action-thumb checkerboard" />` : '<div class="px-batch-action-thumb-empty">?</div>'}
                  <div class="px-batch-action-info">
                    <div class="px-batch-action-name">${a.actionLabel}</div>
                    <div class="px-batch-action-meta">${dirCount}方向 ${frameCount}帧</div>
                  </div>
                  <div class="px-batch-action-ops">
                    <button class="px-btn tiny" data-batch-add-lib="${b.id}::${a.actionId}" title="加入动作库">+${pxIcon('box', 'px-icon')}</button>
                    <button class="px-btn tiny" data-batch-replace="${b.id}::${a.actionId}" title="替换当前">↻</button>
                  </div>
                </div>`
            }
            html += `<div class="px-batch-footer">
              <button class="px-btn tiny" data-batch-add-all="${b.id}">全部加入动作库</button>
            </div></div>`
          }
          html += `</div>`
        }
        html += `</div>`
      }
      html += `</div>`
    }
    return html
  }

  private bindBatchHistoryEvents(): void {
    this.leftEl?.querySelector('[data-px="toggle-batches"]')?.addEventListener('click', async () => {
      this.batchHistoryExpanded = !this.batchHistoryExpanded
      if (this.batchHistoryExpanded && this.batchHistory.length === 0) {
        await this.refreshBatchHistory()
      }
      this.refresh()
    })

    this.leftEl?.querySelectorAll<HTMLElement>('[data-batch-toggle]').forEach(el => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button')) return
        const batchId = el.dataset.batchToggle!
        this.expandedBatchId = this.expandedBatchId === batchId ? null : batchId
        this.renderLeft()
      })
    })

    this.leftEl?.querySelectorAll<HTMLButtonElement>('[data-batch-view]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.viewingBatchId = btn.dataset.batchView!
        this.renderLeft()
        this.renderCenter()
      })
    })

    this.leftEl?.querySelectorAll<HTMLButtonElement>('[data-batch-del]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        await deleteBatch(btn.dataset.batchDel!)
        await this.refreshBatchHistory()
        if (this.viewingBatchId === btn.dataset.batchDel) {
          this.viewingBatchId = null
          this.renderCenter()
        }
        this.renderLeft()
      })
    })

    this.leftEl?.querySelectorAll<HTMLButtonElement>('[data-batch-add-lib]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        this.btnFlash(btn, 'busy')
        const [batchId, actionId] = btn.dataset.batchAddLib!.split('::')
        const batch = this.batchHistory.find(b => b.id === batchId)
        const actionResult = batch?.actions.find(a => a.actionId === actionId)
        if (!actionResult) { this.toast('找不到该动作'); return }
        await this.saveOneActionToLib(
          actionResult.actionId, actionResult.actionLabel,
          actionResult.sheetDataUrl, actionResult.directions,
          batchId, batch?.label,
        )
        this.btnFlash(btn, 'done')
        this.toast(`${actionResult.actionLabel} 已加入动作库`)
      })
    })

    this.leftEl?.querySelectorAll<HTMLButtonElement>('[data-batch-replace]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const [batchId, actionId] = btn.dataset.batchReplace!.split('::')
        const batch = this.batchHistory.find(b => b.id === batchId)
        const actionResult = batch?.actions.find(a => a.actionId === actionId)
        if (!actionResult) { this.toast('找不到该动作'); return }
        this.replaceActionFromSource(actionResult.actionId, actionResult.directions, actionResult.sheetDataUrl)
        this.btnFlash(btn, 'done')
      })
    })

    this.leftEl?.querySelectorAll<HTMLButtonElement>('[data-batch-add-all]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        this.btnFlash(btn, 'busy')
        const batchId = btn.dataset.batchAddAll!
        const batch = this.batchHistory.find(b => b.id === batchId)
        if (!batch) return
        for (const a of batch.actions) {
          await this.saveOneActionToLib(a.actionId, a.actionLabel, a.sheetDataUrl, a.directions, batchId, batch.label)
        }
        this.btnFlash(btn, 'done')
        this.toast(`${batch.actions.length} 个动作已加入动作库`)
      })
    })
  }

  /* ── Library Detail Center View ─────────────────────────────────────── */

  private renderCenterLibDetail(): void {
    if (!this.selectedLibActionId) {
      this.panels!.center.innerHTML = `
        <div class="px-center">
          <div class="px-center-title">动作库</div>
          <div class="px-lib-center-empty">
            <div style="margin-bottom:8px">${pxIcon('box', 'px-icon px-empty-svg')}</div>
            <div style="font-size:12px;color:var(--text-secondary)">点击左侧动作卡片查看详情</div>
          </div>
        </div>`
      return
    }

    const entries = this.actionLib.filter(e => e.actionId === this.selectedLibActionId)
    if (entries.length === 0) {
      this.selectedLibActionId = null
      this.renderCenterLibDetail()
      return
    }

    const entry = entries[0]
    const action = getAction(entry.actionId)
    const dirFrames = entry.directions
    const dirCount = Object.keys(dirFrames).length
    const frameCount = Object.values(dirFrames).reduce((n, arr) => n + arr.length, 0)

    const detailScale = clampScale(entry.scale ?? 1)
    const detailScaleStyle = detailScale !== 1 ? ` style="transform: scale(${detailScale}); transform-origin: center center;"` : ''

    let html = `<div class="px-center">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <div class="px-center-title" style="flex:1">${entry.actionLabel}</div>
        <span class="px-action-card-meta">${dirCount}方向 ${frameCount}帧 · 缩放 ${Math.round(detailScale * 100)}%</span>
      </div>`

    html += `<div class="px-lib-detail-actions">
      <button class="px-btn-icon" data-lib-detail-apply="${entry.id}" title="应用到工作区"><span class="px-btn-icon-glyph">↻</span> 应用到工作区</button>
      <button class="px-btn-icon" data-lib-detail-skill="${entry.id}" title="技能编辑"><span class="px-btn-icon-glyph">⚔</span> 技能编辑</button>
      <button class="px-btn-icon danger" data-lib-detail-del="${entry.actionId}" title="从动作库移除"><span class="px-btn-icon-glyph">×</span> 移除</button>
    </div>`

    html += `<div class="px-action-results" data-px="action-results" style="grid-template-columns:1fr">`

    html += `<div class="px-action-card">`
    for (const [dir, frameUrls] of Object.entries(dirFrames)) {
      html += `<div class="px-dir-strip">
        <div class="px-dir-strip-left">
          <span class="px-dir-strip-name">${DIR_LABELS[dir as Direction] || dir}</span>
          <div class="px-dir-strip-gif" data-lib-gif="${entry.actionId}:${dir}"${detailScaleStyle}></div>
        </div>
        <div class="px-dir-strip-right">`
      for (let i = 0; i < frameUrls.length; i++) {
        html += `<div class="px-frame-cell">
          <div class="px-frame-drag-zone">
            <img src="${frameUrls[i]}" class="px-frame-img checkerboard" draggable="false"${detailScaleStyle} />
          </div>
          <span class="px-frame-idx">#${i + 1}</span>
        </div>`
      }
      html += `</div></div>`
    }
    html += `</div></div></div>`

    this.panels!.center.innerHTML = html

    this.panels!.center.querySelector('[data-lib-detail-apply]')?.addEventListener('click', () => {
      this.replaceActionFromSource(entry.actionId, entry.directions, entry.sheetDataUrl)
      this.btnFlash(this.panels!.center.querySelector('[data-lib-detail-apply]') as HTMLElement, 'done')
    })

    this.panels!.center.querySelector('[data-lib-detail-skill]')?.addEventListener('click', () => {
      this.showSkillEditor(entry.id)
    })

    this.panels!.center.querySelector('[data-lib-detail-del]')?.addEventListener('click', async () => {
      await removePixelActionsByActionId(entry.actionId)
      await this.refreshActionLib()
      this.selectedLibActionId = null
      this.renderLeft()
      this.renderCenter()
    })

    const delay = Math.round(1000 / this.cfg.fps)
    const libHandleKey = `lib:${entry.actionId}`
    this.stopGifsForAction(libHandleKey)
    const libHandles: GifPreviewHandle[] = []

    for (const [dir, frameUrls] of Object.entries(dirFrames)) {
      const el = this.panels?.center.querySelector(`[data-lib-gif="${entry.actionId}:${dir}"]`)
      if (!el || frameUrls.length === 0) continue
      el.innerHTML = ''
      const canvases: HTMLCanvasElement[] = new Array(frameUrls.length)
      let loaded = 0
      frameUrls.forEach((url, idx) => {
        const imgEl = new Image()
        imgEl.onload = () => {
          const c = document.createElement('canvas')
          c.width = imgEl.width; c.height = imgEl.height
          c.getContext('2d')!.drawImage(imgEl, 0, 0)
          canvases[idx] = c
          loaded++
          if (loaded === frameUrls.length) {
            const handle = createGifPreview(canvases.filter(Boolean), {
              delay,
              pingPong: action?.looping ?? true,
              holdLastFrameMs: action?.holdLastFrameMs ?? 0,
            })
            handle.canvas.className = 'px-gif-canvas'
            el.textContent = ''
            el.appendChild(handle.canvas)
            libHandles.push(handle)
          }
        }
        imgEl.src = url
      })
    }
    this.gifHandles.set(libHandleKey, libHandles)
  }

  /* ── Batch Detail Center View ──────────────────────────────────────── */

  private async renderCenterBatchDetail(batchId: string): Promise<void> {
    const batch = this.batchHistory.find(b => b.id === batchId) || await loadBatch(batchId)
    if (!batch) {
      this.panels!.center.innerHTML = `<div class="px-center"><div class="px-grid-empty">批次不存在</div></div>`
      return
    }

    let html = `<div class="px-center">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <button class="px-btn small primary" data-px="back-to-workspace">← 返回工作区</button>
        <div class="px-center-title" style="flex:1">${this.esc(batch.label)}</div>
      </div>
      <div class="px-action-results" data-px="action-results">`

    for (const a of batch.actions) {
      const dirCount = Object.keys(a.directions).length
      const frameCount = Object.values(a.directions).reduce((n, arr) => n + arr.length, 0)
      html += `<div class="px-action-card">
        <div class="px-action-card-head">
          <span class="px-action-card-name">${a.actionLabel}</span>
          <span class="px-action-card-meta">${dirCount}方向 ${frameCount}帧</span>
        </div>`

      for (const [dir, frameUrls] of Object.entries(a.directions)) {
        html += `<div class="px-dir-strip">
          <div class="px-dir-strip-left">
            <span class="px-dir-strip-name">${DIR_LABELS[dir as Direction] || dir}</span>
            <div class="px-dir-strip-gif" data-batch-gif="${a.actionId}:${dir}"></div>
          </div>
          <div class="px-dir-strip-right">`
        for (let i = 0; i < frameUrls.length; i++) {
          html += `<div class="px-frame-cell">
            <div class="px-frame-drag-zone">
              <img src="${frameUrls[i]}" class="px-frame-img checkerboard" draggable="false" />
            </div>
            <span class="px-frame-idx">#${i + 1}</span>
          </div>`
        }
        html += `</div></div>`
      }

      html += `<div class="px-action-card-footer">
        <button class="px-btn small" data-batchdetail-addlib="${batchId}::${a.actionId}">+ 加入动作库</button>
        <button class="px-btn small" data-batchdetail-replace="${batchId}::${a.actionId}">↻ 替换当前</button>
      </div></div>`
    }

    html += `</div></div>`
    this.panels!.center.innerHTML = html

    // Bind events
    this.panels!.center.querySelector('[data-px="back-to-workspace"]')?.addEventListener('click', () => {
      this.viewingBatchId = null
      this.renderLeft()
      this.renderCenter()
    })

    this.panels!.center.querySelectorAll<HTMLButtonElement>('[data-batchdetail-addlib]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.btnFlash(btn, 'busy')
        const [bid, aid] = btn.dataset.batchdetailAddlib!.split('::')
        const b = batch!
        const ar = b.actions.find(a => a.actionId === aid)
        if (!ar) return
        await this.saveOneActionToLib(ar.actionId, ar.actionLabel, ar.sheetDataUrl, ar.directions, bid, b.label)
        this.btnFlash(btn, 'done')
        this.toast(`${ar.actionLabel} 已加入动作库`)
      })
    })

    this.panels!.center.querySelectorAll<HTMLButtonElement>('[data-batchdetail-replace]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [bid, aid] = btn.dataset.batchdetailReplace!.split('::')
        const ar = batch!.actions.find(a => a.actionId === aid)
        if (!ar) return
        this.replaceActionFromSource(ar.actionId, ar.directions, ar.sheetDataUrl)
        this.btnFlash(btn, 'done')
      })
    })

    const batchHandleKey = `batch:${batchId}`
    this.stopGifsForAction(batchHandleKey)
    const batchHandles: GifPreviewHandle[] = []

    for (const a of batch.actions) {
      const action = getAction(a.actionId)
      const delay = Math.round(1000 / this.cfg.fps)
      for (const [dir, frameUrls] of Object.entries(a.directions)) {
        const el = this.panels?.center.querySelector(`[data-batch-gif="${a.actionId}:${dir}"]`)
        if (!el || frameUrls.length === 0) continue
        el.innerHTML = ''
        const canvases: HTMLCanvasElement[] = new Array(frameUrls.length)
        let loaded = 0
        frameUrls.forEach((url, idx) => {
          const imgEl = new Image()
          imgEl.onload = () => {
            const c = document.createElement('canvas')
            c.width = imgEl.width; c.height = imgEl.height
            c.getContext('2d')!.drawImage(imgEl, 0, 0)
            canvases[idx] = c
            loaded++
            if (loaded === frameUrls.length) {
              const handle = createGifPreview(canvases.filter(Boolean), {
                delay,
                pingPong: action?.looping ?? true,
                holdLastFrameMs: action?.holdLastFrameMs ?? 0,
              })
              handle.canvas.className = 'px-gif-canvas'
              el.textContent = ''
              el.appendChild(handle.canvas)
              batchHandles.push(handle)
            }
          }
          imgEl.src = url
        })
      }
    }
    this.gifHandles.set(batchHandleKey, batchHandles)
  }

  /* ── Helpers ────────────────────────────────────────────────────── */

  private btnFlash(el: HTMLElement | null, state: 'busy' | 'done'): void {
    if (!el) return
    if (state === 'busy') {
      el.classList.add('busy')
      el.classList.remove('done')
    } else {
      el.classList.remove('busy')
      el.classList.add('done')
      setTimeout(() => el.classList.remove('done'), 1200)
    }
  }

  private refresh(): void {
    if (this.leftEl && this.panels) this.mount(this.leftEl, this.panels)
  }

  private isStepDone(id: Step): boolean {
    return id === 1 ? !!this.img.turnaroundImage : Object.keys(this.img.splitFrames).length > 0
  }

  private stopAllGifs(): void {
    for (const handles of this.gifHandles.values()) handles.forEach(h => h.stop())
    this.gifHandles.clear()
  }

  private stopGifsForAction(actionId: string): void {
    for (const [key, handles] of this.gifHandles) {
      if (key === actionId || key.startsWith(actionId + ':')) {
        handles.forEach(h => h.stop())
        this.gifHandles.delete(key)
      }
    }
  }

  private showProgress(show: boolean, text?: string): void {
    const queueSuffix = this.regenQueue.length > 0 ? ` | 队列 ${this.regenQueue.length}` : ''
    const fullText = text ? text + queueSuffix : (show ? this.progressText : null)
    this.progressActive = show
    this.progressText = show ? (fullText ?? this.progressText ?? '处理中...') : null

    const el = this.leftEl?.querySelector('[data-px="gen-progress"]') as HTMLElement
    if (el) {
      el.style.display = show ? '' : 'none'
      if (text) {
        const t = el.querySelector('[data-px="gen-text"]')
        if (t) t.textContent = text + queueSuffix
      }
    }

    this.renderProgressOverlay()
    this.broadcastProgress()
  }

  /**
   * Paint a live progress card into the center pane's preview area while a
   * generation is in flight, so the user sees feedback in BOTH panes (the
   * sibling iframe mirrors the same overlay via `pixel-char-progress`
   * broadcast). Without this the center pane sits on the "⏳ 等待生成"
   * placeholder for the entire 60s gpt-image-2 round-trip.
   */
  private renderProgressOverlay(): void {
    const center = this.panels?.center
    if (!center) return

    // Update any in-cell loading text (Step 1 right cell, Step 2 placeholder)
    // so live phase changes ("[2/4 扩图]") propagate without a full rerender.
    center.querySelectorAll<HTMLElement>('.px-cell-loading-text').forEach(el => {
      el.textContent = this.progressText || (this.progressActive ? '正在生成...' : '')
    })

    // The dot on the active stage strip should keep spinning.
    center.querySelectorAll<HTMLElement>('.px-stage-dot.px-stage-active').forEach(dot => {
      dot.classList.toggle('px-stage-spinning', this.progressActive)
    })

    // The bottom progress overlay is the universal fallback (covers states
    // where no in-cell loading slot exists, e.g. lib detail / batch detail).
    const host = center.querySelector('.px-center') as HTMLElement | null ?? center
    const existing = host.querySelector(':scope > .px-progress-overlay') as HTMLElement | null

    // If the in-cell loading is already showing the same info, skip the
    // bottom overlay to avoid double feedback. We detect this by presence
    // of `.px-cell-loading` (Step 1 right cell) or `.px-step2-loading`.
    const hasInCell = !!host.querySelector('.px-cell-loading, .px-step2-loading')

    if (!this.progressActive || !this.progressText || hasInCell) {
      if (existing) existing.remove()
      return
    }

    const html = `
      <div class="px-progress-spinner"></div>
      <div class="px-progress-overlay-text">${this.esc(this.progressText)}</div>
      <div class="px-progress-overlay-hint">生成结果会自动同步到这里</div>
    `
    if (existing) {
      existing.innerHTML = html
      return
    }
    const node = document.createElement('div')
    node.className = 'px-progress-overlay'
    node.innerHTML = html
    host.appendChild(node)
  }

  private toast(msg: string, durationMs = 3000): void {
    let el = document.querySelector('.px-toast') as HTMLElement
    if (!el) {
      el = document.createElement('div')
      el.className = 'px-toast'
      document.body.appendChild(el)
    }
    el.textContent = msg
    el.classList.add('show')
    setTimeout(() => el.classList.remove('show'), durationMs)
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
}

/* ── Pipeline Export ──────────────────────────────────────────────── */

let ui: PixelPipelineUI | null = null
let pendingReset = false

const pixelChar: IPipeline = {
  meta,

  async init(context) {
    ctx = context
    console.log('[PixelChar] Pipeline initialized v5')
  },

  dispose() {
    ui?.dispose()
    ui = null
  },

  async resetForNewCharacter() {
    pendingReset = true
    const cfg = loadConfig()
    cfg.activeStep = 1
    saveConfig(cfg)
    // 抹掉上一个角色在像素管线里留下的所有东西——动作库、批次、会话快照、
    // 内存参考图——否则新角色生成的 2 个动画会混在旧角色几十个动作的库里。
    //
    // 这里必须 await：PipelinePanel 的 switch 处理器会在本函数 resolve 之后才
    // 调 `createUI()` → 新 `PixelPipelineUI` 在构造器里 `refreshActionLib()`
    // 读 IDB；若这里不 await，可能把还没清的旧数据又读回 this.actionLib。
    try {
      if (ui) {
        await ui.clearWorkspace({ silent: true })
      } else {
        await Promise.allSettled([
          clearPixelActionLib(),
          clearAllBatches(),
          sessionDelete(`current:${PIPELINE_ID}`),
        ])
      }
    } catch (e) {
      console.warn('[PixelChar] resetForNewCharacter cleanup failed:', e)
    }
  },

  createUI(container, panels) {
    if (!ui) ui = new PixelPipelineUI()
    ;(window as any).__pixelCharUi = ui
    if (panels) {
      ui.mount(container, panels)
    } else {
      container.innerHTML = '<div style="padding:16px;color:var(--text-secondary);font-size:12px;">像素管线需要完整面板布局。</div>'
    }
  },

  destroyUI() {
    ui?.unmount()
  },

  getDefaultParams() {
    return { fps: 8 }
  },
}

export default pixelChar

/* ── CSS ──────────────────────────────────────────────────────────── */

function injectCSS(): void {
  let s = document.getElementById(CSS_ID) as HTMLStyleElement | null
  if (!s) { s = document.createElement('style'); s.id = CSS_ID; document.head.appendChild(s) }
  s.textContent = `
.px-panel {
  display: flex; flex-direction: column; min-height: 0;
  font-family: system-ui, -apple-system, sans-serif;
}
.px-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.07);
}
.px-header-title { font-size: 15px; font-weight: 700; color: #d4ff48; line-height: normal; }
.px-header-pill {
  margin-left: auto; padding: 3px 8px;
  border: 1px solid rgba(212,255,72,0.28);
  border-radius: 999px; background: rgba(212,255,72,0.08);
  color: #d4ff48; font-size: 11px; font-weight: 700;
  line-height: 1.2; letter-spacing: .04em; white-space: nowrap;
}
.px-icon {
  width: 16px; height: 16px;
  display: inline-block; flex: 0 0 auto;
  fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round;
  vertical-align: -0.2em;
}

.px-section {
  margin: 8px 10px 0; padding: 10px;
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px; background: rgba(255,255,255,0.018);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.16);
}
.px-label {
  font-size: 12px; font-weight: 800; color: var(--accent);
  margin-bottom: 7px; letter-spacing: 0.03em;
}

.px-steps { display: flex; flex-direction: column; gap: 2px; }
.px-step {
  border: 1px solid rgba(255,255,255,0.07); border-radius: 8px;
  background: rgba(255,255,255,0.015);
  transition: all 0.15s; cursor: pointer;
}
.px-step:hover { background: var(--bg-hover); }
.px-step.active { background: rgba(212,255,72,0.055); border-color: rgba(212,255,72,0.24); }
.px-step.done .px-step-label { color: var(--success); }

.px-step-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 10px;
}
.px-step-icon {
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;
  background:var(--accent);color:#071007;font-size:10px;font-weight:900;
}
.px-step-svg { width:11px; height:11px; stroke-width:2.4; }
.px-step-label { font-size: 12px; font-weight: 600; color: var(--text-primary); flex: 1; }
.px-step-done { font-size: 9px; color: var(--success); font-weight: 600; }

.px-step-detail {
  padding: 4px 10px 12px; border-top: 1px solid var(--border);
}
.px-step-desc {
  font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.5;
}

.px-btn {
  display: inline-flex; align-items:center; justify-content:center; gap:6px;
  width: 100%; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-hover); color: var(--text-primary);
  font-size: 12px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.2s; text-align: center;
  position: relative; overflow: hidden;
}
.px-btn:hover { background: var(--bg-active); }
.px-btn:active { transform: scale(0.98); }
.px-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.px-btn.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 700; }
.px-btn-svg { width:15px; height:15px; stroke-width:2.2; }
.px-btn.primary:hover { filter: brightness(1.1); }
.px-btn.primary:disabled { filter: none; }
.px-btn.busy { pointer-events: none; opacity: 0.65; }
.px-btn.busy::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
  animation: px-shimmer 1s ease infinite;
}
.px-btn.done { border-color: var(--color-status-success); }
.px-btn.done::after {
  content: '✓'; position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--color-status-success) 18%, transparent); color: var(--color-status-success);
  font-weight: 700; font-size: 14px;
  animation: px-flash-in 0.3s ease;
}

.px-progress { padding: 8px 16px; }
.px-progress-bar {
  height: 3px; background: var(--border); border-radius: 2px; overflow: hidden;
}
.px-progress-fill {
  height: 100%; width: 30%; background: var(--accent);
  animation: px-progress-anim 1.5s ease-in-out infinite;
}
@keyframes px-progress-anim {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
.px-progress-text { font-size: 10px; color: var(--text-secondary); margin-top: 4px; }

/* ── Stage strip ──────────────────────────────────────────────────── */
.px-stage-strip {
  display: flex; align-items: center; gap: 6px;
  width: 100%;
  padding: 12px 4px 14px;
  margin: 0 -4px 4px;
  border-bottom: 1px solid var(--border);
  flex-wrap: nowrap;
  box-sizing: border-box;
}
.px-stage-item {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  flex: 0 0 auto;
}
.px-stage-dot {
  width: 24px; height: 24px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700;
  border: 2px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  transition: all 0.25s ease;
  position: relative;
}
.px-stage-dot.px-stage-done {
  border-color: var(--color-status-success);
  background: var(--color-status-success);
  color: #000;
}
.px-stage-dot.px-stage-active {
  border-color: var(--accent);
  background: var(--bg);
  color: var(--accent);
  box-shadow: 0 0 0 3px rgba(255,255,255,0.04);
}
.px-stage-dot.px-stage-spinning::after {
  content: ''; position: absolute; inset: -2px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: var(--accent);
  animation: px-spin 0.8s linear infinite;
}
.px-stage-label {
  font-size: 10px; line-height: 1.1;
  white-space: nowrap;
  letter-spacing: 0.02em;
}
.px-stage-label-done { color: var(--text-primary); }
.px-stage-label-active { color: var(--accent); font-weight: 600; }
.px-stage-label-pending { color: var(--text-secondary); opacity: 0.55; }
.px-stage-connector {
  flex: 1 1 auto; height: 2px;
  margin: 0 2px;
  align-self: flex-start; margin-top: 11px;
  border-radius: 1px;
  min-width: 12px;
}
.px-stage-connector-done { background: var(--color-status-success); opacity: 0.65; }
.px-stage-connector-pending { background: var(--border); opacity: 0.5; }

/* ── Friendly empty states ────────────────────────────────────────── */
.px-empty-icon {
  font-size: 30px; line-height: 1; margin-bottom: 8px;
  opacity: 0.85;
}
.px-empty-title {
  font-size: 12px; font-weight: 600; color: var(--text-primary);
  margin-bottom: 4px; line-height: 1.4;
}
.px-empty-sub {
  font-size: 10px; color: var(--text-secondary);
  line-height: 1.4;
}
.px-empty-hint {
  font-size: 9px; color: var(--text-secondary);
  margin-top: 6px; opacity: 0.7;
  font-style: italic;
}

/* ── In-cell loading state ────────────────────────────────────────── */
.px-grid-cell.px-cell-active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.04), 0 0 16px color-mix(in srgb, var(--color-status-success) 10%, transparent);
}
.px-cell-loading {
  position: relative;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center; gap: 10px;
  padding: 20px 12px;
  min-height: 180px;
  overflow: hidden;
}
.px-cell-skeleton {
  position: absolute; inset: 8px;
  border-radius: 6px;
  background: linear-gradient(110deg,
    var(--bg-hover) 30%,
    rgba(255,255,255,0.06) 50%,
    var(--bg-hover) 70%);
  background-size: 200% 100%;
  animation: px-skel 1.6s ease-in-out infinite;
  z-index: 0;
  opacity: 0.5;
}
@keyframes px-skel {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
.px-cell-spinner {
  width: 28px; height: 28px;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: px-spin 0.8s linear infinite;
  z-index: 1;
}
.px-cell-loading-text {
  font-size: 12px; font-weight: 600;
  color: var(--text-primary);
  z-index: 1; position: relative;
  line-height: 1.4;
  max-width: 90%;
}
.px-cell-loading-hint {
  font-size: 10px; color: var(--text-secondary);
  z-index: 1; position: relative;
  opacity: 0.75;
}

/* Fresh-result celebration: subtle green pulse when image first appears. */
.px-result-fresh {
  animation: px-pulse-in 0.9s ease-out;
}
@keyframes px-pulse-in {
  0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-status-success) 55%, transparent); }
  60%  { box-shadow: 0 0 0 14px color-mix(in srgb, var(--color-status-success) 0%, transparent); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-status-success) 0%, transparent); }
}

/* Step 2 placeholder loading variant — same idiom, looser layout. */
.px-step2-loading {
  display: flex; flex-direction: column; align-items: center;
  gap: 10px; padding: 40px 16px;
  text-align: center;
}

.px-progress-overlay {
  position: sticky; bottom: 0; z-index: 5;
  margin: 12px -16px -16px;
  padding: 14px 16px;
  background: linear-gradient(180deg, transparent 0%, var(--bg-secondary, var(--bg, #1a1a1a)) 12%, var(--bg-secondary, var(--bg, #1a1a1a)) 100%);
  border-top: 1px solid var(--border);
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  box-shadow: 0 -8px 24px rgba(0,0,0,0.4);
}
.px-progress-spinner {
  width: 22px; height: 22px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: px-spin 0.8s linear infinite;
}
@keyframes px-spin { to { transform: rotate(360deg); } }
.px-progress-overlay-text {
  font-size: 12px; font-weight: 600; color: var(--text-primary);
  text-align: center; line-height: 1.4;
}
.px-progress-overlay-hint {
  font-size: 10px; color: var(--text-secondary); opacity: 0.75;
}

.px-center {
  padding: 16px; display: flex; flex-direction: column; gap: 12px;
  width: 100%; height: 100%; min-height: 0;
  overflow-y: auto; overflow-x: hidden;
  box-sizing: border-box;
}
.px-center-title {
  font-size: 14px; font-weight: 700; color: var(--text-primary);
}

.px-grid { display: grid; gap: 8px; flex: 1; min-height: 0; width: 100%; }
.px-grid-ref {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: minmax(320px, 1fr);
  gap: 12px;
}
.px-grid-cell {
  display: flex; flex-direction: column; background: rgba(0,0,0,0.2);
  border-radius: 6px; border: 1px solid var(--border); overflow: hidden;
  min-height: 0;
}
.px-grid-label {
  padding: 5px 8px; font-size: 10px; font-weight: 600; color: var(--text-secondary);
  background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--border); text-align: center;
}
.px-grid-img {
  flex: 1; width: 100%; object-fit: contain; min-height: 0; padding: 6px; box-sizing: border-box;
}
.px-grid-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-size: 24px; color: var(--text-secondary); opacity: 0.4; min-height: 80px;
  text-align: center;
  padding: 12px;
}
/* Variants override the dim default — used for friendly empty / loading. */
.px-grid-empty.px-droppable-hint,
.px-grid-empty.px-cell-loading {
  opacity: 1;
  font-size: 12px;
}

.px-sheet-list { display: flex; flex-direction: column; gap: 12px; }
.px-sheet-item {
  border: 1px solid var(--border); border-radius: 6px; overflow: hidden;
  background: rgba(0,0,0,0.15);
}
.px-sheet-label {
  padding: 6px 10px; font-size: 12px; font-weight: 600; color: var(--text-primary);
  background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--border);
}
.px-sheet-img {
  width: 100%; display: block; image-rendering: pixelated;
}
.checkerboard {
  background-image: linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
    linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
    linear-gradient(-45deg, transparent 75%, #1a1a1a 75%);
  background-size: 10px 10px;
  background-position: 0 0, 0 5px, 5px -5px, -5px 0px;
}

.px-action-results {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}

.px-action-card {
  border: 1px solid var(--border); border-radius: 8px;
  background: rgba(0,0,0,0.15);
}
.px-action-card-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; background: rgba(0,0,0,0.2);
  border-bottom: 1px solid var(--border);
  border-radius: 8px 8px 0 0;
}
.px-action-card-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.px-action-card-meta { font-size: 10px; color: var(--text-secondary); font-weight: 500; }
.px-action-card-footer {
  display: flex; gap: 8px; padding: 8px 14px;
  border-top: 1px solid var(--border); background: rgba(0,0,0,0.1);
  border-radius: 0 0 8px 8px;
}

.px-sheet-toggle { padding: 8px 14px; }
.px-sheet-toggle summary {
  font-size: 11px; color: var(--text-secondary); cursor: pointer; user-select: none; list-style: none;
}
.px-sheet-toggle summary:hover { color: var(--text-primary); }
.px-sheet-prompt-row {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px; margin-top: 6px; align-items: start;
}
@media (max-width: 900px) {
  .px-sheet-prompt-row { grid-template-columns: 1fr; }
}
.px-sheet-col, .px-prompt-col { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.px-sheet-img { max-width: 100%; max-height: 280px; display: block; }
.px-sheet-label { font-size: 10px; color: var(--text-secondary); margin-top: 6px; opacity: 0.7; }
.px-prompt-textarea {
  width: 100%; box-sizing: border-box;
  min-height: 180px; max-height: 400px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; line-height: 1.45;
  background: var(--panel-alt, #1a1a1a); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 8px; resize: vertical; white-space: pre-wrap;
}
.px-prompt-actions { display: flex; gap: 6px; margin-top: 4px; }

.px-dir-strip {
  display: flex; align-items: stretch; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.04);
  min-height: 120px;
}
.px-dir-strip:last-child { border-bottom: none; }
.px-dir-strip-left {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  min-width: 130px; flex-shrink: 0;
}
.px-dir-strip-name {
  font-size: 12px; font-weight: 700; color: var(--accent);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.px-dir-strip-gif { flex-shrink: 0; }
.px-gif-canvas {
  width: 120px; height: 120px; image-rendering: pixelated;
  border: 2px solid var(--accent); border-radius: 6px;
  background: rgba(0,0,0,0.3);
}
.px-dir-strip-right {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 4px 0; flex: 1; min-width: 0;
}
.px-frame-cell {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  flex-shrink: 0;
}
.px-frame-img {
  width: 100px; height: 100px; image-rendering: pixelated;
  object-fit: contain; display: block;
}
.px-frame-idx { font-size: 9px; color: var(--text-secondary); font-weight: 600; }

.px-textarea {
  width: 100%; min-height: 40px; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--bg-hover); color: var(--text-primary);
  font-family: inherit; font-size: 12px; resize: vertical; outline: none; box-sizing: border-box;
  line-height: 1.5;
}
.px-select {
  width: 100%; padding: 6px 8px; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--bg-hover); color: var(--text-primary);
  font-family: inherit; font-size: 11px; outline: none; box-sizing: border-box;
  cursor: pointer;
}
.px-select:focus { border-color: var(--accent); }
.px-textarea:focus { border-color: var(--accent); }

.px-ta-mode-row { display: flex; gap: 4px; margin-bottom: 8px; }
.px-ta-mode-btn {
  flex: 1; padding: 7px 6px; border: 1px solid var(--border); border-radius: var(--radius);
  background: transparent; color: var(--text-secondary); font-size: 11px;
  font-family: inherit; cursor: pointer; transition: all 0.15s; text-align: center;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
}
.px-mode-svg { width:14px; height:14px; stroke-width:2; }
.px-ta-mode-btn:hover { background: var(--bg-hover); }
.px-ta-mode-btn.active {
  background: var(--bg-active); border-color: var(--accent); color: var(--text-primary); font-weight: 600;
}

.px-source-preview {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px solid var(--border);
  margin-bottom: 4px;
}
.px-source-thumb {
  width: 40px; height: 40px; border-radius: 4px; object-fit: cover;
  border: 1px solid var(--border);
}
.px-source-label { font-size: 11px; color: var(--text-secondary); font-weight: 500; }
.px-hint-box {
  padding: 8px 10px; font-size: 11px; color: var(--color-status-warning);
  background: color-mix(in srgb, var(--color-status-warning) 12%, transparent); border: 1px solid color-mix(in srgb, var(--color-status-warning) 28%, transparent);
  border-radius: 6px; margin-bottom: 6px; line-height: 1.5;
}
.px-upload-row { display: flex; align-items: center; gap: 6px; }
.px-link-btn {
  font-size: 10px; color: var(--accent); cursor: pointer;
  text-decoration: underline; text-underline-offset: 2px;
}
.px-link-btn:hover { opacity: 0.8; }

.px-checkbox-label {
  display: flex; align-items: center; gap: 6px; font-size: 12px;
  color: var(--text-primary); cursor: pointer; white-space: nowrap; margin-bottom: 4px;
}
.px-checkbox-label input { accent-color: var(--accent); }

.px-mode-hint {
  font-size: 10px; color: var(--text-secondary); line-height: 1.5;
  margin-top: 4px; padding: 0 2px;
}

.px-style-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px; margin-top: 4px;
}
.px-style-chip {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; padding: 8px 4px; border: 1px solid var(--border);
  border-radius: var(--radius); background: transparent;
  color: var(--text-secondary); font-family: inherit; font-size: 10px;
  cursor: pointer; transition: all 0.15s; text-align: center; line-height: 1.2;
}
.px-style-chip:hover { background: var(--bg-hover); color: var(--text-primary); }
.px-style-chip.active {
  background: var(--bg-active); border-color: var(--accent);
  color: var(--text-primary); font-weight: 600;
}
.px-style-chip-icon { font-size: 18px; line-height: 1; }
.px-style-chip-icon .px-icon { width:18px; height:18px; stroke-width:1.9; }
.px-empty-svg { width:28px; height:28px; opacity:0.45; }
.px-btn-pill-icon .px-icon { width:14px; height:14px; stroke-width:2.2; }
.px-style-chip-label {
  font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
}

.px-droppable { cursor: pointer; transition: all 0.15s; }
.px-droppable:hover { border-color: var(--accent); }
.px-droppable.px-droppable-hover {
  border-color: var(--accent); background: rgba(90, 140, 255, 0.08);
  box-shadow: 0 0 0 2px rgba(90, 140, 255, 0.3);
}
.px-droppable-hint {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4px; padding: 20px; color: var(--text-secondary); font-size: 12px;
  text-align: center; line-height: 1.5;
}

.px-toast {
  position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%) translateY(20px);
  background: var(--bg-active); color: var(--text-primary); padding: 8px 16px;
  border-radius: 8px; font-size: 12px; opacity: 0; transition: all 0.3s;
  pointer-events: none; z-index: 9999; border: 1px solid var(--border);
}
.px-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

.px-ws-divider { margin:14px 16px 0;border-top:2px dashed var(--border); }
.px-ws-header {
  display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;transition:opacity .15s;
}
.px-ws-header:hover { opacity:.85; }
.px-ws-icon { font-size:16px; }
.px-ws-title { font-size:13px;font-weight:700;color:var(--accent);flex:1; }
.px-ws-badge { font-size:9px;color:var(--success); }
.px-ws-arrow { font-size:10px;color:var(--text-secondary); }
.px-ws-body { margin-top:4px; }

.px-lib-list { display:flex;flex-direction:column;gap:6px; }
.px-lib-item {
  border:1px solid var(--border);border-radius:6px;background:rgba(0,0,0,0.15);
  overflow:hidden;
}
.px-lib-item-header {
  display:flex;align-items:center;gap:8px;padding:6px 10px;
  background:rgba(0,0,0,0.1);border-bottom:1px solid var(--border);
}
.px-lib-item-name { font-size:12px;font-weight:600;color:var(--text-primary);flex:1; }
.px-lib-remove {
  width:20px;height:20px;border:none;border-radius:3px;background:color-mix(in srgb, var(--color-status-error) 18%, transparent);
  color:var(--color-status-error);font-size:12px;cursor:pointer;transition:background .15s;
  display:flex;align-items:center;justify-content:center;
}
.px-lib-remove:hover { background:color-mix(in srgb, var(--color-status-error) 32%, transparent); }

.px-btn.small {
  display: inline-flex; align-items: center; gap: 4px;
  width: auto; padding: 5px 10px; font-size: 10px;
  border-radius: 5px;
}
.px-btn.tiny {
  display: inline-flex; align-items: center; justify-content: center;
  width: auto; min-width: 22px; padding: 3px 5px; font-size: 10px; line-height: 1;
  border-radius: 4px;
}
.px-btn.tiny:hover { background: rgba(255,255,255,0.15); border-color: var(--accent); }

.px-frame-ops {
  display: flex; gap: 2px; margin-top: 2px;
}
.px-frame-drag-zone {
  cursor: grab; position: relative; overflow: hidden;
  border-radius: 4px; border: 1px solid var(--border);
}
.px-frame-drag-zone:hover { border-color: var(--accent); }
.px-frame-drag-zone.dragging {
  cursor: grabbing; border-color: var(--accent);
  box-shadow: 0 0 8px rgba(var(--accent-rgb, 100,200,255), 0.4);
}
.px-frame-drag-zone .px-frame-img {
  width: 100px; height: 100px; image-rendering: pixelated;
  object-fit: contain; display: block; pointer-events: none;
  border: none; border-radius: 0;
  transition: none;
}

.px-copy-dialog {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
}
.px-copy-dialog-inner {
  background: var(--bg-primary, #1e1e1e); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px; min-width: 200px; max-width: 400px; max-height: 60vh;
  display: flex; flex-direction: column; gap: 10px; overflow-y: auto;
}
.px-copy-dialog-title {
  font-size: 13px; font-weight: 700; color: var(--text-primary);
}
.px-copy-dialog-list {
  display: flex; flex-wrap: wrap; gap: 6px;
}

/* Batch History */
.px-batch-list { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.px-batch-item { background: rgba(0,0,0,0.12); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; transition: background 0.15s; }
.px-batch-item.expanded { border-color: var(--accent); }
.px-batch-item.viewing { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.px-batch-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; }
.px-batch-head:hover { background: rgba(0,0,0,0.2); }
.px-batch-info { flex: 1; min-width: 0; }
.px-batch-label { font-size: 11px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.px-batch-actions-summary { font-size: 9px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.px-batch-ops { display: flex; gap: 2px; flex-shrink: 0; }
.px-batch-body { padding: 4px 8px 8px; display: flex; flex-direction: column; gap: 4px; }
.px-batch-action-row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; background: rgba(0,0,0,0.1); border-radius: 3px; }
.px-batch-action-thumb { width: 28px; height: 28px; object-fit: contain; border-radius: 2px; flex-shrink: 0; }
.px-batch-action-thumb-empty { width: 28px; height: 28px; background: rgba(0,0,0,0.2); border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text-secondary); flex-shrink: 0; }
.px-batch-action-info { flex: 1; min-width: 0; }
.px-batch-action-name { font-size: 10px; font-weight: 600; color: var(--text-primary); }
.px-batch-action-meta { font-size: 9px; color: var(--text-secondary); }
.px-batch-action-ops { display: flex; gap: 2px; flex-shrink: 0; }
.px-batch-footer { display: flex; gap: 4px; margin-top: 4px; }

/* Action Library */
.px-lib-action-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; background: rgba(0,0,0,0.1); border-radius: 4px; margin-top: 3px; }
.px-lib-action-row:hover { background: rgba(0,0,0,0.2); }
.px-lib-action-thumb { width: 32px; height: 32px; object-fit: contain; border-radius: 2px; flex-shrink: 0; }
.px-lib-action-thumb-empty { width: 32px; height: 32px; background: rgba(0,0,0,0.2); border-radius: 2px; display: flex; align-items: center; justify-content: center; font-size: 10px; color: var(--text-secondary); flex-shrink: 0; }
.px-lib-action-info { flex: 1; min-width: 0; }
.px-lib-action-name { font-size: 11px; font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.px-lib-action-meta { font-size: 9px; color: var(--text-secondary); }
.px-lib-action-ops { display: flex; gap: 2px; flex-shrink: 0; }
.px-lib-footer { display: flex; gap: 4px; margin-top: 8px; flex-wrap: wrap; }

.px-skill-editor { padding: 8px; background: rgba(30,30,40,0.8); border-radius: 6px; margin-top: 6px; }
.px-skill-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.px-skill-row label { font-size: 11px; color: var(--text-secondary); min-width: 48px; }
.px-skill-row input, .px-skill-row select {
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
  color: var(--text-primary, #eee); border-radius: 4px; padding: 2px 6px; font-size: 11px;
  flex: 1; min-width: 0;
}
.px-skill-row input[type="color"] { width: 28px; height: 22px; padding: 0; flex: none; cursor: pointer; }
.px-skill-frames-strip {
  display: flex; gap: 2px; padding: 4px 0; overflow-x: auto; scrollbar-width: thin;
}
.px-skill-frame-thumb {
  width: 32px; height: 32px; border: 2px solid transparent; border-radius: 3px;
  cursor: pointer; image-rendering: pixelated; object-fit: contain; flex-shrink: 0;
  background: rgba(0,0,0,0.3);
}
.px-skill-frame-thumb.trigger { border-color: var(--color-accent-orange-default); }
.px-skill-frame-thumb.vfx-start { border-color: var(--color-accent-blue-default); }
.px-skill-section-title { font-size: 10px; color: #999; margin-top: 6px; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px; }

/* Tab Bar */
.px-tab-bar {
  display: flex; gap: 0; border-bottom: 2px solid var(--border);
  padding: 0 16px;
}
.px-tab-btn {
  flex: 1; padding: 9px 0; border: none; background: transparent;
  color: var(--text-secondary); font-size: 12px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.15s;
  text-align: center; position: relative;
}
.px-tab-btn:hover { color: var(--text-primary); }
.px-tab-btn.active {
  color: var(--accent);
}
.px-tab-btn.active::after {
  content: ''; position: absolute; bottom: -2px; left: 12px; right: 12px;
  height: 2px; background: var(--accent); border-radius: 1px;
}
.px-tab-body { flex: 1; overflow-y: auto; min-height: 0; }

/* Lib Tab - Card Grid */
.px-lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px; padding: 12px 16px;
}
.px-lib-card {
  display: flex; flex-direction: column; align-items: center;
  padding: 10px 6px 8px; border-radius: 6px; cursor: default;
  background: rgba(0,0,0,0.15); border: 1px solid var(--border);
  transition: all 0.15s; position: relative;
}
.px-lib-card:hover { background: rgba(0,0,0,0.25); border-color: var(--accent); }
.px-lib-card-thumb-box {
  width: 48px; height: 48px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;  /* scaled thumbs shouldn't bleed into the card's label */
}
.px-lib-card-thumb {
  width: 48px; height: 48px; image-rendering: pixelated;
  object-fit: contain; border-radius: 4px;
  transform-origin: center center;
  transition: transform 0.12s ease-out;
}
.px-lib-card-thumb-empty {
  width: 48px; height: 48px; background: rgba(0,0,0,0.2); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: var(--text-secondary);
}
.px-lib-card-scale {
  display: flex; align-items: center; justify-content: center;
  gap: 4px; margin-top: 4px; font-size: 10px;
  color: var(--text-secondary); user-select: none;
}
.px-scale-btn {
  width: 16px; height: 16px; line-height: 1; padding: 0;
  border: 1px solid var(--border); border-radius: 3px;
  background: rgba(255,255,255,0.05); color: var(--text-primary);
  cursor: pointer; font-size: 11px; font-family: inherit;
}
.px-scale-btn:hover { background: rgba(255,255,255,0.12); border-color: var(--accent); }
.px-scale-pct {
  min-width: 34px; text-align: center; font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.px-scale-pct:hover { color: var(--accent); }
.px-lib-toolbar {
  display: flex; gap: 6px; padding: 8px 16px 0; flex-wrap: wrap;
}
.px-lib-card-name {
  font-size: 10px; margin-top: 6px; color: var(--text-primary);
  text-align: center; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 100%;
}
.px-lib-card-ops {
  position: absolute; top: 3px; right: 3px;
  display: none; gap: 2px;
}
.px-lib-card.selected {
  background: rgba(var(--accent-rgb, 100, 200, 255), 0.12);
  border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent);
}
.px-lib-card:hover .px-lib-card-ops { display: flex; }
.px-lib-footer-bar {
  display: flex; gap: 6px; padding: 10px 16px; flex-wrap: wrap;
  border-top: 1px solid var(--border);
}

/* 动作库底部操作区——分主次两行：主操作（导入到游戏/发布 NPC）放大强调，
   工作区辅助按钮放到第二行用更克制的 ghost 样式，清空工作区挂在尾部靠右。 */
.px-lib-footer {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 16px; border-top: 1px solid var(--border);
  background: rgba(0,0,0,0.15);
}
.px-lib-footer-row {
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
}
.px-lib-footer-primary { gap: 12px; }
.px-lib-footer-secondary {
  gap: 6px; padding-top: 6px;
  border-top: 1px dashed rgba(255,255,255,0.08);
}
.px-lib-footer-secondary .px-btn-pill.danger {
  margin-left: auto;
}

/* Pill Buttons */
.px-btn-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px; background: rgba(255,255,255,0.06);
  color: var(--text-primary); font-size: 11px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.2s;
  white-space: nowrap; position: relative; overflow: hidden;
}
.px-btn-pill:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.2); transform: translateY(-1px); }
.px-btn-pill:active { transform: translateY(0); }
.px-btn-pill.accent {
  background: var(--accent); color: #000; border-color: var(--accent); font-weight: 700;
}
.px-btn-pill.accent:hover { filter: brightness(1.1); }
.px-btn-pill.danger { color: var(--color-status-error); border-color: color-mix(in srgb, var(--color-status-error) 28%, transparent); }
.px-btn-pill.danger:hover { background: color-mix(in srgb, var(--color-status-error) 14%, transparent); }
.px-btn-pill.primary {
  color: #80f0a0; border-color: rgba(80,240,160,0.35);
  background: rgba(80,240,160,0.08);
}
.px-btn-pill.primary:hover { background: rgba(80,240,160,0.18); border-color: rgba(80,240,160,0.55); }
.px-btn-pill-icon { font-size: 13px; line-height: 1; }

/* 主操作 pill —— 主次明显：xl 放大字号 / 内边距 / 阴影，hover 上浮。 */
.px-btn-pill.xl {
  padding: 12px 22px; font-size: 14px; font-weight: 700;
  border-radius: 26px; letter-spacing: 0.5px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
}
.px-btn-pill.xl .px-btn-pill-icon { font-size: 18px; }
.px-btn-pill.xl:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.32); }

/* 次级操作 pill —— ghost 样式：底色更淡，字号压一号，不抢主操作视觉。 */
.px-btn-pill.ghost {
  background: transparent; border-color: rgba(255,255,255,0.08);
  color: var(--text-secondary, #a0a0a8); font-size: 10.5px; font-weight: 500;
  padding: 6px 12px;
}
.px-btn-pill.ghost:hover {
  background: rgba(255,255,255,0.06); color: var(--text-primary);
  border-color: rgba(255,255,255,0.15);
}
.px-btn-pill.ghost.danger {
  color: var(--color-status-error); border-color: color-mix(in srgb, var(--color-status-error) 22%, transparent);
}
.px-btn-pill.ghost.danger:hover {
  background: color-mix(in srgb, var(--color-status-error) 12%, transparent); color: var(--color-status-error);
  border-color: color-mix(in srgb, var(--color-status-error) 40%, transparent);
}

.px-btn-pill.busy {
  pointer-events: none; opacity: 0.65;
}
.px-btn-pill.busy::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
  animation: px-shimmer 1s ease infinite;
}
.px-btn-pill.done { border-color: var(--color-status-success); }
.px-btn-pill.done::after {
  content: '✓'; position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--color-status-success) 18%, transparent); color: var(--color-status-success);
  font-weight: 700; font-size: 14px;
  animation: px-flash-in 0.3s ease;
}
@keyframes px-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
@keyframes px-flash-in {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}

/* Step2 action buttons */
.px-step2-actions {
  display: flex; flex-direction: column; gap: 6px; margin-top: 10px;
}

/* Icon Buttons (center detail toolbar) */
.px-btn-icon {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; background: rgba(255,255,255,0.06);
  color: var(--text-primary); font-size: 11px; font-weight: 500;
  font-family: inherit; cursor: pointer; transition: all 0.15s;
}
.px-btn-icon:hover { background: rgba(255,255,255,0.12); }
.px-btn-icon.danger { color: var(--color-status-error); }
.px-btn-icon.danger:hover { background: color-mix(in srgb, var(--color-status-error) 14%, transparent); }
.px-btn-icon.done { border-color: var(--color-status-success); color: var(--color-status-success); }
.px-btn-icon-glyph { font-size: 13px; line-height: 1; }

/* Lib Detail Actions */
.px-lib-detail-actions {
  display: flex; gap: 8px; flex-wrap: wrap; padding: 6px 0 10px;
  border-bottom: 1px solid var(--border); margin-bottom: 8px;
}
.px-lib-center-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 40px 20px; text-align: center;
}

.px-lib-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 40px 20px; text-align: center;
}
.px-lib-empty-icon { font-size: 32px; margin-bottom: 12px; opacity: 0.5; }
.px-lib-empty-text { font-size: 13px; color: var(--text-primary); font-weight: 600; margin-bottom: 6px; }
.px-lib-empty-hint { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
`
}
