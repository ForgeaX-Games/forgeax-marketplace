# PickOneBuilding（单点建筑）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1781806910509_ac8a1`，也可用 basename `PickOneBuilding`。

在指定坐标放置**一栋**建筑区域（点位 + 宽高 + 资产名）。与 `PickMultiBuildings`（多点批量）互补。

**尺寸**：`layoutMode=narrative_interior` 时 AreaWidth/AreaHeight **≥15×15**（与 catalog footprint 取 max）；装饰外观 ≥10×10。接 `BuildingStructures` 前须 execute 验证 footprint。

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

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../_DOC_STANDARD.md`](../_DOC_STANDARD.md)。Sino：**通道 A** `instantiateTemplate`；**通道 B** `applyBatch`（白名单 op + `connect`）。

### 通道 A · 实例化

```json
{ "toolId": "scene:pipeline.instantiateTemplate", "caller": { "kind": "ai" },
  "args": { "projectId": "<pid>", "templateId": "PickOneBuilding", "groupId": "verify_pk1",
            "position": { "x": -400, "y": 600 },
            "opts": { "actor": "ai:sino", "label": "实例化 PickOneBuilding" } } }
```

### 通道 B · 必接输入（白名单 opId → 本组端口）

| 本端口 | 白名单上游 | 怎么喂 |
|--------|-----------|--------|
| `in_1` | 上游 `out_*` + `scene_focus_path` | `AreaPartition.out_0` + path `/父区域/划分子区域1` → focus.scene → `in_1` |
| `in_0` | `text_panel` | **BuildingName**（叙事名，如 `望江客栈`）— **不是** `in_2` |
| `in_4` | `text_panel` | BuildingAsset（catalog object/tile 名） |
| `in_3` | `manual_points` | Point `{x,y}`，子区内偏南示例 `{28,24}` |
| `in_5` / `in_6` | `number_const` | AreaWidth × AreaHeight，叙事内构 **≥15×15**；验证链用 **18×16**（故意非正方形） |
| `in_2` | `number_const` | BuildingHeight（格） |
| `in_14` | `seed_control` | 与全局 seed 扇出一致 |

完整 ops 见验证报告 `aw-support/battery-verify/<projectId>/step-m2-pickonebuilding.json`。

---

## 如何用命令消费输出（输出侧）

| 本端口 | 典型下游 | 白名单 opId | 禁止 |
|--------|---------|-------------|------|
| `out_1` | BuildingStructures | `connect` → `BuildingStructures.in_0` | **禁止**接 Rest 或 Path `in_2` |
| `out_2` | PathConnection / 下一栋 | `connect` → Path `in_2` 或下一 Pick `in_1` | 禁止对 `out_2` 再 instantiate 模板 |
| `out_3` | 门洞 POI 链 | `string_concat` + `scene_focus_path` + `node_explode` | 禁止手拍 `/outer_door` 坐标 |

---

## 已验证调用示例

| 项 | 值 |
|---|---|
| **projectId** | `p_mr4b9s3j_dycp8k` |
| **报告** | [`step-m2-pickonebuilding.json`](../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m2-pickonebuilding.json) |
| **groupId** | `verify_pk1` |
| **参数** | 子区 `/父区域/划分子区域1`；点 `{28,24}`；**18×16**；名 `望江客栈` |

**headless 验收（execute 后）：**

```bash
PID=p_mr4b9s3j_dycp8k
curl -s -X POST "http://127.0.0.1:9557/api/v1/projects/$PID/execute" \
  -H 'content-type: application/json' -H 'x-forgeax-caller-kind: ai' \
  -d '{"narrativeLocationNames":["父区域","望江客栈"]}' \
  | jq '.outputs.verify_pk1.out_1[0].items[0].tree.children[].name'
# 预期含：望江客栈
```

单链顺序：M0 AddBaseGrid → M1 AreaPartition → **M2 PickOneBuilding** → M3 BuildingStructures → …
