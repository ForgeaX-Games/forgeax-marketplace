# 自然装饰 - NaturalDecorationDistribution（自然装饰散布）

> 权威详情：[../../../../batteries/templates/scene/NaturalDecorationDistribution/README.md](../../../../batteries/templates/scene/NaturalDecorationDistribution/README.md)
> templateId：`NaturalDecorationDistribution`。完整端口以 `scene:templates.get` 为准。

## 1. 管线电池的基本介绍

管线所属层级：**自然地物 / 装饰层级**

管线效果：在剩余空地上按密度散布自然装饰（树木、石头等）。通常接在上一组的 Rest/Non-Path 之后，是装饰链的主力。**多品种**时每种一组、用 Rest 链式串联，各组独立 density。

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

- **Density**：装饰密度，越大越密。多品种时每组各自调 density。
- **AssetName 一组一名**；多品种 = 多组串联（每组 `out_2`Rest → 下一组 `in_1`）。

## 5. 管线效果描述

- 在空地撒植被/石头等，是"禁止大面积空白"的主要手段——对合理区域大面积、多品种散布。
- `in_1` 悬空会静默空跑（execute 仍 completed），务必确认接上上游 Rest。
