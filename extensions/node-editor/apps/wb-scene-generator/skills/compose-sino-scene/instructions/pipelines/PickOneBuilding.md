# 建筑 - PickOneBuilding（单点建筑）

> 权威详情：[../../../../batteries/templates/scene/PickOneBuilding/README.md](../../../../batteries/templates/scene/PickOneBuilding/README.md)
> templateId：`PickOneBuilding`。与 `PickMultiBuildings`（多点批量）互补。端口以 instantiateTemplate 返回的 exposedInputs 为准（勿 templates.get 预读）。

## 1. 管线电池的基本介绍

管线所属层级：**建筑层级（单栋）**

管线效果：在**指定坐标**放置**一栋**建筑区域（点位 + 占地宽高 + 资产名）。用于地标/装饰/剧情建筑这种"明确放在某处一栋"的需求，而非随机撒。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 怎么喂 / 建议值 |
|--------|------|------|----------------|
| `in_3` | point | Point 点位 | `manual_points`(x,y → point)，左上角 `(0,0)`，x 横 y 纵 |
| `in_1` | scene | Scene 上游场景 | `AddBaseGrid.out_1`(BaseNode) |
| `in_5` / `in_6` | number | AreaWidth / AreaHeight 占地宽高(格) | `number_const`；**叙事内构 ≥15×15**；装饰外观 ≥10×10；取 max(catalog footprint, 下限) |
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

- **占地宽高（`in_5`/`in_6`）尺寸铁律**：
  - **叙事内构**（需接 BuildingStructures 的可进入建筑）：**至少 `15×15` 格** — 取 `max(catalog footprint, 15, contract.footprintMin)`
  - **装饰外观**小建筑：至少 `10×10` 格，常规 `10×10`~`16×16`
  - 禁止 `4×4`；避免 ≫`20×20` 除非区域 Rest 足够大
- 占地宽高即该建筑资产的 `footprint` — Phase 0 从 `prefab-footprint-summary.json` / checklist `assets` 读取（禁止 read 全量 catalog）。
- Phase 0 checklist 须写 `assets.AreaWidth/AreaHeight` 与 `structureParams.bottomDoor: true`（narrative_interior）。

## 5. 管线效果描述

- 在给定坐标放一栋建筑；要墙体/房间/门细节，把 `out_1`(Building) 接 `BuildingStructures.in_0`。
- 多栋村庄 / 城镇补充：**暂禁 PickMultiBuildings** — `town-building-scatter.json` 每条 supplementary → **单独 PickOneBuilding** task，用 `out_2`(Rest) 串联下一栋 `in_1`。

> **已验证 M2**：projectId `p_mr49zz2e_idczh2` → [`step-m2-pickonebuilding.json`](../../../../../../aw-support/battery-verify/p_mr49zz2e_idczh2/step-m2-pickonebuilding.json)。**BuildingName → `in_0`**（非 `in_2`）；子区 focus + 18×16。

## 6. 建筑贴图 footprint 导出（对接 Mira `dechouse_gen`）

布局 `execute` 跑通后，**禁止**按 `AreaWidth×AreaHeight` 手拼矩形 mask。要给本组建筑出整栋 billboard 贴图时：

```
PickOneBuilding.out_1 → building_footprint_mask → grid_to_json
```

读取 `grid_to_json.json` 原样交给 Mira 的 `dechouse_gen.in_0`；`BuildingAsset`（`in_4`）填**建筑 object 名**（与 `publishToGame.assetName` 一致），不要填地面 tile 名。完整协议见 [asset-collaboration.md §二A](../asset-collaboration.md)。
