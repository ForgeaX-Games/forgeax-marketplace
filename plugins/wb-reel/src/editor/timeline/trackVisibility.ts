/**
 * 时间轴「逐轨状态」(显隐 / 静音 / 锁定) 的持久化偏好 —— 剪映式轨头能力的存储层。
 *
 * 由原先只管 DIA 一条的 dialoguePref 推广而来:现在每条轨(特效/贴纸/视频/画面/字幕/
 * QTE/文字/搜索/触发/音频/小游戏/分支)各有独立的 visible/muted/locked 三态。
 *
 * 设计:
 *   · 单一事实源:Timeline 轨头、StagePane 预览、Player 试玩输出都读这里。
 *     「时间轴里看不到 = 画面/试玩里也看不到」(视觉层);音频 muted = 试玩静音。
 *   · 向后兼容:DIA 的可见性继续与旧 key `reel-studio.timeline.showDialogue.v1` 双向同步,
 *     这样仍在直接读 loadDialoguePref() 的 Player 字幕逻辑无需改动即可继续工作。
 *   · 默认值:视觉/音频/QTE 轨默认可见;触发(TRIG)/小游戏(GAME)/分支(BR)沿用旧
 *     VISIBLE_TRACKS 死开关的「默认隐藏」(数据层仍在,轨道管理面板里可勾选恢复)。
 *
 * key 命名沿用 "reel-studio.*.v1" 规范。
 */

export type TrackKey =
  | 'fx'
  | 'stk'
  | 'video'
  | 'image'
  | 'dia'
  | 'qte'
  | 'txt'
  | 'srch'
  | 'trig'
  | 'audio'
  | 'game'
  | 'br'

export interface TrackState {
  visible: boolean
  muted: boolean
  locked: boolean
  /**
   * 可选内容轨(特效/贴纸/文字/搜索/触发/小游戏/分支)即使为空也强制铺一条空 lane,
   * 便于直接往里拖素材(剪映式)。恒显轨(视频/画面/QTE/音频)忽略此字段。
   */
  showEmpty: boolean
}

export type TrackPrefs = Record<TrackKey, TrackState>

export const TRACK_KEYS: TrackKey[] = [
  'fx',
  'stk',
  'video',
  'image',
  'dia',
  'qte',
  'txt',
  'srch',
  'trig',
  'audio',
  'game',
  'br',
]

/** 各轨默认可见性 —— trig/game/br 沿用旧 VISIBLE_TRACKS 死开关的「默认隐藏」。 */
const DEFAULT_VISIBLE: Record<TrackKey, boolean> = {
  fx: true,
  stk: true,
  video: true,
  image: true,
  dia: true,
  qte: true,
  txt: true,
  srch: true,
  trig: false,
  audio: true,
  game: false,
  br: false,
}

const STORAGE_KEY = 'reel-studio.timeline.trackPrefs.v1'
const LEGACY_DIA_KEY = 'reel-studio.timeline.showDialogue.v1'

function defaultState(key: TrackKey): TrackState {
  return { visible: DEFAULT_VISIBLE[key], muted: false, locked: false, showEmpty: false }
}

export function defaultTrackPrefs(): TrackPrefs {
  const out = {} as TrackPrefs
  for (const k of TRACK_KEYS) out[k] = defaultState(k)
  return out
}

function parseLegacyDia(raw: string | null): boolean | undefined {
  if (raw === null) return undefined
  const t = raw.trim().toLowerCase()
  if (t === 'true' || t === '1') return true
  if (t === 'false' || t === '0') return false
  return undefined
}

/**
 * 解析持久化值。`raw` 为主 key 的 JSON;`legacyDiaRaw` 为旧 DIA key(向后兼容)。
 * 主 key 缺失字段一律退化到默认;旧 DIA 值仅在主 key 未显式写过 dia.visible 时生效。
 */
export function parseTrackPrefs(
  raw: string | null,
  legacyDiaRaw: string | null = null,
): TrackPrefs {
  const out = defaultTrackPrefs()
  let parsed: unknown = null
  if (raw) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  const hasDiaInMain =
    parsed != null &&
    typeof parsed === 'object' &&
    'dia' in (parsed as Record<string, unknown>)
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, Partial<TrackState>>
    for (const k of TRACK_KEYS) {
      const v = obj[k]
      if (v && typeof v === 'object') {
        if (typeof v.visible === 'boolean') out[k].visible = v.visible
        if (typeof v.muted === 'boolean') out[k].muted = v.muted
        if (typeof v.locked === 'boolean') out[k].locked = v.locked
        if (typeof v.showEmpty === 'boolean') out[k].showEmpty = v.showEmpty
      }
    }
  }
  // 主 key 没写过 dia → 吃旧 DIA 开关的值(老用户曾关过字幕仍按其选择)。
  if (!hasDiaInMain) {
    const legacy = parseLegacyDia(legacyDiaRaw)
    if (legacy !== undefined) out.dia.visible = legacy
  }
  return out
}

export function serializeTrackPrefs(prefs: TrackPrefs): string {
  return JSON.stringify(prefs)
}

export function loadTrackPrefs(): TrackPrefs {
  if (typeof window === 'undefined') return defaultTrackPrefs()
  try {
    return parseTrackPrefs(
      window.localStorage.getItem(STORAGE_KEY),
      window.localStorage.getItem(LEGACY_DIA_KEY),
    )
  } catch {
    return defaultTrackPrefs()
  }
}

export function saveTrackPrefs(prefs: TrackPrefs): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeTrackPrefs(prefs))
    // 与旧 DIA key 双向同步 —— Player 字幕仍直接读 loadDialoguePref()。
    window.localStorage.setItem(
      LEGACY_DIA_KEY,
      prefs.dia.visible ? 'true' : 'false',
    )
  } catch {
    // 隐身 / 存储满 —— 本轮会话仍按内存值工作。
  }
}

/** 不可变地更新某轨某字段,返回新对象(便于 React state)。 */
export function withTrack(
  prefs: TrackPrefs,
  key: TrackKey,
  patch: Partial<TrackState>,
): TrackPrefs {
  return { ...prefs, [key]: { ...prefs[key], ...patch } }
}

export const TRACK_PREFS_STORAGE_KEY = STORAGE_KEY
export const TRACK_PREFS_LEGACY_DIA_KEY = LEGACY_DIA_KEY
