# 局部精准装饰 - LocalPreciseDecoration（局部装饰播撒）

> 权威详情：[../../../../batteries/templates/structures/decorations/LocalPreciseDecoration/README.md](../../../../batteries/templates/structures/decorations/LocalPreciseDecoration/README.md)
> templateId：`group_local_precise_decoration` 或 basename `LocalPreciseDecoration`。端口序号和语义（`label`）以 instantiateTemplate 返回的 exposedInputs/exposedOutputs 为准（勿 templates.get 预读）；本文档在 `label` 缺失或需要接线配方/数值参考时作补充。

## 1. 管线电池的基本介绍

管线所属层级：**自然地物 / 装饰层级**

管线效果：以**兴趣点**为中心，在圆形半径内采样多个点位并挂资产，适合「建筑旁点缀一圈」「路口周围散落」等**局部簇/环**场景。

**无顶层 Footprint 口**——只控制 Count / ScatterRadius / Algorithm；单颗平面尺寸不可调。

**选型**：

| 模板 | 何时用 | 可挂资产 |
|------|--------|----------|
| `PlaceOneDecoration` | 少量地标/人造件、有明确位置和/或底面尺寸 | 需占格贴合的物件 |
| **`LocalPreciseDecoration`（本模板）** | 兴趣点旁一簇/一环点缀 | **仅**底面简单、结构简单的小物件（花草、碎石、小灌木、灯笼等近单格） |
| `NaturalDecorationDistribution` | 大片 Rest 背景填充；草/灌木/树推荐多层（非强制；Density 分层，≤0.01） | 同上——简单植被/石块 |

有明显宽深 + 落点的地标 → **改用 PlaceOne**，不要用本模板。按需求选用，不必硬凑三种。

> **时序**：接在高差之后、通常位于 PlaceOne 之后、Natural 之前；兴趣点取建筑/keypoint 旁。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 |
|--------|------|------|---------|--------|
| `in_1` | scene | 上游剩余空地 | **必接** | 上一组 Rest（悬空则整组静默空跑） |
| `in_2` | point2d | 兴趣点 | **建议接** | `manual_points`（x→列、y→行） |
| `in_19` | number | Count 采样数量 | 建议接 | `number_const`，默认约 5 |
| `in_20` | number | ScatterRadius 播撒半径 | 建议接 | `number_const`，默认约 12 格 |
| `in_21` | string | Algorithm 采样算法 | 可选 | `text_panel`：`random` / `cluster` / `ring` / `poisson` / `noise` |
| `in_0` | string | NamePrefix | 可选 | `text_panel` |
| `in_5` | string | AssetName | 建议接 | `text_panel`（**简单小物件**） |
| `in_3` | number | Seed | **必接** | **`aw_m0_seed.seed`（全局固定非 0）**；禁止悬空/`seed:0` |

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Decoration 装饰（主产物） | `appendMergeItem` → `aw_m0_merge` |
| `out_2` | scene | Rest 剩余空地 | 下一组 `in_1` |

## 4. 推荐参数

- **Count**：3–8 适合小范围点缀；10+ 适合较大半径区域。
- **ScatterRadius**：小物件 6–10；灌木丛/碎石带 12–20。
- **Algorithm**：`cluster` 靠近中心簇状；`ring` 环状；`poisson` 最小间距；`noise` 有机分布。
- 多品种：用 **`out_2` Rest → 下一组 `in_1`** 链式串联，每组换 AssetName / Point / Count。

## 5. 管线效果描述

- **禁止**挂复杂底面/复杂结构物件（雕像院落、大型机关等）——那些走 PlaceOne。
- 兴趣点可落在无效格，scatter 会 BFS 吸附到最近有效格再采样。
- `in_1` 悬空会静默空跑，务必确认接上上游 Rest。

> **已验证 M7**：projectId `p_mr49zz2e_idczh2` → [`step-m7-localprecisedecoration.json`](../../../../../../aw-support/battery-verify/p_mr49zz2e_idczh2/step-m7-localprecisedecoration.json)。Count=8，ScatterRadius=6，Algorithm=`poisson`；无顶层 Footprint 口。
