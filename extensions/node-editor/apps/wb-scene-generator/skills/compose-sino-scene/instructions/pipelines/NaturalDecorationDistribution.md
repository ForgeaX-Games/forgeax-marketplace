# 自然装饰 - NaturalDecorationDistribution（自然装饰散布）

> 权威详情：[../../../../batteries/templates/structures/decorations/NaturalDecorationDistribution/README.md](../../../../batteries/templates/structures/decorations/NaturalDecorationDistribution/README.md)
> templateId：`NaturalDecorationDistribution`。端口序号和语义（`label`）以 instantiateTemplate 返回的 exposedInputs/exposedOutputs 为准（勿 templates.get 预读）；本文档在 `label` 缺失或需要接线配方/数值参考时作补充。

## 1. 管线电池的基本介绍

管线所属层级：**自然地物 / 装饰层级**

管线效果：在剩余空地上按密度散布装饰点。通常接在 PlaceOne / LocalPrecise **之后**，用 `out_2` Rest 作**大面积背景填充**，防空白。

**无单颗 Footprint 口**——只控制 Density（及可选 zHeight）；单颗平面尺寸不可调。

**选型**：

| 模板 | 何时用 | 可挂资产 |
|------|--------|----------|
| `PlaceOneDecoration` | 少量地标/人造件、有明确位置和/或底面尺寸 | 雕像、棚亭、叙事指名的那一棵大树等 |
| `LocalPreciseDecoration` | 兴趣点旁一簇/一环点缀 | **仅**简单小物件 |
| **`NaturalDecorationDistribution`（本模板）** | 大片 Rest 背景填充；**草/灌木/树/散布石推荐走本模板（非强制）**；Density 分层 | **仅**底面简单、结构简单的植被/石块；**禁止**复杂体量或需精准落点的物件 |

例如散布山石应选「小假山」1×1；「假山」4×1 属于大体积资产，应改用 `PlaceOneDecoration` 并明确 Footprint。

问卷 `count` 对植被类是量级暗示，**不要**按 count 逐个 PlaceOne。大片 Rest 空白或清单含植被时用本模板；装饰很少且全是精准物件时可以不用。按需求选用，不必硬凑三种。

> **时序**：须在高差之后再播撒；避开叙事核心区（建筑/道路/广场）。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 |
|--------|------|------|---------|--------|
| `in_1` | scene | 上游剩余空地 | **必接** | 上一组 Rest（悬空则整组静默空跑） |
| `in_0` | string | NamePrefix 名称前缀 | 可选 | `text_panel` |
| `in_5` | string | AssetName 装饰资产名 | 建议接 | `text_panel`，如 `行道树`（**简单资产**；**不是 `in_2`**） |
| `in_2` | number | Density 密度 | 建议接 | `number_const` |
| `in_3` | number | Seed | **必接** | **`aw_m0_seed.seed`（全局固定非 0）**；禁止悬空/`seed:0` |
| `in_4` | number | zHeight | 可选 | 默认即可 |

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Decoration 装饰（主产物） | 调试 / 领域引用 |
| `out_0` | scene | Scene 整树汇总口 | `appendMergeItem` → `aw_m0_merge`（`{ label:"Scene", portName:"out_0" }`） |
| `out_2` | scene | Rest 剩余空地 | 下一组 `in_1`（多品种链式） |

## 4. 推荐参数

- **Density（先看面积）**：算法会对每个 Rest 有效格独立按 Density 概率抽样，所以优先用 `目标量级 × 丰富度系数 ÷ Rest 有效格数`。丰富度系数：稀疏 `1.0`、正常 `1.5`、丰富 `2.0–2.5`；计算结果直接使用，**仅限制在底层概率范围 `0–1`，禁止人为截断到 `0.01`**。例如 Rest≈153 格、目标≈5 且取正常系数 `1.5`，Density≈`5×1.5÷153≈0.049`。只有 Rest 面积未知时才用兜底区间：树 `0.01–0.04`、灌木/散布石 `0.02–0.06`、草/地被 `0.04–0.12`。一组一种装饰，靠 **多层 Rest 链 + 不同 density** 叠层次。
- **AssetName 一组一名** — 每次只能散布一种 itemName；多品种 = **多组**串联（`out_2` Rest → 下一组 `in_1`）。
- 草→灌木→树（或多种树/石）宜各一组且各自不同 density；不同 Rest 段（镇郊 / 栈道侧 / 崖边）亦可再叠。

## 5. 管线效果描述

- 用途是「禁止大面积空白」的背景填充——不是精准地标手段。
- **不要**用本模板放置有明确尺寸/落点的复杂物件；那些走 PlaceOne。
- 有植被需求时宜 **多层多品种** Natural（不同 asset），**禁止**只象征性放一种就收工。
- `in_1` 悬空会静默空跑（execute 仍 completed），务必确认接上上游 Rest。

> **已验证 M6**：projectId `p_mr49zz2e_idczh2` → [`step-m6-naturaldecoration.json`](../../../../../../aw-support/battery-verify/p_mr49zz2e_idczh2/step-m6-naturaldecoration.json)。**asset → `in_5`**，**density → `in_2`**（禁止接反；验证链曾用 0.012，生产按 Rest 面积公式计算）。
