# 地形 - HillContourGenerate（小山包等高线）

> 权威详情：[../../../../batteries/templates/structures/topographic/HillContourGenerate/README.md](../../../../batteries/templates/structures/topographic/HillContourGenerate/README.md)
> templateId：`HillContourGenerate`（`group_hill_contour_generate`）。
> 端口序号和语义（`label`）以 instantiateTemplate 返回的 exposedInputs/exposedOutputs 为准（勿 templates.get 预读）；本文档在 `label` 缺失或需要接线配方/数值参考时作补充。

## 1. 介绍

在**上游 Rest 剩余区域**内生成圆润小山包同心等高线（`hill_contour_generate`）。与 `MountainContourGenerate`（多峰 FBM 山地）互补 — Hill 适合**局部缓丘**，Mountain 适合**外围高差**。

> ### ⛰️ Rest 单链（禁止 fan-out）
> - **`in_0` ← 上一组 Rest**（如 PathConnectionLink/RW `out_2`、或上一段 Hill/Mountain `out_*` Rest）
> - **禁止**与道路/建筑/另一 Hill/Mountain **并行**接同一 Rest 或 BaseNode
> - 多段不同 Rest 可**多次** instantiate Hill（不同 PeakPosition / 参数），**串链**：`out_2`(Rest) → 下一组 `in_0`

## 2. 输入

| portName | 语义 | 必接 |
|----------|------|------|
| `in_0` | Scene — **上游 Rest** | **是** |
| `in_1` | AssetName tile | 建议 |
| `in_3` | ContourLevels 层数 | 建议 ≤2 |
| `in_4`~`in_8` | HillCount / Roundness / PeakRadius … | 可选 |

## 3. 输出

| portName | 语义 | 典型去向 |
|----------|------|---------|
| `out_1` | Hill 主产物 | 调试 / 领域引用 |
| `out_0` | Scene 整树汇总口 | `appendMergeItem` → `aw_m0_merge`（`{ label:"Scene", portName:"out_0" }`） |
| `out_2` | **Rest** | 下一组 `in_0` / 装饰 `in_1` |

## 4. 时序

**建筑 → 道路（PathConnectionLink/RW）→ Hill 或 Mountain（Rest 链）→ 装饰**

`ContourLevels` / 层数建议 **≤2**（无坡道系统）。
