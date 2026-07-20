# LocalPreciseDecoration（局部精准装饰播撒）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_local_precise_decoration`，也可用 basename `LocalPreciseDecoration`。

以**兴趣点**为中心，在父区域有效格内的圆形半径内采样多个小型装饰物点位并挂树；算法核心为 scenealg **`alg_points_center_scatter`**（源自 `components/decoration/precise_decoration_scatter`）。

## 与相关模板的分工

| 模板 | 用途 |
|---|---|
| **NaturalDecorationDistribution** | 全区域**随机散布**（密度驱动，无中心点） |
| **PlaceOneDecoration** | **单个**装饰物，矩形 footprint 精准贴合 |
| **LocalPreciseDecoration**（本模板） | 以兴趣点为中心的**局部多颗**小型装饰（半径 + 数量 + 算法） |

## 主要可见端口

| 方向 | portName | 语义 |
|---|---|---|
| IN | `in_1` | Scene 上游剩余空地（**必接**） |
| IN | `in_2` | Point 兴趣点 point2d（x→列、y→行） |
| IN | `in_19` | Count 采样数量 |
| IN | `in_20` | ScatterRadius 播撒半径（格数） |
| IN | `in_21` | Algorithm 采样算法：`random` / `cluster` / `ring` / `poisson` / `noise` |
| IN | `in_0` | NamePrefix 名称前缀 |
| IN | `in_5` | AssetName 装饰资产名 |
| IN | `in_3` | Seed 随机种子 |
| OUT | `out_1` | Decoration 装饰（主产物） |
| OUT | `out_2` | Rest 剩余空地 |

`in_1` 悬空会导致整组静默空跑（execute 仍 completed）。完整端口以 `scene:templates.get` 为准。

## 内部管线（③ 段 scenealg）

```
scene → explode → rect_grid → voxel_slice（region）
  → alg_points_center_scatter(point, count, scatterRadius, algorithm)
  → grid2node + MultiNames(NamePrefix) + ObjectAssetName(AssetName)
  → add_child；alg_region_union_all(points) → subtract → Rest
```

兴趣点不在有效格内时，scatter 电池会 BFS 吸附到最近有效格再采样。

---

## 如何用命令调用（输入侧）

> 文档标准见 [`../../_DOC_STANDARD.md`](../../_DOC_STANDARD.md)。本模板**无顶层 Footprint 口**；用 **ScatterRadius + Count** 控制局部多颗小装饰范围（与 PlaceOne 单矩形 footprint 区分）。

| 本端口 | 语义 | 怎么喂 |
|--------|------|--------|
| `in_1` | Scene Rest | **`NaturalDecorationDistribution.out_2` → `scene_focus_path`（path=`/父区域/划分子区域1/rest/rest/rest`）→ `in_1`** |
| `in_2` | Point 兴趣点 | `manual_points`，如建筑/广场中心 `{28,26}` |
| `in_19` | Count | `number_const`，验证链 **8** |
| `in_20` | ScatterRadius | `number_const`，验证链 **6**（格） |
| `in_21` | Algorithm | `text_panel`：`poisson` / `random` / `cluster` / `ring` / `noise` |
| `in_0` / `in_5` | NamePrefix / AssetName | `text_panel` |
| `in_3` | Seed | `seed_control` |

---

## 已验证调用示例

| 项 | 值 |
|---|---|
| **projectId** | `p_mr4b9s3j_dycp8k` |
| **报告** | [`step-m7-localprecisedecoration.json`](../../../../../../../aw-support/battery-verify/p_mr4b9s3j_dycp8k/step-m7-localprecisedecoration.json) |
| **groupId** | `verify_lp1` |
| **restFocusPath** | `/父区域/划分子区域1/rest/rest/rest` |

```bash
PID=p_mr4b9s3j_dycp8k
curl -s -X POST "http://127.0.0.1:9557/api/v1/projects/$PID/execute/summary" \
  -H 'content-type: application/json' -H 'x-forgeax-caller-kind: ai' \
  -d '{"narrativeLocationNames":["父区域"]}' \
  | jq '.outputs.verify_lp1.out_4.itemCount'
# 预期 ≥ 8（前缀 局部）
```
