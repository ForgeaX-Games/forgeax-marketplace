---
id: texture-pipeline
name: 场景贴图生成管线（现生成贴图编排）
trigger: /texture-pipeline
audience: Sino（场景构图师）的「现生成贴图」扩展 — 此时同时持有 scene:* 与 asset2d:* 工具
---

# 场景贴图生成管线 · 现生成贴图编排 skill

> 这是 **Sino（场景构图师）** 的「现生成贴图」扩展手册。目标：**在用 `/compose-sino-scene`
> 搭场景布局的同时，按需用 2D 资产生成器产出对应的地块贴图 / 场景物件，发布进当前场景
> 项目的私有 `raw` 库，让 billboard 渲染器把它们匹配到体素上**——取代「只能用内置模板
> 资产」的旧做法。
>
> **仅当用户明确说「不要现生成 / 只用内置素材」时**，才跳过 texture-pipeline，全用内置名构图。

> **This skill 是顶层编排**；具体子流程按需展开：
> - 场景构图（你的主业）：`/compose-sino-scene`（`scene:*`，模板组串联 + 全部连图铁律）
> - 2D 资产生成：`/generate-2d-asset`（`asset2d:*`，PART A 单资产 / PART B tileset / PART C 房屋）
>
> ⚠️ **本管线不改变任何连图规则**：`edgeId`、op schema、`in_0` 接谁、PathConnection POI、
> `tree_merge` params 等**一律以 `/compose-sino-scene` 为准**。贴图只是把模板参数 `xxxAsset`
> 从内置名换成契约语义名，并多出「生成→发布→验证命中」三步。

---

## 0. 一句话数据流

```
contract.json (游戏 workspace SSOT)
        │  ①写：场景里每个待贴图语义名 → {type, rule?, size, prompt}
        ▼
场景侧 compose-sino-scene  ──②──►  在模板参数里把 xxxAsset 指到契约的语义名
        │
        ▼
2D 侧 generate-2d-asset  ──③──►  按契约逐项生成 PNG（tile 走 PART B 对齐 rule，object 走 PART A），记下成品 alias
        │
        ▼
scene:library.useGameTextures({ gameSlug })
        ──④──► 先绑定沙箱、从返回 dir 反推 projectRoot（定锚，防两 workbench host root 不一致）
        │
        ▼
asset2d:publishToGame({ alias, gameSlug, assetName, assetType, autotileKind?, projectRoot })
        ──⑤──► 2D 后端把字节写进与④同目录的沙箱（bytes + index.json 描述符）
        │
        ▼
scene:library.list ──⑥──► 核对 targetDir=dir、贴图可见
        │
        ▼
scene:pipeline.execute + screenshot.capture ──⑦──► 验证 billboard 命中，回写契约 publishedAlias
```

**关键不变量**：贴图字节的「创作 SSOT」在 2D 侧 `assets/generated/`；场景库里是「消费副本」，
用 `sourceBlobId` 做 provenance + 幂等去重，保证可追溯、不漂移。

---

## 0.1 起手铁律：每次新任务都自建全新场景项目

**动手第一步永远是 `scene:projects.create` + `scene:projects.open` 建一个全新空项目**，然后在自己的
新项目里从零搭（强制起手式 `empty_scene` → `AddBaseGrid`，见 `/compose-sino-scene`）。

- **严禁复用 / 改写当前 active 项目里已有的图**：即使 `scene:pipeline.get` 看到一张现成的完整场景图，
  那也可能是别的工作画布或只读参考项目（如 Example1）——**不要在它上面改**，新建项目重搭。
- 只有用户**明确**说「继续上次那个项目」时，才 `scene:projects.list` 找回并 open。
- 建完项目后，把这个**新项目 id** 写进契约的 `sceneProjectId`（§1.2），后续发布前一律 open 它。

> 这与 `/compose-sino-scene` 工作流第 1 步是同一条铁律。一个 agent 同一时刻只持一个项目锁，
> 建完即在自己的新项目里干，互不污染。

---

## 0.2 主动出图（禁止等用户说「没有图」）

**场景结构跑通 ≠ 任务完成。** 只要契约或散布链用了**待生成语义名**，贴图就必须在验收前进沙箱。

| ❌ 被动（禁止） | ✅ 主动 |
|----------------|---------|
| 只搭 RandomNaturalDecoration，等用户说「都没图」 | 写契约 → 出图发布 → 再散布 → 截图 |
| 场景 execute + 截图后才想起要 asset2d | **截图前** `library.list` 查契约每个 `name` |
| 「先做一种验证再复制」当契约已列 4 种 | **一次** applyBatch 铺 N 条 PART A |
| 开工前逐个 `batteries.get` 探 op id | 直接照 `/generate-2d-asset` battery-catalog 搭链；**仅 connect 失败再查** |
| shell/glob 找 game 目录 | 用契约 `gameSlug` + `useGameTextures` 定锚 |

**推荐顺序（植被散布典型）**：

```
contract → useGameTextures/projectRoot → 2D 批量 PART A → 批量 publish
    → library.list 全绿 → 场景散布链 → execute → topBillboard 截图
```

结构与贴图可交错，但 **screenshot 声称成功之前，契约内 object/tile 必须已 published**。

---

## 0.3 批量 vegetation 快车道（4 种 × PART A）

契约示例：`grass_tuft`(12px) / `bush`(16) / `tree_small`(32) / `tree_big`(48) — 见 §3 尺寸表。

**一个 2D 项目、一次 applyBatch、一次 execute、N 次 publish**：

1. **共享节点**：一组 `scaleW`/`scaleH`/`lockToggle` fan-out 到各链 `pixscale`/`pixscaleMask`（每链 width 不同则用独立 `number_const`）。
2. **每品种一套前缀**（例 `grass_`）：`prompt`→`gen`→`nobg`→`pixfix`→`pixscale`→`out`；`maskPrompt`→`genMask`←**`gen.image`**→`cutMask`→`dewire`→`pixscaleMask`→`outMask`→`geom`。
3. **运行**：4× `generateImage(gen*)` → 4× `generateImage(genMask*)` → **1×** `pipeline.execute`。
4. **发布**：4× `publishToGame`（`assetType:object` + `geometryJson`；同一 `projectRoot`）。
5. **验收**：`library.list` 四个 `assetName` 均有、`widthPx` 对表。

PART A 细节（mask 参考图、512、几何审查）见 `/generate-2d-asset` §4b–§4c；**不要**为此重读全文，按上表搭即可。

---

## 1. 命名契约（contract.json）—— 两 app 的文件通信 SSOT

### 1.1 位置（固定）

```
<active_game>.dir/texture-pipeline/contract.json
```

- `<active_game>.dir` 是 agent `produces` 已经在用的游戏 workspace 令牌，落在**当前游戏项目**下，
  **不是**任一 workbench app 隔离的 `FORGEAX_PROJECT_ROOT`（那两个互相看不见）。
- 这是 **plugin 内部格式**，只给本管线用；用你的通用文件读写工具(read/write file)直接读写它。
- 不存在时先创建（`schemaVersion: 1` + 空 `assets: []`）。

### 1.2 schema

```jsonc
{
  "schemaVersion": 1,
  "gameId": "<当前游戏 id>",
  "sceneProjectId": "<scene 侧 project id，发布前必须 scene:projects.open 它>",
  "style": "低分辨率像素 / 16px / 统一色板…",   // 全局风格约束，喂给 2D 生成
  "assets": [
    {
      "name": "grassland",          // ★ field4 语义名：场景模板参数 xxxAsset 与发布 alias 都以它为准
      "type": "tile",               // "tile" | "object"
      "rule": "common_16",          // type=tile 必填，取值见 §2 对照表；object 省略
      "sizePx": 16,                 // 单 cell 尺寸（tile）或物件目标边长（object）
      "prompt": "茂密草地，俯视，无缝平铺",
      "status": "pending",          // pending | generated | published | verified
      "sourceBlobId": null,         // ③生成后填：2D 侧产物 blob id（幂等键）
      "publishedAlias": null        // ④发布后填：场景库里的完整 bracket alias
    }
  ]
}
```

- **`name` 是贯穿全链的唯一锚点**：场景模板的 `xxxAsset` 参数填它、2D 生成产物按它命名、
  发布时 `assetName` 传它、最终渲染器按 alias field4 匹配它。全程别改写它。
- 每完成一步就回写对应条目的 `status` / `sourceBlobId` / `publishedAlias`，让中断可续。

---

## 2. tile 模板：必须对齐 autotile rules

`type=tile` 的贴图不是一张平图，而是一个 **atlas（瓦片组）**，渲染器按四邻 voxel 的
邻接状态从 atlas 里取对应 sprite（autotile）。所以 **2D 侧生成的 atlas 瓦片数 / 布局必须
和契约里声明的 `rule` 一一对齐**，否则渲染器按规则取 sprite 会越界 / 错位。

### 2.0 默认路径：地块 / 草坪 / 铺地（⚠️ 铁律）

用户要「生成 XX 地块 / 草坪 / 草地瓦片 / 铺进场景 / AddBaseGrid 底图」时：

| ✅ 必须做 | ❌ 禁止做 |
|---|---|
| PART B 全链：`terrain_extract` → **`image_atlas_compose`** + 内置模版 → `image_output` | 只 `terrain_extract` 单图就发布 |
| 契约 `rule: "common_16"` | 默认 `floor_1`「省事」捷径 |
| 发布 `autotileKind: "common_16"`，atlas **64×80**（标准）或 64×64 | 16×16 单格 PNG 当 tile |
| 发布 **atlas 成品 alias**（`image_output` 或 `atlas_compose` 输出） | 发布 `terrain_extract` 中间态 |

**内置模版（标准 tile 模板）**：`preset:tiles/tile模板.png`（从 `asset2d:assets.list` 取 alias+blobId）
→ 建 `image_source` 节点，`params.image` 填 JSON → 接 `image_atlas_compose.template`。

**`floor_1` 仅当**用户**明确**说「单格平铺、不要邻接 autotile / 不要标准 tile 模板」时才用。

### 2.1 rule 对照表（`assets/rules/*.json`，全部 ppu=16）

| rule (`assetKind`) | cell 数 | faces | 用途 | atlas 要求 |
|---|---|---|---|---|
| `floor_1` | 1 | top | 纯地板/单格平铺（**非默认**） | 16×16 单格；仅用户明确不要 autotile 时用 |
| `fence_7` | 7 | top | 栅栏/线性边界 | 7 格（端/直/拐/交） |
| `slope_9` | 9 | top | 斜坡 | 9 格 3×3 邻域 |
| `bridge_horizontal_9` | 9 | top | 横向桥面 | 9 格横向序列 |
| `flower_bed_11` | 11 | top | 花圃/装饰地块 | 11 格 |
| `bridge_vertical_15` | 15 | top | 纵向桥面 | 15 格纵向序列 |
| `common_16` | 16 (+4 变体可选) | top | 通用地块（草/土/水…） | 4×4=16 邻域格；atlas **64×64**（无变体行）或 **64×80**（含第 5 行变体） |
| `wall_outer_16` | 16 | top+front | 外墙（带正面） | 16 格 + front 面 |

> cell 数 = rule 名后缀。`common_16` 是**地块/草坪/铺地默认**（§2.0）；`floor_1` 仅「单格、不要 autotile」；
> 线性物 → `fence_7` / 桥；外墙 → `wall_outer_16`。

> **默认 rule**：地块 / 草坪 / 铺地 / AddBaseGrid 底图 → **`common_16`** + PART B atlas（§2.0）。
> `floor_1` 不是「验证捷径」，用户要的是标准 tile 模板。
> 其它 rule 仅在语义需要特殊邻接形态时在契约里显式指定（栅栏/坡/桥/外墙等）。

### 2.2 生成对齐（交给 `/generate-2d-asset` PART B）

1. 进 2D 项目，**必须走 PART B**（含 `image_atlas_compose`，两路 `terrain`+`template` 都接）。
2. 内置模版 `preset:tiles/tile模板.png` → atlas **64×80** → 对齐 **`common_16`**（发布时后端校验尺寸）。
3. `image_terrain_extract.size` 建议 **≥128**（给 atlas 滑窗选 patch 用；**不是**发布尺寸，发布尺寸由 atlas 决定）。
4. 语义名：`text_panel` → **`image_output.name` 端口连线**（name 不是 params 字段）；发布 `assetName` 以契约为准。
5. 记下 **`image_output` / `image_atlas_compose` 成品 alias**（64×80 PNG），**不要**拿 `terrain_extract` 中间态去发布。

### 2.3 标准配方照抄（蓝草 / 草地类 tile，可直接复用）

```
contract: { name:"蓝草地块", type:"tile", rule:"common_16", prompt:"..." }

2D 链:
  tp_prompt(text_panel, params.text=提示词)
    → gen(image_gen)           ← generateImage(nodeId, prompt)
    → tex(image_terrain_extract, size=128 via number_const)
    → tpl(image_source, image={alias:"preset:tiles/tile模板.png", blobId:...})
    → atlas(image_atlas_compose, terrain←tex, template←tpl)
    → name_panel(text_panel, params.text=蓝草地块) → out(image_output.name)
    → atlas.image → out.image

  pipeline.execute → 成品 alias, 预期 64×80

发布:
  scene:library.useGameTextures({gameSlug}) → projectRoot
  asset2d:publishToGame({ alias:<atlas成品>, gameSlug, assetName:"蓝草地块",
    assetType:"tile", autotileKind:"common_16", projectRoot })

场景:
  AddBaseGrid.in_4(BaseAsset) ← text_panel "蓝草地块"
  renderer.setViewMode → topBillboard → execute → 截图/用户目视
```

### 2.4 发布（§4）时

`asset2d:publishToGame` 传 `assetType:"tile"` + `autotileKind:"<rule>"`。发布时后端会**校验 atlas PNG 尺寸**
是否与 rule 对齐（尺寸不对直接 422 拒绝，避免进库后 autotile 切图错位）。`common_16` 允许 **64×64**
（无变体行）或 **64×80**（含 randomRules 变体行）；其余 rule 须精确匹配 `assets/rules/<rule>.json`
里全部 sprite 的外接矩形。场景读沙箱时据此组出
`cropTypeOriginal='瓦片组'` + `assetKind=<rule>`，渲染器 `deriveAliasMeta` 据此精确加载
`assets/rules/<rule>.json` 做邻域 autotile（这条路覆盖 field[8] 旧映射够不到的 rule，如 `slope_9`）。

---

## 3. object 场景对象资产（非地块）

`type=object`：道具 / 装饰 / **植被** / 房屋拆件等，渲染器走 **cutout（抠图）池**，不参与 autotile。

1. 交给 `/generate-2d-asset` **PART A 单资产**：文生图 → 抠背景 → 像素化 → 定尺寸 → 入库 **+ 默认碰撞 mask 旁路**（`xxx` + `xxx_mask`）。
2. **16 PPU 尺寸约定**（场景 wb-scene-generator 默认 **16px = 1m**）：

| 用途示例 | 实物体量 | `image_pixel_scale.width` | `height` | `lock_aspect` |
|---|---|---:|---:|---|
| 小草丛 `grass_tuft` | ~0.75m | 12 | 0 | true |
| 灌木 `bush` | ~1m | 16 | 0 | true |
| 小树 `tree_small` | ~2m | 32 | 0 | true |
| 大树 `tree_big` | ~3m | 48 | 0 | true |

典型 PART A 链（**默认双产出**）：

```
[贴图] prompt → image_gen → remove_bg → pixel_fix → pixel_scale → image_output (name=语义名)
[mask] maskPrompt → image_gen_mask (ref=物体图, imageSize=512) → cut_by_mask (mask←主链 remove_bg.mask)
       → remove_wireframe → pixel_scale (同参) → image_output (name=语义名_mask)
[几何] pixscale.image + pixscaleMask.image → image_object_geometry → geometry_json + anchor_x/y + object_height
       → publishToGame(assetType:object, geometryJson, anchorX, anchorY)
```

3. **几何信息**：`image_object_geometry` 从 footprint mask + sprite 计算锚点（0~1 左下角）、碰撞矩形（两角点归一化）、`object_height`（像素）。发布时 `geometryJson` + `anchorX`/`anchorY` 写入沙箱 object 描述符；场景 `RandomNaturalDecoration` 用 `assetName` 匹配。
4. 发布传 `assetType:"object"`（**不传** `autotileKind`）；`library.list` 核对贴图与 `_mask` **宽高一致**、`cropType:抠图`。

### 3.0 整栋建筑贴图（PART C + Scene 掩码 · **专属，非默认**）

> **这是什么**：把场景里**某一栋**的真实 footprint + 门位导出为 0/1/2 掩码，再经 `house_template` 生成 **一张整栋建筑的装饰性贴图**（object/billboard）。
>
> **什么时候才走**：用户**明确**要「按场景形状生成一整张建筑贴图 / 替换这栋的 billboard 贴图」。
>
> **什么时候不要走（绝大多数任务）**：
> - 普通 **object**（树、灌木、道具）→ §3 **PART A**
> - **地块 / tile** → §2 **PART B**
> - **结构化场景构图**（区域 + 盖楼 + 道路…，`ArchitectureStructures` 用内置墙材）→ `/compose-sino-scene` **照常**，**不**接 `building_footprint_mask`
>
> 与 §3 一般 object 不同：本条路的形状/门位**必须**来自 Scene 结构，不能手写掩码糊弄。

**前置铁律（Scene 侧，在打开 2D PART C 之前必须完成）**：

1. **`ArchitectureRegions`** — 划建筑用地；记下 **`out_1`(BuildingPath)** 路径句柄（形如 `/architecture_0`）。
2. **`ArchitectureStructures`** — 在 Buildings 上盖楼起墙；**此时才生成 `outer_door` 子节点**。仅跑区域、不跑结构 → 掩码里**没有门（无 grid 值 `2`）**。
3. **`scene_focus_path`** — `scene` ← `ArchitectureStructures.out_0`，`path` ← **`ArchitectureRegions.out_1`(BuildingPath)**（与 POI 门路径同一来源；**禁止**用 BaseName 猜路径）。
4. **`building_footprint_mask`** — 输入上一步 focus 好的 `scene`；输出 0/1/2 grid（`2`=门位）。
5. **`grid_to_json`** — `grid` → `json` 字符串；写入 `contract.json` 对应条目，供 2D 读取。

一片多栋：`scene_focus_path` 后接 **`scene_focus_children`** 扇出，再批量 `building_footprint_mask` → `grid_to_json`。

**2D 侧**（`/generate-2d-asset` PART C）：**同一份 `json`** 写入 `text_panel.params.text`，`output` 同时连 `house_template.spec`、`house_footprint.spec`、`grid_json_to_size.json`；spec 含 `2` 时不使用随机 `doorCount`。

**PART C 连边/执行防呆（architecture_0 实测，2026-06-16）**：

| 症状 | 根因 | 正解 |
|------|------|------|
| `invalid spec` / `width=0` | connect `source.port:"text"` | **`output`**（内容在 `params.text`） |
| 单独 execute 中间节点仍失败 | `execute(nodeId)` 不回溯上游 | 整图 execute 或从 spec 源头跑 |
| `pixscale` 256×144 非 256×288 | `lock_aspect` 默认 true | `toggle(false).value` → `lock_aspect` |

验收：`sizeFromGrid` = 列×16 / 行×16；`pixscale.out_width/out_height` 一致；`doorCount>0`。

连图铁律仍以 `/compose-sino-scene`「建筑贴图掩码提取」为准；细节见 `/generate-2d-asset` PART C §⑤。

### 3.1 在草坪上散布多款植被（RandomNaturalDecoration）

贴图进沙箱后，用 **`RandomNaturalDecoration`** 撒到 **AddBaseGrid 铺好的 base** 上。完整连图铁律在 `/compose-sino-scene`「多品种植被链式散布」；此处只列 **texture-pipeline 专属弯路**：

| 弯路 | 正解 |
|---|---|
| 4 个名字塞进**一组** `in_1` + 共用一个 density | **每品种一组**，各接独立 `in_3` density |
| 第一组 `in_0` ← `AddBaseGrid.out_0` 或 `out_2` | **`in_0` ← `AddBaseGrid.out_1`（BaseNode）** |
| merge 接各组 **`out_2`（NaturalDec）** | merge 接各组 **`out_0`（完整 scene）** → `scene_merge_subtrees` → `scene_output` |
| 担心路径 `tree_N` 对不上贴图名 | 渲染看 **`asset_name` 属性**（= 发布的 `assetName`），路径前缀固定 `tree_` 无害 |
| 一组接完直接 `out_2` → `scene_output` | 多品种要 **Rest 链** + **scene 级 merge**，完整可视化走 **`scene_output.scene`** |
| 只跑场景结构，等用户说「没有图」 | **先**契约出图发布，**再**散布；截图前 `library.list` 自查 |
| 逐个 batteries.get / shell 找 game | 用 skill 内 op 表 + 契约 gameSlug；**批量** applyBatch |
| 「先做一种验证再复制」 | 契约 N 项 → **一次**铺 N 条 PART A 链 |

链式 Rest 示意（4 品种）：

```
AddBaseGrid.out_1 → Dec_grass.in_0 ──out_3(Rest)──→ Dec_bush.in_0 ──out_3──→ Dec_treeS.in_0 ──out_3──→ Dec_treeB.in_0
                    单名+密度d1              单名+d2              单名+d3              单名+d4

Dec_grass.out_0 ─┐
Dec_bush.out_0  ─┼→ tree_merge → tree_flatten → scene_merge_subtrees → scene_output
Dec_treeS.out_0 ─┤   （四路都必须是 out_0 = 完整 scene，不是 out_2）
Dec_treeB.out_0 ─┘
```

---

## 4. 发布桥：经共享沙箱（推荐主路径）

字节落进**共享游戏沙箱** `<projectRoot>/.forgeax/games/<gameSlug>/textures/`。**生成的贴图只待在沙箱、和 app 内置（固有）资产物理分开**；场景只是把沙箱**当资产源读取**、和内置资产 merge 显示 + 喂渲染器，**不写任何 app 内部库**。

### ⚠️ host root 对齐铁律（已踩坑，禁止再绕弯路）

2D 与 scene 两个 workbench **各自跑在隔离的 host root**（工具默认 `projectRoot` = 各自 `ctx.cwd`）：
- 2D 侧常见：`.../wb-2d-scene-asset-generator`
- scene 侧常见：`.../wb-scene-generator`（如 `/root/.forgeax/plugins/wb-scene-generator`）

只传 `gameSlug` 不传 `projectRoot` → `publishToGame` 写一份、`useGameTextures` 读另一份 → `library.list` 搜不到 → 白跑一圈再补 `projectRoot`。**禁止先裸发 publish 再发现空库才回头补**。

**正解顺序（定锚 → 发布 → 核对）**：

```jsonc
// ① 先 open 场景项目，绑定沙箱并定锚 projectRoot
scene:projects.open { "projectId":"<你的 sceneProjectId>" }
scene:library.useGameTextures { "gameSlug":"<slug>" }
// → 返回 { dir: "/abs/path/.forgeax/games/<slug>/textures" }
// → projectRoot = dir 去掉末尾 "/.forgeax/games/<slug>/textures"

// ② 逐张发布（必须带与①相同的 projectRoot）
asset2d:publishToGame { "alias":"<2D 成品 alias>", "gameSlug":"<slug>", "assetName":"grassland", "assetType":"tile", "autotileKind":"common_16", "projectRoot":"<①反推>" }
asset2d:publishToGame { "alias":"<2D 成品 alias>", "gameSlug":"<slug>", "assetName":"wooden_barrel", "assetType":"object", "anchorX":0.5, "anchorY":0.02, "geometryJson":"{\"object_height\":48,\"collision_category\":\"Rectangler\",...}", "projectRoot":"<①反推>" }

// ③ 硬核对齐 + 入库可见
scene:library.list { "zone":"raw", "search":"wooden_barrel" }
// publishToGame 返回的 targetDir 必须 === useGameTextures 返回的 dir
```

- **字节铁律（已踩坑两次，别再犯）**：字节由 **2D 后端本地写进沙箱**，agent 全程**不碰 base64**。
  ❌ 绝不把 base64 塞进对话（`getBytes` 转贴 / 手填 `dataBase64`）——几十~几百 KB base64 会被
  **auto-compaction 丢弃** → 死循环。❌ 也别 `read_file`/`glob`/shell 读 2D 侧产物（root 隔离，看不到）。
  ℹ️ `asset2d:assets.getBytes` **已不再回 base64**：它把字节落盘到 `<cwd>/.cache/asset-bytes/…` 并只回一个 `path`，确需像素时才 `read_file`。发布优先 `scene:library.publishExternal({ from2dAlias })`（服务端直传）。
- **gameSlug 怎么填**：契约里记的目标游戏 slug；沙箱绝对路径 = `<projectRoot>/.forgeax/games/<gameSlug>/textures/`，其中 **`projectRoot` 以 scene 侧 bind 返回的 `dir` 反推为准**（不要用 2D 侧默认 cwd 猜）。
- **幂等**：同 `assetName`+`assetType`（或同源 blob）重发 = 原地覆盖 `index.json` 条目，不产生重复。
- 把发布后的成品语义名回写契约 `publishedAlias`/`status:"published"`。
- ℹ️ **旧 `scene:library.publishExternal`（写 app 私有库）已退役为兼容回退**，新流程一律走沙箱。

---

## 5. 场景侧接线（compose-sino-scene）

- 用 `/compose-sino-scene` 串模板组时，把需要贴图的模板参数 `xxxAsset` 填成契约里的 **`name`**
  （= field4 语义名）。`useGameTextures` 绑定后，渲染器匹配池（`aliases-meta?zone=raw`）已合并沙箱贴图，
  所以命中没问题。
- 顺序：**先 `useGameTextures` 定锚 projectRoot → 再 `publishToGame` 带同一 projectRoot → 再接线/执行**，这样首次 execute 就能命中。

---

## 6. 验证（每条都要做，别假设成功）

1. **入库可见**：`scene:library.useGameTextures` 之后，用 **`scene:library.list`**（默认 `zone:"raw"`，
   可带 `search:"<assetName>"`）确认沙箱贴图已并入库列表（私有/沙箱源排在最前、带 `private:true`）。
   > ⚠️ **别用 `scene:assets.list` 核对**——它列的是文件系统素材目录（`<workspaceRoot>/assets`），
   > **看不到** 沙箱/私有库资产；查库一律用 `scene:library.list`。
   > 渲染器匹配池会在 `useGameTextures`/发布广播 `library:changed` 时自动刷新，无需手动重载。
2. **renderer 命中**：
   - 默认 **`scene:renderer.setViewMode` → `topBillboard`**（场景预览默认模式；tile 铺地与 object 都在这里验证 autotile/贴图命中）。
   - `scene:pipeline.execute` 后再 `scene:screenshot.capture`。
   - tile 须看到 **autotile 纹理**（不是纯色网格）；common_16 atlas 进库尺寸应为 **64×80 或 64×64**。
   > ⚠️ **截图视觉可能被关闭**（`FORGEAX_SCENE_SCREENSHOT_NO_VISION`）：**别声称「贴图成功」**——
   > `execute` 返回 cell 数 / 子节点名只说明**网格生成了**，不证明贴图命中。如实说「请用户在画布确认」。
3. **不对就回退**：
   - 用户说「不是标准 tile / 用不了」→ 检查是否**跳过了 atlas**、是否误用 **floor_1**、是否发布了 **terrain_extract 单图** 而非 64×80 atlas。
   - 贴图没出现 → `targetDir`=`dir`；`xxxAsset`=契约 `name`；`sceneProjectId` 正确。
   - tile 接缝错位 → atlas 瓦片数 / `rule` 与 cell 数不匹配，回 §2 重生成。
   - 颜色/风格不统一 → 回 2D 侧按契约 `style` 重生成，同 `sourceBlobId` 重发（幂等覆盖）。
4. 通过后回写契约 `status:"verified"`。

---

## 7. 防呆清单

- **地块 tile 默认 common_16 + PART B atlas**（§2.0）——**禁止**默认 floor_1 / 跳过 `image_atlas_compose`。
- **发布 atlas 成品，不是 terrain_extract 中间态**；common_16 须 64×80（或 64×64）。
- **`image_output.name` 走端口连线**，不是 `params.text`。
- **契约是 SSOT**：名/类型/rule/尺寸只认 `contract.json`，别在 prompt 里另起一套命名。
- **tile 必带 rule**，且 rule ∈ §2 表；object 绝不传 `autotileKind`。
- **op id / 端口**：2D 侧以 `asset2d:batteries.list`/`.get` 为准，场景侧模板以
  `scene:templates.list`/`.get` 为准，绝不凭记忆编。
- **applyBatch 后立刻 get 确认图真的变了**（防「ok 却空」陷阱）。
- **发布走共享沙箱**：先 `scene:library.useGameTextures` 定锚 `projectRoot`，再 `asset2d:publishToGame` 带同一 `projectRoot`。**agent 绝不搬运 base64**（会被压缩丢失→死循环），贴图只在沙箱、不进 app 内部库。**禁止只传 gameSlug 裸发 publish**（两 workbench host root 不同，会落错目录）。
- **先 execute/generate 再 screenshot**，否则截的是旧状态。
- **植被散布**：`AddBaseGrid.out_1` → 装饰链；多品种链式 Rest + 独立 density；merge 用各组 **`out_0`** → `scene_output`（§3.1）。
