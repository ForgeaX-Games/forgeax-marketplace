/**
 * registry-types —— 游戏级共享素材层的**类型 SSOT**（浏览器安全，零依赖 · 无 node:fs）。
 *
 * 素材层数据落在 `.forgeax/games/<slug>/assets/`：
 *   - `manifest.json` = { version, assets: MediaAsset[] }（唯一写方 = wb-game-video）
 *   - `media/<id>.<ext>` = wb-game-video **自产**的图/视频二进制
 *
 * 前端（media.ts / GraphVideoView）与后端（server/asset-registry.ts + generation）都
 * 从本文件取类型：前端负责渲染/轮询，后端负责 fs CRUD。跨模块产物（人设图/场景图）
 * **只读引用**，文件仍在对方目录、不复制进本 registry（externalPath 指回原路径）。
 */

/** 资产的存储类别（对齐 NodeMedia.kind 的大类）。 */
export type MediaKind = 'image' | 'video'

/**
 * 资产用途（决定它在生成管线里的角色）——判断"这条资产是什么"永远看 productionType：
 *   - character_ref / scene_ref：**跨模块只读输入**（人设图 / 场景图），当视频参考图。
 *   - shot_image：wb-game-video 自产的分镜图 / 关键帧。
 *   - grid_storyboard：wb-game-video 自产的 6 面板黑白 previs 故事板（关键帧的可选替代分支）。
 *   - video_clip：wb-game-video 自产的成片视频（node.data.media.ref 指它）。
 */
export type MediaProductionType =
  | 'character_ref'
  | 'scene_ref'
  | 'shot_image'
  | 'grid_storyboard'
  | 'video_clip'

/** 生成生命周期。placeholder = 已占位未生成；generating = 生成中；ready = 就绪；failed = 失败。 */
export type MediaStatus = 'placeholder' | 'generating' | 'ready' | 'failed'

export interface MediaAsset {
  id: string
  kind: MediaKind
  productionType: MediaProductionType
  status: MediaStatus
  /** 展示名（缺省由 productionType + id 兜底）。 */
  label?: string
  /** 生成用/记录用 prompt。 */
  prompt?: string
  /**
   * 自产资产：相对 `assets/` 根的磁盘路径（如 `media/a-xxx.mp4`）。就绪后必有。
   * 播放 URL 由前端 resolveMediaSrc → `/__gva__/media/<id>` 派生，不直接暴露磁盘路径。
   */
  file?: string
  /**
   * 稳定可播放访问地址（D8 目标态）：一旦上传能力就绪，成片以稳定 `url` 登记，
   * 播放优先用它（`resolveMediaSrc` 见 media.ts 优先序）；在此之前为空，回落 D9 兜底
   * （zhandou basename / 本地 `/__gva__/media/<id>` 流）。graph/blueprint 只挂 id，URL 只住 manifest。
   */
  url?: string
  /** 跨模块只读产物：对方文件的绝对磁盘路径（**不复制**进本 registry 的 media/）。 */
  externalPath?: string
  /** 归属的演出节点 id（GameGraph node.id）；跨模块 ref 可空。 */
  sceneNodeId?: string
  /** 产出来源：'wb-game-video' | 'wb-character' | '<scene-module>' 等。 */
  sourceModule?: string
  mime?: string
  bytes?: number
  /** 视频时长（ms）。 */
  durationMs?: number
  /** status=failed 时的可读原因。 */
  error?: string
  createdAt: number
  updatedAt: number
  /** 其它元信息（如 refIds / seed / model / keyframeRole 等）。 */
  meta?: Record<string, unknown>
}

/**
 * 风格三轴（wb-reel）—— 游戏级默认，node 可覆盖。
 * 字段是各轴的 id 字符串（保持 registry-types 零依赖，不引 engine 的 VisualStyle/FilmLook/DirectorStyleId union）；
 * orchestrate 侧的 engine/axes.ts 负责把这些 id 收敛成合法 union 并组合成 prompt。
 *   - artMedia：渲染媒介（photoreal/anime/ink/...，wb-reel art-media 轴）
 *   - director：导演流派（minimal-epic/precision-noir/...，wb-reel directors 轴）
 *   - filmLook：电影调色（teal-orange/noir-lowkey/...，wb-reel film-looks 轴）
 */
export interface StyleAxes {
  artMedia?: string
  director?: string
  filmLook?: string
}

/** manifest.json 顶层容器。 */
export interface AssetManifest {
  version: 1
  assets: MediaAsset[]
  /** 游戏级风格三轴默认（可选）；缺省=各轴不加。 */
  styleAxes?: StyleAxes
}

/** 前端渲染友好的轻量视图（列表/卡片用）。 */
export interface AssetListItem {
  id: string
  kind: MediaKind
  productionType: MediaProductionType
  status: MediaStatus
  label?: string
  sceneNodeId?: string
  durationMs?: number
  bytes?: number
  mime?: string
}

/** 生成一个稳定短 id（自产资产用）；纯函数、浏览器/服务端通用。 */
export function makeAssetId(productionType: MediaProductionType): string {
  const tag =
    productionType === 'video_clip'
      ? 'vid'
      : productionType === 'shot_image'
        ? 'img'
        : productionType === 'grid_storyboard'
          ? 'grid'
          : productionType === 'character_ref'
            ? 'char'
            : 'scene'
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `a-${tag}-${t}-${r}`
}

/** MediaAsset → 轻量视图。 */
export function toListItem(a: MediaAsset): AssetListItem {
  return {
    id: a.id,
    kind: a.kind,
    productionType: a.productionType,
    status: a.status,
    label: a.label,
    sceneNodeId: a.sceneNodeId,
    durationMs: a.durationMs,
    bytes: a.bytes,
    mime: a.mime,
  }
}
