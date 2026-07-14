# 资产协作协议（aw-support 编排 · Sino ↔ Mira）

> Sino **只做场景布局，不生成任何图片/贴图/物件**。场景里要用的贴图(tile)与物件(object，可带碰撞)由 **Mira**（2D 资产生成器）生成。本文定义三方如何用一份 **`asset-requirements.json` 契约**协作，以及 Sino 如何导入与验收 Mira 的产物。场景管线的**调度由 aw-support 代码**负责（gate loop 直接派 Sino / 后续 Mira），不再经 LLM 编排 agent。

---

## 一、四阶段流程（aw-support 驱动）

```
① aw-support → Sino：生成场景布局
② Sino → runDir：交付 asset-requirements.json（资产需求清单）
③ aw-support → Mira：③₀ 基准参考图 → ③₁ 按清单逐项生成 → 发布共享沙箱
④ aw-support → Sino：导入沙箱资产、跑图、核对验收（library.list 命中 + execute 无 error）
```

> **③₀ 基准参考图**：进入生成阶段前，aw-support 调度 Mira 用 `conceptual_scene_design` 出一张完整场景实景基准图（统一像素颗粒度/配色/光照/透视），回传 alias；③₁ 每个 tile/object 都把这张基准图作参考做图生图，保证全场景风格统一。基准图通常不入沙箱，只作风格地基。

| 阶段 | 负责 | 动作 | 产出 |
|------|------|------|------|
| ① 布局 | Sino | 用**语义资产名**（写进 `text_panel`）拼完整张场景，`execute` 跑通（先用内置素材占位） | 一张布局完成的场景图 |
| ② 收集需求 | Sino | 汇总场景引用到的每个资产 → 写 `asset-requirements.json` 到 runDir | `asset-requirements.json` |
| ③ 生成 | Mira | ③₀ 基准参考图 → ③₁ 按**内联字段** + **基准图 alias**逐项做图生图，`asset2d:publishToGame` 发布进共享沙箱 | 基准图 alias + 沙箱 `textures/` + `gameSlug` |
| ④ 导入验收 | Sino | `scene:library.useGameTextures` 绑沙箱 → `library.list` 核对 → `execute` 无 error | 每个 `name` 在/缺 + 来源 + 验收结论 |

> **为什么 Sino 能给出 footprint 与 height**：Sino 在布局时本就为建筑/物件设了占地宽高（`PickOneBuilding` 的 AreaWidth/AreaHeight、BuildingHeight 等）、为底图/道路设了语义名。这些参数即资产的尺寸约束，收集需求时直接读出即可，无需另算。

---

## 二A、建筑贴图：从 Scene 导出 footprint JSON（`building_footprint_mask`）

> **禁止手拼矩形 mask。** 要给 `PickOneBuilding` / `PickMultiBuildings` 放出的建筑出整栋 billboard 贴图时，Mira 的 `dechouse_gen.in_0`（`json_mask`）**必须**来自 Scene 侧真实占地，而不是按 `AreaWidth×AreaHeight` 猜一个满矩形。

### 适用 vs 不适用

| 资产类型 | 导出方式 |
|---------|---------|
| **整栋建筑**（`PickOneBuilding` / `PickMultiBuildings` 产物） | ✅ `building_footprint_mask` → `grid_to_json` |
| 地面/道路 tile、小物件 object | ❌ 不走本链路 |

### Scene 侧导出（Sino，布局 `execute` 跑通后）

**单栋（`PickOneBuilding`）——`out_1` 的 focus 已在建筑节点上，可直接接：**

```
PickOneBuilding.out_1 (Building scene, focus=建筑)
  → building_footprint_mask.scene
  → grid_to_json.grid
  → （读 grid_to_json.json 字符串，交给 Mira）
```

**若 focus 不在建筑上**（或需从 BuildingPath 重聚焦）：

```
PickOneBuilding.out_1 ──→ scene_focus_path.scene
PickOneBuilding.out_3 (BuildingPath) ──→ scene_focus_path.path
scene_focus_path.out ──→ building_footprint_mask.scene ──→ grid_to_json
```

**有 `BuildingStructures` + 门时**：`doorNames` 默认 `outer_door`，掩码里门格为 `2`；无结构时通常全是 `1`（仍合法）。

**批量多栋**：各 Pick 组的 `out_1` 分别接一套 `building_footprint_mask` → `grid_to_json`（每栋独立节点，便于逐栋交付）。

### 掩码语义（与 2D `dechouse_gen` 对齐）

| 值 | 含义 |
|----|------|
| 0 | 空 |
| 1 | 占地 |
| 2 | 门（`doorNames` 子树体素） |

输出尺寸 = 体素并集**最小包围盒**（不是 `AreaWidth×AreaHeight` 画布）。

### Mira 侧（`dechouse_gen`）

1. 把 Scene 导出的 **`json` 原样**写入 `text_panel.params.text`，连到 `dechouse_gen.in_0`（`json_mask`）。
2. `in_4` = 建筑语义名（= `PickOneBuilding.BuildingName` = `publishToGame.assetName`）。
3. `in_1` = `BuildingHeight`（来自 Scene 的 `in_2` height 参数）。
4. `in_3` = 基准参考图（风格统一）。
5. 发布：`assetType:"object"`，`assetName` **等于建筑名**（不是地面 tile 名）。
6. **发布 alias 必须来自后处理 `out_3`（`image_despeckle` PNG）**，禁止用 `generateImage` 返回的 JPEG（未抠图白底图）。

### Sino 绑定（阶段④）

- `PickOneBuilding.in_0`（`BuildingAsset`）改为**建筑 object 名**（如 `港口码头`），**不要**再填地面 tile 名（如 `木质栈桥`）。
- 沙箱里删除已废弃的建筑 tile 条目，避免渲染器误命中旧 tile。
- `library.list` 核对建筑名来自 `game-sandbox:` 且尺寸 ≈ `mask.width×16` × `mask.height×16`。

---

## 二、`asset-requirements.json` 契约格式

Sino 在阶段②产出，落在 runDir（`<runDir>/asset-requirements.json`）。aw-support 读取后调度 Mira。

```jsonc
{
  "schemaVersion": 1,
  "gameSlug": "grass-village",
  "sceneProjectId": "p_xxx",
  "assets": [
    {
      "name": "草地",
      "description": "明亮的卡通草地底图，可平铺，低饱和绿色",
      "type": "tile",
      "footprint": { "w": 1, "d": 1 },
      "heightRatio": 0,
      "autotileKind": "common_16",
      "collision": false,
      "anchor": { "x": 0.5, "y": 1.0 },
      "usedIn": ["AddBaseGrid.BaseAsset", "PathConnection.PathAsset"]
    }
  ]
}
```

字段说明：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | **三方一致的语义名**。Sino 写进 `text_panel` 的就是它；Mira 发布时 `assetName` 用它；渲染器靠它匹配图层。 |
| `description` | ✅ | 给 Mira 的自然语言生成需求（风格、用途、色调、像素特征）。 |
| `type` | ✅ | `tile`（平铺：底图/地面/道路/水面）或 `object`（独立物件：建筑/树/石/道具）。 |
| `footprint{w,d}` | ✅ | 占地格数。tile=1×1；object 取 Sino 布局时设的占地宽高（如建筑 12×12）。 |
| `heightRatio` | ✅ | 相对高度。tile=0（贴地）；object 取高度感（建筑高=BuildingHeight 与占地的比例，植被按视觉）。 |
| `autotileKind` | tile 选填 | autotile 规则（如 `common_16`），需要边界自动过渡的地面/道路填。 |
| `collision` | object 选填 | 是否要碰撞区域；true → Mira 产 `geometryJson` 碰撞掩码（导入侧渲染/导出会消费）。 |
| `anchor{x,y}` | object 选填 | billboard 锚点；默认底边中心。 |
| `usedIn` | 选填 | 该名字被哪些管线端口引用，便于核对与回提。 |

> **像素尺寸比例**（用户要的"底面占地和高度"）= `footprint`(底面占地，格) + `heightRatio`(高度比)。Mira 据此决定出图的画布比例与锚点，保证 billboard 摆进场景时占地/高度与布局一致。

---

## 三、Sino 侧：收集需求（阶段②）

> **这一步的全部技术字段都由 Sino 自己从布局/意图推断出来**——用户只给场景意图，不要求指定 `type`/`footprint`/`heightRatio` 等。这些是 Sino 设计场景时本就定下的参数，收集需求时直接读出/判定即可。

1. 布局完成后，遍历场景里所有 `text_panel` 承载的语义资产名（底图 BaseAsset、道路 PathAsset、湖 LakeAsset、装饰 AssetName、建筑 BuildingAsset 等）。
2. **判 `type`**：底图/道路/水面/地面 → `tile`；建筑/树/石/雕像/道具等独立物件 → `object`。
3. **填 `footprint`/`heightRatio`**：tile=`1×1`/`0`；object 读你布局时为它设的占地宽高与高度参数。
4. **判 `collision`（仅 object，自行判定）**：能阻挡通行的实体 → `true`；可穿过的纯装饰 → `false` 或省略。
5. 写出 `asset-requirements.json`（上节格式）到 runDir。**不要自己去 `asset2d:*` 生成**——那是 Mira 的事。

> **放置方式须组合多种模板**（Sino 自行规划）：**地标单点** → `PlaceOneDecoration`；**锚点旁局部簇** → `LocalPreciseDecoration`；**剩余 Rest 背景填充** → `NaturalDecorationDistribution`。**禁止整张场景只用其中一种**。

---

## 四、Sino 侧：导入与验收（阶段④）

Mira 发布完成、aw-support 续派 Sino 后，按下面**精简三步**走。验收基于**元数据**（`library.list` 命中来源 + `execute` 无 error）：

1. **绑定沙箱（`projectRoot` 必须显式传）**：
   ```json
   { "toolId":"scene:library.useGameTextures", "caller":{"kind":"ai"},
     "args":{ "gameSlug":"grass-village", "projectRoot":"<工作区根>" } }
   ```
   > ⚠️ **`projectRoot` 不可省**：省了工具会用进程 cwd 推算，绑到空目录。
2. **核对命中的是 Mira 产物（不是内置同名预设）**：`scene:library.list` 后确认 `id` 以 `game-sandbox:` 开头。缺失 → 在 run 日志中标注，等待 aw-support 续派 Mira 补。
3. **跑图确认**：`scene:pipeline.execute` 跑一次，确认无 error。

> `scene:library.publishExternal` 已退役——一律走 Mira `publishToGame` + Sino `useGameTextures`。

---

## 五、aw-support 侧：编排要点（代码，非 LLM）

> 资产往返由 **aw-support gate loop** 居中编排，直接 `POST /api/sessions/:sid/messages` 派 Sino / Mira——Sino 与 Mira 互不直接派活。

- **串行依赖**：必须 ① Sino 布局完成 → ② `asset-requirements.json` 在盘 → ③ Mira 生成完 → ④ Sino 导入。门控检测磁盘交付物，未满足则续派。
- **传递载体**：Sino 写契约到 runDir；aw-support 读取后内联字段派 Mira（Mira 不 `read_file` 契约）。
- **回路**：Sino ④ 核对到某 `name` 缺失 / 验收不通过时，aw-support 据 gate 状态决定让 Mira 重出或让 Sino 调整布局，再走 ②→④。
