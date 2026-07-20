# 模板内部固定流水线（实现参考）

> 完整版：[batteries/templates/scene/TEMPLATE_PATTERNS.md](../../../batteries/templates/scene/TEMPLATE_PATTERNS.md)

## 六段模型

占空地类模板（PickOneBuilding、PathConnection、LakeRegions、NaturalDecorationDistribution、LocalPreciseDecoration、PlaceOneDecoration、IslandRegions、DistanceZones、MountainContourGenerate）共享：

```
① scene_passthrough（外部 Scene 单点接入）
    ↓
② node_explode → rect_grid → voxel_slice
    ↓
③ alg_*（模板唯一差异）
    ↓
④ grid2node → add_child → TileAssetName | ObjectAssetName
    ↓
⑤ alg_region_subtract → 主分支 grid2node + rest 分支 grid2node("rest")
    ↓
⑥ scene_passthrough 抽头 + scene_focus_path → type_string（*Path）
```

## 各模板 ③ 段算法

| 模板 | 核心 alg / 特殊 op | 输入要点 |
|------|-------------------|---------|
| AddBaseGrid | `rect_grid` + `add_child`（无 subtract） | Width/Height/BaseName |
| PickOneBuilding | `alg_point2rect` + `alg_region_blocky_carve` | Point + 宽高 |
| PlaceOneDecoration | `alg_point2rect`（无 blocky_carve） | Point + footprint + 高度 |
| PickMultiBuildings | `alg_points2rects` 或 blocky 链 | points 列表 |
| BuildingStructures | `alg_region_outline` / BSP + subtract + partition_connect 系 | 上游 **Building** scene（非 Rest） |
| PathConnection | `alg_topology_connect_points` | **in_3 POI** + **in_2 Scene**（不同源） |
| NaturalDecorationDistribution | `alg_region_random_fill` → `alg_field2points` | Density + seed |
| LocalPreciseDecoration | `alg_points_center_scatter` | Point + Count + ScatterRadius + Algorithm |
| IslandRegions | scatter + flood_grow 链 | Points + IslandSizes |
| DistanceZones | `alg_field_distance` → `alg_field_threshold` | Threshold + 可选 toggle |
| MountainContourGenerate | `alg_field_mountain_contour` → `alg_partition_field_quantize` | MaxElevationLayers + Peak* + Seed |

**规则**：只改 ③ 段；①②④⑤⑥ 尽量复用参考模板拓扑。③ 段 **仅** `batteries/scenealg/alg_*` — 完整形态转化矩阵见 [scenealg-primitives.md](scenealg-primitives.md)。

## 嵌套子组内部拓扑

### TileAssetName / ObjectAssetName

```
in_0 scene ──→ scene_set_attribute(key=asset_name, value=外部 string)
           ──→ scene_set_attribute(key=asset_type, value="tile"|"object")
out_0 scene（已标注）
```

- 固定 `text_panel`：`asset_name` / `asset_type` / `tile`|`object`
- 大模板 exposed IN 的 `*Asset` / `AssetName` 接到嵌套组 `in_1`

### MultiNames

```
in_3 Prefix(string) + in_1 Count(number) → range_list → out_1 Names(string list)
```

用于 LakeRegions / NaturalDecorationDistribution / LocalPreciseDecoration / **MountainContourGenerate** 的 NamePrefix 链。

## 输入提取对照

| 信息 | 提取方式 | 典型 exposed IN |
|------|---------|----------------|
| 上游 scene | passthrough | `in_0` / `in_1` Scene |
| 场景尺寸 | rect_grid.width/height | AddBaseGrid `in_2/3` |
| 点位 | alg point/points | Pick `in_3`；Multi `in_5` |
| 资产名 | type_string 或嵌套组 `in_1` | `*Asset` / `AssetName` |
| 批量名前缀 | MultiNames Prefix | NamePrefix |
| 随机性 | seed / number_const | `in_17` / `in_3` seed |
| POI 栅格 | 独立 grid 口 | PathConnection `in_3` |

## 输出组装对照

| 输出 | 组装 |
|------|------|
| 主产物 scene | alg → grid2node(主名) → add_child → AssetName → passthrough |
| Rest scene | subtract 剩余 → grid2node("rest") → passthrough |
| *Path string | scene_focus_path(对应 scene) → type_string.value |
| 组外汇总 | 各组主产物 → tree_merge → tree_flatten → scene_merge_subtrees → scene_output |

## 链式串联约定

- **Rest → 下一组 Scene IN**：PickMulti `out_1`→下一 `in_6`；装饰 `out_2`→下一 `in_1`
- **主产物 → tree_merge.item_N**：最终汇总图层
- **Path 句柄 → string_concat**：拼 `/outer_door` 等；**禁止**用 BaseName 猜 path

## 静默空跑（必写进 README）

| 模板 | 条件 |
|------|------|
| PathConnection | `in_3` POI 或 `in_2` Scene 悬空 |
| NaturalDecorationDistribution | `in_1` Scene 未接有效上游 |
| 任意占空地类 | 必接 Scene 悬空 → 整组无输出，`execute` 仍 `completed` |
| MountainContourGenerate | `in_0` Scene 悬空 |

## 规模参考（现有模板）

| 模板 | 节点数 | 嵌套子组 | visible IN | visible OUT |
|------|--------|---------|------------|-------------|
| AddBaseGrid | 7 | TileAssetName | 5 | 3 |
| PickOneBuilding | 26 | ObjectAssetName | 7 | 5 |
| PlaceOneDecoration | 25 | ObjectAssetName | 7 | 5 |
| PickMultiBuildings | 28 | ObjectAssetName | 8 | 5 |
| BuildingStructures | 43 | Tile×2 + MultiNames | 4 | 3 |
| PathConnection | 26 | TileAssetName | 5 | 5 |
| NaturalDecorationDistribution | 31 | MultiNames + ObjectAssetName | 6 | 5 |
| LocalPreciseDecoration | 29 | MultiNames + ObjectAssetName | 8 | 5 |
| LakeRegions | 30 | MultiNames + TileAssetName | 5 | 5 |
| MountainContourGenerate | 25 | MultiNames + TileAssetName | 10 | 5 |

新模板应落在同量级；节点数暴涨通常意味着重复逻辑未抽子组。
