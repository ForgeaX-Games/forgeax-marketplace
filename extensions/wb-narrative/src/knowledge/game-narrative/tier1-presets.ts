/**
 * Tier1 叙事驱动型品类预设（叙事占比 70-95%）
 * 视觉小说 / 互动叙事 / JRPG / CRPG / 开放世界 RPG
 *
 * TODO: 在此将 skills/tier1/presets/*.md 中的叙事模式和规则
 *       编译为可在 pipeline 中直接调用的运行时配置。
 */

export type Tier1Genre =
  | "visual-novel"
  | "interactive-drama"
  | "jrpg"
  | "crpg"
  | "open-world-rpg";

export interface Tier1GenreKeyword {
  keywords: string[];
  genre: Tier1Genre;
}

export interface Tier1PipelineConfig {
  genre: Tier1Genre;
  /** 是否启动完整 Phase 1→2→4→5 */
  fullPipeline: true;
  /** Agency 规划是否必须 */
  requiresAgencyPlanning: boolean;
  /** 是否需要数据卫生规则 */
  requiresDataHygiene: boolean;
  /** 推荐的世界观深度 */
  worldviewDepth: "full" | "modular";
  /** 主线章节制还是网状 */
  storyStructure: "linear" | "branching" | "open-world";
}

export const TIER1_GENRE_KEYWORDS: Tier1GenreKeyword[] = [
  {
    keywords: ["视觉小说", "avg", "文字冒险", "galgame", "恋爱avg", "galge"],
    genre: "visual-novel",
  },
  {
    keywords: [
      "互动叙事",
      "互动电影",
      "分支故事",
      "互动小说",
      "choice-based",
      "底特律",
      "隐形守护者",
    ],
    genre: "interactive-drama",
  },
  {
    keywords: [
      "jrpg",
      "日式rpg",
      "回合制rpg",
      "atb",
      "仙侠rpg",
      "武侠rpg",
      "最终幻想",
      "女神异闻录",
      "仙剑",
    ],
    genre: "jrpg",
  },
  {
    keywords: [
      "crpg",
      "wrpg",
      "西式rpg",
      "博德之门",
      "神界原罪",
      "辐射",
      "异域镇魂曲",
      "disco elysium",
    ],
    genre: "crpg",
  },
  {
    keywords: [
      "开放世界rpg",
      "开放世界",
      "仙侠",
      "武侠",
      "原神",
      "塞尔达",
      "上古卷轴",
      "太吾绘卷",
    ],
    genre: "open-world-rpg",
  },
];

export const TIER1_PIPELINE_CONFIGS: Record<Tier1Genre, Tier1PipelineConfig> = {
  "visual-novel": {
    genre: "visual-novel",
    fullPipeline: true,
    requiresAgencyPlanning: true,
    requiresDataHygiene: true,
    worldviewDepth: "full",
    storyStructure: "branching",
  },
  "interactive-drama": {
    genre: "interactive-drama",
    fullPipeline: true,
    requiresAgencyPlanning: true,
    requiresDataHygiene: true,
    worldviewDepth: "full",
    storyStructure: "branching",
  },
  jrpg: {
    genre: "jrpg",
    fullPipeline: true,
    requiresAgencyPlanning: false,
    requiresDataHygiene: true,
    worldviewDepth: "full",
    storyStructure: "linear",
  },
  crpg: {
    genre: "crpg",
    fullPipeline: true,
    requiresAgencyPlanning: true,
    requiresDataHygiene: true,
    worldviewDepth: "full",
    storyStructure: "branching",
  },
  "open-world-rpg": {
    genre: "open-world-rpg",
    fullPipeline: true,
    requiresAgencyPlanning: false,
    requiresDataHygiene: true,
    worldviewDepth: "modular",
    storyStructure: "open-world",
  },
};

/**
 * 根据用户输入文本识别 Tier 1 品类
 */
export function matchTier1Genre(input: string): Tier1Genre | null {
  const lower = input.toLowerCase();
  for (const entry of TIER1_GENRE_KEYWORDS) {
    if (entry.keywords.some((k) => lower.includes(k))) {
      return entry.genre;
    }
  }
  return null;
}

/**
 * 获取 Tier 1 品类的管线配置
 */
export function getTier1Config(genre: Tier1Genre): Tier1PipelineConfig {
  return TIER1_PIPELINE_CONFIGS[genre];
}
