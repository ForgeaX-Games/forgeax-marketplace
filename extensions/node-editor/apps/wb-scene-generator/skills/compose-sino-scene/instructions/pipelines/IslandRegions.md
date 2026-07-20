# 地形分区 - IslandRegions（指定锚点岛屿区域）

> 权威详情（含可照抄 applyBatch/CLI + 验证）：[../../../../batteries/templates/scene/IslandRegions/README.md](../../../../batteries/templates/scene/IslandRegions/README.md)
> templateId：`IslandRegions`。端口以 instantiateTemplate 返回的 exposedInputs 为准（勿 templates.get 预读）。
> 核心算法电池 `new_island_region_gen` 与 `island_poisson_gen` 同源（子种子散布 + 竞争 BFS 膨胀 + 去碎片 + 平滑），仅把随机锚点换成**指定 Point 锚点**。

## 1. 管线电池的基本介绍

管线所属层级：**地形分区 / 区域划分层级**（紧接地图主体，用于把一片基础区域划成「陆地岛屿 + 水域」）

管线效果：在上游一片空地（base 区域）上，按**传入的 Point 列表**作为岛屿中心锚点（**每点一岛**），生成有机形状的岛屿陆地区域，合并为一个 `Island` 陆地节点挂回场景树；没被岛屿占用的区域（水域 / 剩余空地）作 `Rest` 继续往下传。典型位置：**`AddBaseGrid` 之后、建筑层之前**——先用它把地图划成几座岛，再在 `out_1`(Island) 上盖建筑/撒植被。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 / 建议值 |
|--------|------|------|---------|----------------|
| `in_0` | scene | Scene 上游空地（挂接父场景） | **必接** | `AddBaseGrid.out_1`(BaseNode) 或上一组 Rest |
| `in_1` | point2d 列表 | Points 各岛中心锚点（**每点一岛**） | **必接** | 多个 `manual_points` → `tree_merge`(`inferredAccess:"item"`) → `in_1` |
| `in_2` | number 列表 | IslandSizes 各岛膨胀半径（与 Points 对应，不足复用末值） | 建议接 | `number_const`：⚠️ 下面「小岛 6~9、大岛 12~18」只是**通用套餐参考**，不是取值范围上限——真实值必须用 aw-support 任务书给的该子节点 `radiusMeters`（四舍五入），哪怕这个数字远超过 18 也要照抄，不要因为"看起来比参考值大很多"就自己打折抄一个小数字（真实翻车案例：任务书算出 `radiusMeters=35`，agent 却照抄文档区间填了 `10`，岛屿缩水到设计尺寸的 1/3） |
| `in_3` | string | IslandName 岛屿节点名 | 建议接 | `text_panel`，如 `岛屿` / `island` |
| `in_4` | string | IslandAsset 岛屿底图资产名（tile） | 建议接 | `text_panel`，如 `沙地` / `草地` / `island` |
| `in_5` | number | Seed | 建议接 | `seed_control.seed` |

> 隐藏 `in_6..in_11`（RadiusVar / 切片 z / fillValue / schema / token / zRange）默认即可。
> ⚠️ `in_1`(Points) 悬空会**静默空跑**（无岛屿输出、execute 仍 completed）——务必接有效锚点。

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Island 岛屿陆地（主产物，focus 已聚焦岛屿节点） | 后续建筑/装饰层 `in_0`（在岛上继续布置）/ `tree_merge` 汇总 |
| `out_2` | scene | Rest 剩余区域（= 区域 − 岛屿，含水域与未占空地） | 下一组 `in_0`（链式）/ 作水域汇总 |
| `out_0` | scene | Scene 整棵合并后场景树 | 调试 / 汇总根 |
| `out_3` / `out_4` | string | IslandPath / RestPath 路径句柄 | 一般不接 |

## 4. 参数范围组合套餐

| 套餐 | Points 数 | IslandSizes | 效果 |
|------|----------|-------------|------|
| 单座主岛 | 1 | `[16~20]` | 一座大岛居中 |
| 中等群岛（推荐） | 3~5 | `[8~14]` 混搭 | 几座大小不一的岛 |
| 密集小岛群 | 6~10 | `[6~9]` | 散布小岛，海岛氛围 |

- **岛屿坐标**按 base 网格坐标系（见 SKILL.md 坐标方位约定，原点左上、右=东、下=南）；落在 base 外的点被忽略。
- IslandSizes 与 Points 数量不一致：短则复用末值、长则截断。

## 5. 管线效果描述

- 在指定坐标生成几座有机岛屿（陆地图层名 = IslandAsset 文本，如 `沙地`），合并为一个 `Island` 节点。
- `out_1`(Island) 作为后续建筑/植被层的 `in_0`（把场景"局限"在岛屿陆地上继续布置）；`out_2`(Rest) = 水域 / 剩余空地，可继续链式或作整体水面。
- 与 `LakeRegions` 的区别：LakeRegions 是在空地上**挖水**（产水体主产物 + 陆地 Rest）；IslandRegions 是在区域里**造陆**（产岛屿陆地主产物 + 水域 Rest），并且岛屿出现在**指定 Point 位置**。
