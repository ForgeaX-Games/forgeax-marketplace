# DecorationBorder（规则装饰物 · 场景版）

> templateId（传给 `POST /api/v1/group-templates/:projectId/instantiate`）：`group_1782200000001_dbrdr`，也可用 basename `DecorationBorder`。

把 `decoration_border` 电池封装为 scene 流水线：输入 Scene（上游空地/Rest），在其底面区域周围按规则摆放 1×1 装饰物，挂回场景树并产出标准五件套。

## 内部算法链（固定操作）

```
Scene → scene_passthrough → node_explode → rect_grid → voxel_slice(region)
  → decoration_border(inputGrid=region)           # 边框规则摆放
  → grid2node(decoration) + ObjectAssetName       # 装饰层挂树、写资产名
  → alg_region_subtract(region, decoration) → grid2node(rest)   # 剩余空地
  → 标准五件套输出
```

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_0` | Scene 上游可放置区域（**必接**） |
| IN | `in_1` | AssetName 装饰资产名（写入场景节点 asset_name） |
| IN | `in_2` | DecorationName 装饰物名称（电池内格值命名） |
| IN | `in_3` | Count 填充数量 |
| IN | `in_4` | FillMode 填充方式 |
| IN | `in_5` | Offset 偏移距离 |
| IN | `in_6` | Seed 随机种子 |
| IN | `in_7..9` | Rotate / StartCount / ItemSpacing（hidden 高级项） |
| OUT | `out_0` | Scene 整树 |
| OUT | `out_1` | Decoration 装饰层（主产物） |
| OUT | `out_2` | Rest 剩余空地 |
| OUT | `out_3` | DecorationPath 装饰层路径句柄 |
| OUT | `out_4` | RestPath 剩余空地路径句柄 |

`in_0` 悬空会导致整组静默空跑。多实例串联：`out_2`(Rest) → 下一实例 `in_0`(Scene)。
