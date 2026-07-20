import type { BodyType } from './BodyTypes'
import {
  type ImageModel,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODEL_STORAGE_KEY,
  parseImageModelFromStorage,
} from './ImageModel'

export type { ImageModel }

export type CombatType = 'melee' | 'ranged'
export type Gender = 'male' | 'female'

export type ArtStyle = 'pixel' | 'anime' | 'chibi' | 'realistic' | 'painterly' | 'flat' | 'ink' | 'dark' | 'custom' | ''

/**
 * 角色定位：主角英雄 / 职业路人 NPC / 怪物敌人。
 *
 * - `hero`（默认）：走完整的战斗英雄管线——18 种战斗职业、武器装备、
 *   大招演出、非人形形态（昆虫/灵/兽/机械/吉祥物）全都参与。
 * - `npc`：世界里普通的居民/职业人员（现代都市的上班族、街角小贩；
 *   中世纪的铁匠、农夫；赛博朋克的快递员等）。没有武器、没有大招、
 *   动画只需要「待机/走路」这些日常节奏；prompt 去战斗语言。
 * - `monster`：敌方生物/BOSS。接怪物分类（类人型/非人型/混合）+ 体型
 *   + 威胁等级，prompt 强调轮廓清晰、居中、无背景，便于后续切帧。
 *   没有武器装备字段，战斗类型由 classification 决定。
 *
 * 历史档案没有这两个字段时按 `'hero'` 回退（见 load()）。
 */
export type CharacterRole = 'hero' | 'npc' | 'monster'

export interface CharacterProfile {
  name: string
  /**
   * Stable identity for "the character we are currently editing", used to
   * key disk artifacts under <projectRoot>/.forgeax/games/<slug>/characters/<charId>/.
   * Auto-assigned by `globalState.ensureCharId()` on the first successful
   * generation that wants to persist; never re-assigned after that for the
   * lifetime of the workspace (so subsequent pipeline outputs land in the
   * same folder). Cleared on `clear()` along with the rest of the profile.
   */
  charId: string
  gender: Gender
  combatType: CombatType
  charClass: string
  age: string
  worldSetting: string
  artStyle: ArtStyle
  artStyleCustom: string
  extraDesc: string
  /**
   * 形态 / 物种。决定整套 prompt 是按「人形 RPG 英雄」还是按
   * Hollow Knight / Ori / Cuphead 这类非人形主角来生成。
   * 历史档案缺该字段时按 'humanoid' 兜底（见 load()）。
   */
  bodyType: BodyType
  /**
   * 角色定位。历史档案缺字段时按 `'hero'` 兜底。详见 {@link CharacterRole}。
   */
  characterRole: CharacterRole
  /**
   * NPC 职业。仅当 `characterRole === 'npc'` 时参与 prompt。
   * 中文短词（如「上班族」「铁匠」「赛博格」），词表参考
   * `NpcOccupations.ts`；允许自定义。
   */
  npcOccupation: string
  /**
   * 怪物主分类。仅当 `characterRole === 'monster'` 时参与 prompt。
   * 取值参考 `pipelines/_monster-gen/classification.ts` 的 `MONSTER_TREE` key：
   * '类人型' / '非人型' / '混合'。
   */
  monsterCategory?: string
  /**
   * 怪物次分类（子类），如「亚人 / 猛兽类 / 巨龙类 / 爬虫类 / 异物 / 漂浮类」等。
   */
  monsterSubCategory?: string
  /**
   * 怪物种族名（最细），如「哥布林 / 飞龙 / 史莱姆」。允许自定义。
   */
  monsterRace?: string
  /**
   * 怪物体型预设 id，参考 `classification.ts` 的 `BODY_TYPES`：
   * stocky / lean / giant / agile / heavy / compact / gangly。
   */
  monsterBodyType?: string
  /**
   * 威胁等级：'normal' 普通小怪 / 'elite' 精英 / 'boss'。
   * 影响 prompt 的描述力度（BOSS 强调震慑、精英强调徽记/特征）。
   */
  monsterThreat?: 'normal' | 'elite' | 'boss'
}

export interface CharacterDesignResult {
  profile: CharacterProfile
  characterImage: string | null
  timestamp: number
}

/** @deprecated use profile.combatType */
export type Profession = CombatType

type Listener = () => void

const STORAGE_KEY = 'character-editor:global-design'

const DEFAULT_PROFILE: CharacterProfile = {
  name: '',
  charId: '',
  gender: 'male',
  combatType: 'melee',
  charClass: '',
  age: '',
  worldSetting: '',
  artStyle: '',
  artStyleCustom: '',
  extraDesc: '',
  bodyType: 'humanoid',
  characterRole: 'hero',
  npcOccupation: '',
}

function slugifyName(name: string): string {
  const cleaned = (name || '').toLowerCase().trim()
    .replace(/[^a-z0-9一-龥]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  if (cleaned && /^[a-z0-9]/.test(cleaned)) return cleaned.slice(0, 24)
  return ''
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** Fetch a same-origin asset URL and convert to a base64 data-URL (VFX
 *  pipelines need data-URLs, not served paths). Best-effort; null on failure. */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

class GlobalStateManager {
  private design: CharacterDesignResult = {
    profile: { ...DEFAULT_PROFILE },
    characterImage: null,
    timestamp: 0,
  }
  private imageModel: ImageModel = DEFAULT_IMAGE_MODEL
  private listeners = new Set<Listener>()
  /**
   * Project slug for asset persistence. Populated from bridge's
   * STUDIO_INIT/STUDIO_CTX message; pipelines that want to write to disk
   * read this through getSlug() and refuse the upload if it's empty.
   */
  private _slug: string = ''

  constructor() {
    this.load()
    this.loadImageModel()
    // Module 16 split-pane: same-origin sibling iframe (?pane=left vs ?pane=center)
    // 改了 form/profile 触发 save() → localStorage. 'storage' 事件只在
    // 其他同源 browsing-context 里 fire,所以本地 save() 自己听不到、
    // 不会自循环;接收方拉新值进内存,通知 UI 重绘。
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (ev: StorageEvent) => {
        if (ev.key === STORAGE_KEY) {
          this.load()
          this.notify()
        } else if (ev.key === IMAGE_MODEL_STORAGE_KEY) {
          this.loadImageModel()
          this.notify()
        }
      })
    }
  }

  get(): CharacterDesignResult { return this.design }
  get profile(): CharacterProfile { return this.design.profile }
  get hasCharacter(): boolean { return this.design.characterImage !== null }

  /**
   * 当前全局生图模型偏好。
   *
   * 所有 pipeline（概设/完整设定/视角/动作 sheet/载具）都应从这里读，
   * 不要硬编码具体模型名。想让用户选的是**语义**（Gemini 还是 gpt-image-2），
   * 真实的 API model 字符串由每个调用点在发请求时根据这个值现场决定。
   */
  getImageModel(): ImageModel { return this.imageModel }

  /** Project slug from the studio bridge; empty until STUDIO_INIT lands. */
  getSlug(): string { return this._slug }

  setSlug(slug: string): void {
    if (!slug || slug === this._slug) return
    this._slug = slug
    this.notify()
  }

  /**
   * 跨工作台交接(走文件):wb-character 生成角色后把 active-character 指针落盘到
   * .forgeax/games/<slug>/active-character.json。技能特效工作台挂载时按该指针
   * 的 charId 从磁盘 manifest 把角色 portrait 读回来灌进 characterImage,让 VFX
   * 管线立刻有角色输入,不再依赖与角色设计同源共享 localStorage。
   *
   * portrait 在磁盘上是图片字节(同源 /api/wb/character/asset?path=...),VFX 生成
   * 要 base64 data-URL,所以 fetch → blob → dataURL 再 setCharacterImage。
   * 已有同 charId 内存图时跳过磁盘重读。返回读到的 role,失败返回 null。
   */
  async loadCharacterFromDisk(charId: string): Promise<{ role: string } | null> {
    if (!charId || !this._slug) return null
    try {
      const res = await fetch(
        `/api/wb/character/characters/${encodeURIComponent(charId)}?slug=${encodeURIComponent(this._slug)}`,
      )
      if (!res.ok) return null
      const j = await res.json() as {
        manifest?: { charId?: string; name?: string; role?: string; portrait?: Record<string, string> }
        urls?: Record<string, string>
      }
      const manifest = j.manifest
      if (!manifest) return null
      const role = manifest.role ?? 'hero'

      this.updateProfile({
        charId: manifest.charId ?? charId,
        name: manifest.name ?? this.design.profile.name,
        // wb-skill 的 CharacterRole 不含 'vehicle';载具不进技能特效管线,这里
        // 只映射角色三态,其它一律 hero 兜底。
        characterRole: (role === 'npc' || role === 'monster') ? role : 'hero',
      })

      const haveImage = !!this.design.characterImage
      const sameChar = this.design.profile.charId === (manifest.charId ?? charId)
      if (haveImage && sameChar) return { role }

      const portraitUrl =
        j.urls?.['portrait/front'] ??
        (manifest.portrait?.front
          ? `/api/wb/character/asset?path=${encodeURIComponent(
              `.forgeax/games/${this._slug}/characters/${manifest.charId ?? charId}/${manifest.portrait.front}`,
            )}`
          : null)
      if (!portraitUrl) return { role }

      const dataUrl = await fetchAsDataUrl(portraitUrl)
      if (dataUrl) {
        this.design.characterImage = dataUrl
        this.design.timestamp = Date.now()
        this.save()
        this.notify()
      }
      return { role }
    } catch {
      return null
    }
  }

  /**
   * Lazily mint a stable charId for the currently-edited profile. First call
   * on a fresh profile generates `<kebab(name)>-<rand>` (or `char-<rand>` when
   * name is empty / non-ASCII), persists it to localStorage, and returns it.
   * Subsequent calls return the same id until clear() runs.
   */
  ensureCharId(): string {
    if (this.design.profile.charId) return this.design.profile.charId
    const stem = slugifyName(this.design.profile.name) || 'char'
    const id = `${stem}-${randomSuffix()}`
    this.design.profile.charId = id
    this.save()
    this.notify()
    return id
  }

  /**
   * POST a generated artifact to /api/wb/character/upload-asset so it lands
   * under <projectRoot>/.forgeax/games/<slug>/characters/<charId>/<rel>.
   *
   * Returns the asset URL on success (so callers can swap their in-memory
   * data: URL for the served path) or null on failure / missing slug.
   * Best-effort: pipelines should keep the IDB copy as fallback, but the
   * studio mounts disk artifacts as the source of truth across reloads.
   */
  async uploadAsset(rel: string, dataUrl: string): Promise<{ url: string; path: string } | null> {
    if (!this._slug) return null
    if (!rel || !dataUrl) return null
    const charId = this.ensureCharId()
    try {
      const res = await fetch('/api/wb/character/upload-asset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: this._slug, charId, rel, base64: dataUrl }),
      })
      if (!res.ok) return null
      const j = await res.json() as { ok?: boolean; url?: string; path?: string }
      if (!j.ok || !j.url) return null
      return { url: j.url, path: j.path ?? '' }
    } catch { return null }
  }

  setImageModel(model: ImageModel): void {
    if (this.imageModel === model) return
    this.imageModel = model
    this.saveImageModel()
    this.notify()
  }

  /** @deprecated use updateProfile({ combatType }) */
  setProfession(p: CombatType): void {
    this.design.profile.combatType = p
    this.save()
    this.notify()
  }

  updateProfile(partial: Partial<CharacterProfile>): void {
    Object.assign(this.design.profile, partial)
    this.save()
    this.notify()
  }

  /** Fingerprint of the most recently uploaded characterImage, so swapping the
   *  preview to the same dataUrl doesn't re-POST. data: URLs are huge so we
   *  only hash the head + length. */
  private _lastUploadedImageKey: string = ''

  setCharacterImage(dataUrl: string | null): void {
    this.design.characterImage = dataUrl
    this.design.timestamp = Date.now()
    this.save()
    this.notify()
    if (dataUrl && this._slug) {
      const key = `${dataUrl.length}:${dataUrl.slice(0, 64)}:${dataUrl.slice(-32)}`
      if (key !== this._lastUploadedImageKey) {
        this._lastUploadedImageKey = key
        // fire-and-forget; pipelines should treat the IDB copy as the canonical
        // session state, this just mirrors the latest preview to disk so the
        // <projectRoot>/.forgeax/games/<slug>/characters/<charId>/ folder
        // actually fills up while the user is iterating
        void this.uploadAsset('portrait/current.png', dataUrl)
      }
    }
  }

  /**
   * Bulk-upload N concept images under `concepts/<i>.png`. Pipelines call this
   * alongside their existing IDB save so the disk folder mirrors the in-memory
   * batch. Returns the count of successful writes (best-effort, never throws).
   */
  async uploadConceptBatch(images: string[]): Promise<number> {
    if (!this._slug || !images || images.length === 0) return 0
    let ok = 0
    await Promise.all(images.map(async (img, i) => {
      const r = await this.uploadAsset(`concepts/${i}.png`, img)
      if (r) ok++
    }))
    return ok
  }

  /** @deprecated use updateProfile({ extraDesc }) */
  setDescription(desc: string): void {
    this.design.profile.extraDesc = desc
  }

  clear(): void {
    this.design = {
      profile: { ...DEFAULT_PROFILE },
      characterImage: null,
      timestamp: 0,
    }
    this.save()
    this.notify()
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    for (const fn of this.listeners) fn()
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.design)) } catch {}
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved.profile) Object.assign(this.design.profile, saved.profile)
        // migrate old format
        if (saved.profession && !saved.profile) {
          this.design.profile.combatType = saved.profession
        }
        if (saved.characterDescription && !saved.profile?.extraDesc) {
          this.design.profile.extraDesc = saved.characterDescription
        }
        // 旧档案没有 bodyType — 全部当人形处理，保持原行为
        if (!this.design.profile.bodyType) this.design.profile.bodyType = 'humanoid'
        // 旧档案没有 characterRole — 按主角英雄处理，保持原行为
        if (!this.design.profile.characterRole) this.design.profile.characterRole = 'hero'
        if (typeof this.design.profile.npcOccupation !== 'string') this.design.profile.npcOccupation = ''
        // 旧档案没有 charId — 留空，等下次 ensureCharId() 真的要落盘才生成。
        if (typeof this.design.profile.charId !== 'string') this.design.profile.charId = ''
        if (saved.characterImage) this.design.characterImage = saved.characterImage
        if (saved.timestamp) this.design.timestamp = saved.timestamp
      }
    } catch {}
  }

  private loadImageModel(): void {
    try {
      this.imageModel = parseImageModelFromStorage(localStorage.getItem(IMAGE_MODEL_STORAGE_KEY))
    } catch {
      this.imageModel = DEFAULT_IMAGE_MODEL
    }
  }

  private saveImageModel(): void {
    try { localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, this.imageModel) } catch {}
  }
}

export const globalState = new GlobalStateManager()
;(window as any).__globalState = globalState
