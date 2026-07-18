# PlaceOneDecoration（单点装饰物）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_1783000010000_p1dec`，也可用 basename `PlaceOneDecoration`。

在指定**可放置区域**（上游 Scene 的底面形状）内，围绕参考 **Point** 尽可能贴近地放置**单个**装饰物：底面占地由 FootprintWidth × FootprintHeight 定义，竖向由 DecorationHeight 定义包围盒高度；放不下时 `alg_point2rect` 会自动缩小 footprint 直至完整落在区域内。

与 `PickOneBuilding`（建筑 + 随机 blocky 轮廓）互补；本模板**不做** blocky 雕刻， footprint 为精确矩形贴合。

与 `NaturalDecorationDistribution`（随机散布多棵）互补；本模板用于**精准指定**单个装饰物位置（如入口雕像、特定树、地标物件）。

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游可放置区域（通常接 Rest） |
| IN | `in_3` | Point 参考位置（`manual_points` → point） |
| IN | `in_5` / `in_6` | FootprintWidth / FootprintHeight 底面占地（格） |
| IN | `in_2` | DecorationHeight 竖向高度（格，写入 grid2node zRange） |
| IN | `in_0` / `in_4` | DecorationName / DecorationAsset |
| OUT | `out_1` | Decoration 装饰物 scene（主产物） |
| OUT | `out_3` | DecorationPath 路径句柄 |
| OUT | `out_2` | Rest 扣除装饰物后的剩余区域 |
| OUT | `out_0` | Scene 整树中间态 |
| OUT | `out_4` | RestPath |

其余 `in_*` 为 hidden 高级参数，默认即可。完整端口以 `scene:templates.get` 为准。

## 内部算法链（固定操作）

```
Scene → explode → rect_grid → voxel_slice → region
  → alg_point2rect(region, point, width, height)   # 贴近参考点、尽量保持 footprint
  → alg_region_subtract(全区域, 装饰 footprint)
  → grid2node(装饰, zRange=DecorationHeight) + ObjectAssetName
  → grid2node(rest) + 标准 Path 句柄
```

## 典型串联

```
… → Rest → PlaceOneDecoration.in_1(Scene)
manual_points → in_3(Point)
number_const → in_5/in_6/in_2(尺寸)
type_string → in_0/in_4(名称/资产)

PlaceOneDecoration.out_1(Decoration) → tree_merge
PlaceOneDecoration.out_2(Rest)       → 下一层 in_1 或 LakeRegions
```

多个精准装饰物：用 **`out_2`(Rest) → 下一实例 `in_1`(Scene)** 串联，每实例一个 Point。

## 验证要点

- `in_1` Scene 悬空 → 静默空跑，无 Decoration 输出。
- Point 落在区域外 0 格 → 算法取最近有效格再贴合矩形。
- 区域放不下目标 footprint → 自动缩小，仍尽量靠近 Point。
- 验收：execute 后 Decoration 子节点非空，Rest 为扣除 footprint 后的区域。

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../_DOC_STANDARD.md`](../_DOC_STANDARD.md)。

### 通道 A · 实例化

```json
{ "templateId": "PlaceOneDecoration", "groupId": "verify_p1dec", "position": { "x": -400, "y": 1500 } }
```

### 通道 B · 必接输入

| 本端口 | 语义 | 怎么喂 |
|--------|------|--------|
| `in_1` | Scene（可放置 Rest） | **`PickOneBuilding.out_2` → `scene_focus_path`（path=`/父区域/划分子区域1/rest`）→ `in_1`**。禁止直连 `PathConnection.out_2`（多分支 DataTree 会空跑）。Path 与 PlaceOne 共用同一 Pick Rest 源 + 聚焦路径。 |
| `in_3` | Point | `manual_points` → point；须在有效 Rest 格内（可用 `node_explode.2dPoints` 选点） |
| `in_5` / `in_6` | **FootprintWidth × FootprintHeight** | `number_const` — **底面矩形占地格数**（`alg_point2rect` 贴合用） |
| `in_2` | **DecorationHeight** | `number_const` — **竖向包围盒高度**（写入 grid2node zRange），**与底面 footprint 分离** |
| `in_0` / `in_4` | DecorationName / DecorationAsset | `text_panel` |

验证链参数：**Footprint 7×5**，**DecorationHeight 4**，点 `{20,20}`，名 `路口石灯`，资产 `草地`。

### 底面占地 vs 竖向高度

| 参数 | 端口 | 含义 |
|------|------|------|
| FootprintWidth × FootprintHeight | `in_5` / `in_6` | 装饰物**底面**占多少格（平面矩形） |
| DecorationHeight | `in_2` | 体素柱**有多高**（z 方向层数） |

---

## 如何用命令消费输出（输出侧）

| 本端口 | 典型下游 | 说明 |
|--------|---------|------|
| `out_1` | `tree_merge` | Decoration scene（主产物） |
| `out_2` | 下一装饰 `in_1` | Rest（扣除 footprint 后；节点名固定 **`rest`**，路径随层级嵌套如 `…/rest/rest`） |
| `out_3` | 路径句柄 | DecorationPath；headless 可 jq 验收 |

---

## 已验证调用示例

| 项 | 值 |
|---|---|
| **projectId** | `p_mr4b9s3j_dycp8k` |
| **报告** | [`step-m5-placeonedecoration.json`](../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m5-placeonedecoration.json) |
| **groupId** | `verify_p1dec` |
| **restFocusPath** | `/父区域/划分子区域1/rest` |
| **Scene 源** | `verify_pk1.out_2`（PickOne Rest，非 Path.out_2） |

**headless 验收：**

```bash
PID=p_mr4b9s3j_dycp8k
curl -s -X POST "http://127.0.0.1:9557/api/v1/projects/$PID/execute/summary" \
  -H 'content-type: application/json' -H 'x-forgeax-caller-kind: ai' \
  -d '{"narrativeLocationNames":["父区域","路口石灯"]}' \
  | jq '.outputs.verify_p1dec | {out_1:.out_1.totalCellCount, out_2:.out_2.totalCellCount, out_3:.out_3.itemCount}'
# 预期：out_1/out_2 totalCellCount > 0；out_3 itemCount ≥ 1
```

完整 ops 见报告（`p1_rest_path` + `p1_rest_focus` + `verify_pk1.out_2`）。

### Preview 汇总（必做）

装饰链完成后，须把 **`LocalPreciseDecoration.out_1`（或最后一组主产物）→ `m0_merge` → `scene_output`**，否则 Preview 仍只有 M1 的四区草地。见 [`step-m8-exportpreview.json`](../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m8-exportpreview.json)。
