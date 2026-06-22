# 图生图管线 · 电池速查

> op id / 端口名是运行时数据。**始终先 `asset2d:batteries.list` + `asset2d:batteries.get`
> 核对**，下表只是导航，不要直接抄成最终值。

## 查电池

```json
{ "toolId": "asset2d:batteries.list", "args": {}, "caller": { "kind": "ai" } }
{ "toolId": "asset2d:batteries.get", "args": { "id": "image_gen" }, "caller": { "kind": "ai" } }
```

## 图生图 / 文生图链上常用电池

| 角色 | op id | 显示名 | 关键输入 | 关键输出 | 备注 |
|---|---|---|---|---|---|
| 提示词面板 | `text_panel` | Panel | `input`(any，可空) | `output`(string) | 直接在面板里写提示词；**任何 string（字符串）输入端口都用它喂值** |
| 数值常量 | `number_const` | 数值 / Number | —（节点上拖滑条/填数） | `value`(number) | **任何 number（数值）输入端口都用它喂值**（如 `width`/`height`/`height(房高)`/`doorCount`） |
| 布尔开关 | `toggle` | 布尔 / Toggle | —（节点上切开/关） | `value`(bool) | **任何 bool（布尔）输入端口都用它喂值**（如 `lock_aspect`/`crop`/`square_grid`） |
| 提示词模板 | `prompt_dealer` | 提示词模板填充 | `template` + `value_0/1/…`(动态) | `prompt`(string) | 把多个词填进 `{0}{1}…` |
| 参考图源 | `image_source` | ImageSource | —（仅 param `image`/`alias`） | `image`(image) | **拖拽 generated asset 自动生成**；图生图用 |
| AI 生图 | `image_gen` | ImageGen | `prompt`(string)、`image`(可选参考图，access:tree)、`imageSize`(string: **512**/1K/2K/4K，默2K) | `image`(image)、`error` | **manualTrigger**，每节点只点一次运行 |
| 抠背景 | `image_remove_bg` | RemoveBG | `image`、`lab_tolerance`(默认9)、`bg_grow_tolerance`、`sample_points`、`crop`(默认true) | `image`、`mask`、`width`、`height`、`error` | 本地算法抠图；**`mask` 供 CutByMask 对齐** |
| 风格滤镜 | `image_filter_style` | FilterStyle | `image`、`style`(下拉，默认"标准西幻")、`blend_mode`(下拉，默认"跟随风格") | `image`、`width`、`height`、`style`、`error` | 本地按既定风格调色（色相/饱和/亮度/对比/罩色/老照片）；罩色为 PS 混合模式图层(正片叠底/叠加/柔光)不糊画面；保留 alpha |
| 按 mask 裁切 | `image_cut_by_mask` | CutByMask | `image`(必填)、`mask`(必填，通常接 RemoveBG.mask)、`crop`(默true) | `image`、`width`、`height`、`error` | 把任意图对齐到 RemoveBG 同轮廓/尺寸；**碰撞 mask 旁路必用** |
| 去线框 | `image_remove_wireframe` | RemoveWireframe | `image`、`threshold`、`erode_radius`、`transparent_bg`(可选) | `image`、`width`、`height`、`error` | 形态学开运算去细线框，**只留实心纯黑**；**碰撞 mask 旁路 CutByMask 之后必接** |
| 物体放置几何 | `image_object_geometry` | ObjectGeometry | `mask`(碰撞 footprint)、`image`(物体贴图，同尺寸)、`threshold`、`alpha_min` | `geometry_json`、`anchor_x`、`anchor_y`、`object_height`、`width`、`height`、`error` | 从 mask+sprite 算锚点/碰撞矩形/object_height；**publishToGame 用** |
| 像素修复 | `image_pixel_fix` | PixelFix | `image`、`k_colors`(默0=自动)、`square_grid`(默true) | `image`、`width`、`height`、`error` | 伪像素图→点对点真实像素图；**像素风必接** |
| 像素缩放 | `image_pixel_scale` | PixelScale | `image`、`width`(默256)、`height`(0=等比)、`lock_aspect`(默true)、`max_color_diff` | `image`、`out_width`、`out_height`、`error` | 整数倍最近邻**无损**缩放；接在 PixelFix 后；**取代 Resize** |
| 预览 | `image_preview` | ImgPreview | `image` | `image`(透传) | 画布上看图，可继续往下连 |
| 入库 | `image_output` | ImgOutput | `image`、`name`、`tags` | `alias`、`ok` | 写入资产库 raw 区 |

## PART A · 物体贴图 + 碰撞 mask 双产出（默认）

> 主链产出**物体贴图**；旁路产出**底部碰撞区域 mask**（`语义名_mask`），与贴图同抠图轮廓、同 PixelScale 尺寸。

```
[主链 · 物体贴图]
promptPanel.output ──→ gen.prompt
(可选) image_source ──→ gen.image
gen.image ──→ nobg.image ──→ pixfix.image ──→ pixscale.image ──→ out.image
                              nobg.mask ────────────────┐
scaleW.value ──→ pixscale.width                          │
scaleH.value ──→ pixscale.height                         │
lockToggle.value ──→ pixscale.lock_aspect                │
namePanel.output ──→ out.name                            │
                                                         │
[旁路 · 碰撞 mask]                                        │
maskPrompt.output ──→ genMask.prompt                     │
gen.image ──→ genMask.image          （物体图作参考）      │
size512.output ──→ genMask.imageSize （固定 "512"）       │
genMask.image ──→ cutMask.image                          │
nobg.mask ──────→ cutMask.mask ──────────────────────────┘
cutMask.image ──→ dewire.image       （image_remove_wireframe）
scaleW.value ──→ pixscaleMask.width    （与主链相同）
scaleH.value ──→ pixscaleMask.height
lockToggle.value ──→ pixscaleMask.lock_aspect
dewire.image ───→ pixscaleMask.image ──→ outMask.image
nameMask.output ──→ outMask.name       （语义名 + "_mask"）
                                                         │
[放置几何 · 发布用]                                      │
pixscale.image ───→ geom.image                           │
pixscaleMask.image → geom.mask                           │
geom.geometry_json / anchor_x / anchor_y / object_height → publishToGame
```

- **两个 `image_gen`**：`gen`（物体·**文生图**）、`genMask`（碰撞剪影·**图生图**）——**`gen.image` → `genMask.image` 必填**；各 `generateImage` **一次**；顺序：**先 `gen`，再 `genMask`**。
- **`genMask.imageSize`**：接 `text_panel` 输出 `"512"`（或 `updateNode` 设 input；档位见 `batteries.get image_gen`）。
- **`image_cut_by_mask`**：把 512 档 AI 碰撞图对齐到 `nobg.mask` 定义的抠图区域（crop 默认 true）。
- **`image_remove_wireframe`**：CutByMask 之后去线框 → 同参 `image_pixel_scale`；**再接 `image_object_geometry`**（sprite + mask）产出 `geometry_json` 供发布。
- 完整步骤与提示词模板见 [executions/part-a-single-asset.md](executions/part-a-single-asset.md) §碰撞 mask。

## 触发语义（重要）

- **`image_gen`（manualTrigger）**：不被 `pipeline.execute` 的自动遍历触发。AI 用
  `asset2d:generation.generateImage`（带 `nodeId`）点一次运行；结果写进该节点输出缓存，
  下游随后用 `pipeline.execute` hydrate。**同一节点不要重复点。**
- **后处理电池**（`image_remove_bg` / `image_pixel_fix` / `image_pixel_scale` / `image_preview` / `image_output`）：
  普通电池，靠 `asset2d:pipeline.execute` 正常执行。

## Tile 链常用电池（PART B · 地形瓦片 / Autotile atlas）

> 完整 tile 数据流、最小可跑图、运行顺序见 [tile-pipeline.md](tile-pipeline.md)。

| 角色 | op id | 显示名 | 关键输入 | 关键输出 | 备注 |
|---|---|---|---|---|---|
| 提取大块纹理 | `image_terrain_extract` | TerrainExtract | `image`(必填)、`size`(默128)、`patch_size`、`overlap`、`candidates`、`seed` | `image`、`width`、`height`、`source_patches`、`error` | K-means + Image Quilting 炼干净大块纹理 |
| 无缝化（可选） | `make_seamless_moisan` | MakeSeamless·Moisan | `image`、`process_alpha`(默false) | `image`、`info` | Moisan 周期+平滑分解；AtlasCompose 内部已自平铺，故**可选** |
| 合成 Atlas | `image_atlas_compose` | AtlasCompose | `terrain`(必填)、`template`(**可选**,4×N mask；**不接=内置 common_16/64×80**)、`alpha_threshold`(默127)、`apply_tone`(默true)、`ref_cell`(默6) | `image`、`width`、`height`、`terrain_size`、`error` | 标准 tile 不接 `template` 即用内置模版，**别去找模版 alias**；模版宽÷4=cellW，输出与模版同分辨率 |

- **tile 三电池都是普通电池**（非 manualTrigger），靠 `asset2d:pipeline.execute` 执行。
- tile 源头仍需先用 `image_gen` 生出**大面积目标纹理**（同上方触发语义：先 `generateImage` 再 `execute`）。

## 形状房屋链常用电池（PART C · 指定形状房屋）

| 角色 | op id | 显示名 | 关键输入 | 关键输出 | 备注 |
|---|---|---|---|---|---|
| 房屋形状底图 | `house_template` | HouseTemplate | `spec`(string,**房顶掩码 JSON 字符串**)、`doorCount`(默1)、`height`(默1，**装饰房常用 1–2，最多 3–4**)、`roofType`(**pitched=坡屋顶 / flat=平屋顶，装饰房必按设定选**)；param `imageSize`(默300)、`seed` | `image`(image[]，灰度房屋底图)、`error` | 只画房顶，立面/门/窗自动生成 + 外轮廓描边；普通电池，靠 `execute` |
| 房屋底面 | `house_footprint` | HouseFootprint | `spec`(string,**与 house_template 同一份掩码**)、`height`(**与 house_template 同值**)；param `imageSize`(**与 house_template 一致**,默300) | `image`(image[]，黑=底面/白=背景)、`error` | 与 HouseTemplate 逐像素对齐的底面黑白图（与 roofType 无关）；普通电池，靠 `execute`；**装饰房默认一并输出**，底面单独 preview/output，不进图生图链 |
| 家具形状底图 | `furniture_template` | FurnitureTemplate | `kind`(table/chair/wardrobe/bed)、`orientation`(down/up/left/right)；param `imageSize`(默300)、`seed` | `image`(image[]，灰度家具底图)、`error` | 按类型+朝向画立面剪影 + 外轮廓描边；同 house 角色（形状底图喂生图）；普通电池，靠 `execute` |
| 网格转尺寸 | `grid_json_to_size` | 网格 JSON 转尺寸 | `json`(string，**与 spec 同一份房顶掩码 JSON 字符串**) | `width`(number=列数×16)、`height`(number=行数×16) | `helper/data_transform` 下；据掩码算目标像素宽高，喂 PixelScale；普通电池，靠 `execute` |
| AI 生图 | `image_gen` | ImageGen | `prompt`、`image`(参考图，**默认单图直连；双图须 merge 成一路**) | `image`、`error` | 同 PART A；默认 `house_template.image` 一条边直进；风格迁移才 merge 锚图 |
| 像素缩放 | `image_pixel_scale` | PixelScale | `image`、`width`、`height`、`lock_aspect`(**PART C 设 false**)、`max_color_diff` | `image`、`out_width`、`out_height`、`error` | PART C 把 `grid_json_to_size.width/height` 接进 `width/height`，`lock_aspect=false` 锁死目标尺寸 |

- **`house_template` / `house_footprint` / `grid_json_to_size` 都是普通电池**：靠 `asset2d:pipeline.execute` 执行，**不**用 `generation.generateImage`。
- **屋顶类型**：装饰房先定平/坡屋顶，落到 `house_template.roofType`（`flat`/`pitched`）。
- **底面默认一并输出**：同一份掩码字符串与同一个 `height`（且 `imageSize` 一致）也喂 `house_footprint`，
  其 `image`（黑白底面）单独接 `image_preview → image_output` 入库，**不进图生图链**、不接 PixelFix/RemoveBG，与房屋成品逐像素对齐。
- **数据流（默认 · 单灰度图，像素风）**：`house_template.image`（灰度形状模版）→ `image_gen.image`（**单图直连一条边**）；
  `text_panel.output`（强约束提示词：**严守灰度图形状 + 纯色背景**）→ `image_gen.prompt`；
  同一份掩码字符串同时喂 `house_template.spec`、`house_footprint.spec` 与 `grid_json_to_size.json`，同一个 `height` 同时喂 `house_template`/`house_footprint`；
  先 `execute` 出模版/底面/目标尺寸，再对 `image_gen` `generateImage`（先底图、后生图，同 PART A/B 顺序铁律）；
  下游 `image_pixel_fix → image_pixel_scale`，把 `grid_json_to_size.width/height` 接进 PixelScale 的 `width/height` 且 `lock_aspect=false`；`house_footprint.image → image_preview → image_output` 旁路入库。
- **数据流（风格迁移分支 · 双参考图）**：仅当用户指定一张参考图、要求把其风格严格迁移到灰度图上时，
  把 `house_template.image`（灰度模版）＋ 用户参考图 `image_source.image` → **merge 成一路** → `image_gen.image`。
  ⚠️ **双图必须 merge**：后端 `resolveNodeImageInputs` 对 `image_gen.image` **只读一条进边**——两张图各连一条边
  只生效第一张；要两张都用就 merge 单边进，或显式 `generateImage` 时把两张 alias 放进 `args.images` 数组。
- **PART C 提示词两条硬约束**：① **务必严格遵守灰度图的形状**（`完全一致/EXACTLY/不得增删延伸越出、白=空`，
  并点名房顶∶墙面∶门比例与灰度图一致）；② **生成纯色背景图**（solid plain，单一纯色）。
  风格迁移分支再把"形状照灰度图、风格照锚图"分别点名。"形状没跟"多半是约束太软，或双图分支没 merge（第二张被丢）。

## 缺电池怎么办

目录里找不到匹配的电池时，**当成能力缺口如实告诉用户**，不要自己编 op id 硬凑。
