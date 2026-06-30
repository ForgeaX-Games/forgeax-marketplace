# RiverbankGreenZone（河岸侵蚀 + 边缘绿簇·叠加为一个节点）

> templateId（传给 `scene:pipeline.instantiateTemplate`）：`group_riverbank_green_zone`，也可用 basename `RiverbankGreenZone`。
> 内部 19 个节点、1 个嵌套子组（TileAssetName，被地块与绿簇两个实例复用）。实例化后返回全新运行时 `groupId`。

## 功能说明

把 `RiverbankZone`（河岸式变深度侵蚀）与 `EdgeGreenClusters`（边缘有机绿簇）合并为一个模板，
**两张网格在 grid 层面完全合并为一张，再生成单个节点**（单个 voxel-mass），而非父子两层。

数据流：`scene → node_explode → rect_grid + voxel_slice`（取占用区掩码 M）。M 同时喂给
`zone_nesting_riverbank`（河岸侵蚀网格 D）与 `edge_green_cluster`（边缘绿簇网格 C），
两者经 `alg_region_union(a=D, b=C)` **逐格求并为一张网格 R**，再 `R → grid2node → add_child`
生成**唯一一个地块节点**。结果场景结构 = 单节点（一个 voxel-mass），两份内容彻底合并。

**典型位置：结构/分区层**。通常接在 `PathConnection.out_1`（Non-Path）或上一个结构组的 Rest 之后。

## 输入端口（IN）

| portName | portType | 语义 | 是否必接 | 怎么喂 |
|---|---|---|---|---|
| `in_0` | scene | 上游场景 / 剩余空地 | **必接** | `PathConnection.out_1` 或上一组 Rest → `in_0` |
| `in_1` | string | DistrictAsset 地块名（=节点名 + 资产名） | 建议接 | `text_panel.output` → `in_1` |
| `in_2` | number | Seed 随机种子（河岸与绿簇共用） | 建议接 | `seed_control.seed` → `in_2` |
| `in_3` | number | ErosionStrength 平均侵蚀强度（默认 **17**） | 建议接 | `number_const.value` → `in_3` |
| `in_4` | number | Waviness 边界波动幅度 | 可选 | `number_const.value` → `in_4` |
| `in_5` | number | MaxDepth 最大侵蚀深度（格数） | 可选 | `number_const.value` → `in_5` |
| `in_6` | number | Count 绿簇数量（默认 **16**） | 建议接 | `number_const.value` → `in_6` |
| `in_7` | number | ClusterSize 单簇平均像素数（默认 **267**） | 建议接 | `number_const.value` → `in_7` |
| `in_8` | number | Irregularity 绿簇破碎度 0~1 | 可选 | `number_const.value` → `in_8` |

> 隐藏高级端口：`in_9`..`in_21`（featureScale / targetValue×2 / spline* / sizeVariance / outputValue / fillValue / z / schema / token / zRange）。**默认即可。**
>
> **数据格式总则**：端口值是 **DataTree** = `[{path,items}]`；`portType` 决定 `items` 形态：`scene`→`{tree:{...}}`、`number`→数值、`string`→字符串、`grid`→二维数组。

## 输出端口（OUT）

| portName | 类型 | 语义 | 典型去向 |
|---|---|---|---|
| `out_0` | scene | 主产物（含合并地块的整棵 scene） | → `tree_merge.item_N` |
| `out_1` | scene | **District** 合并后的单个地块节点（河岸+绿簇并入一张网格） | 一般不接 |
| `out_2` | string | DistrictPath（地块节点路径句柄） | 一般不接 |

> 不产出 Rest，也不做差集：两张网格在 grid 层面**完全合并成一张**，输出单个节点。

## 推荐参数（即当前默认）

- **ErosionStrength（`in_3`）= 17** / **Count（`in_6`）= 16** / **ClusterSize（`in_7`）= 267**。
- **Seed（`in_2`）**：接全局 `seed_control.seed` 保证可复现；改 seed 同时换河岸与绿簇形态。

## 使用场合

- 既要**河岸式不规则地块**、又要**边缘绿簇**，且希望二者作为同一个地块节点（地块 + 绿簇子层）输出时。
- 想要两层完全独立、各成顶层节点时，请改用 `RiverbankZone` + `EdgeGreenClusters` 两个模板。

## 验证要点

`pipeline.execute` 应 `status:completed`。输出场景应只有**一个**地块节点（单个 voxel-mass，Scene Structure
为单节点结构），其网格 = 河岸侵蚀网格与边缘绿簇网格的逐格并集，两份内容彻底合并到同一张 grid 上。
