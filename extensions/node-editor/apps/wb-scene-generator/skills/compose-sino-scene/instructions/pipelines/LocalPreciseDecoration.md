# 局部精准装饰 - LocalPreciseDecoration（局部装饰播撒）

> 权威详情：[../../../../batteries/templates/structures/decorations/LocalPreciseDecoration/README.md](../../../../batteries/templates/structures/decorations/LocalPreciseDecoration/README.md)
> templateId：`group_local_precise_decoration` 或 basename `LocalPreciseDecoration`。端口以 instantiateTemplate 返回的 exposedInputs 为准（勿 templates.get 预读）。

## 1. 管线电池的基本介绍

管线所属层级：**自然地物 / 装饰层级**

管线效果：以**兴趣点**为中心，在圆形半径内采样多个小型装饰物（花草、碎石、小物件等），适合「建筑旁点缀一圈」「路口周围散落」「锚点附近簇状/环状分布」等**局部**场景。

> ### 🌿 须与其他装饰叠加（禁止单独使用）
> 本模板只做**局部播撒**。若整图**只用** `LocalPreciseDecoration` 而无全区域背景植被，会显得**稀疏、缺底色**；若只有本模板而无 `PlaceOneDecoration` 地标，会**缺叙事锚点**。须与 **`NaturalDecorationDistribution`**（Rest 背景填充）和 **`PlaceOneDecoration`**（精准地标）**组合**使用。
>
> **时序**：接在 **`MountainContourGenerate` 之后**、通常位于 **`PlaceOneDecoration` 之后**、`NaturalDecorationDistribution` **之前**；兴趣点取建筑/keypoint 旁，勿与叙事核心区的高差冲突。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 |
|--------|------|------|---------|--------|
| `in_1` | scene | 上游剩余空地 | **必接** | 上一组 Rest（悬空则整组静默空跑） |
| `in_2` | point2d | 兴趣点 | **建议接** | `manual_points`（x→列、y→行） |
| `in_19` | number | Count 采样数量 | 建议接 | `number_const`，默认约 5 |
| `in_20` | number | ScatterRadius 播撒半径 | 建议接 | `number_const`，默认约 12 格 |
| `in_21` | string | Algorithm 采样算法 | 可选 | `text_panel`：`random` / `cluster` / `ring` / `poisson` / `noise` |
| `in_0` | string | NamePrefix | 可选 | `text_panel` |
| `in_5` | string | AssetName | 建议接 | `text_panel` |
| `in_3` | number | Seed | 可选 | `seed_control.seed` |

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Decoration 装饰（主产物） | `tree_merge` |
| `out_2` | scene | Rest 剩余空地 | 下一组 `in_1` |

## 4. 推荐参数

- **Count**：3–8 适合小范围点缀；10+ 适合较大半径区域。
- **ScatterRadius**：小物件 6–10；灌木丛/碎石带 12–20。
- **Algorithm**：`cluster` 靠近中心簇状；`ring` 环状；`poisson` 最小间距；`noise` 有机分布。
- 多品种：用 **`out_2` Rest → 下一组 `in_1`** 链式串联，每组换 AssetName / Point / Count。

## 5. 管线效果描述

- 兴趣点可落在无效格（如水域边缘外），scatter 会 BFS 吸附到最近有效格再采样。
- 输出契约与 `NaturalDecorationDistribution` 一致：points 列表 → MultiNames → ObjectAssetName → union → subtract。
- `in_1` 悬空会静默空跑，务必确认接上上游 Rest。

> **已验证 M7**：projectId `p_mr49zz2e_idczh2` → [`step-m7-localprecisedecoration.json`](../../../../../../aw-support/battery-verify/p_mr49zz2e_idczh2/step-m7-localprecisedecoration.json)。Count=8，ScatterRadius=6，Algorithm=`poisson`；无顶层 Footprint 口。
