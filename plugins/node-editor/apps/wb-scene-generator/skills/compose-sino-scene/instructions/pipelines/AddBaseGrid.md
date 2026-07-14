# 地图主体 - AddBaseGrid（基础网格区域）

> 权威详情（含可照抄 applyBatch/CLI、templateId、验证）：  
> `packages/marketplace/plugins/node-editor/apps/wb-scene-generator/batteries/templates/general/grid/AddBaseGrid/README.md`  
> （**不是** repo 根目录 `batteries/templates/...` — 该路径不存在，glob 会 ENOENT）
>
> templateId：`AddBaseGrid`（basename，`instantiateTemplate` 返回全新运行时 groupId）。

## ⚠️ 易错：in_1 与 in_4 千万别对调

| 口 | 是什么 | 不是什么 | 示例 |
|----|--------|----------|------|
| **`in_1` BaseName** | 场景**节点名**（叙事世界名） | ❌ 底图 tile | `"京畿南境驿道"` |
| **`in_4` BaseAsset** | catalog **itemName** 底图 tile | ❌ 场景名 | `"草地"` |

接反 → execute 可能 completed 但 **体素全 0** / 无底图 tile → M1+ 全空。

checklist 写 `assets.baseName` + `assets.baseAsset`，施工时分别 `text_panel` 接到 `in_1` / `in_4`。

## 1. 管线电池的基本介绍

管线所属层级：**地图主体（起点）**

管线效果：场景构图的第一块积木。在空场景（或上游场景）上添加一片带尺寸、可挂底图资产(tile)的**基础网格区域**，作为整张场景的尺寸约束与底图，并把 focus 聚焦到这个基础节点，让后续所有模板组从它出发。取代旧的"手搓网格铺草地"起手式。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 / 建议值 |
|--------|------|------|---------|----------------|
| `in_0` | scene | RootScene 挂接起点 | **必接** | 第一块：`empty_scene.scene`；多区域：上一块 `out_2`(RootScene) |
| `in_1` | string | **BaseName** 基础网格**节点名**（叙事/世界名） | 建议接 | `text_panel`，如 `京畿南境驿道` |
| `in_2` | number | Width 网格宽度 | 建议接 | `number_const`，常用 `50`（大场景 `73`） |
| `in_3` | number | Height 网格高度 | 建议接 | `number_const`，常用 `50` |
| `in_4` | string | **BaseAsset** 底图 **catalog itemName**（tile） | 可选(推荐) | `text_panel`，如 `草地` |

> 隐藏高级端口 `in_5..in_8`（schema/token/zRange/fillValue）默认即可。

## 3. 管线电池的总输出端口

| 端口名 | 类型 | 说明 | 典型去向 |
|--------|------|------|---------|
| `out_1` | scene | **BaseNode**（focus 已聚焦到基础网格节点） | ★ 后续模板组 `in_0` |
| `out_2` | scene | **RootScene**（整棵根透传） | 下一块 `AddBaseGrid.in_0`（多区域）/ `tree_merge` |
| `out_3` | string | BaseNodePath 路径句柄 | 一般不接 |
| `out_0` | scene | 裸 grid scene（未 focus） | ❌ 装饰链不要接 |

## 4. 推荐参数

- **Width/Height**：决定场景物理范围，起手推荐 `50×50`；多区域各块可不同尺寸。
- **BaseName（`in_1`）**：场景树里的**节点名** — 用 contract 世界名 / LOC 顶层名，如 `京畿南境驿道`。**不是** catalog 资产名。
- **BaseAsset（`in_4`）**：prefab catalog 的 **itemName** 底图 tile，如 `草地` / `石质地砖`。**不是**场景叙事名。

## 5. 管线效果描述

- 产出 BaseNode（聚焦基础网格）+ RootScene（整根）。
- 多个 AddBaseGrid（前块 `out_2` → 后块 `in_0`）可拼多区域（村落区/农田区/湖区各一块）。
- 几乎所有场景的第一个实例化模板组（紧接 `empty_scene`）。
