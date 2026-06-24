# BuildingStructures（建筑结构）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1781831816652_3k380`，也可用 basename `BuildingStructures`。

在已有**建筑区域**上生成墙体/房间结构（含 `outer_door` 门子节点，供道路 POI 聚焦）。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_0` | Scene 建筑区域（接 `PickOneBuilding.out_1` 或 `PickMultiBuildings.out_2`） |
| IN | `in_23` | WallAsset 墙体资产名 |
| IN | `in_24` | Seed |
| IN | `in_1` | bottomDoor（hidden 默认，按需） |
| OUT | `out_0` | Scene 含结构的建筑场景（主产物） |
| OUT | `out_1` / `out_2` | Rooms / RoomsPath |

完整端口以 `scene:templates.get` 为准。
