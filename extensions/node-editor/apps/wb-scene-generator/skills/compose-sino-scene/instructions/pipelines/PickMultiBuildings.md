# 建筑 - PickMultiBuildings（多点建筑）

> **⚠️ 暂禁（2026-07）**：pure-asset / Sino 构图 **不要使用** 本模板。城镇补充改 **`PickOneBuilding` Rest 串链** — 见 `town-building-scatter.json` 与 [PickOneBuilding.md](./PickOneBuilding.md)。

> 权威详情：[../../../../batteries/templates/scene/PickMultiBuildings/README.md](../../../../batteries/templates/scene/PickMultiBuildings/README.md)
> templateId：`PickMultiBuildings`。端口序号和语义（`label`）以 instantiateTemplate 返回的 exposedInputs/exposedOutputs 为准（勿 templates.get 预读）；本文档在 `label` 缺失或需要接线配方/数值参考时作补充。

## 1. 管线电池的基本介绍

管线所属层级：**建筑层级（多栋 / 村庄）**

管线效果：一次放置**多栋**建筑（points 列表 + 各栋占地宽高/高度/资产）。用于村落、街区、聚落这种"成片建筑"的需求。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 怎么喂 / 建议值 |
|--------|------|------|----------------|
| `in_6` | scene | Scene 上游场景 | 首组：`AddBaseGrid.out_1`；后续：**上一组 Rest**（`PickMulti.out_1` 或 PickOne `out_2`） |
| `in_5` | array | points 多点列表 | `manual_points` 多点 / 上游点位列表 |
| `in_0` / `in_1` | array | AreaWidths / AreaHeights 各栋占地 | 每栋至少 10×10 |
| `in_2` / `in_3` | array/number | BuildingHeights 各栋高度 | `number_const` |
| `in_4` | array | BuildingAssets 各栋资产名 | `text_panel`→`str_to_list` |
| `in_13` | number | seed | `seed_control.seed` |

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_2` | scene | Buildings 建筑区域（主产物） | `appendMergeItem` → `aw_m0_merge` / `BuildingStructures.in_0` |
| `out_0` | array | BuildingsPaths 路径句柄列表 | 拼门路径 |
| `out_1` | scene | Rest 剩余空地 | 下一组 `in_0` / 下一批建筑 `in_6` |

## 4. 推荐参数

- **城镇补充散布**：Phase 0 读 `town-building-scatter.json` — `supplementaryBuildings[]` 的 itemName + footprint 写入 checklist；`batchId: town-scatter`。
- 各栋占地至少 `10×10` 格（叙事地标单栋若需内构，用 PickOneBuilding ≥15×15 + BuildingStructures）。
- 各栋 `BuildingAssets` **必须**来自 `town-building-scatter.json` / `prefab-scene-picks.json` itemName（施工核对才用 catalog）。
- 多批串联：上一批 **`out_1`(Rest)** → 下一批 **`in_6`(Scene)** — 禁止两批都接 BaseNode。

## 5. 管线效果描述

- ~~一次铺出整片补充建筑~~ **暂禁施工** — 文档保留供将来恢复；当前用 PickOne Rest 串链（见文首 ⚠️）。
- 与 PickOneBuilding 互补：叙事地标用 PickOne+结构；城镇散布用 **多条 PickOne**（draft 已带坐标/namePort）。
