# PART B · Tile 生成核心流程（地形瓦片 / Autotile atlas）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART B** 的完整执行步骤。
> 配套 op 速查 / 最小可跑图见 [tile-pipeline.md](../tile-pipeline.md)；电池速查见 [battery-catalog.md](../battery-catalog.md)；
> 公共底座 / 防呆见 [notes/common-base.md](../notes/common-base.md)。

> 目标：产出一张**标准 autotile atlas**（多格瓦片组），供场景 AddBaseGrid / 模板组 `xxxAsset` 匹配渲染。
> **默认 rule = `common_16`**，内置模版 **`preset:tiles/tile模板.png`** → atlas **64×80**。
> ⭐ **内置模版自动加载**：`image_atlas_compose.template` 端口留空即用 `common_16`——
> 标准 tile **无需**建模版 `image_source`、**无需**去 `assets.list` 找模版 alias/blobId。
> **禁止**只 `terrain_extract` 单图 + `floor_1` 当「省事验证」——那不是标准 tile 模板。

整条流程**三步走**：**①生图（大面积目标纹理）→ ②塞进 tile 管线（含 AtlasCompose）→ ③命名 + 发布**。

## B-阶段一 · 先问清需求（动手前必做）

接到"帮我做个 XX 地块/瓦片/可平铺纹理"时，先问清：

1. **什么地形** —— 草地 / 泥土 / 石板 / 沙地 / 水面…？什么美术风格（像素 / 写实 / 卡通）？
2. **模版（template）哪来** —— **默认不用管**：`image_atlas_compose.template` 端口不接，电池自动用内置
   `common_16` 模版（`preset:tiles/tile模板.png`，4×5 → atlas **64×80**）。**别去 `assets.list` 找它的 alias/blobId**，
   也别建模版 `image_source`。只有契约指定其它 rule 时，才接一个自定义 4×N mask 模版到 `template`。
3. **瓦片尺寸 / 纹理大小** —— 想要多大的瓦片？（影响 TerrainExtract 的 `size` 与模版选型。）
4. **是否要中间 MakeSeamless** —— 见下方「②-b」：AtlasCompose 内部已做 S×S Moisan 自平铺，
   单独的 `make_seamless_moisan` 是**可选增强**（先把整块纹理无缝化再喂 compose），按需接。

把方案讲清楚（"我打算：生一张大面积草地纹理 → TerrainExtract 提干净大块 →（可选 MakeSeamless）
→ AtlasCompose（用内置 common_16 模版，template 端口不接）→ 重命名为『草地瓦片』"），再进 B-阶段二。

## B-阶段二 · 搭管线并运行

### ① 先生图：产出一张大面积目标纹理（用 PART A 的生图能力）

tile 管线的**源头是一张以目标纹理为主体、占大面积**的图（不是带透明背景的孤立精灵）。
所以**先用 PART A 的生图链**产出它：

- 提示词强调 **大面积、铺满、俯视、无主体物件、无阴影**（如
  `Top-down seamless ground texture, grass and dirt, fills the frame, no objects, no shadows`），
  内置预设可参考 `presets/builtin-topdown-tile-prompt.json`。
- 建 `text_panel → image_gen`，**对 image_gen 调一次 `generation.generateImage`** 产出纹理图。
- ⚠️ 这里**通常不接 RemoveBG**——tile 要的是铺满的纹理，不是抠出来的物件。

产出后该纹理图会落进资产库（拿到一个 alias）。它就是 ② 的输入。

### ② 把图塞进 tile 管线（核心：Extract → [Seamless] → AtlasCompose）

标准 tile 只需**一路** `image_source`（纹理）经 **TerrainExtract → [MakeSeamless] → AtlasCompose**
合出 atlas——**模版走 AtlasCompose 内置默认，不接 `template` 端口**。

**②-a 准备纹理 image_source（模版默认内置，不必建）：**
- **纹理源**：把 ① 生成的纹理图做成 `image_source`（拖入画布自动建，或用 `assets.list`
  拿 alias 后手建并填 `image`/`alias` param）。
- **模版源**：标准 `common_16` 不需要——`template` 端口留空即用内置模版。只有换其它 rule 时，
  才把一张自定义 4×N mask 模版做成第二个 `image_source` 接到 `template`。

**②-b 接核心三电池**（op id / 端口名以 `batteries.get` 为准，详见 [tile-pipeline.md](../tile-pipeline.md)）：

- **`image_terrain_extract`（TerrainExtract，提取大块纹理）**：从含装饰物/噪点的纹理里
  用 K-means + Image Quilting 炼出 `size×size` 干净大块。
  连边：`image_source(纹理).image → image_terrain_extract.image`；关键参数 `size`（输出边长）。
- **`make_seamless_moisan`（Make Seamless · Moisan，无缝化）— 可选增强**：Moisan 周期+平滑分解
  让整块纹理四边严格连续。连边：`image_terrain_extract.image → make_seamless_moisan.image`。
  > AtlasCompose 内部已对挑出的 S×S 子块单独做 Moisan 自平铺，**这一节点不是必须的**；
  > 想让喂给 compose 的整块纹理本身先无缝时再接。不接就直接 `TerrainExtract.image → AtlasCompose.terrain`。
- **`image_atlas_compose`（AtlasCompose，合成 atlas）**：把干净纹理按 4×N 模版合成 Wang/Autotile atlas。
  连边：
  - 纹理（**必接**）：`make_seamless_moisan.image`（或直接 `image_terrain_extract.image`）`→ image_atlas_compose.terrain`
  - 模版（**默认不接**）：`template` 端口留空即用内置 `common_16` 模版（64×80）。只有换 rule 时才接
    `image_source(自定义模版).image → image_atlas_compose.template`。
  关键参数：`alpha_threshold`（模版 alpha 二值化阈值，默认 127）、`apply_tone`（是否应用模版 RGB 色调修饰，默认 true）、
  `ref_cell`（interior 参考格索引，默认 6）。输出 `image` 与模版同分辨率。

**②-c 接入库 + 跑下游：**
- `image_atlas_compose.image → image_output.image`（写入资产库）。
- 🛑 **顺序铁律**：先对 `image_gen` 调过 `generateImage`（① 已做），**再** `asset2d:pipeline.execute`
  跑 Extract → [Seamless] → AtlasCompose → output 这条下游链。这三个 tile 电池都是普通电池，
  靠 `execute` 执行；`image_gen` 是 `manualTrigger` 数据边界，execute 不会重触发它（同 PART A）。

完整 applyBatch ops 见 [tile-pipeline.md](../tile-pipeline.md)（含与你看到的图一致的最小可跑图）。

### ③ 重命名（给 atlas 起人类可读名）

tile 管线产出的 atlas 同样落在资产库里，`alias` 由后端自动生成（仅英文数字）。给它一个
人类可读的**显示名**（如「草地瓦片」），两条路任选：

1. **入库时命名（推荐）**：在 `image_output` 上设 `name`（param 直填或用 `text_panel` 连 `name` 端口），
   `overwrite` 默认 `true` 同显示名就地覆盖。这与 PART A 的入库命名规范完全一致。
2. **事后重命名**：对已落库的 atlas 走重命名接口
   `PATCH /api/v1/generated-assets/:alias`（body `{ "name": "草地瓦片" }`）——
   只改**显示名**，不动 `alias`/底层文件；同名自动加 ` (2)` 后缀。

命名是否落上，用 `asset2d:assets.get <atlas alias>` 看记录的 `name` 字段确认。

### B-迭代

`pipeline.execute` 后用 `preview.latest` / `preview.selectAsset` 看 atlas，用做地编的眼光点评：
**接边有没有缝、瓦片之间过渡自不自然、色调对不对**。不对就调参数（`size` / `patch_size` /
`alpha_threshold` / `apply_tone` / 是否加 `make_seamless_moisan`）再 `execute`；纹理本身不行
就回 ① 改提示词**重新生图**（新建 image_gen 或明确告知用户，别对旧 image_gen 再点）。
