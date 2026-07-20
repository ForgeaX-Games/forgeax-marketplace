/**
 * 素材生成模块 · 对外可调用边界（subpath: `@forgeax-extension/wb-reel/generation`）。
 *
 * 影游把「素材生成」当成一个可解耦的下游模块来调用：影游(编排器)负责拆角色/场景/道具、
 * 组织参考锚点、决定素材归属哪个 game；本模块只负责「给定提示词 + 参考素材 + 参数
 * → 产出一条媒体候选(返回 mediaId)」。其它工程（如未来的过程动画工程）可从此 subpath
 * 直接复用这些生成原语，而不必依赖影游的剧本/时间轴。
 *
 * charter（Pipeline-Isolation）：这些原语**不读** scenarioStore —— 美术风格(visualStyle)、
 * 项目级视频参数(scenarioVideoConfig)、素材归属(scenarioId) 一律由调用方从各自上下文
 * **显式传入**。凭据(apiKey/apiBase)仍只来自本机 settingsStore，绝不经由参数外泄。
 *
 * 说明：当前这些原语仍会把产物 ingest 进 wb-reel 的 mediaStore（落 assetStore）。若他方
 * 工程要完全脱离 wb-reel 存储层，后续再把「ingest 目的地」抽成依赖注入 —— 本 barrel 是
 * 迈向独立可复用的第一道稳定边界。
 */
export {
  generateCardImage,
  generateCardVideo,
  generateCardAudio,
  runPool,
  cardPromptKind,
} from './assetCardGen'

export type { AssetGenResult, AssetGenMeta, AssetMediaKind } from './assetCardGen'
export type { CardKind } from './assetCards'
export type { GenRequestSnapshot, GenRequestRef } from './generationQueueStore'
