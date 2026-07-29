---
name: compose-sino-scene
description: >-
  Sino 用既有「场景模板组」(管线电池) 与白名单工具电池，在 wb-scene-generator 工作台里连线拼出整张大场景的操作手册。
  当 Sino 被要求布局 / 搭建 / 迭代一张场景（地图主体、地形分区/岛屿、山地等高线、建筑、道路、湖泊、自然装饰）时使用。
  Sino 只做场景布局构图，不生成图片/资产——贴图/物件由 Mira 生成，Sino 只负责把 Mira 的产物正确导入并验收。
---

# 管线操作手册（Sino · 场景构图）

> ### ⬛ 模板组 = 黑盒（比双通道更优先）
> **`instantiateTemplate` 整组落地** — 组内有 `scene_set_attribute` / `rect_grid` / 任意 op **都正常**，**禁止** `templates.get` 打开组内 JSON 研究实现。
> **你唯一需要知道的**：返回的 **`exposedInputs` / `exposedOutputs`**（每项 `{ portName, portType, label? }`，`label` 是模板作者标注的语义名，如 `IslandName`/`Rest`——先看它，不要死记 `in_N` 编号） → `text_panel` / `manual_points` 接到 exposed 口 → connect → execute。**会用、能用、快用。**

> ### 🚦 构图双通道（搞混 applyBatch 顶层 = 422，与组内无关）
> **通道 A** `instantiateTemplate` → 一次落地整组场景模板组（AreaPartition/IslandRegions/建筑/道路/装饰…；**整组落地，组内部实现无需你关心**）  
> **通道 B** `applyBatch` → **仅** connect + 工具电池（empty_scene、panels、tree_merge…）  
> 完整 SSOT：[instructions/mutation-lanes.md](instructions/mutation-lanes.md)

> 连线细节见 [instructions/session_operation.md](instructions/session_operation.md)。  
> **Phase 0 自规划** → [design-and-checklist.md](instructions/design-and-checklist.md)（Sino **一次性**写 `{runDir}/scene-composition-checklist.json`）  
> **Rest 填充与面积**：[instructions/spatial-fill-and-rest.md](instructions/spatial-fill-and-rest.md)  
> **快循环**：[instructions/fast-loop.md](instructions/fast-loop.md)  
> 纯资产模式跳过 [asset-collaboration.md](instructions/asset-collaboration.md)。

> ### 📋 Keypoint → 估算 → Phase 0（必须先读再规划）
> 编排层已跑 keypoint_layout 求解并落盘 **`keypoint-layout-estimate.json`**（gridPosition、画布尺度、suggestedBBox）。  
> Phase 0：**先读 estimate + scatter + contract**，再写 checklist — 禁止跳过估算直接 instantiate。

> ### 📋 aw-support 纯资产（一次写 checklist → 按 batch 施工）
> 编排层只落盘输入；Sino Phase 0 **写一次** checklist（含 `batchId`）。  
> Phase 1+：**读 SSOT、从 next batch 接着做** — 只选电池/设参/连线，**禁止重写 checklist**。

> ### 🚦 构图双通道
> **四拍**：`instantiateTemplate`(A) → applyBatch 连线(B) → get → execute → 读摘要（含 `verification.hints`）。
> **M0**：empty_scene → AddBaseGrid → merge 链 → execute — **完成后立刻 M1+，不要停**。
> **aw-support**：**一次派工跑完阶段 3**（全部 LOC/路/装饰）；M0 **不是**交卷点。
> **M1+（可分步批量）**：允许一次连多组，但依赖上游 execute 真值的须分步 — **PathConnectionLink/RW** POI 须提门、**Hill/Mountain 须 Rest 串链**、装饰围绕已生成建筑。下一组接上一组 **Rest**，禁止 BaseNode / 同 Rest fan-out。详见 [fast-loop.md](instructions/fast-loop.md)。

> ### 🚫 零起点纪律（aw-support / 新场景任务）
> - **禁止**读 `executions/` 历史归档、open 非本次 projectId
> - **禁止**批量 read pipeline.md 再动手；422 时才读 **一个** md
> - **禁止** shell/python 直改 `state/graph.json`（hash 失步 → open 500；删边用 applyBatch `deleteEdge`）
> - 坐标真值：runDir `keypoint-layout-solved.json`

> ### 🏷️ 命名对齐 + 结构展开（硬门控 `stage3.location_names`，2026-07-01：命名对齐现有真正的服务端校验，不再只是口头要求）
> - 上游每个地点 `name` 必须原样出现在场景节点名 — 通过 **exposed Name 端口**（`text_panel` 喂 BuildingName/ZoneNames 等）。
> - **禁止在 applyBatch 顶层 createNode `scene_set_attribute` 来命名** — 那是通道 B 误用。
> - **模板组内部的 `scene_set_attribute` 是正常实现** — `instantiateTemplate` 后你**不要**打开组内审计；与你无关。
> - **自检方式（收尾前必做）**：`scene:pipeline.execute` 传 `narrativeLocationNames:[...]`（aw-support 派单给你的上游地点 name 原样清单），摘要会多出 `verification.locationNameAlignment: {ok, missing:[{name,reason}]}`——**收尾前必须自己跑一次，确认 `ok:true`**；`ok:false` 就照着 `missing` 里的 `reason` 把缺的 name 补成场景节点（可加前后缀/作子节点名，如 `望江客栈_主楼` 仍算命中 `望江客栈`，但不能整体换成泛化名或漏项），再重新 `execute` 复核，不要带着 `ok:false` idle。
> - 缺任一上游 name → 门控不过、任务不算完。上游名是**下限**：在保留原名节点前提下**必须**展开丰富子结构（市集/城镇补足够建筑物、神社补主殿+参道+石柱+彼岸花丛…）——这是要求，不是可选加分项。**反过来，多出的补充/装饰节点从不会导致门控失败**，只有核心命名缺失才算。

---

## 第一步：Phase 0 一次性自规划

**aw-support 不替你写施工顺序。** 见 [design-and-checklist.md](instructions/design-and-checklist.md)。

1. **Tier 1** 读 runDir：`keypoint-layout-estimate.json` → `location-layout-contract.json` → `town-building-scatter.json`
2. **Tier 2（按需）**：`prefab-scene-picks.json` · `prefab-footprint-summary.json` — **禁止** Phase 0 read `prefab-catalog.json` / `preprocessed.json`
3. 按 **规划要点** 写出完整 `scene-composition-checklist.json`（含 `keypointEstimateRef`、`townBuildingPlan`、`restFrom`、`structureParams`）
3. **此后禁止重写 checklist** — 续跑读 SSOT、从 next batch 接着做

## 第二步：按 checklist batch 施工（快循环）

**每 turn 只想：选电池 · 设 params · 连线。** 同 `batchId` 可一批 instantiate+execute。详见 [fast-loop.md](instructions/fast-loop.md)。

> ### 📐 坐标方位约定（把"东北角""靠南"等意图换算成 Point 坐标时，逐字按此，别凭直觉）
> **原点 `(0,0)` 在左上角**；**右 = 东 = `+x`，下 = 南 = `+y`**（即 西 = `-x`、北 = `-y`，x 横 y 纵）。
>
> | 方位 | 方向 | 坐标偏移 | | 方位 | 方向 | 坐标偏移 |
> |---|---|---|---|---|---|---|
> | 东 | 右 | `+x` | | 东北 | 右上 | `+x, -y` |
> | 西 | 左 | `-x` | | 东南 | 右下 | `+x, +y` |
> | 南 | 下 | `+y` | | 西北 | 左上 | `-x, -y` |
> | 北 | 上 | `-y` | | 西南 | 左下 | `-x, +y` |
>
> 例：W×H 网格里"东北角" ≈ `(x≈W-1, y≈0)`、"中心偏南" ≈ `(x≈W/2, y>H/2)`。所有 `manual_points` / Point（`PickOneBuilding`/`PlaceOneDecoration`/`PathConnection` POI）一律按此约定。

地图层级体系（从大到小，分层推进）：

| 层级 | 说明 | 本套白名单对应管线电池 | 典型输出 |
|------|------|----------------------|----------|
| **地图主体（起点）** | 确立场景尺寸与底图，聚焦基础网格节点 | `AddBaseGrid` | BaseNode + RootScene |
| **功能分区（可选，默认分区手段）** | 把父区域按中心点 + 面积**纯划分**成若干命名子区（铺满、无剩余） | `AreaPartition` | 仅 Zones（无 Rest） |
| **海岛分区（可选，仅海洋/群岛场景）** | 按指定锚点在区域里**造岛**，分出陆地 / 水域 —— **只在需要水域时用** | `IslandRegions` | Island(陆地) + Rest(水域) |
| **地形分带（可选）** | 在已有区域内部按到边界的距离再分近/远两带（深海/浅海、海岸/内陆） | `DistanceZones` | Near(近) + Far(远) |
| **建筑层级** | 在基础网格上放置建筑（单栋；多栋/村庄用多次 `PickOneBuilding` 串联，`out_2`Rest→下一栋） | `PickOneBuilding` | Building + Rest |
| **建筑结构（可选）** | 在建筑区域上盖墙/房间，生成 `outer_door` 门；**narrative_interior 默认 bottomDoor=true** | `BuildingStructures` | 含结构与门的建筑场景 |

> **建筑占地铁律**：**叙事内构**（需 BuildingStructures 的可进入建筑）**≥15×15 格**（与 catalog footprint 取较大值）；**装饰外观**小建筑可 ≥10×10。城镇须读 `town-building-scatter.json` 规划补充散布建筑。
| **道路层级** | 在建筑（门）之间连通道路 | `PathConnectionLink` / `PathConnectionRandomWalk` | Path + Rest |
| **地形层级** | Rest 上叠加高差/缓丘 | `MountainContourGenerate` / `HillContourGenerate` | 主产物 + Rest（**须 Rest 串链**） |
| **地形等高（可选）** | 在**剩余区域**上添加整数高度分层以体现层次感（见下方高差约束） | `MountainContourGenerate` | Mountain(多层) + Rest |
| **自然地物 / 装饰层级** | 按需求选型放置装饰（有尺寸/落点优先 PlaceOne；批量模板只挂简单物件） | `PlaceOneDecoration` + `LocalPreciseDecoration` + `NaturalDecorationDistribution` + `LakeRegions` | 装饰 / 湖 + Rest |

**设计原则：** 必须从大到小、分层级推进。先确定地图主体（`AddBaseGrid`），需要把地图切成**功能区**（城镇/森林/湖区…）用 `AreaPartition`（默认分区手段，无水域）、**只有需要海岛/水域**场景才用 `IslandRegions` 划出陆地与水域、需要把某片区域按到边界距离再分深浅/海岸则用 `DistanceZones`，**先放建筑并连好道路**（见第二步「高差与连通」），再在**不影响叙事区域**的剩余范围用 **`MountainContourGenerate`** 做适度高差（`MaxElevationLayers` **建议 ≤ 2**），**最后**按选型放置装饰（见第二步「装饰选型」）。每一层只在上一层留下的 **Rest / 剩余空地**（或上一层的陆地主产物）上继续布置，互不覆盖。

**优秀场景的标准：**
1. 层级从大到小条理清晰，不存在反复横跳的工具调用；
2. 每一层的电池调用数量逐层递增（装饰层最密）；
3. **装饰按能力选型**：有明确尺寸/落点的用 PlaceOne；Local/Natural 只播简单小物件；大片 Rest 用 Natural 防空白——按需求选用，不必硬凑三种；
4. **地形高差优先于装饰播撒**，且避开建筑/道路/地标等叙事核心区；
5. 结构丰富，最终 `scene_output` 产出一张完整可用的场景。

> **特别注意：禁止大面积无装饰的空白 Rest；禁止把复杂体量物件丢进 Local/Natural 批量播撒。**

---

## 第二步：选择管线电池与工具电池

电池分两类：**管线电池**（成组的场景模板组，封装某一层级的完整制作方法）与**工具电池**（顶层编排/数据转换/桥接）。

> ### ⛰️ 高差与连通（选电池前必读）
> **当前尚无坡道/台阶系统**，不同高度层之间无法自动衔接。因此：
> 1. **先**完成关键内容布局（建筑、结构、道路 POI）并 **`PathConnectionLink` 或 `PathConnectionRandomWalk` 确认连通**；
> 2. **再**在道路/建筑/地标等**叙事核心区之外**的剩余范围上使用 **`MountainContourGenerate`** 添加高差（核心区保持平地）；
> 3. **`MaxElevationLayers` 建议不超过 `2`**（`0`=平地，`1`=一层抬升，`2`=两层抬升）；除非用户明确要求更强地形，否则不要用更大值；
> 4. **地形完成之后**再进入装饰（见下方「装饰选型」）。
>
> 典型顺序：`AddBaseGrid` →（可选分区/分带）→ 建筑 →（可选结构）→ **道路连通** → **`MountainContourGenerate`（外围 Rest，≤2 层）** → **装饰（按选型）** → 湖。

> ### 📍 道路 POI（PathConnectionLink / RandomWalk）
> **`in_3` POI 禁止拍脑袋坐标。** 须从上游 Rest / 建筑体素 **导出并推理**（门 `outer_door`、`building_footprint_mask` 门格=2、建筑外侧邻格、经校验的边界锚点）。每个点必须在**可铺路区域内或区域边缘**；接入前确认 **不在区域外、不在建筑体内、不悬空无效格**。详见 [PathConnection.md](instructions/pipelines/PathConnection.md) §1。

> ### 🌿 地形与装饰选型（选电池前必读）
>
> **地形优先于装饰播撒**  
> `MountainContourGenerate`（及可选的 `IslandRegions` / `DistanceZones`）应在**道路连通之后、任何装饰组之前**完成。高差只加在**不影响叙事区域**的剩余范围——建筑 footprint、道路走廊、广场/地标周边等**叙事核心区保持平地**；丘陵/层次留给外围 Rest、背景带、非剧情空地。
>
> **装饰按能力选型（不必硬凑三种）**  
> 三类模板能力不同：PlaceOne **唯一**可控单颗 Footprint；Local/Natural 是点采样播撒，**无**单颗 footprint 口。
>
> | 方式 | 模板 | 何时用 | 可挂资产 | 链中位置 |
> |------|------|--------|----------|----------|
> | 精准单点 | `PlaceOneDecoration` | **少量**、有明确位置和/或底面尺寸 | 地标、雕像、石灯、特定大树等需占格贴合的物件 | 装饰链**靠前** |
> | 局部簇/环 | `LocalPreciseDecoration` | 兴趣点旁需要一簇点缀 | **仅**底面简单、结构简单的小物件（花草/碎石/小灌木/灯笼等） | PlaceOne 之后 |
> | 背景填充 | `NaturalDecorationDistribution` | 大片 Rest 防空白 | 同上——简单植被/石块；禁止复杂体量 | 局部之后、大面积 Rest |
> | 水体 | `LakeRegions` | 湖/池（按需） | — | 常靠后 |
>
> - 有明显 footprint/宽深 + 落点 → **优先 PlaceOne**，勿塞进 Local/Natural。  
> - 装饰很少且全是精准物件 → **可以只用 PlaceOne**；大片 Rest 空白时再叠加 Local → Natural。  
> - 推荐链式：`… → MountainContour(Rest 外围) → PlaceOne(s) → LocalPrecise → Natural → Lake …`，每组 `out_2`→下一组 `in_1`。  
> - **全局固定 Seed**：带 Seed 口的模板须接 `aw_m0_seed.seed`（非 0）；禁止悬空/`seed:0`（否则每次 execute 结果会变）。

> ⚠️ **硬边界（通道 B 顶层 createNode 限制）**：`applyBatch` 顶层只能放**工具电池**（见下表）。**模板组一律走通道 A `instantiateTemplate` 整组落地**——组内部实现是私有的，你既不需要也无法直接摆放。422 = 你在通道 B 顶层放了非白名单电池（多半是想手搭某个模板组的内部）→ 改用 `instantiateTemplate` 落那个模板组，见 [mutation-lanes.md](instructions/mutation-lanes.md)。

### 管线电池目录（场景模板组）

> 实例化一律用 `scene:pipeline.instantiateTemplate`。**端口序号和语义都以 instantiate 返回的 `exposedInputs`/`exposedOutputs` 为准**——每项自带 `label`（下表里 `in_N`/`out_N` 后面跟的那个词，如 `Scene`/`Rest`/`Island`，就是 `label` 的值；Skill 目录表 + 各 README 作接线配方/数值参考；**禁止**为查端口先 `templates.get` 读组内 nodes）。总览：[batteries/templates/scene/TEMPLATES_INDEX.md](../../batteries/templates/scene/TEMPLATES_INDEX.md)。

| 层级 | 管线电池 | 详细文档（本 skill） | 权威 README | 管线效果 | 必需输入 | 主要输出 |
|------|---------|--------------------|------------|---------|---------|---------|
| 地图主体 | **AddBaseGrid** | [pipelines/AddBaseGrid.md](instructions/pipelines/AddBaseGrid.md) | [README](../../batteries/templates/general/grid/AddBaseGrid/README.md) | 基础网格区域 + 底图 | `in_0`RootScene | `out_1`BaseNode / `out_2`RootScene |
| 功能分区 | **AreaPartition** | [pipelines/AreaPartition.md](instructions/pipelines/AreaPartition.md) | [README](../../batteries/templates/structures/districts/AreaPartition/README.md) | 纯划分父区域（**默认 organic**；无 Rest） | `in_0`Scene / `in_1`Points | `out_0`Scene / `out_1`Zones / `out_2`ZonesPath |
| 海岛分区 | **IslandRegions** | [pipelines/IslandRegions.md](instructions/pipelines/IslandRegions.md) | [README](../../batteries/templates/scene/IslandRegions/README.md) | 指定锚点造岛（每点一岛）+ 水域 —— **仅海洋/群岛场景** | `in_0`Scene / `in_1`Points | `out_1`Island / `out_2`Rest(水域) |
| 地形分带 | **DistanceZones** | [pipelines/DistanceZones.md](instructions/pipelines/DistanceZones.md) | [README](../../batteries/templates/scene/DistanceZones/README.md) | 按到边界距离把区域分近/远两带（深浅海、海岸内陆） | `in_0`Scene / `in_1`Threshold | `out_1`Near / `out_2`Far |
| 地形等高 | **MountainContourGenerate** | [pipelines/MountainContourGenerate.md](instructions/pipelines/MountainContourGenerate.md) | [README](../../batteries/templates/structures/topographic/MountainContourGenerate/README.md) | 剩余区域有机高度分层（**道路连通之后**；`MaxElevationLayers` **≤2**） | `in_0`Scene / `in_3`MaxElevationLayers / `in_1`AssetName | `out_2`Mountain / `out_1`Rest |
| 建筑 | **PickOneBuilding** | [pipelines/PickOneBuilding.md](instructions/pipelines/PickOneBuilding.md) | [README](../../batteries/templates/scene/PickOneBuilding/README.md) | 指定坐标放一栋建筑；**多栋/村庄 = 多次本模板 `out_2`Rest 串联**（`PickMultiBuildings` 暂禁不开放，见 [pipelines/PickMultiBuildings.md](instructions/pipelines/PickMultiBuildings.md)） | `in_3`Point / `in_1`Scene | `out_1`Building / `out_2`Rest |
| 建筑结构 | **BuildingStructures** | [pipelines/BuildingStructures.md](instructions/pipelines/BuildingStructures.md) | [README](../../batteries/templates/scene/BuildingStructures/README.md) | 盖墙/房间（含门） | `in_0`Scene(建筑区域) | `out_0`Scene / `out_1`Rooms |
| 道路 | **PathConnectionLink** / **PathConnectionRandomWalk** | [PathConnectionLink.md](instructions/pipelines/PathConnectionLink.md) / [PathConnection.md](instructions/pipelines/PathConnection.md) | 连连看 / 自然路网（**旧名 PathConnection 已废弃**） | `in_2`Scene / `in_3`POI | `out_1`Path / `out_2`Rest |
| 地形 | **MountainContourGenerate** | [pipelines/MountainContourGenerate.md](instructions/pipelines/MountainContourGenerate.md) | 外围等高线山头 | `in_0`←**Rest** | `out_1`Rest / `out_2`Mountain |
| 地形 | **HillContourGenerate** | [pipelines/HillContourGenerate.md](instructions/pipelines/HillContourGenerate.md) | 局部小山包 | `in_0`←**Rest** | `out_2`Rest / `out_1`Hill |
| 自然装饰 | **PlaceOneDecoration** | [pipelines/PlaceOneDecoration.md](instructions/pipelines/PlaceOneDecoration.md) | [README](../../batteries/templates/scene/PlaceOneDecoration/README.md) | **有尺寸/落点**的单点精准放置（唯一可控 footprint） | `in_1`Scene / `in_3`Point | `out_1`Decoration / `out_2`Rest |
| 自然装饰 | **LocalPreciseDecoration** | [pipelines/LocalPreciseDecoration.md](instructions/pipelines/LocalPreciseDecoration.md) | [README](../../batteries/templates/structures/decorations/LocalPreciseDecoration/README.md) | 兴趣点旁局部簇；**仅**简单小物件 | `in_1`Scene / `in_2`Point | `out_1`Decoration / `out_2`Rest |
| 自然装饰 | **NaturalDecorationDistribution** | [pipelines/NaturalDecorationDistribution.md](instructions/pipelines/NaturalDecorationDistribution.md) | [README](../../batteries/templates/structures/decorations/NaturalDecorationDistribution/README.md) | Rest 密度填充；**仅**简单植被/石块 | `in_1`Scene | `out_1`Decoration / `out_2`Rest |
| 自然地物 | **LakeRegions** | [pipelines/LakeRegions.md](instructions/pipelines/LakeRegions.md) | [README](../../batteries/groups/scene/LakeRegions/README.md) | 剩余空地挖湖 | `in_1`Scene | `out_4`Lake / `out_0`Rest |

> 各模板组 hidden 参数默认即可。**端口名和语义都以 `instantiateTemplate` 返回的 `exposedInputs`/`exposedOutputs`（含 `label`）为准，不要猜、不要 templates.get 预读。** 上表的语义标注若与返回的 `label` 不一致，以 `label` 为准（说明模板改过，回头更新本表/对应 `pipelines/*.md`）。
>
> **模板 README 必含两节：**「如何用命令调用（输入侧）」与「如何用命令消费输出（输出侧）」——标准见 [`batteries/templates/_DOC_STANDARD.md`](../../batteries/templates/_DOC_STANDARD.md)。范例：`AreaPartition` README。

### 工具电池目录（通道 B · 顶层 applyBatch 可用）

> 模板组 **不在此表** — 仅 **`instantiateTemplate`（通道 A）** 落地。  
> **完整端口定义**：`scene:composerUtilities.list` / `scene:composerUtilities.get`（Sino 唯一可见的电池目录）。  
> **`scene:batteries.*` 对 Sino 不可调用**（全量 ~300 ops，人类/Workbench 专用）。

| 工具电池（opId） | 功能 | 主要输入 | 主要输出 |
|----------------|------|---------|---------|
| `empty_scene` | 空场景起点 | 无 | `scene` |
| `text_panel` | 资产名/语义名/路径 | `params.text` | `output` |
| `number_const` | 尺寸/数量/面积权重 | `params.value` | `value` |
| `toggle` | 布尔常量 | `params.value` | `value` |
| `seed_control` | 随机种子（**扇出到各模板 Seed 口**；**禁止**接 AddBaseGrid.in_8 fillValue） | — | `seed` |
| `string_concat` | 拼路径 | `a`、`b` | `result` |
| `scene_focus_path` | 按路径聚焦 scene 子节点（**提门 POI / 单个子区**） | `scene`、`path` | `scene` |
| `scene_focus_children` | 扇出 focus 的每个直接子节点（**多子区分支**） | `scene` | `scenes`(list) |
| `node_explode` | 展开 focus 节点体素/2dPoints（**POI 坐标真值**） | `scene` | `2dPoints`、`voxels`… |
| `building_footprint_mask` | 建筑占地掩码（0/1/2 门格） | `scene` | `grid` |
| `manual_points` | 手动 point2d（**须先 region 校验**） | `params.x/y` | `point` |
| `tree_merge` | 合并 DataTree（scene=`tree`；points/areas=`item`） | `item_0..N` | `tree` |
| `tree_flatten` | 树拍平 | `tree` | `tree` |
| `scene_merge_subtrees` | 合并子树 | `scenes` | `scene` |
| `scene_output` | Preview 终端 | `scene` | — |

> 手搓 `rect_grid` / `grid2node` / `add_child` / `alg_*` / `createGroup` → **403**（服务端硬拒）。需要算法能力时用对应 **模板组** `instantiateTemplate`。

---

## 第三步：操作管线连线

详细操作手册见 [instructions/session_operation.md](instructions/session_operation.md)（op schema、`instantiateTemplate`、`applyBatch`、连线规则、验证）。

**连线铁律（动手前必读，文档已替你验证过，禁止现场试错重新发现）：**
1. **`connect` 的 `source.port`/`target.port` 优先用语义 `{"label":"XxxName"}`**（`instantiateTemplate` 返回的 `exposedInputs`/`exposedOutputs` 里的 label），不用先心算映射成 `in_N`/`out_N`；查不到 label 才退回字符串端口名。字段名是 `nodeId`（不是 `id`）；`edgeId` **可选**（不写会自动生成），写了必须全图唯一，写错字段名（比如写成 `id`）会导致 `edgeId` 变成 `undefined` 并报 `edge undefined already exists`。
2. **`applyBatch` 后必 `scene:pipeline.get` 核对** nodes/edges 真进图（防"ok 却空"）；忘了 groupId 时用 `nameContains`/`opIdIn` 模糊查，不用拉整图。
3. **`scene:pipeline.execute` 返回 `completed` ≠ 每组都成功**——必接 scene 端口悬空会静默空跑；每加一组逐组验证；同时看 `verification.topologyIssues`（Rest 链 fan-out / 局部非法 merge 现在会直接 throw 并带 `suggestedOps`，不用等汇总后才发现）。
4. **`PathConnectionLink` / `PathConnectionRandomWalk`** 的 `in_2`+`in_3` 必接；**禁止**旧 templateId `PathConnection`；POI 须提门（见 PathConnection.md §1）。
5. **`tree_merge` 建组时必带 params**：scene 汇总 `{"inferredAccess":"tree","inferredType":"scene","portCount":N}`；POI 列表 `{"inferredAccess":"item","inferredType":"point2d","portCount":N}`。根 `aw_m0_merge` 追加一路时，只能把模板的 **Scene 汇总口**交给 `appendMergeItem`（自动分配 `item_N`、递增 `portCount`）；领域口与 Rest 口禁止汇总。
6. **`applyBatch` 必带 `opts.actor:"ai:sino"`**——这是白名单硬门的身份标记。
7. **强制顺序**：`empty_scene → AddBaseGrid`（拿 BaseNode）+ seed + 汇总骨架先跑通（M0 execute）→ 再实例化后续组（**参数已知的相邻组可批量连完再一起 execute；依赖上游 execute 结果的组分步来**，见「可分步批量」）→ 后续组 `in_0` 接 BaseNode/上一组 Rest。

**链式串联范式（速记）：**
- 起手：`empty_scene` → `AddBaseGrid` → `out_1`(BaseNode) 作后续 `in_0` 起点。
- 功能分区(可选，默认分区手段)：上一组 Rest/BaseNode → `AreaPartition.in_0`；读 checklist `partitionPointsJson`/`partitionAreasJson`；`in_6` 默认 **organic**（勿改 rectilinear）；各区中心 `manual_points` → `tree_merge`(item) → `in_1`。**无水域** — 详见 [AreaPartition.md](instructions/pipelines/AreaPartition.md)。
- 海岛分区(可选，**仅海洋/群岛场景**)：`AddBaseGrid.out_1` → `IslandRegions.in_0`；多个 `manual_points` → `tree_merge`(item) → `in_1`(各岛锚点)；`in_2` 接各岛 IslandSizes、`in_4` 接岛屿资产名。**`out_0`(Scene) → `appendMergeItem` 汇总**；**`out_1`(Island) 作后续建筑/装饰层 Scene 输入**（领域细化）；`out_2`(Rest) = 水域/Rest 串链。
- 地形分带(可选，深浅海/海岸内陆)：把某区域节点 → `DistanceZones.in_0`；`number_const` → `in_1`(Threshold 带宽格数)；近/远资产名接 `in_4`/`in_6`。**海洋分深浅** `in_2` 留默认(false)：`out_1`=浅海、`out_2`=深海；**岛屿分海岸**用 `toggle`(value=true) → `in_2`：`out_1`=海岸线、`out_2`=内陆。常接在 `IslandRegions` 的 `out_2`(水域，分深浅) 或 `out_1`(岛屿，分海岸) 之后。
- 地形等高(可选，**道路连通之后、装饰之前**)：在**叙事核心区之外**的 Rest 上接 **`MountainContourGenerate.in_0`**；**`out_0`(Scene) → `appendMergeItem` 汇总**；**`out_1`(Rest) → 装饰链**；`out_2` 是 Mountain 领域口（见 [MountainContourGenerate.md](instructions/pipelines/MountainContourGenerate.md)）。
- 建筑：**`PickOneBuilding`**（单栋）；**多栋/村庄暂禁 `PickMultiBuildings`** — 改用多次 `PickOneBuilding`，每次 `out_2`(Rest) → 下一栋 `in_1`(Scene) 串联（见 [PickOneBuilding.md](instructions/pipelines/PickOneBuilding.md) §5）。
- 结构(可选)：`Building.out_*` → `BuildingStructures.in_0` → `out_0` 供道路 POI 提门。
- 道路：**单个** `PathConnectionLink`（城镇）或 `PathConnectionRandomWalk`（野路）— Rest → `in_2`；POI 提门 → `in_3`。**确认连通后再 Hill/Mountain（Rest 串链，禁止 fan-out）。**
- 装饰/湖（**按选型规则，不必硬凑三种**）：高差之后的 Rest → **`PlaceOneDecoration`**(有尺寸/落点的物件，可多组串) → **`LocalPreciseDecoration`**(简单小物件簇) → **`NaturalDecorationDistribution`**(简单植被背景填充) → **`LakeRegions`**（按需）。有尺寸落点优先 PlaceOne；Local/Natural **只**挂简单物件。前三个装饰模板 `out_2`(Rest)→下一组 `in_1` 链式；**`LakeRegions` 的 Rest 出口是 `out_0`（不是 `out_2`），Scene 入口仍是 `in_1`**——用 `{"label":"Rest"}`/`{"label":"Scene"}` 连线，别套错编号。
- 汇总：各组 **`Scene` 汇总口**依次用 `appendMergeItem`（`{ label:"Scene", portName:"out_N" }`）接入根 `aw_m0_merge` → `tree_flatten` → `scene_merge_subtrees` → `scene_output`。POI/名称等列表类中间汇总仍用手写 `tree_merge`（`inferredAccess:"item"`）。
- 统一种子：`seed_control.seed` 扇出到各组 Seed。

---

## 第四步：资产需求收集与 Mira 协作

**Sino 不生成任何图片/贴图/物件。** 构图时一律用**语义资产名**（写进 `text_panel`，如 `草地` / `石路` / `橡木屋` / `行道树`）。完整协作协议（含 `asset-requirements.json` 契约格式与导入验收）见 [instructions/asset-collaboration.md](instructions/asset-collaboration.md)。四阶段速记：

1. **布局**：用语义名拼完整张场景布局，跑通 `execute`（此时用内置素材占位即可）。
2. **收集需求**：把场景里引用到的每个资产汇总成 `asset-requirements.json`（`name` / `description` / `type`=`tile|object` / `footprint`{w,d 格} / `heightRatio`），写入 runDir 供 aw-support 调度 Mira。
3. **等待生成**：Mira 出图并发布到共享游戏沙箱，回传 `gameSlug` / 结果路径。
4. **导入验收**（精简、一次到位、基于元数据）：`scene:library.useGameTextures({gameSlug, projectRoot})`——**`projectRoot` 必传**（=契约绝对路径 `/.forgeax/` 之前那段，否则绑到空目录、误命中内置同名预设）→ `scene:library.list` **逐一核对每个 `name` 就位且确来自沙箱**（`id` 以 `game-sandbox:` 开头、非 `Asset_Library/` 内置、尺寸/`assetKind` 与契约一致）→ `execute` 跑一次确认无 error。这是落沙箱的**权威判定**。详见 [asset-collaboration.md §四](instructions/asset-collaboration.md)；不符则回退第 1/2 步或回提需求。

---

## 第六步：总结归档

完成场景制作后，将**本次**执行总结写入工作区 `executions/` 目录（**仅作归档输出，勿供后续任务当配方读** — 见 [executions/README.md](executions/README.md)），文件以场景名命名，含：
1. **电池清单**：用到的每个管线/工具电池及其层级；
2. **参数记录**：关键参数选择（网格尺寸、建筑数、密度、seed 等）；
3. **资产清单**：本次 `asset-requirements.json` 里的资产及 Mira 产出/导入结果；
4. **场景效果 + 优化建议**：最终效果描述与至少一条改进建议。

---

## 收尾检查清单

- [ ] 场景设计完成，层级从大到小清晰
- [ ] 仅使用第二步目录里的白名单管线/工具电池（`opts.actor:"ai:sino"`）
- [ ] 每加一组都 `pipeline.get` + `execute` 逐组验证过（无 error、摘要符合预期）
- [ ] 资产需求已汇总成 `asset-requirements.json` 交付，Mira 产物已 `useGameTextures` 导入并经 `library.list` 核对每个 `name` 就位（来源为沙箱产物）
- [ ] `verification.locationNameAlignment` 通过（execute 摘要）
- [ ] 已将执行总结写入 `executions/`
