# 地图主体 - AddBaseGrid（基础网格区域）

> 权威详情（含可照抄 applyBatch/CLI、templateId、验证）：[../../../../batteries/templates/scene/AddBaseGrid/README.md](../../../../batteries/templates/scene/AddBaseGrid/README.md)
> templateId：`AddBaseGrid`（basename，`instantiateTemplate` 返回全新运行时 groupId）。

## 1. 管线电池的基本介绍

管线所属层级：**地图主体（起点）**

管线效果：场景构图的第一块积木。在空场景（或上游场景）上添加一片带尺寸、可挂底图资产(tile)的**基础网格区域**，作为整张场景的尺寸约束与底图，并把 focus 聚焦到这个基础节点，让后续所有模板组从它出发。取代旧的"手搓 rect_grid+grid2node 铺草地"起手式。

## 2. 管线电池的总输入端口

| 端口名 | 类型 | 说明 | 是否必接 | 怎么喂 / 建议值 |
|--------|------|------|---------|----------------|
| `in_0` | scene | RootScene 挂接起点 | **必接** | 第一块：`empty_scene.scene`；多区域：上一块 `out_2`(RootScene) |
| `in_1` | string | BaseName 基础网格节点名 | 建议接 | `text_panel`，如 `ground`/`grassland` |
| `in_2` | number | Width 网格宽度 | 建议接 | `number_const`，常用 `50`（大场景 `73`） |
| `in_3` | number | Height 网格高度 | 建议接 | `number_const`，常用 `50` |
| `in_4` | string | BaseAsset 底图资产名(tile) | 可选(推荐) | `text_panel`，如 `grassland` |

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
- **BaseName**：后续所有组从这个节点出发，起语义名（`ground`/`grassland`/`base`）。
- **BaseAsset**：底图图层名，强烈推荐给一个（`grassland`/`ground`/`dirt`），否则只有空网格无底图。

## 5. 管线效果描述

- 产出 BaseNode（聚焦基础网格）+ RootScene（整根）。
- 多个 AddBaseGrid（前块 `out_2` → 后块 `in_0`）可拼多区域（村落区/农田区/湖区各一块）。
- 几乎所有场景的第一个实例化模板组（紧接 `empty_scene`）。
