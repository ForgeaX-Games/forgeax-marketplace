# Rest 空间填充与面积比例

> 与 [fast-loop.md](fast-loop.md) Rest 链配合：Rest 链解决**不重叠**；本文解决**填什么、填多少**。

## Rest 是施工义务

每步模板切走主产物后，**Rest 必须在 checklist 里有 `restFillPlan`**：

```
分区 → Rest₀ → 建筑 → Rest₁ → 道路 → Rest₂ → 装饰链 → Rest₃ …
```

**禁止**：只在大节点下 manual_points 几个 keypoint，Rest 大片空白。

## 尺度匹配

| 反模式 | 修正 |
|--------|------|
| 大 Rest + 单个小 PlaceOne | Natural/LocalPrecise **簇** + 提高 minInstances；或 **缩小/调整父区** |
| 小 Rest + 大 footprint 建筑 | 换小建筑或 **放大 Island/分区面积** |
| 父区巨大、内容挤在 30% 子区 | **areaProportionAdjustments**：放大子区 / 缩小父 grid |

查 **`prefab-footprint-summary.json`**（runDir）或 checklist draft 中的 footprint 估算占用；Phase 0 **禁止** read 全量 `prefab-catalog.json`。

## 有效内容占比 80%–90%

keypoint `area`（S=64, M=400, L=2025, XL=8100）是**参考**，可调整：

1. 读 solved 坐标 + hierarchy area
2. 若内容会聚在一角 → checklist 写 adjustment（放大子 IslandSizes / 缩小 AddBaseGrid / 扩 AreaPartition zone）
3. `targetFillRatio` 写入 checklist

**面积比例可调**——目标是视觉占比合理，不是死守 keypoint 原始 scale。

## restFillPlan 示例

```json
{
  "afterTask": "loc-清水镇-02",
  "restEstimate": { "approxCells": 800, "shape": "ring", "role": "建筑间+街侧" },
  "fillStrategy": [
    { "template": "PlaceOneDecoration", "minInstances": 6, "assets": ["灯柱左", "市集"] },
    { "template": "LocalPreciseDecoration", "minInstances": 4, "assets": ["石桌", "货物"] },
    { "template": "NaturalDecorationDistribution", "assets": ["忘忧草1", "小假山"], "placement": "Rest 外围，非主街" }
  ]
}
```

## 装饰分层（各处都有，分工不同）

| 层 | 模板 | 典型位置 |
|----|------|----------|
| 商业 | PlaceOne | PathConnection 走廊 / 门旁 |
| 结构 | LocalPrecise | 建筑前庭 |
| 植被 | Natural（**多次**） | 各 Rest 段外围 — **每组一种 asset，density≈0.01** |

**NaturalDecorationDistribution 纪律**：
- **一次一种** itemName — 多品种 = 多组 + Rest 链（`out_2` → 下一 `in_1`）
- **Density ≈ 0.01** — 稀疏多样，禁止高密度铺满
- checklist 写 **≥3 个** Natural task（不同 asset 或不同 Rest 段），禁止每类只象征性 1 次

同一 Rest 可**多种模板**串联（PlaceOne → Local → Natural₁ → Natural₂ …）。

## PathConnection POI（checklist 必写 poiDerivation）

- 模板：**`PathConnectionLink`**（城镇）或 **`PathConnectionRandomWalk`**（野路）— **禁止**旧名 `PathConnection`
- POI **禁止拍坐标** — 须 `BuildingPath` + `string_concat("/outer_door")` + `scene_focus_path` + `node_explode` → `2dPoints`
- 建筑 batch **execute 之后**再连道路 batch

## Hill / Mountain（Rest 串链）

- `MountainContourGenerate.in_0` / `HillContourGenerate.in_0` ← **上一组 Rest**（道路 `out_2` 或前段地形 `out_*` Rest）
- **禁止**道路 Rest、Mountain、Hill、装饰 **并行**接同一节点 — 必须 checklist 里 **connectFrom 串链**
- 推荐：道路 → Mountain（外围）→ Hill（局部）→ 装饰

## 材质分区（纯资产）

- 外圈/世界底图：`草地`
- 镇内：`石质地砖` / `地板02`（室内）
- 道路：`地板03` / `地板04`
- 镇外旱地：`土地`

## Phase 1 验收 Rest

execute 摘要：主产物 itemCount > 0；若 Rest 仍极大而装饰层极稀 → 回 checklist 补 fill task，勿标记 verified。
