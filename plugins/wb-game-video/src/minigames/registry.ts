/**
 * 小游戏注册表
 *
 * 每个小游戏 = 一个独立的 iframe 可加载的 HTML 入口：
 *   - Dev 时由 `reelMinigamesPlugin`（见 vite.config.ts）把
 *     `src/minigames/<id>/<entry>.html` serve 到 `/__minigames/<id>/<entry>.html`
 *   - 小游戏通过 `postMessage` 与宿主页面通信：
 *       { source: 'reel-minigame', id, type: 'minigame-ready' | 'minigame-win' | 'minigame-lose' | 'minigame-continue', ... }
 *
 * 宿主（Player / Timeline）按 `type` 推进：
 *   - `minigame-win`     → QTE pass 分支（或 fallback 继续播放）
 *   - `minigame-lose`    → QTE fail 分支
 *   - `minigame-continue`→ 玩家在胜利画面点"继续剧情"（显式推进）
 *
 * 故意极简：只是一张 id→url 表 + 展示元数据，没有 lazy / bundler 魔法。
 * 后续如果要做线上部署，把 URL 换成 CDN 即可，不动上层代码。
 */

export interface MinigameDescriptor {
  /** 稳定 id（用于 QTE cue 里记录，数据迁移时追着它走） */
  id: string
  /** 展示名 */
  title: string
  /** iframe src（已带 `?embed=1`） */
  src: string
  /** 一句话简介，UI 上作为 tooltip / 列表副文案 */
  blurb: string
  /** 难度/类型标签，TimelineDock 列表用 */
  tag?: string
  /** 默认占位时长（ms），拖到时间轴时作为该 cue 块的 widthMs 默认值 */
  defaultDurationMs: number
}

const embed = (path: string): string => `/__minigames/${path}?embed=1`

export const MINIGAMES: MinigameDescriptor[] = [
  {
    id: 'magical-witch-platformer-1',
    title: '平台跳跃',
    src: embed('magical-witch/game.html'),
    blurb: '短关卡：跑到终点金旗即通关；3 次被击则失败。',
    tag: '平台跳跃',
    defaultDurationMs: 45_000,
  },
  // 预留：Boss 战
  // {
  //   id: 'magical-witch-boss',
  //   title: '魔女跳跃 · Boss 战',
  //   src: embed('magical-witch/boss.html'),
  //   blurb: '打败女巫 Boss 方可推进。',
  //   tag: 'BOSS',
  //   defaultDurationMs: 60_000,
  // },
  {
    id: 'placeholder-rhythm',
    title: '节奏点击（占位）',
    src: embed('placeholder/rhythm.html'),
    blurb: '占位小游戏：跟随节拍点击。正式数据后续上传。',
    tag: '节奏',
    defaultDurationMs: 30_000,
  },
  {
    id: 'placeholder-puzzle',
    title: '解谜拼图（占位）',
    src: embed('placeholder/puzzle.html'),
    blurb: '占位小游戏：拼合碎片解谜。正式数据后续上传。',
    tag: '解谜',
    defaultDurationMs: 40_000,
  },
  {
    id: 'placeholder-runner',
    title: '跑酷冲刺（占位）',
    src: embed('placeholder/runner.html'),
    blurb: '占位小游戏：躲避障碍冲向终点。正式数据后续上传。',
    tag: '跑酷',
    defaultDurationMs: 35_000,
  },
]

export function getMinigame(id: string): MinigameDescriptor | null {
  return MINIGAMES.find((m) => m.id === id) ?? null
}
