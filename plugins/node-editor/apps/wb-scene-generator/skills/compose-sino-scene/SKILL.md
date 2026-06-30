---
name: compose-sino-scene
description: >-
  Sino 用既有「场景模板组」(管线电池) 与白名单工具电池，在 wb-scene-generator 工作台里连线拼出整张大场景的操作手册。
  当 Sino 被要求布局 / 搭建 / 迭代一张场景（地图主体、建筑、道路、湖泊、自然装饰）时使用。
  Sino 只做场景布局构图，不生成图片/资产——贴图/物件由 Mira 生成，Sino 只负责把 Mira 的产物正确导入并验收。
---

# 管线操作手册（Sino · 场景构图）

> 本手册沿用 `scene_creator` 的章节结构（场景设计 → 选电池 → 连线 → 协作 → 归档），
> 但**管线电池与工具电池一律使用 wb-scene-generator 的白名单电池**（见第二步目录），
> 连线细节见 [instructions/session_operation.md](instructions/session_operation.md)，
> 资产协作见 [instructions/asset-collaboration.md](instructions/asset-collaboration.md)。

---

## 第一步：场景设计

根据用户输入，先确定目标场景是什么、想要什么效果，再决定**地图主体、建筑、道路、自然装饰**分别如何规划和摆放。

地图层级体系（从大到小，分层推进）：

| 层级 | 说明 | 本套白名单对应管线电池 | 典型输出 |
|------|------|----------------------|----------|
| **地图主体（起点）** | 确立场景尺寸与底图，聚焦基础网格节点 | `AddBaseGrid` | BaseNode + RootScene |
| **建筑层级** | 在基础网格上放置建筑（单栋 / 多栋 / 村庄） | `PickOneBuilding`、`PickMultiBuildings` | Building(s) + Rest |
| **建筑结构（可选）** | 在建筑区域上盖墙/房间，生成 `outer_door` 门 | `BuildingStructures` | 含结构与门的建筑场景 |
| **道路层级** | 在建筑（门）之间连通道路 | `PathConnection` | Path + Non-Path(剩余) |
| **自然地物 / 装饰层级** | 在剩余空地撒植被、挖湖 | `NaturalDecorationDistribution`、`LakeRegions` | 装饰 / 湖 + Rest |

**设计原则：** 必须从大到小、分层级推进。先确定地图主体（`AddBaseGrid`），再放建筑，再连道路，最后做自然装饰。每一层只在上一层留下的 **Rest / 剩余空地** 上继续布置，互不覆盖。

**优秀场景的标准：**
1. 层级从大到小条理清晰，不存在反复横跳的工具调用；
2. 每一层的电池调用数量逐层递增（装饰层最密）；
3. 对合理目标区域大面积、多层次地使用装饰；
4. 结构丰富，最终 `scene_output` 产出一张完整可用的场景。

> **特别注意：禁止大面积无装饰的空白区域。**

---

## 第二步：选择管线电池与工具电池

电池分两类：**管线电池**（成组的场景模板组，封装某一层级的完整制作方法）与**工具电池**（顶层编排/数据转换/桥接）。

> ⚠️ **硬边界**：Sino 只能用下表两类白名单电池。后端对 `actor=ai:sino` 的 `/api/v1/batch` 开了 **opId 白名单硬门**，清单外的顶层 `createNode.opId` 会被直接拒绝。模板组内部的 `alg_*` 算法电池是私有实现，**禁止在顶层直接摆放**——它们只随模板组实例化一并出现。

### 管线电池目录（场景模板组，共 7 个）

> 实例化一律用 `scene:pipeline.instantiateTemplate`（返回全新运行时 `groupId`，连线用返回值，不要硬编下表的库 id）。总览索引以 [batteries/templates/scene/TEMPLATES_INDEX.md](../../batteries/templates/scene/TEMPLATES_INDEX.md) + `scene:templates.get` 为准。

| 层级 | 管线电池 | 详细文档（本 skill） | 权威 README | 管线效果 | 必需输入 | 主要输出 |
|------|---------|--------------------|------------|---------|---------|---------|
| 地图主体 | **AddBaseGrid** | [pipelines/AddBaseGrid.md](instructions/pipelines/AddBaseGrid.md) | [README](../../batteries/templates/scene/AddBaseGrid/README.md) | 基础网格区域 + 底图 | `in_0`RootScene | `out_1`BaseNode / `out_2`RootScene |
| 建筑 | **PickOneBuilding** | [pipelines/PickOneBuilding.md](instructions/pipelines/PickOneBuilding.md) | [README](../../batteries/templates/scene/PickOneBuilding/README.md) | 指定坐标放一栋建筑 | `in_3`Point / `in_1`Scene | `out_1`Building / `out_2`Rest |
| 建筑 | **PickMultiBuildings** | [pipelines/PickMultiBuildings.md](instructions/pipelines/PickMultiBuildings.md) | [README](../../batteries/templates/scene/PickMultiBuildings/README.md) | 一次放多栋建筑 | `in_6`Scene / `in_5`points | `out_2`Buildings / `out_1`Rest |
| 建筑结构 | **BuildingStructures** | [pipelines/BuildingStructures.md](instructions/pipelines/BuildingStructures.md) | [README](../../batteries/templates/scene/BuildingStructures/README.md) | 盖墙/房间（含门） | `in_0`Scene(建筑区域) | `out_0`Scene / `out_1`Rooms |
| 道路 | **PathConnection** | [pipelines/PathConnection.md](instructions/pipelines/PathConnection.md) | [README](../../batteries/templates/scene/PathConnection/README.md) | POI 点集连通道路（**单实例**） | `in_2`Scene / `in_3`POI列表 | `out_1`Path / `out_2`Rest |
| 自然装饰 | **NaturalDecorationDistribution** | [pipelines/NaturalDecorationDistribution.md](instructions/pipelines/NaturalDecorationDistribution.md) | [README](../../batteries/templates/scene/NaturalDecorationDistribution/README.md) | 空地撒植被/装饰 | `in_1`Scene | `out_1`Decoration / `out_2`Rest |
| 自然地物 | **LakeRegions** | [pipelines/LakeRegions.md](instructions/pipelines/LakeRegions.md) | [README](../../batteries/templates/scene/LakeRegions/README.md) | 剩余空地挖湖 | `in_0`Scene | `out_0`Lake / `out_1`Rest |

> 各模板组其余 `in_*` 多为 `[hidden]` 高级调参，默认即可。**端口名以 `scene:templates.get` / `instantiateTemplate` 返回为准，不要猜。**

### 工具电池目录（白名单，顶层可直接 `createNode`）

| 工具电池（opId） | 功能 | 主要输入 | 主要输出 |
|----------------|------|---------|---------|
| `empty_scene` | 空场景起点（管线最起点） | 无 | `scene` |
| `text_panel` | 文本面板：输出资产名/语义名/路径段 | `params.text` | `output`(string) |
| `number_const` | 数值常量：尺寸/数量/密度 | `params.value` | `value`(number) |
| `seed_control` | 统一随机种子（扇出到各组 Seed） | — | `seed`(number) |
| `string_concat` | 拼路径（如 BuildingPath + `/outer_door`） | `a`、`b` | `result`(string) |
| `manual_points` | 手动点位（x,y → 单个 point2d） | `params.x/y` 或接 `number_const` | `point` |
| `tree_merge` | 合并 DataTree：**scene 汇总**用 `inferredAccess:"tree"`；**POI 点列表**用 `inferredAccess:"item"` | `item_0..item_N` | `tree` |
| `scene_focus_children` | 展开焦点节点的直接子节点列表 | `scene` | `scenes`、`childCount` |
| `scene_get_attribute` | 读焦点节点属性 | `scene`、`key` | `value`、`exists` |
| `node_explode` | 检视节点内部（子路径/体素数） | `scene` | `childPaths`、`voxelCount`… |
| `scene_focus_path` | 按路径聚焦到子节点（提门作 POI） | `scene`、`path` | `scene` |
| `tree_flatten` | 树拍平 | `tree` | `tree` |
| `scene_merge_subtrees` | 合并子树 | `scenes` | `scene` |
| `scene_output` | 场景终端输出 | `scene` | — |
| `add_child` | 给场景节点挂子节点 | `scene`、`child` | `scene` |
| `rect_grid` / `grid2node` / `voxel_slice` / `scene_passthrough` | 网格/桥接件（一般随模板组用，少在顶层手摆） | 见 `batteries.get` | — |
| `__group__` | 成组哨兵（模板组实例化落地） | — | — |

> 工具电池的精确端口名查 `scene:batteries.get`（模板组查 `scene:templates.*`，不在 `batteries` 里）。

---

## 第三步：操作管线连线

详细操作手册见 [instructions/session_operation.md](instructions/session_operation.md)（op schema、`instantiateTemplate`、`applyBatch`、连线规则、验证）。

**连线铁律（动手前必读，文档已替你验证过，禁止现场试错重新发现）：**
1. **`connect` 必带全图唯一 `edgeId`**（字段名是 `edgeId`，不是 `id`；漏了报 `edge undefined already exists`）。
2. **`applyBatch` 后必 `scene:pipeline.get` 核对** nodes/edges 真进图（防"ok 却空"）。
3. **`scene:pipeline.execute` 返回 `completed` ≠ 每组都成功**——必接 scene 端口悬空会静默空跑；每加一组逐组验证。
4. **`PathConnection` 的 `in_2`(Scene) 与 `in_3`(POI 点列表) 必接**；多点 POI 用 `tree_merge`（`inferredAccess:"item"`）合并后接 `in_3`，**禁止**每个方向各实例化一个 PathConnection（见 PathConnection 文档）。
5. **`tree_merge` 必带 params**：scene 汇总 `{"inferredAccess":"tree","inferredType":"scene","portCount":N}`；POI 列表 `{"inferredAccess":"item","inferredType":"point2d","portCount":N}`。
6. **`applyBatch` 必带 `opts.actor:"ai:sino"`**——这是白名单硬门的身份标记。
7. **强制顺序**：`empty_scene → AddBaseGrid`（拿 BaseNode）+ seed + 汇总骨架先跑通 → 再逐组实例化 → 后续组 `in_0` 接 BaseNode/上一组 Rest。

**链式串联范式（速记）：**
- 起手：`empty_scene` → `AddBaseGrid` → `out_1`(BaseNode) 作后续 `in_0` 起点。
- 建筑：`PickOneBuilding`(单栋) / `PickMultiBuildings`(多栋，`out_1`Rest 串联)。
- 结构(可选)：`Building.out_*` → `BuildingStructures.in_0` → `out_0` 供道路 POI 提门。
- 道路：**单个** `PathConnection` — 上一组 **Rest** → `in_2`；多个 `manual_points` → `tree_merge`(item) → `in_3`(POI 列表)；`in_1` 接道路资产名。
- 装饰/湖：上一组 **Rest** → `NaturalDecorationDistribution.in_1` → `LakeRegions.in_1`。
- 汇总：各组主产物 → `tree_merge` → `tree_flatten` → `scene_merge_subtrees` → `scene_output`。
- 统一种子：`seed_control.seed` 扇出到各组 Seed。

---

## 第四步：资产需求收集与 Mira 协作

**Sino 不生成任何图片/贴图/物件。** 构图时一律用**语义资产名**（写进 `text_panel`，如 `草地` / `石路` / `橡木屋` / `行道树`）。完整协作协议（含 `asset-requirements.json` 契约格式与导入验收）见 [instructions/asset-collaboration.md](instructions/asset-collaboration.md)。四阶段速记：

1. **布局**：用语义名拼完整张场景布局，跑通 `execute`（此时用内置素材占位即可）。
2. **收集需求**：把场景里引用到的每个资产汇总成 `asset-requirements.json`（`name` / `description` / `type`=`tile|object` / `footprint`{w,d 格} / `heightRatio`），交给调度 agent → Mira。
3. **等待生成**：Mira 出图并发布到共享游戏沙箱，回传 `gameSlug` / 结果路径。
4. **导入验收**：Sino 用 `scene:library.useGameTextures({gameSlug})` 绑定沙箱 → `scene:library.list` 核对资产名 → `execute` + `screenshot.capture` **真的看图**验收；不符则回退第 1/2 步调整或回提需求。

---

## 第五步：总结归档

完成场景制作后，将本次执行总结写入工作区 `executions/` 目录，文件以场景名命名，含：
1. **电池清单**：用到的每个管线/工具电池及其层级；
2. **参数记录**：关键参数选择（网格尺寸、建筑数、密度、seed 等）；
3. **资产清单**：本次 `asset-requirements.json` 里的资产及 Mira 产出/导入结果；
4. **场景效果 + 优化建议**：最终效果描述与至少一条改进建议。

---

## 收尾检查清单

- [ ] 场景设计完成，层级从大到小清晰
- [ ] 仅使用第二步目录里的白名单管线/工具电池（`opts.actor:"ai:sino"`）
- [ ] 每加一组都 `pipeline.get` + `execute` + 截图逐组验证过
- [ ] 资产需求已汇总成 `asset-requirements.json` 交付，Mira 产物已 `useGameTextures` 导入并截图验收
- [ ] 已将执行总结写入 `executions/`
