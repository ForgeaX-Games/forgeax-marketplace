# Tile 生成核心流程 · 管线图 / applyBatch ops（PART B）

> 这是 [SKILL.md](SKILL.md) **PART B** 的配套 op 速查。tile 链 =
> 生图（大面积目标纹理）→ TerrainExtract → [MakeSeamless·Moisan] → AtlasCompose → 重命名。
> op id / 端口名是运行时数据，**始终先 `asset2d:batteries.list` + `asset2d:batteries.get` 核对**，
> 下表只是导航。applyBatch 通用写法见 [pipeline-schema.md](pipeline-schema.md)。

---

## 数据流（标准 tile：模版走内置默认，无需模版源节点）

```
image_source(纹理) ─→ image_terrain_extract ─→ [make_seamless_moisan] ─→ image_atlas_compose ─→ image_output
                          (TerrainExtract)        (MakeSeamless·可选)        (AtlasCompose)        (重命名/入库)
                                                          template 端口不接 → 自动用内置 common_16 模版(64×80)
```

⭐ **`image_atlas_compose.template` 端口默认内置**：做标准 tile（`common_16`）时**不要**建模版 `image_source`、
**不要**去 `assets.list` 找 `preset:tiles/tile模板.png` 的 alias/blobId——把 `template` 端口留空即可，
电池会自动加载内置模版（4×5 → 64×80）。只有要换其它 rule/mask 时才接自定义模版源（见末尾变体）。

不接可选的 MakeSeamless 时，直接 `image_terrain_extract.image → image_atlas_compose.terrain`。

---

## tile 链电池速查

| 角色 | op id | 显示名 | 关键输入端口 | 关键输出端口 | 关键参数 |
|---|---|---|---|---|---|
| 纹理 / 模版源 | `image_source` | ImageSource | —（param `image`/`alias`） | `image` | 拖拽生成或手填 alias |
| 提取大块纹理 | `image_terrain_extract` | TerrainExtract | `image`(必填) | `image`、`width`、`height`、`source_patches`、`error` | `size`(输出边长,默128)、`patch_size`(默32)、`overlap`(默6)、`candidates`(默30)、`seed` |
| 无缝化（可选） | `make_seamless_moisan` | MakeSeamless·Moisan | `image`、`process_alpha`(默false) | `image`、`info` | `process_alpha` 仅纯不透明 RGBA 才开 |
| 合成 Atlas | `image_atlas_compose` | AtlasCompose | `terrain`(必填)、`template`(**可选**，不接=内置 common_16/64×80)、`alpha_threshold`、`apply_tone`、`ref_cell` | `image`、`width`、`height`、`terrain_size`、`error` | `alpha_threshold`(默127)、`apply_tone`(默true)、`ref_cell`(默6) |
| 入库 / 命名 | `image_output` | ImgOutput | `image`、`name`、`tags` | `alias`、`ok` | `overwrite`(默true) |

> **AtlasCompose 模版约束**：模版宽能被 4 整除；高是 `cellW = 宽 ÷ 4` 的整数倍。
> 瓦片尺寸 = `cellW × cellW`；瓦片数 = `4 × (高 ÷ cellW)`；输出 atlas 与模版同分辨率。
> 纹理至少 ≥ `cellW × cellW`，否则报错。

---

## 触发语义（同 PART A）

- **生图（`image_gen`，manualTrigger）**：先 `asset2d:generation.generateImage`（带 `nodeId`）点一次出纹理图。
- **tile 三电池（`image_terrain_extract` / `make_seamless_moisan` / `image_atlas_compose`）+ `image_output`**：
  普通电池，先点过生图后用 `asset2d:pipeline.execute` 跑整条下游。

---

## 最小可跑图：纹理 → Extract →（可选 Seamless）→ AtlasCompose（内置模版）→ 入库

> 假设 ① 已生出纹理图；把它的 `{alias,blobId}` ref 填进 `src_terrain`。
> **`compose.template` 端口故意不接** → 走内置 `common_16` 模版（64×80），无需模版源节点。
> 下例**含**可选的 `make_seamless_moisan`；不要它就删掉 `seamless` 节点、把 `e_extract` 直接连到
> `compose.terrain`（见末尾变体）。

```json
{ "toolId":"asset2d:pipeline.applyBatch", "caller":{"kind":"ai"}, "args":{
  "opts":{"actor":"ai:scene","label":"tile: terrain → seamless → atlas → output"},
  "ops":[
    {"type":"createNode","nodeId":"src_terrain","opId":"image_source","position":{"x":0,"y":0},"params":{"image":"<纹理 {alias,blobId}>","alias":"<纹理 alias>"},"name":"纹理源"},
    {"type":"createNode","nodeId":"extract","opId":"image_terrain_extract","position":{"x":280,"y":0},"params":{"size":128},"name":"TerrainExtract"},
    {"type":"createNode","nodeId":"seamless","opId":"make_seamless_moisan","position":{"x":560,"y":0},"params":{"process_alpha":false},"name":"MakeSeamless"},
    {"type":"createNode","nodeId":"compose","opId":"image_atlas_compose","position":{"x":840,"y":120},"params":{"alpha_threshold":127,"apply_tone":true,"ref_cell":6},"name":"AtlasCompose"},
    {"type":"createNode","nodeId":"out","opId":"image_output","position":{"x":1120,"y":120},"params":{"name":"沙地瓦片","overwrite":true},"name":"入库"},
    {"type":"connect","edgeId":"e_terrain","source":{"nodeId":"src_terrain","port":"image"},"target":{"nodeId":"extract","port":"image"}},
    {"type":"connect","edgeId":"e_extract","source":{"nodeId":"extract","port":"image"},"target":{"nodeId":"seamless","port":"image"}},
    {"type":"connect","edgeId":"e_seamless","source":{"nodeId":"seamless","port":"image"},"target":{"nodeId":"compose","port":"terrain"}},
    {"type":"connect","edgeId":"e_compose","source":{"nodeId":"compose","port":"image"},"target":{"nodeId":"out","port":"image"}}
  ]
}}
```

**不要 MakeSeamless 的变体**（去掉 `seamless` 节点 + `e_extract`/`e_seamless`，新增一条直连）：

```jsonc
{"type":"connect","edgeId":"e_extract","source":{"nodeId":"extract","port":"image"},"target":{"nodeId":"compose","port":"terrain"}}
```

**换自定义模版的变体**（仅当不要 `common_16` 默认时）：加一个模版 `image_source` 并连到 `compose.template`：

```jsonc
{"type":"createNode","nodeId":"src_template","opId":"image_source","position":{"x":0,"y":260},"params":{"image":"<模版 {alias,blobId}>","alias":"<模版 alias>"},"name":"模版源"},
{"type":"connect","edgeId":"e_template","source":{"nodeId":"src_template","port":"image"},"target":{"nodeId":"compose","port":"template"}}
```

---

## 运行顺序

1. **① 生图**：建 `text_panel → image_gen`，对 `image_gen` 调一次 `asset2d:generation.generateImage`
   产出**大面积目标纹理**（提示词强调铺满、俯视、无主体物件、无阴影；不接 RemoveBG）。
2. 把纹理图 + 模版做成两个 `image_source`，applyBatch 建上面这张 tile 图 → `pipeline.get` 校验。
3. **② 跑下游**：`asset2d:pipeline.execute`（Extract →[Seamless]→ AtlasCompose → output）。
   tile 三电池是普通电池，execute 正常执行；`image_gen` 不会被重触发。
4. **③ 重命名**：入库时已在 `image_output.name` 给了显示名（如「草地瓦片」）；
   事后改名走 `PATCH /api/v1/generated-assets/:alias`（body `{"name":"草地瓦片"}`），只改显示名。
5. `preview.latest` / `preview.selectAsset` 看 atlas，用 `asset2d:assets.get <atlas alias>` 核对 `name`，
   接边/色调不对就调参数（`size`/`patch_size`/`alpha_threshold`/`apply_tone`/是否加 seamless）再 `execute`。

---

## 缺电池 / 缺模版怎么办

- 找不到匹配电池 → 当成能力缺口如实告诉用户，**不要编 op id 硬凑**。
- 标准 tile 不缺模版：`image_atlas_compose.template` 不接就用内置 `common_16`（64×80）。
  **不要**为找模版去翻 `assets.list`——内置模版按需自动加载，无需 alias/blobId。
- 只有要**自定义** mask（换 rule）时才需要模版：让用户提供 / 拖入一张 4×N mask-atlas 模版，
  AI 不凭空造模版（模版的 alpha 编码 mask 形状、RGB 编码色调，结构有约定，不能瞎画）。
