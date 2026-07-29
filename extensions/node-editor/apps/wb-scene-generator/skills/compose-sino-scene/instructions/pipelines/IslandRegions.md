# 地形分区 - IslandRegions（指定锚点岛屿区域）

> 权威详情（含可照抄 applyBatch/CLI + 验证）：[../../../../batteries/templates/scene/IslandRegions/README.md](../../../../batteries/templates/scene/IslandRegions/README.md)
> templateId：`IslandRegions`。端口序号和语义（`label`）以 instantiateTemplate 返回的 exposedInputs/exposedOutputs 为准（勿 templates.get 预读）；本文档在 `label` 缺失或需要接线配方/数值参考时作补充。
> 核心算法电池 `new_island_region_gen` 与 `island_poisson_gen` 同源（子种子散布 + 竞争 BFS 膨胀 + 去碎片 + 平滑），仅把随机锚点换成**指定 Point 锚点**。

## 0. 选型：IslandRegions vs AreaPartition（两者都能"一次传多点生成多个子结构"，但语义完全不同）

| | **IslandRegions**（本文档） | **AreaPartition** |
|---|---|---|
| 多区域关系 | **块状、可分离**——各岛各自膨胀生长，岛与岛之间**可以**留有水域/未占空地间隔，不要求接壤 | **无缝铺满**——配额 Voronoi 保证子区两两不重叠、并集 = 父区域，没有空隙 |
| 有没有 Rest | **有**——`out_2` = 岛外水域/剩余空地 | **没有**（旧版 Rest 口已删除，划分即分完） |
| 多个子结构挂在哪 | 全部合并挂在**同一个** `Island` 父节点下（1 个陆地节点，内部含多块地形） | 每个子区**各自独立**命名挂子节点（`划分子区域1..N`） |
| 典型场景 | 海洋/群岛、"一片区域里散布几个据点小岛" | 城镇/城区按功能纯划分（无水域概念） |

选错的后果：拿 IslandRegions 当纯划分工具用会多出一圈不需要的水域 Rest；反过来拿 AreaPartition 硬凑"岛屿感"会发现所有子区严丝合缝、没有海岸线可言。**只有需要水域/群岛效果时才用 IslandRegions**，默认分区手段仍是 [AreaPartition](AreaPartition.md)。

## 1. 管线电池的基本介绍

管线所属层级：**地形分区 / 区域划分层级**（紧接地图主体，用于把一片基础区域划成「陆地岛屿 + 水域」）

管线效果：在上游一片空地（base 区域）上，按**传入的 Point 列表**作为岛屿中心锚点（**每点一岛**），生成有机形状的岛屿陆地区域，合并为一个 `Island` 陆地节点挂回场景树；没被岛屿占用的区域（水域 / 剩余空地）作 `Rest` 继续往下传。典型位置：**`AddBaseGrid` 之后、建筑层之前**——先用它把地图划成几座岛，再在 `out_1`(Island) 上盖建筑/撒植被。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 / 建议值 |
|--------|------|------|---------|----------------|
| `in_0` | scene | Scene 上游空地（挂接父场景） | **必接** | `AddBaseGrid.out_1`(BaseNode) 或上一组 Rest |
| `in_1` | point2d 列表 | Points 各岛中心锚点（**每点一岛**） | **必接** | 多个 `manual_points` → `tree_merge`(`inferredAccess:"item"`) → `in_1` |
| `in_2` | number 列表 | IslandSizes 各岛膨胀半径（与 Points 对应，不足复用末值） | 建议接 | `number_const` → `tree_merge`(`inferredAccess:"item"`)：⚠️ 下面「小岛 6~9、大岛 12~18」只是**通用套餐参考**，不是取值范围上限——真实值必须用 aw-support 任务书给的该子节点 `radiusMeters`（四舍五入），哪怕这个数字远超过 18 也要照抄，不要因为"看起来比参考值大很多"就自己打折抄一个小数字（真实翻车案例：任务书算出 `radiusMeters=35`，agent 却照抄文档区间填了 `10`，岛屿缩水到设计尺寸的 1/3） |
| `in_3` | string | IslandName 岛屿节点名（**单值，所有岛共用同一个父节点名**，不是逐岛列表） | 建议接 | `text_panel`，如 `岛屿` / `京畿南境驿道` |
| `in_4` | string | IslandAsset 岛屿底图资产名（tile） | 建议接 | `text_panel`，如 `沙地` / `草地` / `island` |
| `in_5` | number | Seed | **必接** | **`aw_m0_seed.seed`（全局固定非 0）**；禁止悬空或 `seed:0`（0=每次 execute 重抽岛形） |

> 隐藏 `in_6..in_11`（RadiusVar / 切片 z / fillValue / schema / token / zRange）默认即可。
> ⚠️ `in_1`(Points) 悬空会**静默空跑**（无岛屿输出、execute 仍 completed）——务必接有效锚点。

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | Island 岛屿陆地（主产物，focus 已聚焦岛屿节点） | 后续建筑/装饰层 `in_0`（在岛上继续布置，用 `{ label:"Island", portName:"out_1" }` 细化） |
| `out_2` | scene | Rest 剩余区域（= 区域 − 岛屿，含水域与未占空地） | 下一组 `in_0`（链式）/ 施工报告 `restAnchor` |
| `out_0` | scene | Scene 整棵合并后场景树 | `{ label:"Scene", portName:"out_0" }` → `appendMergeItem` 汇总根 |
| `out_3` / `out_4` | string | IslandPath / RestPath 路径句柄 | 一般不接 |

### ⚠️ 三类输出严格分工

- `out_0`(Scene) 是**唯一汇总口**：用 `appendMergeItem` 接入 `aw_m0_merge`。
- `out_1`(Island) 是**领域细化口**：用于岛上后续建筑/装饰，并在施工报告中写入对应子节点的 `childAnchors`/`producedAnchors`。
- `out_2`(Rest) 是**剩余空间口**：用于同任务下一模板或后续阶段的 Rest 串链，并写入施工报告 `restAnchor`。

`out_1` 与 `out_2` 都不能接根 merge。即使暂时没有下游，也应通过施工报告保留真实 `{ nodeId, port:"out_2", portLabel:"Rest" }`，而不是为了“保留”把 Rest 汇总。

## 4. 参数范围组合套餐

| 套餐 | Points 数 | IslandSizes | 效果 |
|------|----------|-------------|------|
| 单座主岛 | 1 | `[16~20]` | 一座大岛居中 |
| 中等群岛（推荐） | 3~5 | `[8~14]` 混搭 | 几座大小不一的岛 |
| 密集小岛群 | 6~10 | `[6~9]` | 散布小岛，海岛氛围 |

- **岛屿坐标**按 base 网格坐标系（见 SKILL.md 坐标方位约定，原点左上、右=东、下=南）；落在 base 外的点被忽略。
- IslandSizes 与 Points 数量不一致：短则复用末值、长则截断。

## 5. 已验证 / 真实案例（输入口 · 输出口实际用法）

### 5.1 单岛 —— 真实生产案例（`大昭九州` → `京畿南境驿道`，非模拟）

| 参数 | 真实值 |
|---|---|
| Points（`in_1`） | `(57, 57)` |
| IslandSizes（`in_2`） | `35`（任务书算出的 `radiusMeters` 四舍五入——**不是**照抄上面「小岛6~9/大岛12~18」的示例区间） |
| IslandName（`in_3`） | `京畿南境驿道` |
| 上游 Scene（`in_0`） | `AddBaseGrid.out_1`(BaseNode) |
| Scene 汇总 | `out_0`，用 `{ label:"Scene", portName:"out_0" }` 执行 `appendMergeItem` |
| 子节点锚点 | `out_1`(Island)，写入「京畿南境驿道」的 `childAnchors`/`producedAnchors` |
| 后续阶段锚点 | `out_2`(Rest)，写入 `restAnchor` |

```jsonc
// 先 instantiateTemplate({ templateId:"IslandRegions", groupId:"<G_ISLAND>" })，再一次 applyBatch：
{
  "projectId": "<pid>",
  "opts": { "actor": "ai:sino-constructor", "label": "IslandRegions 单岛落地" },
  "ops": [
    { "type": "createNode", "nodeId": "ir_pt", "opId": "manual_points", "params": { "x": 57, "y": 57 } },
    { "type": "createNode", "nodeId": "ir_pt_merge", "opId": "tree_merge",
      "params": { "inferredAccess": "item", "inferredType": "point2d", "portCount": 1 } },
    { "type": "createNode", "nodeId": "ir_size", "opId": "number_const", "params": { "value": 35 } },
    { "type": "createNode", "nodeId": "ir_name", "opId": "text_panel", "params": { "text": "京畿南境驿道" } },
    { "type": "createNode", "nodeId": "ir_asset", "opId": "text_panel", "params": { "text": "草地" } },
    { "type": "connect", "edgeId": "e_ir_scene", "source": { "nodeId": "<abgGroupId>", "port": "out_1" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_0" } },
    { "type": "connect", "edgeId": "e_ir_pt2merge", "source": { "nodeId": "ir_pt", "port": "point" }, "target": { "nodeId": "ir_pt_merge", "port": "item_0" } },
    { "type": "connect", "edgeId": "e_ir_pts", "source": { "nodeId": "ir_pt_merge", "port": "tree" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_1" } },
    { "type": "connect", "edgeId": "e_ir_size", "source": { "nodeId": "ir_size", "port": "value" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_2" } },
    { "type": "connect", "edgeId": "e_ir_name", "source": { "nodeId": "ir_name", "port": "output" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_3" } },
    { "type": "connect", "edgeId": "e_ir_asset", "source": { "nodeId": "ir_asset", "port": "output" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_4" } },
    { "type": "appendMergeItem", "mergeNodeId": "aw_m0_merge", "source": { "nodeId": "<G_ISLAND>", "port": { "label": "Scene", "portName": "out_0" } } }
  ]
}
```

**验收**：`execute` 后 `<G_ISLAND>.out_1` 子树含以 `京畿南境驿道` 命名、`草地` tile 的陆地节点；`aw_m0_merge` 的新增来源是 `<G_ISLAND>.out_0`(Scene)。

### 5.2 嵌套子岛 —— 真实生产案例（同场景续作，`京畿南境驿道` → `清水镇`，非模拟）

`IslandRegions` 不仅能链 Rest，还能**嵌套**：把上一层 `IslandRegions.out_1`(Island 主产物，**不是 Rest**) 直接接给下一层 `IslandRegions.in_0`，在大岛内部再抠出一座更小的子岛——语义是"大区域套小区域"而非"岛外水域"。同一份真实生产记录（`.forgeax/games/scene-fa20e6d5-qrh7et/pipeline/construction-queue.json`，两步均 `status:"verified"`）里，`大昭九州`(`ir_region`) 产出的 `out_1` 被 `京畿南境驿道` 任务接住继续用作 Scene 输入，随后**在其之上再次实例化 `IslandRegions`**（`ir_sub`）抠出 `清水镇` 子岛：

| 层级 | 任务 | Scene 输入 (`in_0`) | Points (`in_1`) | IslandSizes (`in_2`) | IslandName (`in_3`) | `out_1` 产出 |
|---|---|---|---|---|---|---|
| 第 1 层 | `大昭九州` | `AddBaseGrid.out_1` | `(57,57)` | `35` | `京畿南境驿道` | `ir_region.out_1` |
| 第 2 层（嵌套） | `京畿南境驿道` | **`ir_region.out_1`**（上一层岛主产物，非 Rest） | `(60,67)` | `26` | `清水镇` | `ir_sub.out_1` |

```jsonc
// 第 2 层：在第 1 层的岛（ir_region.out_1）上再挖一个更小的子岛
{
  "ops": [
    { "type": "createNode", "nodeId": "ir_sub_pt", "opId": "manual_points", "params": { "x": 60, "y": 67 } },
    { "type": "createNode", "nodeId": "ir_sub_pt_merge", "opId": "tree_merge",
      "params": { "inferredAccess": "item", "inferredType": "point2d", "portCount": 1 } },
    { "type": "createNode", "nodeId": "ir_sub_size", "opId": "number_const", "params": { "value": 26 } },
    { "type": "createNode", "nodeId": "ir_sub_name", "opId": "text_panel", "params": { "text": "清水镇" } },
    { "type": "connect", "edgeId": "e_irsub_scene", "source": { "nodeId": "ir_region", "port": "out_1" }, "target": { "nodeId": "<G_ISLAND_SUB>", "port": "in_0" } },
    { "type": "connect", "edgeId": "e_irsub_pt2merge", "source": { "nodeId": "ir_sub_pt", "port": "point" }, "target": { "nodeId": "ir_sub_pt_merge", "port": "item_0" } },
    { "type": "connect", "edgeId": "e_irsub_pts", "source": { "nodeId": "ir_sub_pt_merge", "port": "tree" }, "target": { "nodeId": "<G_ISLAND_SUB>", "port": "in_1" } },
    { "type": "connect", "edgeId": "e_irsub_size", "source": { "nodeId": "ir_sub_size", "port": "value" }, "target": { "nodeId": "<G_ISLAND_SUB>", "port": "in_2" } },
    { "type": "connect", "edgeId": "e_irsub_name", "source": { "nodeId": "ir_sub_name", "port": "output" }, "target": { "nodeId": "<G_ISLAND_SUB>", "port": "in_3" } }
  ]
}
```

**用途**：当叙事结构是"大区域（州/郡）里套一个更具体的地点（镇/村）"且都需要独立海岸线/水域感时，逐层嵌套比一次性铺开多点更贴合"由大到小逐层展开"的容器展开范式（见 `connect-node-task/SKILL.md` 起点锚点纪律）；若子结构不需要独立水域，改用同一层的 `AreaPartition`（子区）或直接在 `out_1` 上放建筑即可，不必每层都套 `IslandRegions`。

### 5.3 多岛（群岛，一次实例化生成多个）—— 构造示例，遵循与 5.1 相同的端口契约

Points 3 个、IslandSizes 混搭大小、IslandName 单值（**所有岛共用同一个父节点名**，不是逐岛列表）：

```jsonc
{
  "projectId": "<pid>",
  "opts": { "actor": "ai:sino", "label": "IslandRegions 群岛落地" },
  "ops": [
    { "type": "createNode", "nodeId": "ir_pt_1", "opId": "manual_points", "params": { "x": 20, "y": 20 } },
    { "type": "createNode", "nodeId": "ir_pt_2", "opId": "manual_points", "params": { "x": 50, "y": 20 } },
    { "type": "createNode", "nodeId": "ir_pt_3", "opId": "manual_points", "params": { "x": 35, "y": 50 } },
    { "type": "createNode", "nodeId": "ir_pt_merge", "opId": "tree_merge",
      "params": { "inferredAccess": "item", "inferredType": "point2d", "portCount": 3 } },
    { "type": "createNode", "nodeId": "ir_sz_1", "opId": "number_const", "params": { "value": 10 } },
    { "type": "createNode", "nodeId": "ir_sz_2", "opId": "number_const", "params": { "value": 14 } },
    { "type": "createNode", "nodeId": "ir_sz_3", "opId": "number_const", "params": { "value": 8 } },
    { "type": "createNode", "nodeId": "ir_sz_merge", "opId": "tree_merge",
      "params": { "inferredAccess": "item", "inferredType": "number", "portCount": 3 } },
    { "type": "createNode", "nodeId": "ir_name", "opId": "text_panel", "params": { "text": "群岛" } },
    { "type": "createNode", "nodeId": "ir_asset", "opId": "text_panel", "params": { "text": "沙地" } },
    { "type": "connect", "edgeId": "e_ir_scene", "source": { "nodeId": "<abgGroupId>", "port": "out_1" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_0" } },
    { "type": "connect", "edgeId": "e_ir_pt1", "source": { "nodeId": "ir_pt_1", "port": "point" }, "target": { "nodeId": "ir_pt_merge", "port": "item_0" } },
    { "type": "connect", "edgeId": "e_ir_pt2", "source": { "nodeId": "ir_pt_2", "port": "point" }, "target": { "nodeId": "ir_pt_merge", "port": "item_1" } },
    { "type": "connect", "edgeId": "e_ir_pt3", "source": { "nodeId": "ir_pt_3", "port": "point" }, "target": { "nodeId": "ir_pt_merge", "port": "item_2" } },
    { "type": "connect", "edgeId": "e_ir_pts", "source": { "nodeId": "ir_pt_merge", "port": "tree" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_1" } },
    { "type": "connect", "edgeId": "e_ir_sz1", "source": { "nodeId": "ir_sz_1", "port": "value" }, "target": { "nodeId": "ir_sz_merge", "port": "item_0" } },
    { "type": "connect", "edgeId": "e_ir_sz2", "source": { "nodeId": "ir_sz_2", "port": "value" }, "target": { "nodeId": "ir_sz_merge", "port": "item_1" } },
    { "type": "connect", "edgeId": "e_ir_sz3", "source": { "nodeId": "ir_sz_3", "port": "value" }, "target": { "nodeId": "ir_sz_merge", "port": "item_2" } },
    { "type": "connect", "edgeId": "e_ir_sizes", "source": { "nodeId": "ir_sz_merge", "port": "tree" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_2" } },
    { "type": "connect", "edgeId": "e_ir_name", "source": { "nodeId": "ir_name", "port": "output" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_3" } },
    { "type": "connect", "edgeId": "e_ir_asset", "source": { "nodeId": "ir_asset", "port": "output" }, "target": { "nodeId": "<G_ISLAND>", "port": "in_4" } },
    { "type": "appendMergeItem", "mergeNodeId": "aw_m0_merge", "source": { "nodeId": "<G_ISLAND>", "port": { "label": "Scene", "portName": "out_0" } } }
  ]
}
```

**验收**：`execute` 后 `<G_ISLAND>.out_1` 子树下应出现 3 块地形（同属一个 `群岛` 父节点），彼此之间可以有水域间隔（不要求接壤）；若下游还要继续布置岛外内容，按 §3 将 `out_2`(Rest) 串给下一组并写入 `restAnchor`。

> ⚠️ 本节 5.3 为按端口契约手工构造的示例（尚未留痕在 `aw-support/battery-verify/`），坐标仅为示意；真实任务请用任务书给出的 `gridPosition`/`radiusMeters`。如需补一份机器验证记录，可跑 `node aw-support/scripts/verify-battery-templates.mjs --step=island`（若脚本尚无 island step，需先补一个）。**5.1/5.2 均为真实生产记录，优先参考。**

## 6. 管线效果描述

- 在指定坐标生成几座有机岛屿（陆地图层名 = IslandAsset 文本，如 `沙地`），合并为一个 `Island` 节点。
- `out_1`(Island) 作为后续建筑/植被层的 `in_0`（把场景"局限"在岛屿陆地上继续布置）；`out_2`(Rest) = 水域 / 剩余空地，可继续链式或作整体水面——**接不接看第 3 节判断标准，不要默认丢弃**。
- 与 `LakeRegions` 的区别：LakeRegions 是在空地上**挖水**（产水体主产物 + 陆地 Rest）；IslandRegions 是在区域里**造陆**（产岛屿陆地主产物 + 水域 Rest），并且岛屿出现在**指定 Point 位置**。
