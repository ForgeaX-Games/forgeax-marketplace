/**
 * 载具的「概念设计图」分类与风格词表。
 *
 * 这是 wb-anim/pipelines/vehicle-design/vehicle-types.ts 的精简子集——只保
 * 留 wb-character 在「角色设计」表单里画 chip 组、拼 prompt 需要的数据：
 *
 *   - VEHICLE_CATEGORIES：5 大类 × N 个子类型，每个子类型自带英文 prompt 片段
 *   - VEHICLE_STYLES：8 种美术风格
 *   - VEHICLE_ERAS：6 种时代设定
 *
 * 不包含视角模式 / 动画状态 / 镜像配对——那些都属于「动画产线」字段，由
 * 下游 wb-anim/vehicle-design 接管。这里只负责「这是个什么样的载具」。
 *
 * 与 wb-anim 那边的字段保持名字与 id 完全一致（category id、subtype id、
 * style id、era id），下游的 vehicle-design 可以直接消费 wb-character 写
 * 进 character.json 里的载具 profile，不需要二次映射。
 */

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

export function getVehicleCategory(id: string | undefined | null): VehicleCategory | undefined {
  if (!id) return undefined
  return VEHICLE_CATEGORIES.find(c => c.id === id)
}

export function getVehicleSubtype(categoryId: string | undefined | null, subtypeId: string | undefined | null): VehicleSubtype | undefined {
  if (!categoryId || !subtypeId) return undefined
  return getVehicleCategory(categoryId)?.subtypes.find(s => s.id === subtypeId)
}

export function isCustomVehicleSubtype(sub: VehicleSubtype | undefined): boolean {
  return !!sub && sub.id === 'custom'
}

export function getVehicleStyle(id: string | undefined | null): StyleOption | undefined {
  if (!id) return undefined
  return VEHICLE_STYLES.find(s => s.id === id)
}

export function getVehicleEra(id: string | undefined | null): EraOption | undefined {
  if (!id) return undefined
  return VEHICLE_ERAS.find(e => e.id === id)
}
