/**
 * gameLayout —— per-game 磁盘布局**唯一真源**（node / build / dev-server 专用）。
 *
 * ⚠️ 本文件 import `node:path`，**不可被浏览器 bundle 引用**。浏览器侧走 HTTP 路由
 *    （`/__reel__/...?game=<slug>`），从不直接拼磁盘路径。成品清单的纯类型在
 *    同目录 `reelLevel.ts`（浏览器安全），需要时从那里导入。
 *
 * 目标布局（与主程 + 用户敲定，逐步过渡，不一次性破坏现状）：
 *
 *   .forgeax/games/<slug>/
 *   ├── assets/                       # 干净「成品」：只有要导出的东西
 *   │   ├── ReelLevel.pack.json       # 成品清单（InternalTextPackage，见 reelLevel.ts）
 *   │   └── reel-media/<hash>.<ext>   # 已处理/裁剪后的媒体（如 10s→5s），内容寻址
 *   └── workbench/                    # 所有「原料」：生成历史 / 废弃素材 / 中间数据
 *       ├── reel/                     # 影游对资产的处理数据 + 玩法数据
 *       │   ├── scenarios.json        # 剧本库（PersistedDb 磁盘镜像）
 *       │   ├── versions/<scn>/<v>.json
 *       │   └── *-queue.json          # agent→前端 各类生成队列
 *       ├── image/  video/  audio/    # 素材生成模块产出的原始媒体（含 manifest.json）
 *       └── model3d/ texture/ ...      # 游戏 2D/3D 资产
 *
 * 红线：几个主文件夹**不重复复制资产**——原始媒体只存 workbench/<kind>/，其他文件夹
 *       （含 assets/）只引用；assets/reel-media 里放的是**处理过的成品副本**，是有意
 *       的另一份（裁剪/转码后），不是对原始素材的镜像。
 *
 * 现状（迁移前）对照，供 phase1-migrate / 向后兼容读取使用：
 *   - 原始媒体：     games/<slug>/reel/assets/        → 迁到 workbench/<kind>/
 *   - 剧本/队列：     games/<slug>/reel/               → 迁到 workbench/reel/
 *   - 全局兜底库：    <pkgRoot>/.reel-assets、.reel-scenarios（将被去除回退）
 */

import { resolve } from 'node:path'

// ── 目录名常量（唯一真源，禁止各处再写字面量）────────────────────────────────

/** game 根下「成品」目录名。 */
export const ASSETS_DIR = 'assets'
/** game 根下「原料」目录名。 */
export const WORKBENCH_DIR = 'workbench'
/** workbench 下影游处理/玩法数据目录名（剧本库 + 队列）。 */
export const WORKBENCH_REEL_SUBDIR = 'reel'
/** 成品目录内的已处理媒体子目录（与 buildReelGameAsset 改写的 `./reel-media/` 对齐）。 */
export const REEL_MEDIA_SUBDIR = 'reel-media'

/** workbench 下按素材类型分桶的目录名（原始媒体落地）。host 可扩展。 */
export const WORKBENCH_MEDIA_KINDS = [
  'image',
  'video',
  'audio',
  'model3d',
  'texture',
  'character',
  'bgm',
] as const
export type WorkbenchMediaKind = (typeof WORKBENCH_MEDIA_KINDS)[number]

// ── 旧布局常量（迁移读取 / 兼容用，迁完即弃）──────────────────────────────────

/** 旧：影游处理数据与队列都堆在 `games/<slug>/reel/`。 */
export const LEGACY_REEL_SUBDIR = 'reel'
/** 旧：原始媒体堆在 `games/<slug>/reel/assets/`。 */
export const LEGACY_REEL_ASSETS_SUBDIR = 'assets'
/** 旧：包内全局媒体库目录名（无 slug 兜底）。 */
export const LEGACY_GLOBAL_ASSETS_DIR = '.reel-assets'
/** 旧：包内全局剧本库目录名（无 slug 兜底）。 */
export const LEGACY_GLOBAL_SCENARIOS_DIR = '.reel-scenarios'

/**
 * game slug 兜底正则——与 host/server 的 `GAME_SLUG_RE`、vite.config 内联副本对齐，
 * 禁路径穿越。唯一真源放这里，调用方一律 import 本常量，避免多处漂移。
 */
export const GAME_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

/** slug 是否合法。 */
export function isValidGameSlug(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && GAME_SLUG_RE.test(slug)
}

// ── 新布局路径解析（projectRoot = 含 `.forgeax/games` 的工程根）────────────────

/** `.forgeax/games` 容器目录。 */
export function gamesContainerDir(projectRoot: string): string {
  return resolve(projectRoot, '.forgeax', 'games')
}

/** 单个 game 根：`.forgeax/games/<slug>`。 */
export function gameDir(projectRoot: string, slug: string): string {
  return resolve(gamesContainerDir(projectRoot), slug)
}

/** 成品目录：`<game>/assets`。 */
export function assetsDir(projectRoot: string, slug: string): string {
  return resolve(gameDir(projectRoot, slug), ASSETS_DIR)
}

/** 成品清单：`<game>/assets/ReelLevel.pack.json`。 */
export function reelLevelManifestPath(projectRoot: string, slug: string): string {
  // 文件名常量来自 reelLevel.ts，避免与契约类型脱钩——这里内联同名常量以保持
  // 本模块「无浏览器不安全依赖外」零额外耦合。
  return resolve(assetsDir(projectRoot, slug), 'ReelLevel.pack.json')
}

/** 成品已处理媒体目录：`<game>/assets/reel-media`。 */
export function reelMediaDir(projectRoot: string, slug: string): string {
  return resolve(assetsDir(projectRoot, slug), REEL_MEDIA_SUBDIR)
}

/** 原料根：`<game>/workbench`。 */
export function workbenchDir(projectRoot: string, slug: string): string {
  return resolve(gameDir(projectRoot, slug), WORKBENCH_DIR)
}

/** 影游处理/玩法数据目录：`<game>/workbench/reel`（剧本库 + 队列落这里）。 */
export function workbenchReelDir(projectRoot: string, slug: string): string {
  return resolve(workbenchDir(projectRoot, slug), WORKBENCH_REEL_SUBDIR)
}

/** 某类原始素材目录：`<game>/workbench/<kind>`。 */
export function workbenchMediaDir(
  projectRoot: string,
  slug: string,
  kind: WorkbenchMediaKind,
): string {
  return resolve(workbenchDir(projectRoot, slug), kind)
}

// ── 旧布局路径解析（迁移源 / 兼容读取）────────────────────────────────────────

/** 旧影游数据目录：`<game>/reel`。 */
export function legacyReelDir(projectRoot: string, slug: string): string {
  return resolve(gameDir(projectRoot, slug), LEGACY_REEL_SUBDIR)
}

/** 旧原始媒体目录：`<game>/reel/assets`。 */
export function legacyReelAssetsDir(projectRoot: string, slug: string): string {
  return resolve(legacyReelDir(projectRoot, slug), LEGACY_REEL_ASSETS_SUBDIR)
}
