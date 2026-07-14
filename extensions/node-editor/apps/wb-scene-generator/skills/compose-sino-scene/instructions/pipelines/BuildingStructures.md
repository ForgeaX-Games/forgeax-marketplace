# 建筑 - BuildingStructures（建筑结构）

> 权威详情：[../../../../batteries/templates/scene/BuildingStructures/README.md](../../../../batteries/templates/scene/BuildingStructures/README.md)
> templateId：`BuildingStructures`。端口以 instantiateTemplate 返回的 exposedInputs 为准（勿 templates.get 预读）。

## 1. 管线电池的基本介绍

管线所属层级：**建筑层级（结构细化）**

管线效果：在已有**建筑区域**上生成墙体/房间结构，并在每栋建筑内部生成名为 `outer_door` 的**门子节点**——供 `PathConnection` 的进阶 POI"提门"聚焦，让道路从门口自然连出。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 怎么喂 |
|--------|------|------|--------|
| `in_0` | scene | Scene 建筑区域 | `PickOneBuilding.out_1` 或 `PickMultiBuildings.out_2`（**接建筑主产物，不接 Rest**） |
| `in_23` | string | WallAsset 墙体资产名 | `text_panel` |
| `in_24` | number | Seed | `seed_control.seed` |
| `in_1` | bool | bottomDoor 门位于建筑下侧 | **narrative_interior 默认 `true`**（checklist `structureParams.bottomDoor`） |

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_0` | scene | 含结构与门的建筑场景（主产物） | `tree_merge`；`scene_focus_path` 提门作 POI |
| `out_1` / `out_2` | scene/string | Rooms / RoomsPath | 室内地板层（仅 `min(z)-1` 单层）；一般不接 |

## 4. 推荐参数

- `in_0` **必须接建筑主产物**（`PickOneBuilding.out_1` / **`PickMultiBuildings.out_2`**），绝不接 Rest。
- **`in_1` bottomDoor**：叙事内构建筑 **默认开启** — 门位于建筑**下侧**外墙，供 PathConnection 从南侧连入；checklist 写 `structureParams: { "bottomDoor": true }`，施工时 `text_panel`/`bool_const` 或 exposed 口传 `true`。

## 5. 管线效果描述

- 给建筑加墙体/房间，并生成 `outer_door` 门子节点。
- **`out_1` Rooms**：每个房间子节点只在 **建筑最低 z 再往下 1 层**（地板层）生成体素，不再占满整栋高度；墙/门/窗仍用完整建筑 `zRange`。
- 是 `PathConnection` 进阶 POI（连门）的前置：先有本组的 `out_0`，才有门可提取。
