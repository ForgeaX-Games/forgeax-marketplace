# LocalPreciseDecoration（局部精准装饰播撒）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_local_precise_decoration`，也可用 basename `LocalPreciseDecoration`。

以**兴趣点**为中心，在父区域有效格内的圆形半径内采样多个小型装饰物点位并挂树；算法核心为 scenealg **`alg_points_center_scatter`**（源自 `components/decoration/precise_decoration_scatter`）。

## 与相关模板的分工

| 模板 | 用途 |
|---|---|
| **NaturalDecorationDistribution** | 全区域**随机散布**（密度驱动，无中心点） |
| **PlaceOneDecoration** | **单个**装饰物，矩形 footprint 精准贴合 |
| **LocalPreciseDecoration**（本模板） | 以兴趣点为中心的**局部多颗**小型装饰（半径 + 数量 + 算法） |

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游剩余空地（**必接**） |
| IN | `in_2` | Point 兴趣点 point2d（x→列、y→行） |
| IN | `in_19` | Count 采样数量 |
| IN | `in_20` | ScatterRadius 播撒半径（格数） |
| IN | `in_21` | Algorithm 采样算法：`random` / `cluster` / `ring` / `poisson` / `noise` |
| IN | `in_0` | NamePrefix 名称前缀 |
| IN | `in_5` | AssetName 装饰资产名 |
| IN | `in_3` | Seed 随机种子 |
| OUT | `out_1` | Decoration 装饰（主产物） |
| OUT | `out_2` | Rest 剩余空地 |

`in_1` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `scene:templates.get` 为准。

## 内部管线（③ 段 scenealg）

```
scene → explode → rect_grid → voxel_slice（region）
  → alg_points_center_scatter(point, count, scatterRadius, algorithm)
  → grid2node + MultiNames(NamePrefix) + ObjectAssetName(AssetName)
  → add_child；alg_region_union_all(points) → subtract → Rest
```

兴趣点不在有效格内时，scatter 电池会 BFS 吸附到最近有效格再采样。
