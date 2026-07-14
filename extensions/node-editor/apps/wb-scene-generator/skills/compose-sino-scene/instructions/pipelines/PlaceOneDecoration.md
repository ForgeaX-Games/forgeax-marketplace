# 精准装饰 - PlaceOneDecoration（单点放置指定装饰物）

> 权威详情：[../../../../batteries/templates/scene/PlaceOneDecoration/README.md](../../../../batteries/templates/scene/PlaceOneDecoration/README.md)
> templateId：`PlaceOneDecoration`（或库 id `group_1783000010000_p1dec`）。端口以 instantiateTemplate 返回的 exposedInputs 为准（勿 templates.get 预读）。

## 1. 管线电池的基本介绍

管线所属层级：**自然地物 / 装饰层级**

管线效果：在指定**可放置区域**（上游 Scene 的底面形状）内，围绕一个参考 **Point** 尽量贴近地放置**单个**装饰物——底面占地由 FootprintWidth×FootprintHeight 精确矩形定义，竖向由 DecorationHeight 定义包围盒高度；放不下时内部自动缩小 footprint 直至完整落在区域内。

**与 `NaturalDecorationDistribution` / `LocalPreciseDecoration` 的分工**（**三者须叠加，禁止只选一种**）：
- `PlaceOneDecoration`（本模板）：**精准地标单点**——入口雕像、主树、标志性物件
- `LocalPreciseDecoration`：兴趣点旁**局部多颗**播撒（簇/环）
- `NaturalDecorationDistribution`：剩余 Rest 上**背景随机填充**

> **时序**：地形高差（`MountainContourGenerate`，避开叙事核心区）→ 本模板（地标）→ `LocalPreciseDecoration` → `NaturalDecorationDistribution` → 湖。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 |
|--------|------|------|---------|--------|
| `in_1` | scene | 上游可放置区域 | **必接** | 上一组 `Rest`（悬空则整组静默空跑） |
| `in_3` | point | Point 参考放置位置 | **必接** | `manual_points.point`（x,y→point） |
| `in_5` / `in_6` | number | FootprintWidth / FootprintHeight 底面占地（格） | **必接** | `number_const` — **从 `prefab-footprint-summary.json` 或 checklist assets 读占格；禁止默认 1×1** |
| `in_2` | number | DecorationHeight 竖向高度（格） | 建议接 | `number_const`（按 `heightRatio` 换算的高度感） |
| `in_0` / `in_4` | string | DecorationName / DecorationAsset 名称/资产名 | 建议接 | `text_panel`（**写语义资产名**，三方一致，如 `雕像`） |

> 其余 `in_*` 为 `[hidden]` 高级参数，默认即可。

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Decoration 装饰物（主产物） | `tree_merge` |
| `out_2` | scene | Rest 扣除该装饰物后的剩余区域 | 下一实例 `in_1`（多个精准装饰物链式） |
| `out_3` / `out_4` | scene | DecorationPath / RestPath 路径句柄 | 需要时用 |
| `out_0` | scene | Scene 整树中间态 | 一般不用 |

## 4. 推荐参数

- **Footprint / Height（硬要求）**：checklist `assets.footprintWidth/footprintHeight` **必填**，来源 `prefab-footprint-summary.json` 或 `prefab-scene-picks.json`；**禁止** Phase 0 read 全量 `prefab-catalog.json` 或默认 1×1。
- **Point**：落在区域外也会 snap；尽量用 keypoint estimate 的 gridPosition 附近坐标。
- **多样化**：同区域多种装饰物 — 不同 itemName、不同 footprint、不同 Point；LocalPrecise 换 Algorithm/Count。
- **多个精准装饰物**：`out_2`(Rest) → 下一实例 `in_1` 链式。

## 5. 管线效果描述

- 用于叙事**地标锚点**；须与 `LocalPreciseDecoration`、`NaturalDecorationDistribution` **叠加**，不可作为唯一装饰手段。
- `in_1` Scene 悬空或 Point 区域放不下 → 静默空跑/自动缩小，`execute` 后务必确认本组 `out_1` 的 Decoration 子节点非空、`out_2` Rest 为扣除 footprint 后的区域。

> **已验证 M5**：projectId `p_mr49zz2e_idczh2` → [`step-m5-placeonedecoration.json`](../../../../../../aw-support/battery-verify/p_mr49zz2e_idczh2/step-m5-placeonedecoration.json)。**Footprint 7×5**（`in_5`/`in_6`）≠ **DecorationHeight 4**（`in_2`）；Rest 须 `scene_focus_path` 聚焦后再接 `in_1`。
