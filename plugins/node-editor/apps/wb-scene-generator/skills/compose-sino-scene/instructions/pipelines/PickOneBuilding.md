# 建筑 - PickOneBuilding（单点建筑）

> 权威详情：[../../../../batteries/templates/scene/PickOneBuilding/README.md](../../../../batteries/templates/scene/PickOneBuilding/README.md)
> templateId：`PickOneBuilding`。与 `PickMultiBuildings`（多点批量）互补。完整端口以 `scene:templates.get` 为准。

## 1. 管线电池的基本介绍

管线所属层级：**建筑层级（单栋）**

管线效果：在**指定坐标**放置**一栋**建筑区域（点位 + 占地宽高 + 资产名）。用于地标/装饰/剧情建筑这种"明确放在某处一栋"的需求，而非随机撒。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 怎么喂 / 建议值 |
|--------|------|------|----------------|
| `in_3` | point | Point 点位 | `manual_points`(x,y → point)，左上角 `(0,0)`，x 横 y 纵 |
| `in_1` | scene | Scene 上游场景 | `AddBaseGrid.out_1`(BaseNode) |
| `in_5` / `in_6` | number | AreaWidth / AreaHeight 占地宽高(格) | `number_const`，**至少 10×10**，常规 10×10~16×16 |
| `in_0` / `in_4` | string | BuildingName / BuildingAsset | `text_panel` |
| `in_2` | number | BuildingHeight 高度 | `number_const` |

> 其余 `in_*` 为 hidden 高级参数，默认即可。

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Building 建筑区域（主产物） | `tree_merge` / `BuildingStructures.in_0` |
| `out_3` | string | BuildingPath 路径句柄 | 拼门路径（`string_concat`） |
| `out_2` | scene | Rest 剩余空地 | 下一组 `in_0` |

## 4. 推荐参数

- **占地宽高（`in_5`/`in_6`）尺寸铁律**：装饰性建筑**至少 `10×10` 格**，常规 `10×10`~`16×16`；`4×4` 太小（墙/门挤一团），别过大（≫`20×20`）。
- 占地宽高即该建筑资产的 `footprint`，高度即 `heightRatio` 依据——收集资产需求时直接读这些参数。

## 5. 管线效果描述

- 在给定坐标放一栋建筑；要墙体/房间/门细节，把 `out_1`(Building) 接 `BuildingStructures.in_0`。
- 多栋村庄用 `PickMultiBuildings` 或多个 PickOneBuilding 用 `out_2`(Rest) 串联。
