# 自然地物 - LakeRegions（湖泊区域）

> 权威详情（含可照抄 applyBatch/CLI + 验证）：[../../../../batteries/groups/scene/LakeRegions/README.md](../../../../batteries/groups/scene/LakeRegions/README.md)（**不是** `batteries/templates/scene/LakeRegions/`——该路径已随资产库改动迁移，旧路径已不存在）
> templateId：`LakeRegions`。端口序号和语义（`label`）以 instantiateTemplate 返回的 exposedInputs/exposedOutputs 为准（勿 templates.get 预读）；本文档在 `label` 缺失或需要接线配方/数值参考时作补充。

> ⚠️ **2026-07 修订**：本文档此前的端口表（`in_0`=Scene / `in_1`=ExpectedLakes / `in_2`=LakeAsset / `in_3`=Seed，`out_0`=主产物 / `out_1`=Rest）已经和当前模板 JSON（`batteries/groups/scene/LakeRegions/LakeRegions.json`）**不一致**——大概率是资产库改动时模板重排过端口但文档没跟上。下表已按当前模板 JSON 的 `exposedInputs`/`exposedOutputs`（含真实 `customLabelEn`）重新核对，**接线前仍以 `instantiateTemplate` 返回值为准**，此表只作参考。

## 1. 管线电池的基本介绍

管线所属层级：**自然地物层级**

管线效果：在**剩余空地上挖出湖泊区域**（水体），消费一块上游空间划出若干湖，没被占用的地作 Rest 继续往下传。典型位置：建筑/道路之后。

## 2. 管线电池的总输入端口（可见口）

| 端口名 | 类型 | label | 说明 | 是否必接 | 怎么喂 / 建议值 |
|--------|------|-------|------|---------|----------------|
| `in_1` | scene | `Scene` | 上游场景 / 剩余空地（**不是 `in_0`**——这是本模板真正的 Scene 输入） | **必接** | 上一组 Rest 或 `AddBaseGrid.out_1` |
| `in_2` | point2d 列表 | `Points` | 湖泊锚点列表（推断**每点对应一片湖区**，与 `IslandRegions.in_1` 用法一致，内部按点位建 rect 区域再散点填湖；**未在真实案例中验证**，落地前建议先小范围试一次核对面积/数量再放量） | 建议接 | 多个 `manual_points` → `tree_merge`(`inferredAccess:"item"`) → `in_2` |
| `in_0` | string | `NamePrefix` | 湖泊命名前缀（**不是** `in_1`——旧文档写错过端口号） | 建议接 | `text_panel`，如 `湖` |
| `in_14` | string | `AssetName` | 湖泊水面资产名（tile，**不是** `LakeAsset`+`in_2` 这个旧组合） | 建议接 | `text_panel`，如 `水面` / `湖` |
| `in_17` | number | （无 `customLabelEn`，`sourcePortName` 是 `seed`） | 随机种子 | 建议接 | `seed_control.seed` |

> 隐藏 `in_3/in_4`（fillValue/切片 z）、`in_5..in_9`（`alg_points_scatter` 的 mode/countMode/density/count/targetValue——**没有独立可见的"期望湖泊数"输入**，数量由这组内部散点算法参数决定，旧文档的 `ExpectedLakes` 概念在当前版本模板里已经不存在）、`in_10/in_11`（sizeVariance/spacingDilate）、`in_12/in_13`、`in_15/in_16`（两组 schema/token）默认即可，**不要**凭旧文档去接一个不存在的 `ExpectedLakes` 口。

## 3. 管线电池的总输出端口

| 端口名 | 类型 | label | 说明 | 典型去向 |
|--------|------|-------|------|---------|
| `out_4` | scene | `Lake` | 湖泊产物（**主产物，不是 `out_0`**） | 用 `appendMergeItem`（或 `{"label":"Lake"}`）接入 `aw_m0_merge`，不要手动算 `item_N`/`portCount` |
| `out_0` | scene | `Rest` | 剩余区域（**不是 `out_1`**——旧文档端口号错位） | 下一组 `in_1`(Scene)（链式） |
| `out_3` | scene | `Scene` | 整棵合并后场景树 | 调试 / 汇总根 |
| `out_5` | string | `LakePath` | 湖泊路径句柄 | 一般不接 |
| `out_6` | string | `RestPath` | Rest 路径句柄 | 一般不接 |
| `out_1`/`out_2` | grid/number | 无 label（`hidden: true`） | 内部散点/计数中间值 | 不接 |

## 4. 参数范围组合套餐

> 旧版「ExpectedLakes 1~2 点缀 / 3~5 水乡」套餐已随 `ExpectedLakes` 口一起失效（该口在当前模板里不存在，见上面隐藏口说明）。当前版本用 `in_2`(Points) 的锚点数量控制湖泊数量（**推断，未在真实案例中验证**）——需要几片湖就喂几个点，落地前先用少量点跑一次 `execute` 核对面积与数量再决定要不要加点。

## 5. 管线效果描述

- 在剩余空地挖湖，产水体图层（名 = `AssetName`(`in_14`) 文本，如 `水面`），数量随 `Points`(`in_2`) 锚点数（推断）。
- `out_0`(Rest) 继续给后续农田/植被链式使用；`out_4`(Lake) 才是主产物，用 `appendMergeItem` 接入 `aw_m0_merge`。
- 与 `IslandRegions` 的区别：LakeRegions 是在空地上**挖水**（产水体主产物 + 陆地 Rest）；IslandRegions 是在区域里**造陆**（产岛屿陆地主产物 + 水域 Rest）。
