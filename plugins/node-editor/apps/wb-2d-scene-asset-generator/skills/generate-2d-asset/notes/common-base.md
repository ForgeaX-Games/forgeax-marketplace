# 公共底座 & 防呆（三个 PART 通用注意事项）

> [SKILL.md](../SKILL.md) 路由到此。三套流程（[PART A](../executions/part-a-single-asset.md)、
> [PART B](../executions/part-b-tileset.md)、[PART C](../executions/part-c-shaped-house.md)）共用的底座与防呆清单。
> applyBatch op 写法 / 图结构见 [pipeline-schema.md](../pipeline-schema.md)；电池速查见 [battery-catalog.md](../battery-catalog.md)；
> tile op 速查见 [tile-pipeline.md](../tile-pipeline.md)。

## applyBatch / op 写法（照抄，别试探）

所有增删改节点/连边走 `asset2d:pipeline.applyBatch`，op 判别字段是 `type`。
每次 applyBatch 后立刻 `asset2d:pipeline.get` 确认 `nodes` 真的变了（"ok 却空"陷阱）。
**并发防覆盖**：`pipeline.get` 读到的 `hash` 写入 `opts.expectedPrevHash` 再提交 batch；若 UI/其他 agent 在此期间改过图，后端返回 `409 concurrent-write`，应重读重试而非静默覆盖。
详见 [pipeline-schema.md](../pipeline-schema.md)。

## 防呆须知（通用）

- op id / 端口名**只从 `batteries.list` / `batteries.get` 取**
- **输入电池按类型固定选**（要给某个输入端口喂常量值时，按目标端口的类型选电池，别乱用）。
  ⚠️ **手填值的 `params` 字段名已实证，别和输出端口名搞混**：
  - **字符串（string）输入 → 必用 `text_panel`（Panel）电池**。手填内容写进 **`params.text`**（**不是 `output`**！`output` 是它的*输出端口名*，往 `params.output` 写内容会被忽略、面板空、下游 `image_gen` 报 `prompt missing`）。有上游连线时上游值覆盖 `params.text`。
  - **连边时 source 端口必须是 `output`，绝不能写成 `text`**（2026-06-16 PART C 实测：`connect` 里 `source.port:"text"` → 下游收空串 → `house_template` 报 `invalid spec`、`grid_json_to_size` 吐 `width=0,height=0`）。`number_const` / `toggle` 的 source 端口分别是 **`value`**。
  - **数值（number）输入 → 必用 `number_const`（数值 / Number）电池**，手填值写 **`params.value`**，输出端口 `value`。
  - **布尔（bool）输入 → 必用 `toggle`（布尔 / Toggle）电池**，手填值写 **`params.value`**，输出端口 `value`。
- **每个 image_gen 只 `generateImage` 一次**；下游靠 `pipeline.execute`
- **AI 点运行 = 人点运行**：`generation.generateImage` 与画布「运行」按钮调同一接口、同一套数据流，
  传 `nodeId` 让后端按画布连线运行；结果会实时反映到画布预览，且持久化（刷新不丢）。
  ⚠️ **稳妥起见同时带上 `prompt` 字段**（图生图再带 `images`）：只传 `nodeId` 时后端从上游 `text_panel` 取
  `prompt`，一旦面板内容字段填错（见上：必须是 `params.text`）就会报 `prompt missing`。显式带 `prompt` 一步到位、不依赖上游求值。
- **先生图、后跑下游**：每个 `image_gen` 必须先 `generateImage` 产出图（缓存有值），再 `pipeline.execute` 跑下游。
  跳过这步直接 execute，下游会拿到空 image 输入而出错——人是「看到图出来才往下走」，AI 也照此顺序。
  `image_gen` 的 `image`（参考图）输入是可选的；可选的是参考图，不是「要不要先跑 image_gen」。
- **`execute` 指定 `nodeId` 只跑该节点、不回溯上游**（2026-06-16 实测）：单独 `execute` `houseTpl` / `sizeFromGrid` 时，上游 `text_panel` 未执行 → 读到空 spec → `invalid spec` 或 `width=0`。验证/跑通 PART C 应 **`execute` 整图**（不传 nodeId）或 **从上游源头 `specPanel` 触发**，不要孤立 execute 中间节点来判 spec 是否有效。
- 参考图来自面板拖拽生成的 `image_source`，AI 不凭空造图
- **入库命名**：在 `image_output` 上填 `name` 给资产起人类可读名（落到**显示名**字段，支持中文，
  可 param 直填或用 `text_panel` 连 `name` 端口）；`overwrite` 默认 `true` 表示同显示名就地覆盖。
  `alias`（机读文件名）始终由后端自动生成；命名是否落上用 `asset2d:assets.get` 看 `name` 字段。
- `screenshot.store` 是渲染器内部回写，不归你调
- 删除项目要确认（`projects.remove`）

## PART B（tile）专属防呆

- **标准地块（默认）**：用户要地块/草坪/铺地/AddBaseGrid 底图 → **PART B 全链 + `common_16`**，**禁止**跳过 atlas 走 `floor_1`。
- **op id / 端口名照 tile 电池查**：`image_terrain_extract` / `make_seamless_moisan` / `image_atlas_compose`
  的端口名（`terrain` / `template` 等）以 `batteries.get` 为准，详见 [tile-pipeline.md](../tile-pipeline.md)。
- **AtlasCompose 只需接 `terrain`**：`template` 端口**默认内置**——不接时电池自动用内置标准模版
  **`preset:tiles/tile模板.png`**（`common_16`）。⚠️ **别去 `assets.list` 找模版 alias/blobId、别建模版 `image_source`**
  （`preset:` 是 alias 前缀，对应虚拟文件夹叫 `presets`（复数）——这个坑曾让人翻列表翻半天，现在根本不用碰它）。
  只有要换其它 rule/mask 时，才接一个自定义 4×N 模版到 `template`。
- **内置模版 → `common_16`**：atlas **64×80**（4×5），与 `common_16` rule 对齐。
- **`floor_1` 非默认**：仅用户明确「单格平铺、不要 autotile」时用；**不是**「验证捷径」。
- **`image_terrain_extract.size`** 是提取边长（建议 ≥128），**不是**发布尺寸；发布尺寸由 atlas 输出决定（common_16 → 64×80）。
- **`image_output.name`**：语义名用 **`text_panel` → `image_output.name` 连线**；`params.text` 不会写入 name 端口。
- 发布 tile 时后端校验 atlas 尺寸与 `autotileKind` rule 是否匹配，对不上直接 422 拒绝。
- **MakeSeamless 是可选增强**：AtlasCompose 内部已对 S×S 子块做 Moisan 自平铺，不接也能出无缝 atlas。
- **生图是 tile 的源头**：先 `generateImage` 产大面积纹理，再 `execute` 跑 tile 下游（顺序铁律同 PART A）。

## PART A（object / 植被）专属防呆

- **默认双产出**：PART A 生成 scene object 时，**默认同时产出贴图 + 底部碰撞 mask**（`image_output.name` = 语义名，`语义名_mask` = 碰撞几何贴图）。用户明确「不要碰撞 mask」时才省略旁路。
- **场景 16 PPU**：16px = 1m；`image_pixel_scale.width` = 目标米数 × 16（见 [texture-pipeline §3](../SKILL.md) 尺寸表），`height=0` + `lock_aspect=true`。
- **碰撞 mask 旁路**：… → **`image_object_geometry`** → 审查 → 重试 genMask ≤4 次 → **仍不理想则 Agent 人工填近似 geometry 发布**（须说明依据）。详见 [part-a-single-asset.md §4c](../executions/part-a-single-asset.md)。
- **植被透明底**：主链 `image_remove_bg` 必接；像素风必过 `image_pixel_fix` 再接 `image_pixel_scale`。
- **发布**：`assetType:"object"`，**不传** `autotileKind`；多种样式 = 多条独立 PART A 链 + 多次 publish。
- **多种 PART A 链**：每条链各自 `generateImage` 一次，全部 gen 完再 **一次** `execute` 跑下游；不要混在一个 image_gen 里。

## PART C（整栋装饰房屋贴图 · **专属，非默认**）

> **何时用**：用户要 **一张覆盖整栋建筑** 的装饰贴图（billboard object），形状由掩码控制。
> **何时不用**：日常结构化场景（模板组 + 内置墙材）、一般 object（PART A）、tile（PART B）——**不要**为普通「生成建筑/物体」任务自动走 PART C 或 Scene 掩码链。

- **`house_template` 是普通电池**（非 manualTrigger）：靠 `pipeline.execute` 执行；**不要**对它调
  `generation.generateImage`（那是 image_gen 专用）。`house_footprint` / `grid_json_to_size` 同理普通电池。
- **先定平/坡屋顶**：装饰房按设定/风格选 `house_template.roofType`＝`flat`（平屋顶）或 `pitched`（坡屋顶，默认）。
- **`spec` 是 0/1/2 占地掩码 JSON 字符串**（与 Scene `building_footprint_mask` / `grid_to_json` 对齐）：
  `0`=空、`1`=占地、`2`=预设门位。Scene 侧提取的 `json` **原样**贴进 `text_panel.params.text`，连到
  `house_template.spec`、`house_footprint.spec`、`grid_json_to_size.json` 三处（**同一份 JSON**）。
  含 `2` 时忽略 `doorCount`；无 `2` 时才用随机门。
- **连边端口速查（connect 的 source.port，写错 = 下游全空）**：

  | 电池 | 手填字段 | connect 时 source.port |
  |------|----------|------------------------|
  | `text_panel` | `params.text` | **`output`**（不是 `text`） |
  | `number_const` | `params.value` | **`value`** |
  | `toggle` | `params.value` | **`value`** |

- **底面默认一并输出**：装饰房默认接 `house_footprint`（吃**同一份 `spec`＋同一 `height`**，`imageSize` 与
  HouseTemplate 一致），其黑白底面 `image` 单独 `image_preview → image_output` 入库，
  **不进图生图链**、不接 PixelFix/RemoveBG，与房屋成品逐像素对齐。
- **默认单灰度图直连**：`house_template.image → image_gen.image`（已入库 alias，无需中转 `image_source`）。
  **仅当用户指定一张参考图、要求把其风格严格迁移到灰度图上**，才追加该锚图，并把两张图 **merge 成一路**
  再进 `image_gen.image`（后端 `resolveNodeImageInputs` 只读一条进边，双图各连一条只生效第一张）。
- **提示词两条硬约束（任何分支都要写）**：① **务必严格遵守灰度图的形状**——成品形状/轮廓/结构/比例
  与灰度图**完全一致**，点名房顶∶墙面∶门比例照灰度图，用 `完全一致/EXACTLY/不得增删延伸越出/白=空`
  强约束句（这是"形状没跟"的头号根因，软描述会被模型自由扩成大房子）；② **生成纯色背景图**（单一纯色）。
  风格迁移分支再把"形状照灰度图、风格照锚图"分别点名。
- **默认像素风 + 按目标尺寸缩放**：下游 `image_pixel_fix → image_pixel_scale`，把
  `grid_json_to_size.width/height` 接进 PixelScale 的 `width/height`，**`lock_aspect=false`**
  （`toggle.params.value=false` → `pixscale.lock_aspect`，connect 用 **`source.port:"value"`**）
  强制缩到「列数×16 × 行数×16」（如 16×18 格 → **256×288**）。连线正确时 PART C 实测可精确命中；
  若只锁宽、高仍随图比例走，检查 `lock_aspect` 是否误默认为 true（toggle 未连或 port 写错）。
  像素风必接 PixelFix，**不要用 `image_resize`**。
- **顺序铁律**：先 `execute`（整图或从 spec 源头）跑出 `house_template` 底图 + `grid_json_to_size` 尺寸，
  **再**对 `image_gen` 调一次 `generation.generateImage`（**建议显式带 `prompt`**）；
  然后 `execute` 跑 pixfix → pixscale → output。改形状=改 spec/height/roofType 后重 execute + 新建 image_gen。
