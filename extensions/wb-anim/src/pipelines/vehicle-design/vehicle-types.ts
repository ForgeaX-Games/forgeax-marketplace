// ── View system ──────────────────────────────────────────────────────

export type VehicleView =
  | 'front' | 'left' | 'right' | 'back' | 'top'
  | 'iso-nw' | 'iso-ne' | 'iso-sw' | 'iso-se'

export interface ViewMode {
  id: string
  label: string
  views: VehicleView[]
  description: string
}

export const VIEW_MODES: ViewMode[] = [
  {
    id: 'four-dir',
    label: '四方向',
    views: ['front', 'left', 'right', 'back'],
    description: '正面/左/右/背面，适合 RPG 或策略游戏',
  },
  {
    id: 'topdown-plus',
    label: '俯视+四方向',
    views: ['top', 'front', 'left', 'right', 'back'],
    description: '俯视+四面，适合俯视射击、赛车游戏',
  },
  {
    id: 'side-only',
    label: '侧视',
    views: ['left', 'right'],
    description: '左/右两面，适合横版平台游戏',
  },
  {
    id: 'isometric',
    label: '等轴测',
    views: ['iso-nw', 'iso-ne', 'iso-sw', 'iso-se'],
    description: '四个 45° 角，适合战术、城建游戏',
  },
]

export const VIEW_LABELS: Record<VehicleView, string> = {
  front: '正面',
  left: '朝右',
  right: '朝左',
  back: '背面',
  top: '俯视',
  'iso-nw': '左前 45°',
  'iso-ne': '右前 45°',
  'iso-sw': '左后 45°',
  'iso-se': '右后 45°',
}

export function getViewMode(id: string): ViewMode | undefined {
  return VIEW_MODES.find(m => m.id === id)
}

// ── Vehicle categories ───────────────────────────────────────────────

export type VehicleKind = 'mechanical' | 'animal' | 'hybrid'

export interface VehicleSubtype {
  id: string
  label: string
  prompt: string
  kind: VehicleKind
}

export interface VehicleCategory {
  id: string
  label: string
  icon: string
  subtypes: VehicleSubtype[]
}

export const VEHICLE_CATEGORIES: VehicleCategory[] = [
  {
    id: 'ground',
    label: '地面载具',
    icon: '🚗',
    subtypes: [
      { id: 'sedan', label: '轿车', prompt: 'sedan car', kind: 'mechanical' },
      { id: 'sports', label: '跑车', prompt: 'sports car / supercar', kind: 'mechanical' },
      { id: 'police', label: '警车', prompt: 'police patrol car with light bar on roof, police livery (black-and-white or blue-and-white with POLICE / 警 markings), push-bar bumper', kind: 'mechanical' },
      { id: 'ambulance', label: '救护车', prompt: 'emergency ambulance van with red cross markings, rooftop emergency light bar, white body with red/orange stripes', kind: 'mechanical' },
      { id: 'firetruck', label: '消防车', prompt: 'fire engine / fire truck, bright red body, ladder or water hose equipment on top, chrome accents', kind: 'mechanical' },
      { id: 'taxi', label: '出租车', prompt: 'taxi cab, yellow body with taxi rooftop sign, city livery', kind: 'mechanical' },
      { id: 'truck', label: '卡车', prompt: 'truck / heavy vehicle', kind: 'mechanical' },
      { id: 'pickup', label: '皮卡', prompt: 'pickup truck with open cargo bed', kind: 'mechanical' },
      { id: 'van', label: '面包车', prompt: 'delivery van / minivan, boxy cargo body', kind: 'mechanical' },
      { id: 'tank', label: '坦克', prompt: 'military tank / armored vehicle', kind: 'mechanical' },
      { id: 'apc', label: '装甲车', prompt: 'armored personnel carrier (APC), wheeled military transport, turret on top', kind: 'mechanical' },
      { id: 'motorcycle', label: '摩托车', prompt: 'motorcycle / motorbike', kind: 'mechanical' },
      { id: 'atv', label: '全地形车', prompt: 'all-terrain vehicle (ATV/quad bike), four fat off-road tires, roll cage', kind: 'mechanical' },
      { id: 'construction', label: '工程车', prompt: 'construction vehicle (excavator, bulldozer)', kind: 'mechanical' },
      { id: 'bus', label: '巴士', prompt: 'bus / coach', kind: 'mechanical' },
      { id: 'schoolbus', label: '校车', prompt: 'yellow school bus with STOP sign, black stripes, long rectangular body', kind: 'mechanical' },
      { id: 'racing', label: '赛车', prompt: 'racing car / go-kart', kind: 'mechanical' },
      { id: 'custom', label: '自定义...', prompt: '', kind: 'mechanical' },
    ],
  },
  {
    id: 'air',
    label: '空中载具',
    icon: '✈️',
    subtypes: [
      { id: 'helicopter', label: '直升机', prompt: 'helicopter', kind: 'mechanical' },
      { id: 'jet', label: '战斗机', prompt: 'fighter jet / military aircraft', kind: 'mechanical' },
      { id: 'plane', label: '客机', prompt: 'civilian airplane / airliner', kind: 'mechanical' },
      { id: 'drone', label: '无人机', prompt: 'drone / quadcopter', kind: 'mechanical' },
      { id: 'airship', label: '飞艇', prompt: 'airship / blimp / zeppelin', kind: 'mechanical' },
      { id: 'biplane', label: '双翼机', prompt: 'biplane / vintage aircraft', kind: 'mechanical' },
      { id: 'custom', label: '自定义...', prompt: '', kind: 'mechanical' },
    ],
  },
  {
    id: 'water',
    label: '水上载具',
    icon: '🚢',
    subtypes: [
      { id: 'speedboat', label: '快艇', prompt: 'speedboat / motorboat', kind: 'mechanical' },
      { id: 'sailboat', label: '帆船', prompt: 'sailboat / sailing vessel', kind: 'mechanical' },
      { id: 'warship', label: '战舰', prompt: 'warship / battleship', kind: 'mechanical' },
      { id: 'submarine', label: '潜艇', prompt: 'submarine', kind: 'mechanical' },
      { id: 'cargo', label: '货轮', prompt: 'cargo ship / freighter', kind: 'mechanical' },
      { id: 'hovercraft', label: '气垫船', prompt: 'hovercraft', kind: 'mechanical' },
      { id: 'custom', label: '自定义...', prompt: '', kind: 'mechanical' },
    ],
  },
  {
    id: 'scifi',
    label: '科幻载具',
    icon: '🛸',
    subtypes: [
      { id: 'hover-car', label: '悬浮车', prompt: 'futuristic hover car / flying car', kind: 'mechanical' },
      { id: 'starfighter', label: '太空战机', prompt: 'starfighter / space fighter', kind: 'mechanical' },
      { id: 'mech', label: '机甲', prompt: 'mech / bipedal mecha / walking vehicle', kind: 'mechanical' },
      { id: 'shuttle', label: '穿梭机', prompt: 'space shuttle / dropship', kind: 'mechanical' },
      { id: 'hoverbike', label: '悬浮摩托', prompt: 'hover bike / speeder bike', kind: 'mechanical' },
      { id: 'custom', label: '自定义...', prompt: '', kind: 'mechanical' },
    ],
  },
  {
    id: 'fantasy',
    label: '奇幻载具',
    icon: '🐉',
    subtypes: [
      { id: 'horse', label: '骏马', prompt: 'horse / war horse mount', kind: 'animal' },
      { id: 'dragon', label: '龙', prompt: 'dragon mount / riding dragon', kind: 'animal' },
      { id: 'griffin', label: '狮鹫', prompt: 'griffin / gryphon mount', kind: 'animal' },
      { id: 'carpet', label: '魔法飞毯', prompt: 'magic flying carpet', kind: 'mechanical' },
      { id: 'chariot', label: '战车', prompt: 'chariot / war chariot', kind: 'mechanical' },
      { id: 'golem', label: '魔像', prompt: 'golem / construct vehicle', kind: 'mechanical' },
      { id: 'wolf', label: '狼骑', prompt: 'giant wolf mount', kind: 'animal' },
      { id: 'custom', label: '自定义...', prompt: '', kind: 'mechanical' },
    ],
  },
]

/**
 * True when this subtype expects the user to fill in their own free-text
 * description via a <textarea>. UI code shows / hides the input based on
 * this flag, and `generateDesignPrompt` uses the user's text directly as
 * the subject instead of `subtype.prompt`.
 */
export function isCustomSubtype(sub: VehicleSubtype | undefined): boolean {
  return !!sub && sub.id === 'custom'
}

export function getCategory(id: string): VehicleCategory | undefined {
  return VEHICLE_CATEGORIES.find(c => c.id === id)
}

export function getSubtype(categoryId: string, subtypeId: string): VehicleSubtype | undefined {
  return getCategory(categoryId)?.subtypes.find(s => s.id === subtypeId)
}

// ── Styles & eras ────────────────────────────────────────────────────

export interface StyleOption { id: string; label: string; prompt: string }
export interface EraOption { id: string; label: string; prompt: string }

export const VEHICLE_STYLES: StyleOption[] = [
  { id: 'pixel', label: '像素风', prompt: 'pixel art style, crisp pixel edges, limited palette' },
  { id: 'cartoon', label: '卡通', prompt: 'cartoon style, bold outlines, bright colors, playful proportions' },
  { id: 'realistic', label: '写实', prompt: 'realistic detailed rendering, photorealistic materials' },
  { id: 'cyberpunk', label: '赛博朋克', prompt: 'cyberpunk style, neon glow, dark metallic, holographic accents' },
  { id: 'steampunk', label: '蒸汽朋克', prompt: 'steampunk style, brass gears, pipes, Victorian mechanical aesthetic' },
  { id: 'military', label: '军事写实', prompt: 'military realistic style, camouflage, weathered metal, tactical markings' },
  { id: 'lowpoly', label: 'Low-Poly', prompt: 'low-poly 3D style, flat shading, geometric facets, clean edges' },
  { id: 'chibi', label: 'Q版', prompt: 'chibi / super-deformed style, cute small proportions, oversized features' },
]

export const VEHICLE_ERAS: EraOption[] = [
  { id: 'ancient', label: '古代', prompt: 'ancient era, wood and stone construction, animal-drawn' },
  { id: 'medieval', label: '中世纪', prompt: 'medieval era, iron-reinforced wood, siege engineering' },
  { id: 'industrial', label: '工业革命', prompt: 'industrial revolution era, steam-powered, early machinery' },
  { id: 'modern', label: '现代', prompt: 'modern era, contemporary technology and design' },
  { id: 'near-future', label: '近未来', prompt: 'near-future, advanced technology, sleek aerodynamic design' },
  { id: 'far-future', label: '远未来', prompt: 'far-future, alien technology, energy-based propulsion, exotic materials' },
]

// ── Animation states (per category) ──────────────────────────────────

export interface VehicleAnimation {
  id: string
  label: string
  framesPerView: number
  /** Override frame count for side-only (left/right) view modes */
  framesPerViewSide?: number
  looping: boolean
  expandFactor?: number
  /** When true, generate a single-frame multi-view state sheet instead of an animation sequence */
  staticState?: boolean
  motion: string
  /** Which category IDs this animation applies to; empty = all */
  appliesTo: string[]
}

export function getEffectiveFrameCount(anim: VehicleAnimation, viewMode: ViewMode): number {
  if (viewMode.id === 'side-only' && anim.framesPerViewSide != null) {
    return anim.framesPerViewSide
  }
  return anim.framesPerView
}

export const VEHICLE_ANIMATIONS: VehicleAnimation[] = [
  // -- Universal --
  {
    id: 'idle',
    label: '待机 (Idle)',
    framesPerView: 3,
    framesPerViewSide: 2,
    looping: true,
    motion:
      '3-frame idle loop. The vehicle is stationary with the engine running.\n' +
      '  Frame 1: Neutral resting position, very slight upward shift (engine vibration).\n' +
      '  Frame 2: Default resting position.\n' +
      '  Frame 3: Very slight downward shift.\n' +
      'Extremely subtle movement — only engine vibration is visible. The vehicle does NOT move from its position.',
    appliesTo: [],
  },
  {
    id: 'move',
    label: '行驶 (Move)',
    framesPerView: 4,
    framesPerViewSide: 3,
    looping: true,
    expandFactor: 1.2,
    motion:
      '4-frame movement cycle. The vehicle is moving forward at cruising speed.\n' +
      '  Frame 1: Wheels/tracks in position A.\n' +
      '  Frame 2: Wheels/tracks rotate to position B. Slight body tilt from motion.\n' +
      '  Frame 3: Wheels/tracks in position C. Continued forward lean.\n' +
      '  Frame 4: Wheels/tracks in position D, returning toward A. Completes the cycle.\n' +
      'The vehicle body stays at the same height. Only wheels/tracks/propellers animate.\n' +
      'NO exhaust, NO wake, NO speed lines, NO motion blur — vehicle body ONLY.',
    appliesTo: [],
  },
  {
    id: 'boost',
    label: '加速 (Boost)',
    framesPerView: 3,
    framesPerViewSide: 2,
    looping: false,
    expandFactor: 1.3,
    motion:
      '3-frame boost/turbo activation.\n' +
      '  Frame 1: Vehicle tilts slightly backward, preparing to accelerate.\n' +
      '  Frame 2: Full boost — body leans forward aggressively, compressed posture.\n' +
      '  Frame 3: Peak speed pose, maximum forward lean.\n' +
      'Show clear acceleration through BODY POSTURE only. NO exhaust flames, NO jet trails, NO speed lines.',
    appliesTo: [],
  },
  {
    id: 'brake',
    label: '制动 (Brake)',
    framesPerView: 3,
    framesPerViewSide: 2,
    looping: false,
    expandFactor: 1.3,
    motion:
      '3-frame braking sequence.\n' +
      '  Frame 1: Moving, start of deceleration — front dips down.\n' +
      '  Frame 2: Heavy braking — front compressed, rear lifts.\n' +
      '  Frame 3: Coming to rest — vehicle levels out.\n' +
      'Show weight transfer through body posture. NO sparks, NO skid marks, NO dust/smoke.',
    appliesTo: ['ground', 'scifi'],
  },
  // -- Combat --
  {
    id: 'fire',
    label: '开火 (Fire)',
    framesPerView: 3,
    framesPerViewSide: 2,
    looping: false,
    expandFactor: 1.3,
    motion:
      '3-frame firing sequence — VEHICLE BODY ONLY.\n' +
      '  Frame 1: Weapon barrel raised/extended, aimed position.\n' +
      '  Frame 2: Recoil posture — barrel kicked back, vehicle body jolts backward.\n' +
      '  Frame 3: Recovery — returning to neutral position.\n' +
      '⚠️ CRITICAL: Draw ONLY the vehicle. NO projectiles, NO muzzle flashes, NO smoke, NO bullet trails.\n' +
      'Express firing purely through vehicle body posture and weapon barrel position.',
    appliesTo: [],
  },
  {
    id: 'damaged',
    label: '受损 (Damaged)',
    framesPerView: 3,
    framesPerViewSide: 3,
    looping: true,
    motion:
      'IN-PLACE damaged-state loop — the vehicle body stays absolutely still in the same damaged pose.\n' +
      'Damage baseline (identical across all frames):\n' +
      '  • Dents, scratches, cracked panels, bent metal ON the vehicle body.\n' +
      '  • Paint chipped, surface worn, minor structural deformation.\n' +
      '  • Vehicle silhouette remains recognizable and does NOT move, tilt, or shift between frames.\n' +
      'Between-frame variation (ONLY these tiny on-body VFX change — nothing else):\n' +
      '  • A small puff of light smoke rising from a damaged panel — different shape per frame.\n' +
      '  • Occasional flickering sparks on damaged wiring/edges — different positions per frame.\n' +
      '  • Subtle glow inside broken panels — flickers intensity per frame.\n' +
      '⚠️ VEHICLE BODY IS 100% STATIONARY between frames. Only the smoke/spark specks differ.\n' +
      '⚠️ All VFX must stay WITHIN or DIRECTLY ON the vehicle outline — no large smoke clouds, no floating debris outside the body.',
    appliesTo: [],
  },
  {
    id: 'destroyed',
    label: '摧毁 (Destroyed)',
    framesPerView: 3,
    framesPerViewSide: 3,
    looping: true,
    motion:
      'IN-PLACE destroyed-state loop — the wreckage stays absolutely still in the same collapsed pose.\n' +
      'Wreckage baseline (identical across all frames):\n' +
      '  • Collapsed structure, panels cracked and separated.\n' +
      '  • Charred/crushed remains, heavy deformation, parts detached but still within the vehicle outline.\n' +
      '  • Wreckage pose does NOT move, rotate, or shift between frames.\n' +
      'Between-frame variation (ONLY these tiny on-body VFX change — nothing else):\n' +
      '  • Thin smoke wisps rising from charred panels — different shape per frame.\n' +
      '  • Faint ember glow flickering inside cracks — different brightness per frame.\n' +
      '  • Small sparks from exposed wiring — different positions per frame.\n' +
      '⚠️ WRECKAGE IS 100% STATIONARY between frames. Only smoke/embers/sparks differ.\n' +
      '⚠️ All VFX must stay WITHIN or DIRECTLY ON the wreckage outline — no big fireballs, no large smoke clouds, no floating debris outside the body.',
    appliesTo: [],
  },
  // -- Category-specific --
  {
    id: 'tilt',
    label: '倾斜 (Tilt)',
    framesPerView: 3,
    framesPerViewSide: 2,
    looping: false,
    expandFactor: 1.3,
    motion:
      '3-frame banking/tilting maneuver for aerial vehicles.\n' +
      '  Frame 1: Level flight, neutral position.\n' +
      '  Frame 2: Banking — wings tilted, body angled in the direction of turn.\n' +
      '  Frame 3: Return to level, slight overshoot then settle.\n' +
      'Smooth banking animation.',
    appliesTo: ['air'],
  },
  {
    id: 'takeoff',
    label: '起飞 (Takeoff)',
    framesPerView: 4,
    framesPerViewSide: 3,
    looping: false,
    expandFactor: 1.5,
    motion:
      '4-frame takeoff sequence.\n' +
      '  Frame 1: On the ground, engines powering up.\n' +
      '  Frame 2: Lifting off — slight gap between vehicle and ground.\n' +
      '  Frame 3: Ascending — vehicle clearly airborne, gaining altitude.\n' +
      '  Frame 4: Full flight — stable at cruise altitude.\n' +
      'Show clear ground-to-air transition.',
    appliesTo: ['air'],
  },
  {
    id: 'landing',
    label: '降落 (Landing)',
    framesPerView: 4,
    framesPerViewSide: 3,
    looping: false,
    expandFactor: 1.5,
    motion:
      '4-frame landing sequence.\n' +
      '  Frame 1: Approaching — descending toward ground.\n' +
      '  Frame 2: Near touchdown — landing gear deployed, very close to ground.\n' +
      '  Frame 3: Touchdown — contact with ground, suspension compresses.\n' +
      '  Frame 4: Settled — fully on ground, engines powering down.\n' +
      'Show clear air-to-ground transition.',
    appliesTo: ['air'],
  },
  {
    id: 'submerge',
    label: '潜航 (Submerge)',
    framesPerView: 3,
    framesPerViewSide: 2,
    looping: false,
    expandFactor: 1.3,
    motion:
      '3-frame submersion — VEHICLE BODY ONLY.\n' +
      '  Frame 1: Full vehicle visible, angled slightly nose-down.\n' +
      '  Frame 2: Lower half of vehicle cropped/hidden (below imaginary waterline).\n' +
      '  Frame 3: Only top portion visible, rest below waterline.\n' +
      '⚠️ CRITICAL: NO water, NO waves, NO bubbles, NO splash effects. Show submersion by progressively hiding lower parts of the vehicle.',
    appliesTo: ['water'],
  },
]

export function getAnimationsForCategory(categoryId: string): VehicleAnimation[] {
  return VEHICLE_ANIMATIONS.filter(a =>
    a.appliesTo.length === 0 || a.appliesTo.includes(categoryId),
  )
}

export function getAnimation(id: string): VehicleAnimation | undefined {
  return VEHICLE_ANIMATIONS.find(a => a.id === id)
}

// ── Mirror pairs ──────────────────────────────────────────────────────

const MIRROR_PAIRS: [VehicleView, VehicleView][] = [
  ['left', 'right'],
  ['iso-nw', 'iso-ne'],
  ['iso-sw', 'iso-se'],
]

const MIRROR_TARGETS = new Set(MIRROR_PAIRS.map(([, tgt]) => tgt))

/**
 * Return only the views that need AI generation (exclude mirror-derivable views).
 * e.g. four-dir [front,left,right,back] → [front,left,back]
 *      side-only [left,right] → [left]
 *      isometric [iso-nw,iso-ne,iso-sw,iso-se] → [iso-nw,iso-sw]
 */
export function getUniqueViews(viewMode: ViewMode): VehicleView[] {
  return viewMode.views.filter(v => !MIRROR_TARGETS.has(v))
}

/**
 * Return mirror pairs applicable to this view mode.
 * e.g. four-dir → Map { left → right }
 *      isometric → Map { iso-nw → iso-ne, iso-sw → iso-se }
 */
export function getMirrorMap(viewMode: ViewMode): Map<VehicleView, VehicleView> {
  const viewSet = new Set(viewMode.views)
  const map = new Map<VehicleView, VehicleView>()
  for (const [src, tgt] of MIRROR_PAIRS) {
    if (viewSet.has(src) && viewSet.has(tgt)) {
      map.set(src, tgt)
    }
  }
  return map
}
