# PART A · 单个资产生成（图生图 / 文生图）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART A** 的完整执行步骤。
> 公共底座（applyBatch op 写法、触发语义、入库命名、防呆）见 [notes/common-base.md](../notes/common-base.md)；
> 电池速查见 [battery-catalog.md](../battery-catalog.md)；图结构/最小可跑图见 [pipeline-schema.md](../pipeline-schema.md)。

适用：单个物件 / 贴图 / 图标 / UI 件（文生图或图生图，可选抠图/缩放）。

---

## ⚠️ 默认双产出（最高优先级 — 搭链前必读）

**PART A 不是「一条链入库就完」——默认必须产出两样：**

| 产出 | 入库名 | 链路 |
|------|--------|------|
| **物体贴图** | `palm_tree`（语义名） | prompt → `gen` → nobg → pixfix → pixscale → `out` |
| **碰撞 mask** | `palm_tree_mask` | maskPrompt → **`gen.image`→`genMask`**（图生图）→ `cutMask` → … → `outMask` |

> **禁止把 mask 当成第二个独立文生图**——`genMask.image` **必须**接主链 **`gen.image`**（见 §4b「参考图铁律」）。
| **放置几何** | （随贴图发布） | `pixscale.image` + `pixscaleMask.image` → **`geom`**（`image_object_geometry`）→ `geometry_json` / `anchor_x` / `anchor_y` / `object_height` |

> **禁止**只搭主链就停（如「棕榈树 48px」仍要 mask 旁路）。仅当用户**原话**说「不要碰撞 mask / 不要 _mask / 只要一张贴图」才可省略。
>
> 向用户播报方案时**必须两行都提到**；`applyBatch` **一批**建齐主链 + mask 旁路全部节点与边。细节见 [§4b](#4b-碰撞-mask-旁路默认必做物体几何信息)。

---

## A-阶段一 · 先问清需求（动手前必做）

接到"帮我生成 XX"时，先用一两轮对话把下面几点问清楚，别急着建图：

1. **生成什么** —— 要一个什么物件 / 贴图 / 图标 / UI 件？什么风格、什么用途？
2. **走什么流程**：
   - **文生图（text-to-image）**：只有提示词，没有参考图 → ImageGen 只接 `prompt`
   - **图生图（image-to-image）**：有一张/多张参考图 → ImageGen 同时接 `prompt` + `image`（参考图）
3. **有什么要求**：
   - **像素风还是写实？** —— 这是第一分叉。像素风走「PixelFix（完美像素修复）→（可选）PixelScale」链，
     写实/卡通走常规链。
   - **长宽比（aspect ratio）是多少？** —— **生图阶段只定比例，不定具体像素尺寸**（如 1:1 / 4:3 / 16:9）。
     具体像素尺寸交给下游 PixelFix（还原真实像素分辨率）+ PixelScale（按倍率缩放）来满足。
   - **要不要精确像素尺寸？** —— 若用户给了目标像素尺寸，记下来留给 **PixelScale** 的 `width/height`；
     生图时仍只把它折算成**比例**写进提示词。
   - **是否抠图**？（决定是否接 `RemoveBG`，得到透明背景）
4. **是否批量** —— 一次要生成几张 / 几个变体？（决定建几个 ImageGen 节点，或一个 prompt 列表）
5. **碰撞 mask（默认要）** —— PART A **默认一并生成**底部碰撞区域几何贴图（`语义名_mask`），与物体贴图同尺寸。
   只有用户明确说「不要碰撞 mask / 不要几何信息」时才省略旁路。

把方案用一段话讲清楚（"我打算：提示词面板（含 1:1 比例约束）→ ImageGen 文生图 → 抠背景 →
PixelFix 完美像素修复 →（需要尺寸再）PixelScale 缩到 128px → 预览/入库 **；并行碰撞 mask：
碰撞提示词 → ImageGen（参考物体图、512 档）→ CutByMask（对齐主链 RemoveBG.mask）→ RemoveWireframe → 同参 PixelScale → 入库 xxx_mask**，
约 N 个节点"），再进入 A-阶段二。

---

## A-阶段二 · 搭管线并运行

### 0. 选/开项目，查电池

1. `asset2d:projects.list` / `asset2d:projects.open`（没有就 `projects.create`）
2. `asset2d:batteries.list` + 对要用的电池 `asset2d:batteries.get` —— **op id 和端口名以目录返回为准**，别凭记忆编（详见 [battery-catalog.md](../battery-catalog.md)）
   **PART A 必查电池（含 mask + 几何）**：`text_panel`、`image_gen`、`image_remove_bg`、**`image_cut_by_mask`**、**`image_remove_wireframe`**、**`image_object_geometry`**、`image_pixel_fix`、`image_pixel_scale`、`number_const`、`toggle`、`image_output`、`image_preview`
3. `asset2d:pipeline.get` 读当前图

### 1. 准备提示词

用 **`text_panel`**（显示名 Panel）承载提示词：**手填的提示词文本写进 `params.text`**（`output` 是它的*输出端口名*、不是内容字段——往 `params.output` 写会被忽略导致面板空）。
需要把多个词拼进模板时，用 **`prompt_dealer`**（`template` + 动态 `value_0/1/…` → `prompt`）。

> **尺寸只写比例、不写像素**：`image_gen` 没有 width/height 端口，画幅完全由提示词左右。
> 因此**在提示词里写长宽比**（如 `square 1:1 aspect ratio` / `4:3` / `16:9`），**不要**写
> "512x512 像素"之类的硬尺寸——真实像素分辨率交给下游 PixelFix + PixelScale 决定。

### 2. 准备提示图（仅图生图需要）

参考图来自 **generated asset folders 面板**：让用户把一张已生成的图**拖入画布**，会自动
创建一个 **`image_source`** 节点（param 里带 `{alias,blobId}`，输出端口 `image`）。
你不能凭空造参考图——若用户没拖，提示他拖入；或用 `asset2d:assets.list` 找到已有 alias，
据此建 `image_source` 并填 `image` param。

### 3. 连接 ImageGen 并运行（核心）

用 **`image_gen`**（显示名 ImageGen）：
- 输入：`prompt`（string）、`image`（可选参考图，access:tree）、`imageSize`（string，**512 / 1K / 2K / 4K**，默认 2K；**碰撞 mask 专用 gen 固定 512**）
- 输出：`image`、`error`
- 连边：`text_panel.output → image_gen.prompt`；图生图再连 `image_source.image → image_gen.image`
- **`imageSize` 怎么喂**：`text_panel` 输出 `"512"` → `image_gen.imageSize`（connect **`source.port:"output"`**），或 `updateNode` 经 input 连线。以 `batteries.get image_gen` 为准。

**`image_gen` 是手动触发电池（`manualTrigger`）——pipeline 的自动执行不会跑它。**
搭好连线后，**由你（AI）替用户点一次运行**——这跟人在画布上点该节点的「运行」按钮
**走的是同一个接口、同一套数据流**（`POST /api/v1/ai/image`）。

最省事、最推荐的形态：**只给 `nodeId`，让后端按画布上已连好的输入运行**（完全等价于人点运行按钮）：

```json
{ "toolId": "asset2d:generation.generateImage",
  "args": { "nodeId": "<image_gen 的 nodeId>" },
  "caller": { "kind": "ai" } }
```

后端会自动从图里解析该节点 `prompt`/`image` 端口已连的上游值（连了 `text_panel` 就取它的
提示词，连了 `image_source` 就取参考图），生成后把结果写进该节点输出缓存**并持久化到节点的
`_gen_image`**，画布上的预览会像人点运行一样**实时点亮**、刷新页面也不丢。

> 你也可以显式覆盖（不依赖画布连线时）：`args` 里直接给 `prompt` 和/或 `images`（参考图
> alias 数组）。**只要传了 `prompt`/`images`，后端就用你传的、不再读画布。** 两种方式择一即可。

> ⚠️ **每个 ImageGen 节点只点一次运行**。`generation.generateImage` 会把结果写进该节点的
> 输出缓存（`writeNodeOutput`），且因为它是数据边界，后续 `pipeline.execute` 跑下游时
> **不会重新触发生图**。所以：**不要对同一个 image_gen 重复调 `generateImage`**（会重复生成、
> 重复消耗网关额度）。批量生成 = 建多个 image_gen 节点，**各点一次**。

### 4. 按需接后处理

生图出来后，按阶段一问到的要求接下游（这些电池靠 `pipeline.execute` 跑，不是手动触发）：

- **抠背景**：`image_remove_bg`（RemoveBG），`image_gen.image → image_remove_bg.image`，
  关键参数 `lab_tolerance`（默认 9，越大去得越狠）、`crop`（默认裁到内容区）。
  **输出两路**：`image`（透明抠图）+ **`mask`（灰度保留区，供 CutByMask 对齐）**。
- **像素图修复（像素风必接）**：`image_pixel_fix`（PixelFix）——AI 生的「伪像素图」（块大小不一、边缘抗锯齿、
  一块几十种近似色）还原成**点对点真实像素图**。输入 `image`，输出 `image`/`width`/`height`。
  **像素风一律先过 PixelFix**，把分辨率收敛到真实像素网格。
- **像素图缩放（有尺寸需求才接）**：`image_pixel_scale`（PixelScale）——按整数倍最近邻**无损缩放**。
  接在 PixelFix **之后**，`image_pixel_fix.image → image_pixel_scale.image`，目标尺寸填 `width`/`height`
  （`0` = 按另一边等比，`lock_aspect` 默认锁横纵比）。**不要再用 `image_resize`**——像素图缩放走 PixelScale。
- **预览**：`image_preview`（ImgPreview，透传，便于在画布上看）
- **入库**：`image_output`（ImgOutput，写入资产库 raw 区，可给 `name`/`tags`）——**最后一步才改名输出**。

典型链（像素风，**= 主链 + 默认 mask 旁路，见 §4b**）：

**主链**：`text_panel → gen ← image_source` → `gen.image → nobg → pixfix → pixscale → preview → out`

**mask 旁路（默认必搭）**：`maskPrompt → genMask`（`gen.image` 参考 + `imageSize=512`）→ `cutMask`（`nobg.mask`）→ **`dewire`（去线框）** → `pixscaleMask`（与 pixscale **同 width/height/lock_aspect**）→ `outMask`（`name=语义名_mask`）

没有像素需求的写实/卡通件：主链可跳过 PixelFix/PixelScale，**mask 旁路仍默认保留**（CutByMask + 共用 PixelScale）。
完整 ops 写法见 [pipeline-schema.md](../pipeline-schema.md)。

### 示例：16 PPU 棕榈树（`tree_big` / 48px 宽）

用户：「生成 16 PPU 棕榈树 pixel object 贴图」→ **仍走双产出**：

| 节点 | 配置 |
|------|------|
| 主链 | prompt(像素风棕榈树) → `gen` → `nobg` → `pixfix` → `pixscale`(width=**48**, height=0, lock=true) → `out`(name=`palm_tree`) |
| mask 旁路 | maskPrompt（**固定提示词模板**，【xxx】换语义名）→ `genMask`(ref=`gen.image`, imageSize=**512**) → `cutMask` → **`dewire`** → `pixscaleMask`(width=**48**, 与主链同参) → `outMask`(name=`palm_tree_mask`) |

运行：`generateImage(gen)` → `generateImage(genMask)` → `execute` 整图。验收：`palm_tree` 与 `palm_tree_mask` **同宽高**。

### 4b. 碰撞 mask 旁路（**默认必做**，物体几何信息）

与主链**并行**，产出 **`语义名_mask`**：物体与地面接触的**底面实心碰撞区域**（纯黑）；AI 生成阶段含线框，经 **`image_remove_wireframe`** 后只保留实心黑；
与物体贴图 **同抠图轮廓、同最终像素尺寸**，供场景 `geometryJson.collision_mask` / 落地语义使用。

#### 参考图铁律（**禁止两条独立文生图**）

`genMask` **不是**「再开一条只有碰撞提示词的文生图」——它是 **图生图（image-to-image）**，**必须**把主链物体成品当参考：

```
gen.image ──→ genMask.image     （必填！主链 ImageGen 的 image 输出口）
```

| | ❌ 错误（实测 Sino 会犯） | ✅ 正确 |
|---|---------------------------|---------|
| 连线 | 只有 `maskPrompt → genMask.prompt`，**没接** `gen.image` | **`gen.image → genMask.image`** + `maskPrompt → genMask.prompt` |
| 语义 | 两个 ImageGen 各画各的，物体与 mask **可能不是同一棵/同一姿态** | mask 在**已生成物体图**上标注底面碰撞区 |
| 下游 | `cut_by_mask` 用 `nobg.mask`（来自**主链物体**抠图）对齐 → **轮廓对不上**、碰撞区飘移 | AI 参考物体图 → 剪影与物体 **同轮廓、同姿态** → CutByMask 可对齐 |
| 提示词 | 「不改变物体姿态」在纯文生图里**无法保证** | 参考图 + 提示词共同约束 |

**为什么必须接参考图：**

1. 碰撞 mask 的语义是「**在这张物体图里**标出地面接触底面」——不是重新想象一个物体。
2. `cutMask` 的 `mask` 口接的是主链 **`nobg.mask`**（由**物体贴图**抠出）；`genMask` 若不参考同一物体，512 档 AI 图与 nobg 轮廓 **无法对齐**。
3. 后续 `image_object_geometry` 要求 **sprite 与 mask 同尺寸、同物体**；独立生图会导致几何计算失真。

**搭链 / 验收 checklist：**

- `applyBatch` 里必须有边：`source: { nodeId: 'gen', port: 'image' }` → `target: { nodeId: 'genMask', port: 'image' }`
- `pipeline.get` 后 **肉眼数边**：找不到 `gen → genMask` 的 `image` 连线 = **不合格，补连后再 generateImage**
- 运行顺序：**先** `generateImage(gen)`（物体图必须先存在），**再** `generateImage(genMask)`（此时 `gen.image` 才有 alias 可读）

#### 数据流

```
maskPrompt.output ──→ genMask.prompt
gen.image ──────────→ genMask.image          （主链 ImageGen 物体图 = 参考图）
size512.output ─────→ genMask.imageSize      （固定 "512"）
genMask.image ──────→ cutMask.image
nobg.mask ──────────→ cutMask.mask           （主链 RemoveBG 的 mask 口，对齐抠图区域）
cutMask.image ──────→ dewire.image           （image_remove_wireframe：去线框，只留实心黑）
scaleW.value ───────→ pixscaleMask.width     （与主链 pixscale 相同参数）
scaleH.value ───────→ pixscaleMask.height
lockToggle.value ───→ pixscaleMask.lock_aspect
dewire.image ───────→ pixscaleMask.image ──→ outMask.image
nameMask.output ────→ outMask.name           （= 语义名 + "_mask"）
```

#### 节点与端口（op id 以 `batteries.get` 为准）

| 节点 | op id | 要点 |
|------|-------|------|
| `maskPrompt` | `text_panel` | **固定提示词**（见下，只替换 `【xxx】`） |
| `genMask` | `image_gen` | **图生图**（非独立文生图）；**`gen.image` → `genMask.image` 必填**；`imageSize` = `"512"` |
| `size512` | `text_panel` | `params.text = "512"` → **`genMask.imageSize`**（`connect` **`source.port:"output"`**） |

> ⚠️ **`image_gen` 默认 `imageSize` = `2K`**。碰撞 mask 的 `genMask` 必须锁 **512**（`size512` 连线 + `generateImage` 传 `imageSize:"512"` 双保险）。
| `cutMask` | `image_cut_by_mask` | `image`←`genMask.image`，`mask`←**`nobg.mask`** |
| `dewire` | `image_remove_wireframe` | `cutMask.image` → 去线框，**只保留底面实心纯黑区域** |
| `pixscaleMask` | `image_pixel_scale` | **width/height/lock_aspect 与主链 `pixscale` fan-out 同一组常量** |
| `outMask` | `image_output` | `name` = `{语义名}_mask` |

**不要**对 mask 旁路接 `image_remove_bg` / `image_pixel_fix`。主链 `nobg` 仅服务物体贴图并产出 **`nobg.mask`** 供 CutByMask 对齐；mask 旁路在 CutByMask 之后 **只接 RemoveWireframe → PixelScale**。

#### 碰撞 mask 提示词（固定原文，禁止改写）

`maskPrompt.params.text` **只把 `【xxx】` 换成语义名**（如 `palm_tree`、`棕榈树`），**其余字句一字不改**：

```
生成一张黑白染色剪影图像，白色背景，把图中物体看成一个 3D 立体物体【xxx】，将物体内的和地面实际接触的底面实心碰撞区域范围绘制为实心纯黑色，其余部分保留透明和极细线条边框，不包含杂色，不包含文字、不包含阴影、不超出物体实际图像范围、不改变物体姿态。黑色图层最高
```

#### 运行顺序（两个 ImageGen）

1. **`generateImage(gen)`** — 物体贴图（主链）
2. **`generateImage(genMask)`** — 碰撞剪影（**必须等 gen 已有图**；`generateImage` **显式带上述完整 prompt**）
3. **`pipeline.execute` 整图** — 跑主链 `nobg`→`pixfix`→`pixscale`→`out` **与** `cutMask`→`dewire`→`pixscaleMask`→`outMask`

#### 验收

- `out` 与 `outMask` 的 `out_width`/`out_height`（或 execute 摘要）**一致**
- `cutMask` / `dewire` 无 error；mask 图**仅底面实心黑**，线框已被 RemoveWireframe 去掉
- **`geom` 几何 JSON 语义审查通过**（或已用尽 4 次 genMask 重试仍如实上报）
- 发布时：贴图 alias → `assetName`；mask alias → `assetName_mask`（或契约单独条目），见 `/texture-pipeline`

#### 何时省略

仅当用户明确：**「不要碰撞 mask / 不要几何贴图 / 只要一张贴图」** 时，不建 `genMask`/`cutMask`/`outMask` 旁路。

### 4c. 放置几何（**默认必做**，场景 object 导入）

mask 旁路产出 footprint 图后，用 **`image_object_geometry`**（ObjectGeometry）从 **同尺寸** 的物体贴图 + 碰撞 mask 计算场景放置几何，对齐 wb-scene-generator 资产库 `geometry_json` 规范：

| 量 | 单位 / 坐标系 | 说明 |
|----|----------------|------|
| `anchor_x` / `anchor_y` | **0~1，左下角原点** | footprint **底边中心**；`0=左/底`，`1=右/顶` |
| `collision_mask` | **0~1 矩形两角点** | `collision_category:"Rectangler"` + `[[uMin,vBottom],[uMax,vTop]]` |
| `object_height` | **像素** | sprite 可见顶 → footprint 底边的垂直跨度 |
| `geometry_json` | string | 上述字段 + `pivot` 的 JSON，**直接** `publishToGame.geometryJson` |

#### 数据流

```
pixscale.image ──────→ geom.image          （主链物体贴图，与 mask 同尺寸）
pixscaleMask.image ──→ geom.mask           （mask 旁路最终 footprint 图）
geom.geometry_json ──→ （发布时 asset2d:publishToGame.geometryJson）
geom.anchor_x / anchor_y / object_height ─→ publishToGame.anchorX / anchorY（与 geometry_json.pivot 一致）
```

#### 发布进场景沙箱（Sino / texture-pipeline）

1. `scene:library.useGameTextures` → 记下 **`projectRoot`**
2. `asset2d:publishToGame`：

```json
{
  "alias": "<主链 out 的 alias>",
  "gameSlug": "<slug>",
  "assetName": "palm_tree",
  "assetType": "object",
  "projectRoot": "<①反推>",
  "anchorX": <geom.anchor_x>,
  "anchorY": <geom.anchor_y>,
  "geometryJson": "<geom.geometry_json 整段字符串>"
}
```

3. `scene:library.list` 核对 object 已进沙箱；场景 `RandomNaturalDecoration` 等用 **`assetName`** 散布。

> mask 图（`xxx_mask`）可单独入库备查，**发布 billboard 用主链贴图 alias**；几何写在主 object 的 `geometryJson` 里，不必再发 mask 文件。

#### 4c.1 碰撞几何 JSON 审查（Agent **必做**，发布前）

`image_object_geometry` 跑完后，**必须**读出 `geometry_json` / `anchor_x` / `anchor_y` / `object_height`，**向用户解释各字段含义**，并按物体语义判断是否合理。

**几何量含义（左下角原点，0~1 归一化 + 像素高度）**

| 字段 | 含义 | 场景里干什么 |
|------|------|----------------|
| `anchor_x` / `anchor_y`（=`pivot`） | 物体**落地锚点**：`x` 0=左 1=右；`y` 0=底 1=顶。通常落在 **footprint 底边中心** | 散布/放置时锚点对齐格子；渲染时 sprite 锚点落位 |
| `collision_mask` 两角点 | **地面接触 footprint 外接矩形**（`[[uMin,vBottom],[uMax,vTop]]`，顺序可交换） | 换算成格子占地宽度/深度（÷16 PPU） |
| `object_height` | **像素**：sprite 可见顶 → footprint **底边**的垂直跨度 | `ceil(object_height/16)` = 场景里占几层高度 |

**合理性快检（按语义，不是死规则）**

- **落地类**（石块、树、灌木）：`anchor_y` 应**偏小**（近底边）；`collision_mask` 的 `vBottom`/`vTop` 应在图像**下半部**（贴地），不应整框飘在天上。
- **footprint 大小**：石块/树桩 → 碰撞矩形宽度通常**中等、偏扁**；不应占满几乎整张图（除非物体本身就是大盘子）。
- **`object_height`**：应**小于等于** sprite 像素高度，且与视觉体量一致（小草丛 < 大树）；不应为 1px 级或等于整图高却明显不合理。
- **对称物体**：`anchor_x` 宜在 footprint 水平中心附近（≈0.5）。

**离谱示例（应触发重试）**：footprint 矩形在图像顶部；`object_height` 与可见物体严重不符；碰撞区面积极小却标成大树；锚点远离底面接触区。

#### 4c.2 碰撞 mask 重试（最多 **4 次**生图，**保留**已有结果）

若审查判定几何**语义明显不合理**：

1. **再次** `generateImage(genMask)`（同一 `genMask` 节点，带完整碰撞提示词 + `imageSize:"512"`）→ `pipeline.execute` 跑 `cutMask` 下游 → 重读 `geom` 输出。
2. **同一轮任务最多尝试 4 次**（含首次共 4 次 `generateImage(genMask)`）；仍不合格 → 走 [§4c.3 人工近似几何](#433-人工近似几何4-次重试仍不理想时)（**不要**静默发布离谱的自动结果）。
3. **禁止删除**已有节点、连线、或资产库中已生成的 alias/入库记录。重试产生的新图自然留在 staging；**满意之前**可对 `outMask` 设 **`overwrite:false`** 或暂不入库 mask，避免覆盖；主链物体贴图**不要**因 mask 重试而重跑。
4. 每次重试向用户简短说明：**哪项几何不合理**、**第几次尝试**、**是否改善**。

```
attempt 1: generateImage(genMask) → execute → geom → 审查
attempt 2–4: （若离谱）再 generateImage(genMask) → execute → geom → 审查
仍不理想: §4c.3 人工填近似 geometry_json → publishToGame
满意后: publishToGame(geometryJson)   （自动 geom 或人工 geom 二选一）
```

#### 4c.3 人工近似几何（4 次重试仍不理想时）

AI 生图 mask **不稳定**时，允许 Agent **参考前面各轮审查记录 + 物体贴图视觉 + 16 PPU 语义**，**自己填一套接近合理的几何**再发布——**不必**再死磕 `genMask`。

**何时用**

- 已用尽 **4 次** `generateImage(genMask)`，或明显继续重试收益很低；
- 主链**物体贴图**已满意，只是自动 `geom` / mask 链几何离谱；
- Agent 能根据**先前分析**（哪项不对、贴图宽高、物体类型）给出**可解释的近似值**。

**怎么填（格式不变）**

手工构造与资产库一致的 JSON 字符串，经 `publishToGame.geometryJson` + 同值的 `anchorX`/`anchorY` 发布：

```json
{
  "object_height": 36,
  "collision_category": "Rectangler",
  "collision_mask": [[0.25, 0.02], [0.75, 0.18]],
  "pivot": [0.5, 0.02]
}
```

| 字段 | 人工填写要点 |
|------|----------------|
| `anchor_x` / `pivot[0]` | 对称物体 ≈ **0.5**；明显偏心则按视觉底面中心估 |
| `anchor_y` / `pivot[1]` | **贴地**：≈ footprint 底边 `vBottom`，通常 **0~0.15**（视贴图而定） |
| `collision_mask` | 底面占地矩形：`[[uMin,vBottom],[uMax,vTop]]`，**左下角原点 0~1**；石块/树桩 → 偏扁、位于图像**下半** |
| `object_height` | **像素**；≈ sprite 可见高度或契约 16 PPU 目标（如 48px 宽树 ≈ 40–48px 高），≤ 贴图 `heightPx` |

**估算时可对照**

- 贴图最终 **`out_width` × `out_height`**（pixscale 后像素尺寸）；
- 16 PPU 表（§场景 object 尺寸）：3m 大树 → 宽约 48px，footprint 约 2–3 格宽；
- **前面各次 `geom` 输出**：取「最不离谱的一项」作起点再微调，勿凭空乱填。

**必须向用户说明**

1. 自动 mask/geom **为何不理想**（引用前面审查）；
2. **人工值各是多少、含义是什么**（同 §4c.1 表格）；
3. 标明 **「人工近似几何，非 mask 管线直接产出」**，便于日后人工复核。

**禁止**

- 删已有 genMask 产物、节点或 alias；
- 在无法解释的情况下瞎填（比离谱的自动结果更差时，应停手问用户）。

**发布**

```json
{
  "alias": "<主链 out alias>",
  "assetType": "object",
  "anchorX": 0.5,
  "anchorY": 0.02,
  "geometryJson": "<上表 JSON 字符串>"
}
```

> mask 旁路/`outMask` 可保留作参考，**不强制**用最后一次 mask 图；场景 billboard 仍用**主链贴图** alias。

### 场景 object 尺寸（16 PPU，wb-scene-generator）

PART A 产物要进场景 billboard（植被 / 道具）时，按 **16 PPU = 16px = 1m** 定 `image_pixel_scale`：

| 语义示例 | 实物体量 | `width` | `height` | `lock_aspect` |
|---|---|---:|---:|---|
| `grass_tuft` | ~0.75m | 12 | 0 | true |
| `bush` | ~1m | 16 | 0 | true |
| `tree_small` | ~2m | 32 | 0 | true |
| `tree_big` | ~3m | 48 | 0 | true |

发布：`asset2d:publishToGame`，`assetType:"object"`，传 **`geometryJson` + `anchorX`/`anchorY`**（来自 `image_object_geometry`，或 §4c.3 **人工近似**）。场景散布见 `/texture-pipeline` §3.1。

#### `image_output` 命名要点（落库名怎么填）

`image_output` 有三个可控项，按下面的规范填写：

- **`name`（名称，输入端口）**：用户起的人类可读名（如「圣诞树测试」），落到资产记录的
  **显示名字段**——也就是资产库卡片标题、检索与重命名所用的名字，支持中文。
  填写方式二选一：
  1. **节点 param 直填**：`updateNode` 设 `out` 节点 `params.name = "圣诞树测试"`；
  2. **连端口**：用一个 `text_panel` 输出「圣诞树测试」连到 `image_output.name`。
- **`tags`（标签，输入端口，list）**：附加检索标签（如 `["xmas","tree"]`），同样可 param 直填或连线。
- **`overwrite`（覆盖同名，param，默认 `true`）**：当资产库已存在**同显示名**的资产时，
  `true` 表示就地覆盖该资产（沿用其底层文件位置），`false` 表示另存为一条并自动加 ` (2)` 后缀。
  重复跑同名入库、希望始终保持一条时用默认 `true`。

资产的 **`alias`（机读文件名）始终由后端自动生成**（形如 `ai-…-image_output-xxxx.png`，仅含
英文与数字）。用户的中文名落在**显示名 `name`** 上，二者各司其职：`alias` 供机器/URL 引用，
`name` 供人识别与检索。要核对命名是否落上，用 `asset2d:assets.get <alias>` 看记录的 `name` 字段。

### 5. 跑下游、截图、迭代

> 🛑 **顺序铁律（含碰撞 mask）**：
> 1. **`generateImage(gen)`** — 物体图先出来
> 2. **`generateImage(genMask)`** — 碰撞剪影（参考 gen.image；可显式带 prompt）
> 3. **`pipeline.execute` 整图** — 跑 RemoveBG、主链后处理、CutByMask、双路 PixelScale、双路 output
>
> `image_gen` 是 `manualTrigger` 数据边界——`pipeline.execute` **不会**替你触发它。
> 若跳过点运行、直接 execute 下游，`nobg`/`cutMask` 会吃到空 image → 失败或空产出。

1. `asset2d:pipeline.execute`（跑整图 / 指定下游 nodeId）—— 注意这不会重触发已点过的 image_gen
2. `asset2d:screenshot.capture` / `asset2d:preview.latest` / `asset2d:preview.selectAsset` 看结果
3. `asset2d:assets.list` 看落库资产
4. 用美术师的眼光点评（构图、抠净没有、像素网格干不干净、尺寸对不对），不对就回到第 3/4 步改图再 `execute`
   （改提示词重生成则**新建或明确告知用户**，避免误以为能对旧 image_gen 再点一次）
