# PickOneBuilding（单点建筑）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1781806910509_ac8a1`，也可用 basename `PickOneBuilding`。

在指定坐标放置**一栋**建筑区域（点位 + 宽高 + 资产名）。与 `PickMultiBuildings`（多点批量）互补。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_3` | Point 点位（`manual_points` → point） |
| IN | `in_1` | Scene 上游场景 |
| IN | `in_5` / `in_6` | AreaWidth / AreaHeight |
| IN | `in_0` / `in_4` | BuildingName / BuildingAsset |
| IN | `in_2` | BuildingHeight |
| OUT | `out_1` | Building 建筑区域（主产物） |
| OUT | `out_3` | BuildingPath 路径句柄 |
| OUT | `out_2` | Rest 剩余空地 |

其余 `in_*` 为 hidden 高级参数，默认即可。完整端口以 `scene:templates.get` 为准。
