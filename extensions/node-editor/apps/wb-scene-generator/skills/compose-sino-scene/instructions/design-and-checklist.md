# Phase 0：基于 draft 落盘 final checklist

> **施工顺序骨架由 aw-support 预写。** 编排层落盘 `scene-composition-checklist.draft.json`（坐标/namePort/footprint 确定性）；
> **Sino Phase 0 读 draft + Tier 1/2，复制为** `{runDir}/scene-composition-checklist.json`（`_source: "sino-planned"`），
> **仅可改** `connectFrom` / `note` / `status`，然后 Phase 1+ **严格按清单施工**。

---

## 两阶段分工

| 阶段 | 谁做 | 产出 |
|------|------|------|
| **Preprocess** | aw-support | `scene-composition-checklist.draft.json`（`_source: "aw-support-draft"`） |
| **Phase 0 规划** | **Sino**（一个规划 turn） | 复制 draft → final checklist（`_source: "sino-planned"`）— **只写一次** |
| **Phase 1+ 施工** | **Sino** | 读 SSOT → 按 **batchId 语义批次** 施工 → 只更新 task.status |
| **进度 sync** | aw-support（可选） | 根据 graph + execute 摘要标 `verified` |

---

## Phase 0 必读输入（runDir — **渐进式披露**）

| Tier | 文件 | 用途 |
|------|------|------|
| **1** | **`keypoint-layout-estimate.json`** | gridPosition、suggestedBBox、AddBaseGrid 尺度 |
| **1** | `location-layout-contract.json` | LOC **id**、layoutMode、footprintMin、structureParams |
| **1** | **`town-building-scatter.json`** | 叙事 + 补充散布建筑 |
| **Draft** | **`scene-composition-checklist.draft.json`** | 确定性 task 骨架 — **禁止改 namePort/坐标/footprint** |
| **2** | `layout-sketch.json` + `keypoint-positions.json` | 坐标草图（按需） |
| **2** | `prefab-scene-picks.json` | 每 LOC 推荐 itemName |
| **2** | **`prefab-footprint-summary.json`** | 装饰 footprint 占格 |

**Phase 0 禁止 read**：`prefab-catalog.json`（264KB+）、`preprocessed.json`、glob skill md。

**禁止** Phase 0 跳过 draft 直接手写坐标；禁止读 `executions/`、`_source: aw-support-prebuilt` 旧 checklist。

---

## 规划要点（checklist 必须定死）

0. **Keypoint 估算** — `keypointEstimateRef`；AddBaseGrid 用 estimate.canvas；**`assets.baseName`→`in_1`（场景名）、`baseAsset`→`in_4`（tile）勿对调**；坐标来自 `keypoint-positions.json` grid
1. **地图尺度 + 分区** — AreaPartition **多点 bbox** + **`boundaryStyle=organic`**（禁止四角等面积 rectilinear 田字格）；读 checklist `partitionPointsJson` / `partitionAreasJson`
2. **视觉中心** — `visualCenter: { locationId, reason }`
3. **叙事内构建筑** — PickOneBuilding **≥15×15** → BuildingStructures（**`bottomDoor: true`**）
4. **城镇补充** — draft scatter tasks：`namePort` **= itemName**（禁止父区域名）；`batchId: town-scatter`；**暂禁 PickMultiBuildings**
5. **命名** — `locationId` / `namePort` = 上游 name 原文；`narrativeLocationNames[]` = `requiredLocationIds`
6. **资产 footprint** — scatter 用 town-building-scatter；装饰用 **prefab-footprint-summary**（禁止 1×1 默认）
7. **道路** — `PathConnectionLink` batch 在 **全部 BuildingStructures 之后**；POI：BuildingPath+outer_door
8. **装饰三层** — PlaceOne（地标）→ LocalPrecise → Natural 多层多品种（草/灌木/树推荐，非强制；density=目标量级×丰富度系数÷Rest有效格数，丰富度 1.0/1.5/2.0–2.5，仅限制在概率范围 0–1）

---

## Phase 1+ 纪律

- **找清单**：`{runDir}/scene-composition-checklist.json` — 续跑 `read_file` 一次即可，**禁止重写整文件**
- **每 turn 只想**：选电池 · 设 params · 连线 · execute
- **批次**：同 `batchId` 的连续 pending 可一次连多组 + 一次 execute
- **只改 status**：`pending` → `in_graph` → `verified`

---

## 补充细节要点（写进 checklist，施工时只执行）

- **narrative_interior** — `assets.AreaWidth/AreaHeight` ≥ 15；`structureParams.bottomDoor: true`
- **decorative_exterior 建筑** — 可 ≥10×10；无 BuildingStructures
- 描述有、树无的结构 → decoration + catalog footprint
- POI 周围城镇 → 父区分区 + supplementary buildings batch
- **禁止**多个 AreaPartition 都从 BaseNode fan-out

---

## checklist JSON 形状（落盘 SSOT）

```json
{
  "version": 1,
  "sceneName": "...",
  "_source": "sino-planned",
  "keypointEstimateRef": "keypoint-layout-estimate.json",
  "townBuildingPlan": { "minTotalBuildings": 10, "supplementaryBatchId": "town-scatter", "scatterTemplate": "PickOneBuilding" },
  "narrativeLocationNames": ["望江客栈", "..."],
  "visualCenter": { "locationId": "...", "reason": "..." },
  "globalFillPolicy": {
    "minEffectiveFillRatio": 0.55,
    "maxEffectiveFillRatio": 0.92,
    "restMustHaveFillTask": true
  },
  "locationHints": [{ "id": "...", "recommendedTemplates": ["..."], "densityNote": "..." }],
  "tasks": [
    {
      "id": "m0-base",
      "phase": "base",
      "template": "AddBaseGrid",
      "batchId": "m0",
      "status": "pending",
      "assets": {
        "baseName": "京畿南境驿道",
        "baseAsset": "草地",
        "AreaWidth": 60,
        "AreaHeight": 40
      },
      "note": "M0: baseName→in_1, baseAsset→in_4"
    },
    {
      "id": "inn-structure",
      "phase": "structure",
      "template": "PickOneBuilding",
      "batchId": "望江客栈-结构",
      "locationId": "望江客栈",
      "connectFrom": { "source": "AreaPartition.out_0(Scene)", "target": "PickOneBuilding.in_1" },
      "restFrom": "PickOneBuilding.out_2(Rest)",
      "status": "pending",
      "assets": { "BuildingAsset": "望江客栈", "AreaWidth": 15, "AreaHeight": 15 },
      "structureParams": { "bottomDoor": true }
    },
    {
      "id": "town-scatter-1",
      "phase": "structure",
      "template": "PickOneBuilding",
      "batchId": "town-scatter",
      "locationId": "清水镇",
      "namePort": "市集",
      "connectFrom": { "source": "PickOneBuilding.out_2(Rest)", "target": "PickOneBuilding.in_1" },
      "restFrom": "PickOneBuilding.out_2(Rest)",
      "status": "pending",
      "assets": {
        "BuildingAsset": "市集",
        "itemName": "市集",
        "PositionX": 12,
        "PositionZ": 40,
        "AreaWidth": 7,
        "AreaHeight": 8
      },
      "note": "scatter：namePort=itemName；坐标/footprint 来自 draft + keypoint-positions — 禁止 PickMultiBuildings"
    },
    {
      "id": "town-scatter-2",
      "phase": "structure",
      "template": "PickOneBuilding",
      "batchId": "town-scatter",
      "connectFrom": { "source": "PickOneBuilding.out_2(Rest)", "target": "PickOneBuilding.in_1" },
      "restFrom": "PickOneBuilding.out_2(Rest)",
      "status": "pending",
      "assets": { "BuildingAsset": "茅草屋2", "AreaWidth": 6, "AreaHeight": 6 },
      "note": "scatter 第2栋…"
    },
    {
      "id": "deco-lamp",
      "phase": "decoration",
      "template": "PlaceOneDecoration",
      "batchId": "东区-装饰",
      "connectFrom": { "source": "PickOneBuilding.out_2(Rest)", "target": "PlaceOneDecoration.in_1" },
      "restFrom": "PlaceOneDecoration.out_2(Rest)",
      "assets": {
        "DecorationAsset": "灯柱",
        "footprintWidth": 2,
        "footprintHeight": 2
      },
      "status": "pending"
    }
  ],
  "progress": { "total": 0, "verified": 0 }
}
```

每项 `tasks[]` 建议含：`id`, `phase`, `template`, `batchId`, `locationId`, `namePort`, `assets`, **`connectFrom`**, `restFrom`, `structureParams`, `connects`, `status`, `note`。

---

## Phase 0 完成 → 立刻 M0

落盘 checklist 后 **同一 session** 进入 M0，**不要**规划 turn 里连 instantiate 多组。

Phase 1+ 见 [fast-loop.md](fast-loop.md) · Rest/填充见 [spatial-fill-and-rest.md](spatial-fill-and-rest.md)

---

## 禁止磁盘直改 graph.json

Phase 1+ 改图 **只用** `applyBatch`（含 `deleteEdge`）。**禁止** shell/python 写 `projects/.../state/graph.json` — hash 校验失败会导致项目无法 open。execute 失败时用 `pipeline.get(groupId)` 查线，勿 `pipeline.import` 或删项目重来。
