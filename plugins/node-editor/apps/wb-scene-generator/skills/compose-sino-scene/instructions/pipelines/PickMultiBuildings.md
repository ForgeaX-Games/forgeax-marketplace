# 建筑 - PickMultiBuildings（多点建筑）

> 权威详情：[../../../../batteries/templates/scene/PickMultiBuildings/README.md](../../../../batteries/templates/scene/PickMultiBuildings/README.md)
> templateId：`PickMultiBuildings`。完整端口以 `scene:templates.get` 为准。

## 1. 管线电池的基本介绍

管线所属层级：**建筑层级（多栋 / 村庄）**

管线效果：一次放置**多栋**建筑（points 列表 + 各栋占地宽高/高度/资产）。用于村落、街区、聚落这种"成片建筑"的需求。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 怎么喂 / 建议值 |
|--------|------|------|----------------|
| `in_6` | scene | Scene 上游场景 | `AddBaseGrid.out_1`(BaseNode) |
| `in_5` | array | points 多点列表 | `manual_points` 多点 / 上游点位列表 |
| `in_0` / `in_1` | array | AreaWidths / AreaHeights 各栋占地 | 每栋至少 10×10 |
| `in_2` / `in_3` | array/number | BuildingHeights 各栋高度 | `number_const` |
| `in_4` | array | BuildingAssets 各栋资产名 | `text_panel`→`str_to_list` |
| `in_13` | number | seed | `seed_control.seed` |

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_2` | scene | Buildings 建筑区域（主产物） | `tree_merge` / `BuildingStructures.in_0` |
| `out_0` | array | BuildingsPaths 路径句柄列表 | 拼门路径 |
| `out_1` | scene | Rest 剩余空地 | 下一组 `in_0` / 下一批建筑 `in_6` |

## 4. 推荐参数

- 各栋占地至少 `10×10` 格；占地宽高/高度即各资产的 `footprint`/`heightRatio` 依据。
- 多批建筑串联：上一批 `out_1`(Rest) → 下一批 `in_6`(Scene)。

## 5. 管线效果描述

- 一次铺出整片建筑；接 `BuildingStructures` 细化墙体/门，再供 `PathConnection` 连路。
