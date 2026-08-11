# PoiScatter（随机POI分布 · 场景版）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1782200000002_poisc`，也可用 basename `PoiScatter`。

把 `poi_scatter` 电池封装为 scene 流水线：输入 Scene（上游空地/Rest），在其底面区域内按规则随机散布兴趣点（POI），挂回场景树并产出标准五件套。

## 内部算法链（固定操作）

```
Scene → scene_passthrough → node_explode → rect_grid → voxel_slice(region)
  → poi_scatter(inputGrid=region)                 # 随机散布 POI
  → grid2node(poi) + ObjectAssetName              # POI 层挂树、写资产名
  → alg_region_subtract(region, poi) → grid2node(rest)   # 剩余空地
  → 标准五件套输出
```

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_0` | Scene 上游可放置区域（**必接**） |
| IN | `in_1` | AssetName POI 资产名（写入场景节点 asset_name） |
| IN | `in_2` | PoiRules POI 规则列表 |
| IN | `in_3` | Seed 随机种子 |
| OUT | `out_0` | Scene 整树 |
| OUT | `out_1` | Poi POI 层（主产物） |
| OUT | `out_2` | Rest 剩余空地 |
| OUT | `out_3` | PoiPath POI 层路径句柄 |
| OUT | `out_4` | RestPath 剩余空地路径句柄 |

`in_0` 悬空会导致整组静默空跑。多实例串联：`out_2`(Rest) → 下一实例 `in_0`(Scene)。
