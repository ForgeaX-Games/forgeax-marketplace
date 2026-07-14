# 自然装饰 - NaturalDecorationDistribution（自然装饰散布）

> 权威详情：[../../../../batteries/templates/scene/NaturalDecorationDistribution/README.md](../../../../batteries/templates/scene/NaturalDecorationDistribution/README.md)
> templateId：`NaturalDecorationDistribution`。端口以 instantiateTemplate 返回的 exposedInputs 为准（勿 templates.get 预读）。

## 1. 管线电池的基本介绍

管线所属层级：**自然地物 / 装饰层级**

管线效果：在剩余空地上按密度散布自然装饰（树木、石头等）。通常接在 **`LocalPreciseDecoration` / `PlaceOneDecoration` 之后**，用 **`out_2` Rest** 作背景填充，是装饰链的**大面积兜底**。

> ### 🌿 须与其他装饰叠加（禁止单独使用）
> 本模板只做**全区域随机散布**。若整张场景**只用** `NaturalDecorationDistribution`，整图会**单调同质**（一片相同植被）。必须与 **`PlaceOneDecoration`**（地标单点）和 **`LocalPreciseDecoration`**（锚点旁簇/环）**组合**；三者分工见 [SKILL 第二步「装饰叠加」](../../../../SKILL.md)。
>
> **时序**：须在 **`MountainContourGenerate`（地形高差）之后**再播撒装饰；地形本身应优先于装饰，且避开叙事核心区（建筑/道路/广场）。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 |
|--------|------|------|---------|--------|
| `in_1` | scene | 上游剩余空地 | **必接** | `PathConnection.out_1` 或上一组 Rest（悬空则整组静默空跑） |
| `in_0` | string | NamePrefix 名称前缀 | 可选 | `text_panel` |
| `in_5` | string | AssetName 装饰资产名 | 建议接 | `text_panel`，如 `行道树` |
| `in_2` | number | Density 密度 | 建议接 | `number_const` |
| `in_3` / `in_4` | number | seed / zHeight | `seed_control.seed` |

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Decoration 装饰（主产物） | `tree_merge` |
| `out_2` | scene | Rest 剩余空地 | 下一组 `in_1`（多品种链式） |

## 4. 推荐参数

- **Density**：**推荐 `0.01` 上下**（稀疏、自然）；**禁止** >0.05 铺满。一组一种装饰，靠 **多次 Rest 链**叠层次，不靠单次高密度。
- **AssetName 一组一名** — Natural 模板**每次只能散布一种** itemName；多品种 = **多组** `NaturalDecorationDistribution` 串联（`out_2` Rest → 下一组 `in_1`）。
- 不同 Rest 段（镇郊 / 栈道侧 / 崖边）各跑 1–2 组 Natural，asset 与 density 可微调。

## 5. 管线效果描述

- 在空地撒植被/石头等，是"禁止大面积空白"的**背景填充**手段——接在精准/局部装饰之后，铺剩余 Rest。
- **不要**作为唯一装饰手段；与 `PlaceOneDecoration`、`LocalPreciseDecoration` **叠加**才够层次。
- **不要** checklist 里每种装饰只象征性写 1 个 Natural task — 须 **≥3 个** Natural batch（不同 asset 或不同 Rest 段）。
- `in_1` 悬空会静默空跑（execute 仍 completed），务必确认接上上游 Rest。

> **已验证 M6**：projectId `p_mr49zz2e_idczh2` → [`step-m6-naturaldecoration.json`](../../../../../../aw-support/battery-verify/p_mr49zz2e_idczh2/step-m6-naturaldecoration.json)。**asset → `in_5`**，**density 0.012 → `in_2`**（禁止接反）。
