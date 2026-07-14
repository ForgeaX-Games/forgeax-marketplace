---
name: compose-lowpoly
description: >-
  Compose and iterate ForgeaX 3D Lowpoly Generator projects (wb-3d-lowpoly)
  through the official Studio ToolRegistry tools (lowpoly:*). Covers three
  distinct flows: PART A — asset / mechanical part / assembly (the mandatory
  two-phase workflow: write a part manifest → model + bake each part on its own
  with g_bake_part → reference the staged g_mesh meshes and assemble one rooted
  URDF tree); PART B — static low-poly BUILDINGS (walls, floors, stairs, doors,
  windows, roofs, facades, railings, columns via the Architecture family,
  assembled by hand into one rooted tree with g_part + g_joint_fixed); SCENE
  orchestration (terminal stage = PART C) — for a
  scene / city / multi-object + building composition: list the scene inventory,
  loop each unique item through PART A/B + bake, then place the baked meshes into
  one URDF tree by setting each g_part's origin/rpy (no g_joint — g_to_urdf
  auto-stitches the jointless roots into one tree), QC, and export the whole
  scene to .glb. Use when the user asks to create, modify, export, or iterate a
  low-poly 3D model, mechanical part, building, or a composed scene. First triage the intent (single object/assembly → A; building → B;
  scene → SCENE orchestration), then route to the right PART and follow its
  execution file.
trigger: /compose-lowpoly
---

# Compose Lowpoly · 入口与路由

在「3D 低多边形生成器」（wb-3d-lowpoly）里产出引擎中立的低多边形 `.glb`。所有操作走 Studio
ToolRegistry 工具（`lowpoly:*`，代理到插件后端 `/api/v1/*`），不要直接改运行时文件，不要点 UI
模拟人工，也不要用旧版 scene/renderer API。

> **DSL-first（首要）**：几何 **DSL 是唯一真源**。用 `lowpoly:model.apply({ source })` 提交
> **完整 DSL 文本**，后端一次完成 **校验 → 编译成图 → 执行 → 烘焙 → QC**，返回**紧凑回执**（错误 /
> QC 信号**定位到 DSL 行号**、mesh-aware 穿模硬信号 + 具体平移修正量、URDF 指纹）。你**只写 DSL、
> 绝不手工连线**（不发 `createNode`/`connect`/`applyBatch`）。DSL 语法见
> [dsl-quickref.md](dsl-quickref.md)，全部 op 签名见自动生成的 [op-directory.md](op-directory.md)
> （SSOT，无需再调 `batteries.list`）。下方旧的 applyBatch/连边流程为**过渡期**保留，agent 不再使用。

> **本文件只负责路由 + 每个 PART 的要点提要。** 拿到需求先**判断走哪套流程**，再打开对应的
> execution 文件按步骤执行；动手前与执行中遇到的通用规则查「共享参考」。**无论哪个 PART，都先
> 问清/想清需求，再搭管线并运行；不要拿一次绿色 batch 当成品交付——读 QC 信号判断完成度。**

## Token 纪律（精简循环，先读这条）

这套流程的 token 开销主要来自**反复重读目录/端口**和**图越堆越大**，不是引擎问题。DSL-first
本身就把往返压到最小——按下面几条走，既保住正确性护栏又不浪费 context，这是全套技能里关于
「怎么发现 op / 何时读态 / 何时算完成」的**唯一权威表述**，其余文件引用它：

1. **只写 DSL，用 `model.apply` 一次成图**：不再 `batteries.list`/`get` 逐个查端口——op 签名从
   [op-directory.md](op-directory.md)（自动生成的 SSOT）取，语法查 [dsl-quickref.md](dsl-quickref.md)。
   一次 `model.apply(source)` 就完成校验+编译+执行+QC，无需手工 `createNode`/`connect`/`applyBatch`。
2. **读态用 `model.get` / `parts.list`**：要看当前模型就 `model.get`（返回 DSL 源，人在编辑器改过图也
   round-trip 回等价 DSL）；要查已烘焙的 mesh 就 `lowpoly:parts.list`（`name→sha+bbox+dims`）——不再
   例行 `pipeline.get` 拉整张 node/edge JSON。
3. **每件 bake 完只携带 `<sha>.obj` + bbox**：`parts.list` 随时可查，图/上下文始终很小。
4. **完成门禁 = `model.apply` 回执干净**：无 `errors`、`qc.valid`、`meshQc.clean`、`urdf` 无错误
   （回执已把 QC/穿模信号定位到 DSL 行号，并给出具体平移修正量）+ 对照 Phase-0 清单核对尺寸/AABB。
   回执里的 mesh-aware QC 就是形态判据；`export-glb` 仅在用户明确要导出成品文件时才调。

## 官方工具路径

`caller.kind = "ai"`（除非宿主另给 caller 上下文）。DSL-first 主入口 —— 提交完整 DSL 文本：

```json
{
  "toolId": "lowpoly:model.apply",
  "args": { "source": "b1 = box(size=[1,1,1])\np1 = part(shape=b1)", "name": "demo" },
  "caller": { "kind": "ai" }
}
```

可用工具：`lowpoly:projects.*`（list/create/open/close/remove，remove 需破坏性确认）、
**`lowpoly:model.apply`（主入口）/ `lowpoly:model.get` / `lowpoly:parts.list`**、
`lowpoly:assets.list`、`lowpoly:export-glb`（仅用户要导出成品时）。低层 `lowpoly:batteries.*` /
`pipeline.*` 供人工/旧流程，agent 不用。

---

## 一、意图分诊（先走这棵决策树）

拿到需求**先分诊**：用户要的是**一个物件**、**一栋建筑**，还是**一个由多物体/建筑组成的空间**？
照下面从上到下判，命中即停：

1. **场景 / 城市 / 多物体 + 建筑的空间组合**（「一条街」「一个村子」「一座小城」「房子 + 树 +
   栅栏 + 路灯摆成一个院子」「一片柱列 + 道具阵」）→ **SCENE 编排**。这是一个**包裹 A+B 再 C**
   的内部循环：先列**详细**场景清单 → **对每个 unique item 打开并完整跟做它对应的 execution 文件**
   （`part-a-asset.md` 或 `part-b-building.md` 的整套建模 + `g_bake_part`）→ 最后走 PART C 按位姿
   组装成整棵 URDF 树并导出整场。**每个 unique item 都在同一个场景项目里 bake**（blob 库 workspace
   级，同项目 bake 出的 `<sha>.obj` 才能稳定被组装引用）。入口见
   [PART C · 场景编排与组装](executions/part-c-scene-assembly.md)。
2. **房屋 / 建筑 / 房间 / 多层壳体 / 建筑构件**（墙、楼板、楼梯、门窗、屋顶、栏杆、柱）→
   **PART B · 建筑**（Architecture 家族）。
3. **单个物件 / 机械件 / 装配体**（枪、宝箱、齿轮组、机械臂…）→ **PART A · 资产 / 机械**。

### 装配 vs 场景的边界（最容易误判，先消歧）

- **PART A（装配体）= 一个作为整体运作 / 联动的物件**，哪怕它有很多零件、带可动关节（机械臂、
  齿轮组、带盖宝箱）。判据：拆出来的件是**同一个东西的零件**，合起来才是「那一个物件」。
- **SCENE（场景）= 多个各自独立的物体 / 建筑共处同一个环境**。判据：每个 item 自己就是一个完整
  的东西（一栋楼、一棵树、一个路灯），它们只是**摆在一起**、没有作为一个机构联动。
- 一句话区分：**「这是一个会动/联动的整体」→ A；「这是好几样东西摆在一块」→ SCENE。**

## 二、选哪套流程（路由表）

| 你要做的 | 走哪个 PART | 打开 |
|---|---|---|
| 单个物件 / 机械件 / 装配体（枪、宝箱、齿轮组、机械臂…）——**逐件建模 + 烘焙 → 引用 mesh 组装** | **PART A · 资产 / 机械** | [executions/part-a-asset.md](executions/part-a-asset.md) |
| 房屋 / 建筑 / 房间 / 多层壳体 / 建筑构件（墙、楼板、楼梯、门窗、屋顶、栏杆、柱）——**用 Architecture 家族** | **PART B · 建筑** | [executions/part-b-building.md](executions/part-b-building.md) |
| **场景 / 城市 / 多物体 + 建筑的空间组合**——先列详细清单、逐件**打开并完整跟做** A/B execution 文件 + bake（同一场景项目内），再按位姿组装成整场 `.glb` | **SCENE 编排（终段 = PART C）** | [executions/part-c-scene-assembly.md](executions/part-c-scene-assembly.md) |

> **SCENE 编排不是独立的第四套流程**，而是**包裹 A/B 逐件建模 + PART C 终段组装**的编排循环。
> 场景里的每个 unique item 仍先经 A 或 B 建模并 bake；PART C 是这套编排的**最终组装阶段**——把
> 这些已 bake 的 mesh 按算好的位姿摆进同一棵 URDF 树并导出整场。

## 三、各 PART 要点提要（先看摘要，再进 execution 文件）

### PART A · 资产 / 机械 → [executions/part-a-asset.md](executions/part-a-asset.md)
- **强制两阶段，绝不一个 mega-batch 成图**：阶段0 写**精细拆件清单**（硬门禁，每件一行：
  名称+功能 / 真实形态 / op 路由 / 带轴尺寸 / 细节特征及位置 / 局部原点基准 / 装配关节 /
  材质 / 用 primitive 的逐件理由）。
- **阶段1 逐件建模 + 烘焙**：每件从空几何起搭**独立子图**（CSG / Parts，齿轮也在 Parts 里），末端
  `g_bake_part` 烘成 `<sha>.obj`，记下 filename/bbox 后 `deleteNode` 删掉该件子图再建下一件。一件
  一个小 batch + execute。
- **阶段2 引用 mesh 组装**：写 DSL —— `mesh(filename=<sha>.obj)` → `part` → `material` 配色 →
  `joint(...)` 连成单一根树，`model.apply(source)` 一次跑完编译+执行+QC+URDF（QC/URDF 是编译器自动
  追加的终端节点，你不用手写）。完成判定看回执信号。平凡件
  （真就是一块板/一根杆）才直接 `box`/`cylinder`/`sphere`。

### PART B · 建筑 → [executions/part-b-building.md](executions/part-b-building.md)
- **工具/传输/QC 循环与 PART A 完全一致**，变的是**建模哲学**：建筑里 **Architecture 家族
  （`g_wall` / `g_floor_slab` / `g_stairs` / `g_roof` / `g_window` / `g_door` / `g_railing` /
  `g_column`）是默认**，裸 `g_box` 是例外。
- **先写建筑 brief**（footprint & 层数 / 房间矩形与墙中线布局 / 流线楼梯 / 各墙开洞 /
  屋顶类型）再动手。
- **没有整栋编排器**：逐条写 Architecture op 的 DSL，各自 `part(...)` 包壳后用
  `joint(type="fixed",...)`（可开的门窗扇用 `type="revolute"`）连到单一根件（如地面楼板），元件靠
  joint `origin`/`rpy` 摆位；共享内墙去重。`model.apply` 会自动追加 QC + URDF 终端节点跑完校验。

### SCENE 编排（终段 = PART C） → [executions/part-c-scene-assembly.md](executions/part-c-scene-assembly.md)
- 定位：**SCENE 编排的最终组装阶段**。前置是先口播场景清单、逐件走 A/B 建模 + bake；PART C 把这些
  已 bake 的 mesh 当**道具库**，按算好的位姿摆进同一棵 URDF 树，导出整场 `.glb`。组装阶段本身
  **不建新几何**。
- **阶段-2/-1/0 编排上游**：先写场景 brief（主题、尺度、布局范式）→ **详细**场景清单（每 item 走 A
  还是 B、2~3 句真实形态、目标尺寸、数量、**哪些实例化复用**、落位）→ 分发循环：**对每个 unique item
  打开并完整跟做它对应的 execution 文件**（`part-a-asset.md` / `part-b-building.md` 的整套两阶段建模
  + `g_bake_part`，不是凭记忆堆电池），记 `<sha>.obj` + bbox。
- **同项目 bake（硬规则）**：所有 unique item 都**在同一个场景项目里 bake**——blob 库是 workspace 级、
  内容寻址，同项目 bake 出的 `<sha>.obj` 才能稳定被组装阶段 `g_mesh` 引用。别把不同物体分散到不同
  项目里 bake（跨项目引用的前提与退化条件见 part-c）。
- **组装配方（默认）**：每实例 `g_mesh(<sha>.obj, bbox)` → `g_part(origin=位姿, rpy, material)`，
  **不写 `g_joint_fixed`**——`g_to_urdf` 的 auto-stitch 会把无 joint 的根 part 自动缝成单一根树。
  位姿挂在 `g_part` 自己的 origin / rpy 上（直接渲染成 `<visual><origin>`）。
- **重烘陷阱**：别用 `g_translate`/`g_array_*` 给引用 mesh 摆位（它们会把每个实例重新烘成新 OBJ、
  毁掉实例化）；大量同款复用 = **同一 `<sha>.obj` + 多个不同 origin 的 `g_part`**。
- **QC 注意**：场景模式下 `g_geometry_qc` 的 `islands` 信号可忽略（无 joint 的 part 会被报成孤岛，
  但 auto-stitch 已缝好）；**`aabb_overlap` 穿模仍是硬信号**——`g_mesh` 必须填 `bbox_min/max` 才生效。
- **多色物体两条路**：①**`g_bake_object`**——把物体各 part 用真形状建在一个图里 + 各配 `g_material`，
  整组烘成**一个带色 `<sha>.glb`**，场景里当一个 mesh 摆、引用它的 `g_part` 不再上 material（配色固定、
  整体复用首选；只适合静态物体）。②`g_bake_part` 按颜色分件成多个 `<sha>.obj` + 组装阶段各上一次
  `g_material`（同款换色 / 配色多变）。**单个 `<sha>.obj` 不带材质 = 单色**；跨项目引用前提见 part-c。

## 四、共享参考（按需读取，不要一次全读）

一次标准建模只需要：**对应的 execution 文件（A/B/C）+ 下面前两份**。其余仅在需要时才查。

| 何时读 | 内容 | 文件 |
|---|---|---|
| **必读** | 全部 op 签名（authoring SSOT） | [op-directory.md](op-directory.md) |
| **必读** | DSL 语法速查（grammar + 值类型 + 最小示例 + 铁律） | [dsl-quickref.md](dsl-quickref.md) |
| 选型拿不准时 | 家族列表 + 路由表 | [battery-catalog.md](battery-catalog.md) |
| 忘了流程时 | DSL-first 工作流 + 回执/QC 循环 | [quickstart.md](quickstart.md) |
| ⚠️ 旧格式，一般不用 | modeling-guide / pipeline-schema 仍是 **legacy `createNode` JSON** 写法（非 DSL），只在想看某家族概念时参考，**别照它的格式写**——授权一律走 DSL + op-directory | modeling-guide.md · pipeline-schema.md |

**最常踩的三条铁律**（展开与依据见顶部「Token 纪律」）：

1. **op 名 / 参数以 [op-directory.md](op-directory.md) 为权威、绝不凭记忆编**——它由 op-registry
   自动生成，覆盖全部 op 签名；`model.apply` 回执会对未知 op / 参数错误**报出具体 DSL 行号**。
2. **只写 DSL、交给 `model.apply`**：编译器按 op→电池映射自动建图连线、自动追加 QC/URDF 终端节点；
   遇到映射表外的 op 会显式报错（带行号），不会静默降级。不要手写 `createNode`/`connect`。
3. **两阶段，不堆 mega-model**：把整个物件/场景写进一坨 DSL 必然退化成方块拼接。PART A 每件单独建模、
   `g_bake_part` 烘成 `<sha>.obj`（`parts.list` 可查），阶段2 再用 `mesh(filename=...)` 引用组装。
