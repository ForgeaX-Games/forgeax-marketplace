# scenealg 四形态与转化算子（模板内部实现参考）

> **硬约束**：模板组内部的领域算法段（六段流水线之 ③），应尽可能用 `batteries/scenealg/` 下 **`alg_*` 原子电池** 复合实现，而不是引用 `alg_store/`、`components/`、`scene30/` 里的重型专用电池，也不是在模板内写一次性逻辑。
>
> 权威清单：`batteries/scenealg/**/meta.json`（`id` 字段 = 图里 `opId`）。

---

## 1. 五种基本形态（+ Utils）

scenealg 把二维场景几何抽象为网格上的几种**数据形态**。模板设计时先判定「本层在形态空间里走哪条边」，再选对应 `alg_*`。

| 形态 | 数据结构 | 语义 | 典型 grid 值 |
|------|----------|------|-------------|
| **Region** | 单张 `grid` (item) | 0/1（或多值 ID）**区域掩码** | 有效格 ≠ 0 |
| **Partition** | `grid[]` (list, rank=1) | 若干 **互斥** 0/1 子区域，顺序有语义 | 每张 mask 不重叠 |
| **Topology** | 单张 `grid` (item) | **线状/薄结构**（道路、墙线、门洞候选） | 结构格 = roadValue，其余 0 |
| **Field** | 单张 `grid` (item) | **标量场**（距离、噪声、权重） | 每格 float，region 外常 = 0 |
| **Points** | 单张 `grid` (item) 或 point2d | **离散点** / 点掩码（种子、POI、锚点） | 选中格 = 1 或 point2d 坐标 |

**Utils**（形态组合，仍输出 region/partition）：

| opId | 作用 |
|------|------|
| `alg_region_union` | 两 region 并集 |
| `alg_region_union_all` | region 列表并集 |
| `alg_region_subtract` | region 差集（主/Rest 拆分的核心） |

**桥接（scene 域，非 alg，但模板固定配套）**：

| opId | 形态转换 |
|------|----------|
| `node_explode` | scene → 可计算体素/region |
| `rect_grid` / `voxel_slice` | scene → region grid |
| `grid2node` + `add_child` | region/topology/partition 单张 → scene 子树 |

---

## 2. 形态转化算子矩阵

箭头 = 「上游形态 → 下游形态」。优先走 **scenealg `alg_*`**；同一语义勿混用 legacy 非 `alg_*` id。

### Region ↔ Region（Utils）

| opId | 输入 → 输出 |
|------|-------------|
| `alg_region_union` | region + region → region |
| `alg_region_union_all` | region[] → region |
| `alg_region_subtract` | region − region → region（**Rest 分支**） |
| `alg_region_dilate` | region → region（膨胀） |
| `alg_region_blocky_carve` | region + 约束 → region（块状雕刻/贴合） |
| `alg_region_random_fill` | region + density → region（按概率填充） |
| `alg_region_noise_fill` | region + noise → region（噪声阈值填充） |
| `alg_region_cluster_scatter` | region → region（簇状散布） |

### Region → Partition

| opId | 说明 |
|------|------|
| `alg_region_components` | 连通分量拆分 |
| `alg_region_bsp` / `alg_region_uniform_bsp` | BSP 空间划分 |
| `alg_region_grid_split` | 规则网格切分 |
| `alg_region_stripe_split` | 条带切分 |
| `alg_region_flood_grow` | points 种子 → 有机 blob 列表（**LakeRegions 核心**） |
| `alg_region_area_partition` | centers + areas → 配额 Voronoi 分区列表（**AreaPartition 核心**） |
| `alg_region_topology_split` | region − topology 切分 → partition |
| `alg_random_rect_zone_gen` | 随机矩形区划 |
| `alg_partition_field_quantize` | region + field + maxElevationLayers → partition[]（高度整数截断） |

### Partition ↔ Topology

| opId | 说明 |
|------|------|
| `alg_partition_boundaries` | partition[] → topology（分区边界线） |
| `alg_region_outline` | region → topology（外轮廓） |
| `alg_region_topology_split` | region + topology → partition |
| `alg_partition_absorb_topology` | partition + topology → partition（门洞吸回房间） |
| `alg_partition_connect` | partition + topology → topology（最少门洞联通） |
| `alg_topology_pick_doors` / `alg_topology_pick_windows` | topology → topology（选门/窗） |

### Region → Field

| opId | 说明 |
|------|------|
| `alg_field_distance` | region → field（到边界的距离） |
| `alg_field_inner_distance` | region → field（域内距离） |
| `alg_field_noise` | region → field（[0,1] 噪声场） |
| `alg_field_mountain_contour` | region → field（[0,1] 山地高度场，FBM+高斯峰+等面积重映射） |

### Field → Region / Points

| opId | 说明 |
|------|------|
| `alg_field_threshold` | field + region → region + region（近/远两档，**DistanceZones 核心**） |
| `alg_partition_field_quantize` | field + region → partition[]（高度整数截断，**MountainContourGenerate 核心**） |
| `alg_field2points` | field → points（按场值采样离散点） |

### Region → Points

| opId | 说明 |
|------|------|
| `alg_points_scatter` | region → points 掩码（**装饰/湖泊种子**） |
| `alg_points_center_scatter` | region + point2d + scatterRadius → points 列表（**LocalPreciseDecoration 核心**；BFS 吸附中心 + random/cluster/ring/poisson/noise） |

### Points → Region / Topology

| opId | 说明 |
|------|------|
| `alg_point2rect` | region + point2d → region（**PickOneBuilding / PlaceOneDecoration**） |
| `alg_points2rects` | region + points → region[]（多点矩形，互不重叠） |
| `alg_topology_connect_points` | poiGrid + obstacle → topology（**PathConnection**） |

### Region → Region（拓扑派生，仍属 region 形态）

| opId | 说明 |
|------|------|
| `alg_region_edge_inner_split` | region → edge region + inner region（边缘/内部分带） |

---

## 3. 现有模板 ↔ scenealg 对照

| 模板 | ③ 段应使用的 scenealg 复合 |
|------|---------------------------|
| PickOneBuilding | `alg_point2rect` → `alg_region_blocky_carve` |
| PlaceOneDecoration | `alg_point2rect`（无 blocky_carve） |
| PickMultiBuildings | `alg_points2rects` 或 blocky 链 |
| PathConnection | `alg_topology_connect_points` |
| LakeRegions | `alg_points_scatter` → `alg_region_flood_grow` |
| AreaPartition | `alg_region_area_partition` |
| NaturalDecorationDistribution | `alg_region_random_fill` → `alg_field2points` |
| LocalPreciseDecoration | `alg_points_center_scatter` → grid2node + MultiNames + ObjectAssetName |
| DistanceZones | `alg_field_distance` 或 inner_distance → `alg_field_threshold` |
| MountainContourGenerate | `alg_field_mountain_contour` → `alg_partition_field_quantize` |
| IslandRegions | points scatter + flood_grow 或类似锚点扩岛链 |
| BuildingStructures | `alg_region_outline` / BSP + `alg_region_subtract` + partition_connect 系 |

若新模板无法用上表中的 `alg_*` 组合表达，**先评估是否缺原子算子**（应新增 scenealg 电池），而不是在模板内堆 legacy 组件。

---

## 4. 模板内构图范式

```
scene ──explode/slice──► region (工作区)
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
    points_scatter    field_distance    (直接 partition 切分)
         │                 │
         ▼                 ▼
    point2rect         field_threshold
    flood_grow              │
         │                 ▼
         └────► region 主产物 ──subtract──► region Rest
                           │
                    grid2node → scene 子树
```

**规则**：

1. **形态单一**：每条支路清楚自己是 region / partition / topology / field / points，避免隐式混用。
2. **先 Utils 再挂树**：主/Rest 必过 `alg_region_subtract`；多实例 partition 输出契约与 `region_flood_grow` 一致（`partition[]` rank=1）。
3. **Points 只是掩码**：`alg_points_scatter` 输出的是 grid 点掩码，接 flood_grow / topology_connect 时用其 `points` 口，不是 scene tree。
4. **Topology 与 Region 分源**：PathConnection 的 POI grid 与 obstacle/scene slice **不能同一源**（与 TEMPLATE_PATTERNS §4.4 一致）。
5. **禁止顶层 alg_store**：`alg_store/Topology/*` 等可在 Develop 试验，但 **发布模板内只用 scenealg `alg_*`**（保持形态与发布契约一致）。

---

## 5. 新增 scenealg 原子电池（当矩阵缺边时）

若新模板需要矩阵中不存在的形态转化：

1. 在 `batteries/scenealg/<Category>/<name>/` 新增 `{meta.json, index.ts}`。
2. `meta.json.id` = `alg_<snake_name>`，**全局唯一**。
3. 输入/输出严格声明 `type` + `access`（grid item vs list）。
4. 加测试：`batteries/scenealg/__tests__/`。
5. **然后再**在新模板组里引用该 `alg_*`。

---

## 6. 完整 opId 索引（scenealg）

```
Partition:  alg_point2rect, alg_points2rects, alg_partition_absorb_topology,
            alg_partition_field_quantize, alg_random_rect_zone_gen, alg_region_area_partition, alg_region_bsp,
            alg_region_components, alg_region_flood_grow, alg_region_grid_split, alg_region_stripe_split,
            alg_region_topology_split, alg_region_uniform_bsp
Region:     alg_region_blocky_carve, alg_region_cluster_scatter, alg_region_dilate,
            alg_region_noise_fill, alg_region_random_fill
Topology:   alg_partition_boundaries, alg_partition_connect, alg_region_edge_inner_split,
            alg_region_outline, alg_topology_connect_points, alg_topology_pick_doors,
            alg_topology_pick_windows
fields:     alg_field_distance, alg_field_inner_distance, alg_field_mountain_contour,
            alg_field_noise, alg_field_threshold
points:     alg_field2points, alg_points_center_scatter, alg_points_scatter
Utils:      alg_region_subtract, alg_region_union, alg_region_union_all
Layout:     keypoint_layout（特殊：层级布局，非四形态主链）
```

查端口细节：`scene:batteries.get` 或读对应 `meta.json`。
