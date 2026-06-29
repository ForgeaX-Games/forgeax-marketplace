/**
 * Tier3 叙事点缀型品类预设（叙事占比 15-40%）
 * 卡牌构筑 / Roguelike / 2D 横版 / 塔防
 *
 * TODO: 在此将 skills/tier3/presets/*.md 中的叙事模式和规则
 *       编译为可在 pipeline 中直接调用的运行时配置。
 */

export type Tier3Genre =
  | "card-game"
  | "roguelike"
  | "platformer"
  | "tower-defense";

export interface Tier3GenreKeyword {
  keywords: string[];
  genre: Tier3Genre;
}

export interface Tier3PipelineConfig {
  genre: Tier3Genre;
  /** 精简管线 Phase 1→2（精简），Phase 4 仅核心文案 */
  simplifiedPipeline: true;
  /** 世界观最大字数建议 */
  maxWorldviewWords: number;
  /** 角色设定每角色最大字数 */
  maxCharacterWords: number;
  /** 是否需要循环叙事设计（Roguelike 专有） */
  requiresLoopNarrative: boolean;
  /** 主要文案需求类型 */
  primaryCopyType: "item-lore" | "ui-copy" | "event-text" | "environment";
}

export const TIER3_GENRE_KEYWORDS: Tier3GenreKeyword[] = [
  {
    keywords: [
      "卡牌构筑",
      "deck building",
      "肉鸽卡牌",
      "tcg",
      "杀戮尖塔",
      "slay the spire",
      "怪物火车",
    ],
    genre: "card-game",
  },
  {
    keywords: [
      "roguelike",
      "roguelite",
      "随机地牢",
      "肉鸽",
      "哈迪斯",
      "以撒",
      "死亡细胞",
      "挺进地牢",
      "元气骑士",
    ],
    genre: "roguelike",
  },
  {
    keywords: [
      "2d横版",
      "平台跳跃",
      "platformer",
      "metroidvania",
      "类银河战士",
      "横版动作",
      "空洞骑士",
      "蔚蓝",
    ],
    genre: "platformer",
  },
  {
    keywords: [
      "塔防",
      "tower defense",
      "保卫萝卜",
      "植物大战僵尸",
      "王国保卫战",
      "bloons",
    ],
    genre: "tower-defense",
  },
];

export const TIER3_PIPELINE_CONFIGS: Record<Tier3Genre, Tier3PipelineConfig> = {
  "card-game": {
    genre: "card-game",
    simplifiedPipeline: true,
    maxWorldviewWords: 300,
    maxCharacterWords: 100,
    requiresLoopNarrative: false,
    primaryCopyType: "item-lore",
  },
  roguelike: {
    genre: "roguelike",
    simplifiedPipeline: true,
    maxWorldviewWords: 400,
    maxCharacterWords: 150,
    requiresLoopNarrative: true,
    primaryCopyType: "event-text",
  },
  platformer: {
    genre: "platformer",
    simplifiedPipeline: true,
    maxWorldviewWords: 400,
    maxCharacterWords: 150,
    requiresLoopNarrative: false,
    primaryCopyType: "environment",
  },
  "tower-defense": {
    genre: "tower-defense",
    simplifiedPipeline: true,
    maxWorldviewWords: 200,
    maxCharacterWords: 80,
    requiresLoopNarrative: false,
    primaryCopyType: "ui-copy",
  },
};

/**
 * 根据用户输入文本识别 Tier 3 品类
 */
export function matchTier3Genre(input: string): Tier3Genre | null {
  const lower = input.toLowerCase();
  for (const entry of TIER3_GENRE_KEYWORDS) {
    if (entry.keywords.some((k) => lower.includes(k))) {
      return entry.genre;
    }
  }
  return null;
}

/**
 * 获取 Tier 3 品类的管线配置
 */
export function getTier3Config(genre: Tier3Genre): Tier3PipelineConfig {
  return TIER3_PIPELINE_CONFIGS[genre];
}
