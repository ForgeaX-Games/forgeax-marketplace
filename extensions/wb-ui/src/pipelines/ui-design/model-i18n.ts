/** English overlay for model.ts preset data — keyed by stable ids. */
import { getLocale } from '../../i18n'
import type { AssetKindId, GenrePresetId, ScreenKind, StylePresetId } from './model'

export function pick(zh: string, en: string): string {
  return getLocale() === 'en' ? en : zh
}

export const GENRE_I18N: Record<GenrePresetId, { label: string; tagline: string; summary: string }> = {
  'open-world': {
    label: 'Open world',
    tagline: 'Map-first, quest-driven, free exploration',
    summary: 'Multi-layer HUD for exploration and quest progression.',
  },
  'action-rpg': {
    label: 'Action RPG',
    tagline: 'Skill loops, resource feedback, combat and growth',
    summary: 'Combat layout focused on skills, resources, and objectives.',
  },
  fps: {
    label: 'First-person shooter',
    tagline: 'Weapons, reticle, instant feedback first',
    summary: 'Light HUD built around the sightline and shooting feedback.',
  },
  survival: {
    label: 'Survival crafting',
    tagline: 'Status bars, resources, crafting in parallel',
    summary: 'Always-on survival status, resources, and crafting entry.',
  },
  mmo: {
    label: 'MMORPG',
    tagline: 'Chat, guilds, quests, skills together',
    summary: 'High-density cooperative UI with many systems at once.',
  },
  'life-sim': {
    label: 'Life sim',
    tagline: 'Low pressure, soft info, clear menu guidance',
    summary: 'Gentle structure around schedules, dialogue, and management.',
  },
  racing: {
    label: 'Racing',
    tagline: 'Speed, route, placement, lap time first',
    summary: 'UI organized around speed feedback, route cues, and results.',
  },
  puzzle: {
    label: 'Puzzle / match-3',
    tagline: 'Board-first, clear goals, level progression',
    summary: 'Light UI with the puzzle board at the center plus level flow.',
  },
}

export const MODULE_I18N: Record<string, string> = {
  'main-nav': 'Main navigation',
  minimap: 'Minimap',
  'quest-tracker': 'Quest tracker',
  'interaction-hints': 'Interaction hints',
  'health-status': 'Health status',
  'skill-bar': 'Skill bar',
  'weapon-hud': 'Weapon panel',
  'ammo-counter': 'Ammo counter',
  reticle: 'Reticle',
  scoreboard: 'Score / lap time',
  'inventory-grid': 'Inventory grid',
  'item-detail': 'Item details',
  'item-slot': 'Quick item slots',
  'character-panel': 'Character stats',
  'crafting-panel': 'Crafting panel',
  'resource-tracker': 'Resource tracker',
  currency: 'Currency display',
  'map-screen': 'Full-screen map',
  'shop-panel': 'Shop panel',
  'reward-summary': 'Reward summary',
  'chat-panel': 'Chat channels',
  'dialog-box': 'Dialogue box',
  'pause-menu': 'Pause menu',
  'settings-panel': 'Settings panel',
  'modal-dialog': 'Confirm modal',
  'game-board': 'Game board',
  'score-display': 'Current score',
  'level-counter': 'Level / moves',
  'step-counter': 'Moves remaining',
  'endless-mode': 'Endless mode',
  'tech-tree': 'Tech tree',
  'level-select': 'Level select',
  'weapon-select': 'Weapon select',
}

export const STYLE_I18N: Record<StylePresetId, { label: string; tone: string }> = {
  'modern-dark': { label: 'Modern dark', tone: 'Cool black glass + bright accents' },
  fantasy: { label: 'Fantasy epic', tone: 'Gold trim, crests, heavy panels' },
  anime: { label: 'Anime battle', tone: 'Bright outlines, light cards, speed lines' },
  'sci-fi': { label: 'Sci-fi future', tone: 'Neon edges, cool HUD, scanlines' },
  pixel: { label: 'Pixel arcade', tone: 'Blocks, contrast colors, retro clarity' },
  'cute-cartoon': { label: 'Cute cartoon', tone: 'Rounded lines, vivid saturation, light stroke' },
  'fresh-pastoral': { label: 'Fresh pastoral', tone: 'Soft greens, natural texture, hand-drawn' },
  'realistic-military': { label: 'Realistic military', tone: 'Matte olive, metal, tactical display' },
  'modern-minimal': { label: 'Modern minimal', tone: 'Large whitespace, line icons, monochrome' },
}

/** Per-genre screen labels (falls back to SCREEN_KIND_I18N). */
export const SCREEN_FLOW_I18N: Record<GenrePresetId, Partial<Record<ScreenKind, string>>> = {
  'open-world': {
    start: 'Start screen',
    hud: 'Gameplay HUD',
    bag: 'Inventory / items',
    dialog: 'NPC dialogue',
    character: 'Character stats',
    pause: 'Pause menu',
    map: 'Full-screen map',
    results: 'Quest results',
  },
  'action-rpg': {
    start: 'Start screen',
    hud: 'Combat HUD',
    pause: 'Pause menu',
    bag: 'Inventory / items',
    dialog: 'Story dialogue',
    character: 'Character stats',
    results: 'Combat results',
  },
  fps: {
    start: 'Start screen',
    'weapon-select': 'Weapon select',
    hud: 'Combat HUD',
    map: 'Tactical map',
    dialog: 'Briefing / dialogue',
    pause: 'Pause menu',
    results: 'Match results',
  },
  survival: {
    start: 'Start screen',
    hud: 'Survival HUD',
    bag: 'Inventory / crafting',
    character: 'Character stats',
    shop: 'Trader / exchange',
    map: 'World map',
    pause: 'Pause menu',
    results: 'Results / death',
  },
  mmo: {
    start: 'Login / character select',
    hud: 'Gameplay HUD',
    bag: 'Inventory / gear',
    dialog: 'Social / story',
    character: 'Character stats',
    shop: 'Shop / auction',
    map: 'World map',
    pause: 'Pause menu',
    results: 'Dungeon results',
  },
  'life-sim': {
    start: 'Start screen',
    hud: 'Life HUD',
    dialog: 'NPC dialogue',
    bag: 'Inventory / items',
    map: 'Map / travel',
    shop: 'Shop screen',
    pause: 'Pause menu',
    results: 'Daily summary',
  },
  racing: {
    start: 'Start / garage',
    'level-select': 'Track select',
    hud: 'Race HUD',
    pause: 'Pause menu',
    results: 'Race results',
  },
  puzzle: {
    start: 'Start screen',
    'level-select': 'Level select',
    hud: 'Gameplay HUD',
    dialog: 'Story / hints',
    results: 'Level results',
    end: 'End screen',
  },
}

export const STYLE_REASON_I18N: Record<string, string> = {
  'open-world:modern-dark': 'Dense open-world HUD; dark base reduces clutter',
  'open-world:realistic-military': 'Crime/war open-world themes fit well',
  'open-world:sci-fi': 'Immersive sci-fi open worlds',
  'action-rpg:fantasy': 'Mainstream sword-and-sorcery look',
  'action-rpg:modern-minimal': 'Clean pick for modern / cosmic horror RPG',
  'action-rpg:anime': 'Strong fit for Japanese action RPG',
  'fps:sci-fi': 'Neon HUD common in futuristic shooters',
  'fps:realistic-military': 'Tactical shooter realism',
  'fps:modern-dark': 'General modern shooter base',
  'survival:realistic-military': 'Matte outdoor / apocalypse survival',
  'survival:pixel': 'Common indie survival pixel look',
  'survival:modern-dark': 'General 3D survival base',
  'mmo:fantasy': 'Traditional MMO mainstream style',
  'mmo:sci-fi': 'Strong sci-fi MMO match',
  'mmo:modern-dark': 'Modern MMO clean pick',
  'life-sim:cute-cartoon': 'Life-sim audience fit',
  'life-sim:fresh-pastoral': 'Farm/town themes',
  'life-sim:modern-minimal': 'Urban life-sim minimal style',
  'racing:sci-fi': 'Futuristic racing speed feel',
  'racing:realistic-military': 'Realistic racing dashboard',
  'racing:modern-dark': 'Street racing dark UI',
  'puzzle:cute-cartoon': 'Match-3 / puzzle audience fit',
  'puzzle:fresh-pastoral': 'Softer look reduces visual fatigue',
  'puzzle:pixel': 'Indie pixel puzzle style',
}

export function localizedStyleReason(genre: GenrePresetId, styleId: StylePresetId, reasonZh: string): string {
  return pick(reasonZh, STYLE_REASON_I18N[`${genre}:${styleId}`] ?? reasonZh)
}

export function localizedModuleLabel(id: string, zh: string): string {
  return pick(zh, MODULE_I18N[id] ?? zh)
}

export function localizedScreenLabel(genre: GenrePresetId, kind: ScreenKind, zh: string): string {
  if (getLocale() !== 'en') return zh
  return SCREEN_FLOW_I18N[genre]?.[kind] ?? zh
}

export function localizedStyleLabel(id: StylePresetId, zh: string, toneZh: string): { label: string; tone: string } {
  const en = STYLE_I18N[id]
  if (!en) return { label: zh, tone: toneZh }
  return { label: pick(zh, en.label), tone: pick(toneZh, en.tone) }
}

export function localizedGenreField(
  genreId: GenrePresetId,
  field: 'label' | 'tagline' | 'summary',
  zh: string,
): string {
  if (getLocale() !== 'en') return zh
  return GENRE_I18N[genreId]?.[field] ?? zh
}

export const ASSET_KIND_I18N: Record<AssetKindId, string> = {
  buttonNormal: 'Secondary button',
  buttonPrimary: 'Primary button',
  buttonNormalLong: 'Long option secondary button',
  buttonPrimaryLong: 'Long option primary button',
  titleDeco: 'Title bar',
  panelTexture: 'Panel texture',
  icons: 'Icon set',
  background: 'Background',
}

export function localizedAssetKindLabel(kind: AssetKindId, zh?: string): string {
  const fallback = zh ?? kind
  if (getLocale() !== 'en') return fallback
  return ASSET_KIND_I18N[kind] ?? fallback
}

export function localizedComponentStepLabel(
  kind: AssetKindId,
  moduleHints: string[],
  iconCount?: number,
): string {
  const sep = getLocale() === 'en' ? ', ' : '、'
  const hint = moduleHints.length > 0 ? ` (${moduleHints.join(sep)})` : ''
  const base = localizedAssetKindLabel(kind)
  if (kind === 'buttonPrimaryLong') {
    return pick('长选项主按钮（对话整行）', `Long option primary button (full dialog row)${hint}`)
  }
  if (kind === 'buttonNormalLong') {
    return pick('长选项次按钮（对话整行）', `Long option secondary button (full dialog row)${hint}`)
  }
  if (kind === 'icons' && iconCount != null) {
    return pick(`功能图标 ${iconCount} 个${hint}`, `Function icons (${iconCount})${hint}`)
  }
  return `${base}${hint}`
}
