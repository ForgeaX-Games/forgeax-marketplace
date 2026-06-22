# PART C · 指定形状的房屋生成（HouseTemplate 底图引导）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART C** 的完整执行步骤。

> **定位**：生成 **一整张、覆盖整栋建筑轮廓** 的装饰性房屋贴图（通常作 object/billboard）。
> **不是**日常场景里「结构化建筑」（模板组 + 内置墙材）的默认做法；**也不是**一般 object（PART A）或 tile（PART B）。
> Scene 掩码链（`building_footprint_mask` → `grid_to_json`）**仅当**用户要从场景真实 footprint 驱动 PART C 时才用；也可手写/约定掩码 JSON，不经过 Scene。
> 电池速查（含 `house_template` / `grid_json_to_size` / `image_pixel_scale` 端口）见 [battery-catalog.md](../battery-catalog.md)；
> applyBatch op 写法见 [pipeline-schema.md](../pipeline-schema.md)；公共底座 / 防呆见 [notes/common-base.md](../notes/common-base.md)。

> 目标：生成一栋**轮廓/形状由你指定**的房屋。思路 = 先用 **`house_template`** 把一个
> **房顶掩码**渲染成一张**灰度房屋底图**（顶面深灰、立面带环境光遮蔽明暗、底部有门），
> 再把这张底图作为 **ImageGen 的形状模版** + 一段**强约束提示词**，让 AI 在严格保持
> 灰度图轮廓/体块/比例的前提下"上色"成成品房屋。**默认产出像素图。**
>
> **默认只用一张灰度底图**——形状由掩码精确控制，风格由提示词描述。**仅当用户明确指定了
> 某张参考图、要求把它的风格严格迁移到灰度图上时，才追加第二张风格锚图**（双参考图）。
>
> 与 PART A 的差异：形状模版**不是用户拖进来的现成图，而是本流程用 `house_template` 程序
> 化生成的灰度底图**——形状由掩码精确控制。

整条流程**三步走**：**①出形状底图（HouseTemplate，含 roofType 选择）+ 同源派生底面（house_footprint）+
据掩码算目标尺寸（grid_json_to_size）→ ②写强约束提示词（默认单灰度图；指定风格迁移才加锚图）→
③图生图并运行 → ④像素化 + 按目标尺寸缩放入库（房屋成品 + 底面黑白图一并输出）**。

## C-阶段一 · 先问清需求（动手前必做）

接到"帮我生成一栋 XX 形状/轮廓的房子"时，先问清：

1. **形状从哪来** —— 用户给一个**占地掩码**（二维数组，**0/1/2**：`0`=空、`1`=占地(房顶)、`2`=预设门位），如
   `[[0,2,0],[1,1,1]]`。没有就和用户敲定一个：方形 / L 形 / 多段错落 等。
   > **与 Scene 侧对齐**：从 `building_footprint_mask` 导出的 grid 经 `grid_to_json` 序列化后，**原样**作为 `house_template.spec`。
   > 含 `2` 时按输入门位放置；**无 `2` 时**才用 `doorCount` 随机分配门。也兼容仅 0/1 的旧掩码。
2. **屋顶类型（平屋顶 or 坡屋顶）** —— 这是**装饰性房屋必须先定**的一项：是**平屋顶**（`flat`，
   现代/工业/碉堡/集装箱风，顶面平、外缘一道薄女儿墙）还是**坡屋顶**（`pitched`，民居/小屋/茅草木屋风，
   有屋脊坡面）。据房屋的设定与风格选定，落到 `house_template` 的 **`roofType`** 端口（`pitched`/`flat`）。
   > 用户没明说就按描述判断并和用户确认（如"小木屋/茅草屋"多为 `pitched`，"现代平房/仓库/碉堡"多为 `flat`）。
3. **高度 / 门** —— 房屋多高（`height`，立面投影行数，越大立面越高）。
   > **`height` 必须问清**：装饰性房屋一般 **1–2**（**1 最常见**），最多到 **3–4** 左右。
   > **门位**：spec 含 `2` 时忽略 `doorCount`；无 `2` 时才问 `doorCount`（随机门数）。
4. **成品风格 / 是否做风格迁移** —— 什么材质（木屋 / 砖房 / 茅草顶…）？
   > **默认产出像素图**（pixel art）。**默认只用一张灰度底图**：风格靠提示词描述即可，不强行接锚图。
   > **只有当用户明确给出一张参考图、并要求把它的风格严格迁移到灰度图上**时，才追加这张图作
   > **风格锚图**走双参考图（见 ②/③ 的「风格迁移」分支）。用户没要求迁移就别画蛇添足加第二张图。
5. **是否抠图** —— 是否要透明背景（决定接不接 `RemoveBG`）。
   > 像素风成品在下游接 `PixelFix`（完美像素修复）+ `PixelScale`（按目标尺寸缩放）。

> **底面默认一并输出**：装饰性房屋除成品图外，**默认再用 `house_footprint` 输出这栋建筑的底面黑白图**
> （黑=接触地面的占位、白=背景），与 HouseTemplate 渲染图逐像素对齐，可作放置/碰撞/对齐参考。
> 它吃**同一份房顶掩码 + 同一个 `height`（且 `imageSize` 与 HouseTemplate 一致）**，与屋顶类型无关。

把方案讲清楚（默认："我打算：HouseTemplate（按平/坡屋顶选 roofType）把你给的房顶掩码渲成灰度形状模版
＋ house_footprint 用同一份掩码/高度输出建筑底面黑白图 ＋ grid_json_to_size 据掩码算出目标像素宽高 →
把灰度图喂 ImageGen +『严格遵守灰度图形状、纯色背景、像素风』强约束提示词 → 图生图 → PixelFix 像素化
→ PixelScale 按目标宽高缩放（锁横纵比=false）入库；底面图一并入库"），再进 C-阶段二。

## C-阶段二 · 搭管线并运行

### ① 出形状底图 + 据掩码算目标尺寸

**A. HouseTemplate 把房顶掩码渲成灰度图**

用 **`house_template`**（显示名 HouseTemplate，op id 以 `batteries.get` 为准）：

- 输入端口：`spec`（string，**0/1/2 占地掩码 JSON 字符串**）、`doorCount`（number，**仅 spec 无 2 时**随机门数）、
  `height`（number，高度）、**`roofType`（dropdown：`pitched`=坡屋顶 / `flat`=平屋顶）**；
  参数 `imageSize`（输出边长，默 300）、`seed`（随机门种子，**有预设门位 2 时忽略**）。
- **`roofType` 必填对**：按 C-阶段一定下的屋顶类型设 `pitched` 或 `flat`（默认 `pitched`）。
  它是 dropdown 端口，用 `updateNode` 设 `params.roofType`，或接 `text_panel` 输出对应字符串。
- 输出端口：`image`（image[]，灰度房屋底图，已自动入库并归档到顶层 `.forgeax/grayscale/`）、`error`。
- `spec` 怎么填：把占地掩码二维数组**序列化成 JSON 字符串**填进 `spec` 端口/param，例如
  `"[[0,2,0],[1,1,1]]"`。Scene 侧用 `building_footprint_mask` → `grid_to_json` 得到同格式字符串；
  也可 `text_panel` 手写或 `updateNode` 设 `params.spec`。
- **`house_template` 是普通电池**（非 manualTrigger）：靠 `asset2d:pipeline.execute` 执行，
  不需要、也不能用 `generation.generateImage` 点它。

执行后它的 `image` 输出就是这栋房子的**灰度形状底图**（轮廓/体块/门的位置已确定）。

**B. house_footprint 同源派生建筑底面（默认必接）**

装饰性房屋默认再接一个 **`house_footprint`**（显示名 HouseFootprint）输出建筑底面黑白图：

- 输入端口：`spec`（string，**与 `house_template.spec` 同一份房顶掩码字符串**）、`height`
  （number，**必须与 `house_template.height` 同值**）；参数 `imageSize`（**须与 HouseTemplate 的
  `imageSize` 一致**，默 300）。**与 `roofType` 无关**——底面只由掩码＋高度决定。
- 输出端口：`image`（image[]，黑=底面/白=背景，已入库并归档到顶层 `.forgeax/grayscale/`）、`error`。
- 连法：让喂 `house_template.spec` 的同一路掩码字符串（如 `text_panel.output`）同时连到
  `house_footprint.spec`；同一个 `height` 数值同时喂两者；`imageSize` 两边设成一样。这样底面与
  房屋成品**逐像素对齐**，可作放置/碰撞/对齐参考。
- **`house_footprint` 是普通电池**：靠 `asset2d:pipeline.execute` 执行；其 `image` 在 ④ 单独接
  `image_preview`/`image_output` 入库（**不进图生图链**，底面是辅助产物，保持黑白二值原样）。

**C. grid_json_to_size 据房顶掩码算目标像素宽高**

用 **`grid_json_to_size`**（显示名「网格 JSON 转尺寸」，`helper/data_transform` 下）算出
**目标图像的宽度与高度**（每格 16px：宽=列数×16，高=行数×16），供下游 PixelScale 精确缩放：

- 输入端口：`json`（string，**与 `house_template.spec` 同一份房顶掩码二维数组字符串**）。
- 输出端口：`width`（number=列数×16）、`height`（number=行数×16）。
- 连法：把同一份掩码字符串喂给它的 `json`（可让 `text_panel.output` 同时连 `house_template.spec`
  和 `grid_json_to_size.json`，保持两路掩码一致）。它的 `width`/`height` 在 ④ 连到 `image_pixel_scale`。

### ② 写强约束提示词（默认单灰度图；指定风格迁移才加锚图）

用 **`text_panel`** 写提示词。**核心两条硬约束（任何分支都要写）**：

1. **务必严格遵守灰度图的形状**：成品的形状/轮廓/结构/比例与灰度图**完全一致**，房顶∶墙面∶门
   占比与灰度图**完全一致**，不得增删、延伸、旋转或越出灰度轮廓，白色区域保持为空。
2. **生成纯色背景图**：背景为**单一纯色**（solid plain background），便于下游抠图/像素化。

**默认分支（单灰度底图，像素风）推荐骨架**：

```
绘制一栋【古朴小楼】：像素风、细节完整丰富且统一、纯色背景（单一纯色，无渐变无图案）。
结构严格依据这张灰度形状模版：成品的形状/结构/比例与灰度图完全一致；房顶∶墙面∶门 的占比
与灰度图完全一致；不得增删、延伸、旋转或越出灰度轮廓，白色区域保持为空。
```

> 英文等价骨架（强约束动词更稳）：
> `Subject: <古朴小楼…>, pixel art, complete & coherent details. STRICTLY follow the gray`
> `template's SHAPE: match its silhouette, structure and the roof:wall:door proportions`
> `EXACTLY; do NOT add/extend/rotate beyond the gray outline; keep white areas empty.`
> `Solid plain (single flat color) background.`

**风格迁移分支（用户指定了一张参考图、要求把其风格严格迁移到灰度图上 → 双参考图）**：

在上面两条硬约束基础上，**把"形状"与"风格"分别点名**——形状照灰度图、风格照锚图：

```
按照【风格锚图】（image #2）的画风/配色/笔触，绘制这栋房屋；像素风、纯色背景。
结构严格依据【灰度形状模版】（image #1）：形状/结构/比例与灰度图完全一致；房顶∶墙面∶门 的
占比与灰度图完全一致；不得增删、延伸、旋转或越出灰度轮廓，白色区域保持为空。
```

要点（按重要性排序）：
- **两条硬约束（严守灰度图形状 + 纯色背景）任何分支都要写**，这是 PART C 的成败关键。
- **强约束动词**：`完全一致 / EXACTLY / 不得增删延伸越出 / 白=空`，而不是软描述，防止模型自行扩成大房子。
- **比例点名**：明确"房顶∶墙面∶门 比例与灰度图完全一致"，这是装饰房最容易跑偏的一处。
- **别写与掩码冲突的轮廓词**（掩码是方的就别写"圆塔/尖顶"）。
- 风格迁移分支才把锚图点名为 image #2、灰度模版点名为 image #1，并分别交代各自管什么。

### ③ 图生图并运行

把 ① 的灰度形状模版接到 `image_gen` 的参考图输入，把 ② 的提示词接到 `prompt`：

- 连边：
  - `text_panel.output → image_gen.prompt`
  - `house_template.image → image_gen.image`（**默认单图，直接一条边进**）
- **风格迁移分支（双参考图）才需 merge**：⚠️ 后端 `resolveNodeImageInputs` 对 `image_gen.image`
  **只读一条进边**——两张图各连一条边只生效第一张。要两张都用，就先把 `house_template.image`
  与风格锚图 `image_source.image`（用户给的参考图）**用 `tree_merge` 电池合并成一路**（op id =
  **`tree_merge`**，来自 `batteries.list` 的 datatree 类），再用**这一条边**连 `image_gen.image`。
  示例：`createNode opId:"tree_merge"` → `house_template.image → tree_merge.item_0`、
  `image_source.image → tree_merge.item_1` → `tree_merge.tree → image_gen.image`。
- 顺序铁律（同 PART A/B）：
  1. **先 `asset2d:pipeline.execute`** 跑 `house_template`（+ `grid_json_to_size`，风格迁移时再 + merge），
     确认灰度模版/目标尺寸/合并值已就绪（`assets.list`/`preview` 可见）；
  2. **再对 `image_gen` 调一次 `generation.generateImage`**（只给 `nodeId`，后端自动取已连好的
     `prompt` + `image` 运行）——`image_gen` 是 manualTrigger 数据边界，**每节点只点一次**。

```json
{ "toolId": "asset2d:generation.generateImage",
  "args": { "nodeId": "<image_gen 的 nodeId>" },
  "caller": { "kind": "ai" } }
```

> 风格迁移分支也可显式覆盖：`args.images` 直接给**两张图的 alias 数组**（`[灰度模版 alias, 风格锚图 alias]`）、
> `args.prompt` 给提示词。传了就用你传的、不读画布——这是绕开"只读一条边"最稳的写法。

### ④ 像素化 + 按目标尺寸缩放 / 抠图 / 入库

成品默认走像素链：`image_gen.image →（按需 image_remove_bg）→ image_pixel_fix → image_pixel_scale → image_preview → image_output`。

- **PixelScale 用目标宽高、锁横纵比=false**（关键）：把 ① 的 `grid_json_to_size.width` / `height`
  分别连到 `image_pixel_scale` 的 `width` / `height` 输入；`toggle.params.value=false` →
  `image_pixel_scale.lock_aspect`（connect 时 **`source.port:"value"`**，不是 `text`）。
  让成品精确缩放到「掩码列数×16 × 行数×16」（16×18 格 → **256×288**，2026-06-16 实测可命中）。
  - 连边：`grid_json_to_size.width → image_pixel_scale.width`、`grid_json_to_size.height → image_pixel_scale.height`；
    `toggle.value → image_pixel_scale.lock_aspect`。
  - 若只得到 256×144 一类「宽对、高随图比例走」的结果 → 检查 `lock_aspect` 是否仍为默认 true（toggle 未连或 port 写错）。
- **像素风必接 PixelFix**（伪像素→点对点真实像素），再接 PixelScale；**不要用 `image_resize`。**
- 抠图（要透明背景）才接 `image_remove_bg`；命名规范同 PART A 的「`image_output` 命名要点」，**最后一步才改名输出**。
- **底面图一并输出**：把 `house_footprint.image` 单独接一条 `image_preview → image_output`（与房屋成品并列、互不干扰），
  命名建议加 `_footprint`/`_base` 后缀，保持黑白二值原样（**不接 PixelFix/RemoveBG**）。底面与房屋成品同尺寸、逐像素对齐。
- 靠 `pipeline.execute` 跑下游（注意不会重触发已点过的 `image_gen`）。

### ⑤ PART C 实测弯路（禁止再踩）

| 症状 | 根因 | 正解 |
|------|------|------|
| `house_template` `invalid spec`；`grid_json_to_size` → `width=0,height=0` | connect 里 `text_panel` 的 **source.port 写成了 `text`** | 一律 **`source.port:"output"`** |
| 单独 `execute` `houseTpl` 仍 invalid，但整图 execute 正常 | **`execute(nodeId)` 不回溯上游** | 整图 execute 或从 `specPanel` 源头触发 |
| `generateImage` `prompt missing` | 只传 `nodeId` 且上游 panel 空 / port 错 | **`generateImage` 显式带 `prompt`** |
| `pixscale` 256×144 而非 256×288 | `lock_aspect` 默认 true（toggle 未连或 port 错） | `toggle.value(false)` → `lock_aspect`，port=`value` |
| grid 无 `2`（门位） | 未跑 `ArchitectureStructures` | Scene 侧必须先结构层再 `building_footprint_mask` |

**Scene → 2D 掩码来源**：优先把 Scene 侧 `grid_to_json.json` **原样**写入 `text_panel.params.text`，不要手改 JSON。
`specPanel.output` 同时连 `house_template.spec` 与 `grid_json_to_size.json`（同一份 JSON、两处 consumer）。

**迭代**：形状不对 → 改 `house_template` 的 `spec`/`height`/`doorCount`/`roofType`（连带 `grid_json_to_size.json`
**与 `house_footprint` 的 `spec`/`height` 同步**，三者掩码与高度必须一致）再 `execute` 出新底图与新底面，
然后**新建一个 image_gen**（或明确告知用户）重新图生图；只是材质/风格不对
→ 只改 `text_panel` 提示词后同样新建 image_gen 重生。（别对旧 image_gen 再点一次——它是数据边界。）
