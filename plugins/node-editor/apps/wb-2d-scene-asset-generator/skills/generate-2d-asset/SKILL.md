---
name: generate-2d-asset
description: >-
  Generate 2D scene assets in the ForgeaX 2D Scene Asset Generator (wb-2d-scene-asset-generator)
  by composing pipelines of batteries over the Studio ToolRegistry (asset2d:*). Covers three
  distinct flows: PART A — single object asset DEFAULT DUAL OUTPUT (sprite + collision_mask via
  second ImageGen + CutByMask; prompt → ImageGen → RemoveBG → PixelFix → PixelScale → output,
  plus maskPrompt → ImageGen(512, ref=sprite) → CutByMask → same PixelScale → name_mask);
  PART B — tileset core flow; PART C — whole-building decorative texture only. First clarify
  the request, then build the graph and run each ImageGen node exactly once (PART A = two ImageGens).
trigger: /generate-2d-asset
---

# 生成 2D 资产（节点图管线）· 入口与路由

> **PART A 默认双产出**：每个 object 贴图任务**必须**同时产出 `{name}` + `{name}_mask`，除非用户明确不要。见 [part-a-single-asset.md 顶部铁律](executions/part-a-single-asset.md)。

在「2D 场景资产生成器」（wb-2d-scene-asset-generator）里，通过**摆放电池 + 连线 + 运行**
产出 2D 资产。所有操作走 Studio ToolRegistry 工具（`asset2d:*`），不要手改
`state/graph.json`，不要点 UI 模拟人工。

> **本文件只负责路由 + 每个部分的要点提要。** 拿到需求先**判断走哪套流程**，再打开对应的
> execution 文件按步骤执行；动手前与执行中遇到的通用规则查「注意事项」。**无论哪个 PART，
> 都先问清需求，再搭管线并运行。**

---

## 一、选哪套流程（路由表）

| 你要做的 | 走哪个 PART | 打开 |
|---|---|---|
| 单个物件 / 贴图 / 图标 / UI 件（文生图或图生图，可选抠图/缩放） | **PART A · 单个资产生成** | [executions/part-a-single-asset.md](executions/part-a-single-asset.md) |
| **可无缝平铺的地形瓦片 / Wang-Autotile atlas**（先生大块纹理图，再提取→无缝化→合成 atlas→重命名） | **PART B · Tile 生成核心流程** | [executions/part-b-tileset.md](executions/part-b-tileset.md) |
| **指定形状/轮廓的整栋装饰房屋贴图**（单张 object；房顶/footprint 掩码 → HouseTemplate 灰度底图 → ImageGen） | **PART C · 指定形状的房屋生成** | [executions/part-c-shaped-house.md](executions/part-c-shaped-house.md) |

> PART C = **整栋建筑一张贴图**，与场景模板组「结构化盖楼（内置墙材）」是两条线。只有用户明确要 billboard 级整栋贴图时才路由到 PART C；否则 object → A，tile → B，场景建筑 → compose + 内置素材。
## 二、各 PART 要点提要（先看摘要，再进 execution 文件）

### PART A · 单个资产生成 → [executions/part-a-single-asset.md](executions/part-a-single-asset.md)
- **阶段一问清**：生成什么 / 文生图还是图生图 / 长宽比·像素风还是写实·抠图 / 是否批量（**只问比例不问像素尺寸**）。
- **默认双产出**：**物体贴图 + 底部碰撞 mask**（`xxx` 与 `xxx_mask`），同抠图轮廓、同最终像素尺寸；用户明确不要 mask 时才省略旁路。
- **阶段二搭图**：主链 `text_panel`→`image_gen`→`image_remove_bg`→（像素风）`image_pixel_fix`→`image_pixel_scale`→`image_output`；
  旁路 `maskPrompt`→`image_gen`（参考=物体图、`imageSize=512`）→`image_cut_by_mask`（mask←主链 RemoveBG.mask）→**`image_remove_wireframe`**→`image_pixel_scale`（**共用缩放参数**）→`image_output`（`name=xxx_mask`）。
  **放置几何**：`image_object_geometry` → 审查 → 重试 genMask（≤4 次）→ **仍不理想则人工近似 geometry** → `publishToGame`。
  **像素风走 PixelFix→PixelScale，不再用 `image_resize`。**
- **核心动作**：**两个** `image_gen` 各 `generateImage` 一次（**先物体、后 mask**），**再** `pipeline.execute` 跑下游。

### PART B · Tile 生成核心流程 → [executions/part-b-tileset.md](executions/part-b-tileset.md)
- **三步走**：①生图（大面积目标纹理，不抠图）→ ②`image_terrain_extract` →（可选 `make_seamless_moisan`）
  → `image_atlas_compose`（**只需接 terrain**）→ ③重命名入库。
- **关键约束**：AtlasCompose 的 `template` 端口**默认内置**——标准 tile（`common_16` / 64×80）**不接 template 端口**即可，
  **别去 `assets.list` 找模版 alias、别建模版 image_source**；只有换其它 rule/mask 时才接自定义 4×N 模版。
  MakeSeamless 是**可选增强**（compose 内部已自平铺）。
- op 速查 / 最小可跑图见 [tile-pipeline.md](tile-pipeline.md)。

### PART C · 指定形状的房屋生成 → [executions/part-c-shaped-house.md](executions/part-c-shaped-house.md)
- **默认产出像素图**。**四步走**：①`house_template`（**普通电池，靠 execute**；装饰房先定**平/坡屋顶**落到 `roofType`）把房顶掩码 JSON 渲成灰度形状模版 ＋
  `house_footprint`（**同一份掩码＋同一 height**，默认一并输出建筑底面黑白图）＋ `grid_json_to_size`（**同一份掩码**）算出目标像素宽高 →
  ②写**强约束提示词**（**两条硬约束：严格遵守灰度图形状 + 纯色背景**）→
  ③图生图（**默认单灰度图直连 `image_gen.image`**；仅当用户要把某张参考图风格严格迁移到灰度图上，才加该锚图、双图 **merge 成一路**）→
  ④`image_pixel_fix → image_pixel_scale`，把 `grid_json_to_size.width/height` 接进 PixelScale 的 `width/height`、**`lock_aspect=false`** 锁死目标尺寸；`house_footprint.image` 旁路 `image_preview → image_output` 入库。
- **"形状没跟"头号根因**：①提示词太软（要 `完全一致/EXACTLY/不得增删延伸、白=空`，且点名房顶∶墙面∶门比例照灰度图）；
  ②双图分支没 merge —— 后端只读 `image_gen.image` 一条进边，两张各连一条边只生效第一张。

## 三、注意事项（通用规则 / 防呆，随时查）

| 内容 | 文件 |
|---|---|
| 公共底座 + 三 PART 防呆清单（applyBatch、触发语义、入库命名、各 PART 专属防呆） | [notes/common-base.md](notes/common-base.md) |
| applyBatch / op 写法 + 图结构 + 最小可跑图 | [pipeline-schema.md](pipeline-schema.md) |
| 电池速查（op id / 端口 / 参数；含 tile 链、house 链） | [battery-catalog.md](battery-catalog.md) |
| Tile 链 op 速查 / 数据流 / 最小可跑图 | [tile-pipeline.md](tile-pipeline.md) |

**最常踩的三条铁律**（详见 [notes/common-base.md](notes/common-base.md)）：

1. **op id / 端口名只从 `batteries.list` / `batteries.get` 取**，别凭记忆编。
2. **先生图、后跑下游**：每个 `image_gen` 必须先 `generateImage`（缓存有值），再 `pipeline.execute`；
   `image_gen` 是 `manualTrigger` 数据边界，execute 不会替你触发它，**每节点只点一次**。
3. **每次 `applyBatch` 后立刻 `pipeline.get`** 确认 `nodes` 真变了（防"ok 却空"陷阱）。
