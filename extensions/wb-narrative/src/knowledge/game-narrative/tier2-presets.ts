/**
 * Tier2 叙事增强型品类预设（叙事占比 40-70%）
 * 抽卡 RPG / ARPG / MMORPG / 战棋 RPG / 模拟经营
 *
 * TODO: 在此将 skills/tier2/presets/*.md 中的叙事模式和规则
 *       编译为可在 pipeline 中直接调用的运行时配置。
 */

export type Tier2Genre =
  | "gacha-rpg"
  | "arpg"
  | "mmorpg"
  | "srpg"
  | "simulation";

export interface Tier2GenreKeyword {
  keywords: string[];
  genre: Tier2Genre;
}

export interface Tier2PipelineConfig {
  genre: Tier2Genre;
  /** 标准管线 Phase 1→2→4，Phase 5 按需 */
  standardPipeline: true;
  /** 是否需要系统叙事接口文档 */
  requiresSystemInterface: boolean;
  /** 是否有长线运营叙事需求 */
  isLiveService: boolean;
  /** 世界观是否需要模块化设计（支持长期扩展） */
  modularWorldview: boolean;
  /** 主要叙事载体 */
  primaryNarrativeVehicle: "character" | "environment" | "combat" | "daily";
}

export const TIER2_GENRE_KEYWORDS: Tier2GenreKeyword[] = [
  {
    keywords: [
      "抽卡rpg",
      "gacha rpg",
      "原神",
      "明日方舟",
      "崩坏",
      "蔚蓝档案",
      "手游rpg",
      "卡牌rpg手游",
    ],
    genre: "gacha-rpg",
  },
  {
    keywords: [
      "arpg",
      "动作rpg",
      "魂类",
      "souls-like",
      "暗黑类",
      "艾尔登法环",
      "巫师",
      "暗黑之魂",
      "哈迪斯",
    ],
    genre: "arpg",
  },
  {
    keywords: [
      "mmorpg",
      "mmo",
      "大型多人在线",
      "网游",
      "ff14",
      "逆水寒",
      "魔兽世界",
    ],
    genre: "mmorpg",
  },
  {
    keywords: [
      "srpg",
      "战棋rpg",
      "trpg",
      "策略rpg",
      "火焰纹章",
      "战棋",
      "三角战略",
      "皇家骑士团",
    ],
    genre: "srpg",
  },
  {
    keywords: [
      "模拟经营",
      "经营类",
      "sim",
      "生活模拟",
      "星露谷",
      "牧场故事",
      "动物森友会",
      "种菜",
      "开店",
    ],
    genre: "simulation",
  },
];

export const TIER2_PIPELINE_CONFIGS: Record<Tier2Genre, Tier2PipelineConfig> = {
  "gacha-rpg": {
    genre: "gacha-rpg",
    standardPipeline: true,
    requiresSystemInterface: true,
    isLiveService: true,
    modularWorldview: true,
    primaryNarrativeVehicle: "character",
  },
  arpg: {
    genre: "arpg",
    standardPipeline: true,
    requiresSystemInterface: false,
    isLiveService: false,
    modularWorldview: false,
    primaryNarrativeVehicle: "environment",
  },
  mmorpg: {
    genre: "mmorpg",
    standardPipeline: true,
    requiresSystemInterface: true,
    isLiveService: true,
    modularWorldview: true,
    primaryNarrativeVehicle: "daily",
  },
  srpg: {
    genre: "srpg",
    standardPipeline: true,
    requiresSystemInterface: false,
    isLiveService: false,
    modularWorldview: false,
    primaryNarrativeVehicle: "combat",
  },
  simulation: {
    genre: "simulation",
    standardPipeline: true,
    requiresSystemInterface: false,
    isLiveService: true,
    modularWorldview: false,
    primaryNarrativeVehicle: "daily",
  },
};

/**
 * 根据用户输入文本识别 Tier 2 品类
 */
export function matchTier2Genre(input: string): Tier2Genre | null {
  const lower = input.toLowerCase();
  for (const entry of TIER2_GENRE_KEYWORDS) {
    if (entry.keywords.some((k) => lower.includes(k))) {
      return entry.genre;
    }
  }
  return null;
}

/**
 * 获取 Tier 2 品类的管线配置
 */
export function getTier2Config(genre: Tier2Genre): Tier2PipelineConfig {
  return TIER2_PIPELINE_CONFIGS[genre];
}
