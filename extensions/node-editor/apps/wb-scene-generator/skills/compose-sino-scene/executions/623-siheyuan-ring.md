# 623 · 四合院环绕场景

## 电池清单

| 层级 | 模板/工具 | 数量 |
|------|-----------|------|
| 地图主体 | AddBaseGrid | 1 |
| 精准装饰 | PlaceOneDecoration | 1（中心四合院 18×18，高 6 格） |
| 道路 | PathConnection | 1（8 点 POI merge → 四向连边界） |
| 建筑 | PickOneBuilding | 8（环状小建筑 10×10） |
| 汇总 | tree_merge → tree_flatten → scene_merge_subtrees → scene_output | 1 链 |

## 参数

- 地图：60×60，底图资产 `grassland`，节点名 `ground`
- 四合院：中心点 (30,30)，资产名 `四合院`
- 道路 POI：(30,21) 北、(30,39) 南、(39,30) 东、(21,30) 西，资产 `石路`
- 小建筑：8 个点位环绕（四角 + 内环），资产 `小建筑`，seed=62342

## 串联

```
AddBaseGrid → PlaceOneDecoration → PathConnection(8 POI) → PickOneBuilding×8(链式 Rest)
→ tree_merge(14项) → scene_output
```

## 验证

- `execute/summary` → `completed`，`g_siheyuan.out_1` focus=`/ground/四合院`，cellCount=8820
- `g_path_n.out_1` 含 `main_road` 道路节点
- `g_b1.out_1` 含 `小铺_西南` 等建筑节点

## 优化建议

- 若希望道路从四合院门口而非几何中心引出，可在 PlaceOneDecoration 后用 `scene_focus_path` 提取子节点再作 POI。
- 8 栋小建筑可改为 `PickMultiBuildings` 一次放置（需额外 list 合并工具）。
