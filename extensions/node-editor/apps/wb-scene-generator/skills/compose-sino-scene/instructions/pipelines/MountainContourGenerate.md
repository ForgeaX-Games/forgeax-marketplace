# 地形等高 - MountainContourGenerate（等高线山头生成）

> 权威详情：[../../../../batteries/templates/structures/topographic/MountainContourGenerate/README.md](../../../../batteries/templates/structures/topographic/MountainContourGenerate/README.md)
> templateId：`MountainContourGenerate`（库 id `group_mountain_contour_generate`）。端口以 instantiateTemplate 返回的 exposedInputs 为准（勿 templates.get 预读）。
> 核心算法为模板组私有实现（顶层看不到、不可摆放）；整组走 `instantiateTemplate` 落地即可。

## 1. 管线电池的基本介绍

管线所属层级：**地形等高 / 结构地形层**（在已有区域 footprint 内生成有机山地高度分层）

管线效果：取上游 Scene 的顶层切片为父区域，用 FBM+高斯峰生成 `[0,1]` 高度场，再按 **`MaxElevationLayers` 整数截断**为互斥高度层 partition，逐层挂为命名 tile 子节点（统一 `AssetName`）。

> ### ⛰️ 使用时机与约束（Agent 必守）
> **当前尚无坡道/台阶系统**，不同高度层之间无法自动衔接。因此：
> 1. **先**完成建筑、结构、**`PathConnectionLink` / `PathConnectionRandomWalk` 道路连通**；
> 2. **再**在关键内容之外的**剩余 Rest** 上串链 **`MountainContourGenerate` / `HillContourGenerate`**（禁止与道路并行 fan-out）；
> 3. **`MaxElevationLayers` 建议不超过 `2`**；
> 4. **地形完成后**再进入装饰播撒链（`PlaceOne` → `LocalPrecise` → `NaturalDecoration` …）。

典型位置：**道路连通之后、任何装饰组之前**（`PathConnectionLink.out_2`(Rest) → `MountainContourGenerate.in_0`，仅作用于外围 Rest；**禁止**与 Hill/装饰并行接同一 Rest）。

与 `HillContourGenerate`（小山包同心圆，`hill_contour_generate` 组件）的区别：本模板用 **scenealg 山地链**，等高线更流动、可多峰，层数由 **`MaxElevationLayers`**（整数抬升单元）控制。

## 2. 管线电池的总输入端口

| portName | customLabelEn | 类型 | 说明 | 是否必接 | 怎么喂 / 建议值 |
|----------|---------------|------|------|---------|----------------|
| `in_0` | Scene | scene | 上游剩余区域（建筑/道路后的 Rest） | **必接** | `PathConnectionLink.out_2`(Rest) 或上一组 Rest — **禁止** BaseNode / 同 Rest fan-out |
| `in_1` | AssetName | string | 各高度层统一 tile 资产名 | 建议接 | `text_panel`，如 `丘陵` / `高地` |
| `in_2` | Seed | number | 随机种子 | 建议接 | `seed_control.seed` |
| `in_3` | MaxElevationLayers | number | **最高抬升层数**（整数） | 建议接 | `number_const`：**建议 `1~2`，不超过 `2`**；`0`=不加高差 |
| `in_4` | PeakCount | number | 山头数量 | 可选 | 默认 3；单峰=`1`，群山=`3~5` |
| `in_5` | PeakRadius | number | 山头影响半径（归一化 0~1） | 可选 | 默认 0.14；宽缓=`0.18~0.22` |
| `in_6` | PeakStrength | number | 山头增益强度 | 可选 | 默认 1.2 |
| `in_7` | NoiseScale | number | 底层噪声频率 | 可选 | 默认 2.5；更碎=`3~4` |
| `in_8` | WarpStrength | number | 域扭曲（有机感） | 可选 | 默认 1.2；`0`=较圆 |
| `in_9` | NamePrefix | string | 各层子节点名前缀 | 可选 | 默认 `Contour` → `Contour1`、`Contour2`…（MultiNames 1 起后缀） |

> ⚠️ **`in_0` 悬空会静默空跑**（execute 仍 `completed`，无子节点产出）。

### MaxElevationLayers 语义（Agent 必懂）

| 值 | 效果 | 高度层数 | 推荐 |
|----|------|----------|------|
| `0` | 不加高差，仅占结构 | 1 层（层 0） | 不需要层次时 |
| `1` | 最多抬高 1 个单元 | 2 层（0、1） | **常用** |
| `2` | 最多抬高 2 个单元 | 3 层（0、1、2） | **上限（无坡道约束）** |
| `>2` | 更高分层 | 更多层 | **默认不建议**（除非用户明确要求） |

## 3. 管线电池的总输出端口

> ⚠️ **连线用 `portName`，不是 customLabelEn。** 本模板与 LakeRegions 等同源五件套，主/Rest 的 portName 与语义标签交叉编号。

| portName | customLabelEn | 类型 | 说明 | 典型去向 |
|----------|---------------|------|------|---------|
| `out_0` | Scene | scene | 完整场景（输入 + 山地形子树） | 调试 / 汇总根 |
| `out_2` | Mountain | scene | **主产物**：各高度层子树（focus 已聚焦） | `tree_merge` 汇总 |
| `out_1` | Rest | scene | 剩余（掩码 − 全部高度层覆盖；全覆盖时可能为空） | 下一组 `in_0` 链式 |
| `out_3` | MountainPath | string | 主产物路径句柄 | 一般不接 |
| `out_4` | RestPath | string | Rest 路径句柄 | 一般不接 |

## 4. 参数范围组合套餐

| 套餐 | MaxElevationLayers | PeakCount | PeakRadius | 效果 |
|------|-------------------|-----------|------------|------|
| 不加高差 | `0` | — | — | 跳过层次，仅占位 |
| 轻度层次 | `1` | `2~3` | `0.16~0.20` | **推荐默认**：缓丘，一层抬升 |
| 双层层次 | `2` | `2~3` | `0.14~0.18` | **推荐上限**：两层抬升，仍可控 |
| 单峰点缀 | `1~2` | `1` | `0.18~0.22` | 剩余区域单一起伏 |

## 5. 管线效果描述

- 在父区域 footprint 内生成**互斥高度层**子节点，每层独立命名（`NamePrefix`+序号），**共用同一 `AssetName` tile**（由 Mira 提供贴图）。
- **无坡道**：高差只应加在已连通的关键内容之外的剩余区域；`MaxElevationLayers` **建议 ≤ 2**。
- 高度场/分层算法均为模板组私有实现，随 `instantiateTemplate` 间接使用——顶层无需也不可摆放。
- 典型串联：建筑 → 道路 → **`PathConnection*.out_2`(Rest) → `MountainContourGenerate.in_0`** → `out_1`(Rest) → Hill 或装饰；`out_2`(Mountain) → `tree_merge`。

## 6. instantiateTemplate 示例

```json
{
  "tool": "scene:pipeline.instantiateTemplate",
  "arguments": {
    "templateId": "MountainContourGenerate",
    "x": 400,
    "y": 200
  }
}
```

返回的 `groupId` 用于后续 `connect`；`exposedInputs` / `exposedOutputs` 的 **`portName`** 即上表。
