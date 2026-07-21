---
name: compose-lowpoly
description: >-
  Compose and iterate ForgeaX 3D Lowpoly Generator projects (wb-3d-lowpoly)
  through the official Studio ToolRegistry tools (lowpoly:*). The compiler
  auto-routes each DSL to one of THREE terminal pipelines by content: STATIC
  (no joint / no skin → g_to_scene → single merged multi-material .glb),
  URDF (has joint → g_to_urdf, mechanical/articulated), or CHARACTER (has
  skin/skeleton → g_to_rig, skeleton + smooth skinning). Covers these flows:
  PART A — asset / mechanical part / assembly (the mandatory two-phase workflow:
  write a part manifest → model + bake each part on its own with g_bake_part →
  reference the staged g_mesh meshes and assemble; jointed → URDF, jointless →
  static glb); PART B — low-poly BUILDINGS (walls, floors, stairs, doors,
  windows, roofs, facades, railings, columns via the Architecture family);
  PART D — CHARACTER / creature (skeleton + smooth skinning via
  bone/skeleton/skin, exported as a skinned glb); SCENE orchestration (terminal
  stage = PART C) — for a scene / city / multi-object + building composition:
  list the scene inventory, loop each unique item through PART A/B + bake, then
  place the baked meshes by setting each g_part's origin/rpy — jointless, so it
  routes through the STATIC pipeline (g_to_scene merges the placed meshes into
  one multi-material .glb; no URDF auto-stitch). Use when the user asks to
  create, modify, export, or iterate a low-poly 3D model, mechanical part,
  character, building, or a composed scene. First triage the intent
  (single static object/mechanical assembly → A; character/creature → D;
  building → B; scene → SCENE orchestration), then route to the right PART and
  follow its execution file.
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
> **家族索引**（SSOT，无需再调 `batteries.list`）——索引按家族链到
> [op-directory/](op-directory/) 下的分片文件，**只开当前 PART 要用的那几个分片**，别把全部家族
> 都读一遍。下方旧的 applyBatch/连边流程为**过渡期**保留，agent 不再使用。

> **本文件只负责路由 + 每个 PART 的要点提要。** 拿到需求先**判断走哪套流程**，再打开对应的
> execution 文件按步骤执行；动手前与执行中遇到的通用规则查「共享参考」。**无论哪个 PART，都先
> 问清/想清需求，再搭管线并运行；不要拿一次绿色 batch 当成品交付——读 QC 信号判断完成度。**

> **🔑 共同纪律 · 列清单 + 逐件建模（A / B / D 一律适用，细节全靠它）**：任何非平凡物件——
> **无论机械、建筑还是角色生物**——都必须先写**逐件清单（Phase 0 硬门禁）**：每件一行写清名称+功能 /
> 真实形态 / op 路由 / 带轴尺寸 / **细节特征及位置** / 局部原点。然后**逐件用真形状建模**（CSG / Parts /
> Architecture 出细节，`box`/`cylinder`/`capsule`/`sphere` 只是起手体块，不是成品）。**一口气把整个物件
> 糊成一坨 DSL、堆几个 primitive = 必然退化成方块玩具，没有细节。** 各 PART 只是**装配方式**不同：
> **A** 逐件 `bake` 成 `<sha>.obj` 再 `mesh` 引用组装、写 `joint`；**D** 同样逐件 `bake` → `mesh` 引用
> 组装，但组装时**你亲手写 `bone`/`skeleton` 骨架 + 一行 `skin(method="auto")`**（`g_bake_object` 合并成可
> 蒙皮网格、权重前端算）；**B** 逐条 Architecture 元件 `joint` 拼成一栋。
> **建模的精细度要求三者相同——区别只在怎么拼，不在能不能省略逐件建模。**
> **A 和 D 拼法几乎一样**：都逐件 `bake` → `mesh` 引用组装；只是 A 组装写 `joint`，D 组装**由你亲手写
> `bone` / `skeleton` 建骨架（父子按解剖定）+ 一行 `skin(method="auto")`**——骨架不靠启发式猜，蒙皮才自动。

## Token 纪律（精简循环，先读这条）

这套流程的 token 开销主要来自**反复重读目录/端口**和**图越堆越大**，不是引擎问题。DSL-first
本身就把往返压到最小——按下面几条走，既保住正确性护栏又不浪费 context，这是全套技能里关于
「怎么发现 op / 何时读态 / 何时算完成」的**唯一权威表述**，其余文件引用它：

1. **只写 DSL，用 `model.apply` 一次成图**：不再 `batteries.list`/`get` 逐个查端口——op 签名从
   [op-directory.md](op-directory.md)（自动生成的家族索引 SSOT）取，**只读当前 PART 需要的分片**
   （见下方各 PART 的 execution 文件顶部链接），语法查 [dsl-quickref.md](dsl-quickref.md)。
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
   栅栏 + 路灯摆成一个院子」「一片柱列 + 道具阵」）→ **SCENE 编排（走静态路）**。这是一个**包裹 A+B
   再 C** 的内部循环：先列**详细**场景清单 → **对每个 unique item 打开并完整跟做它对应的 execution
   文件**（`part-a-asset.md` 或 `part-b-building.md` 的整套建模 + `g_bake_part`）→ 最后走 PART C 按
   位姿把已烘 mesh 摆进 DSL。**无 joint 的场景 DSL 走静态路**（`g_to_scene → scene_preview`），合并
   成**单个多材质 `.glb`**，导出 `mode="static"`——不再走 URDF auto-stitch。**每个 unique item 都在
   同一个场景项目里 bake**（blob 库 workspace 级，同项目 bake 出的 `<sha>.obj` 才能稳定被组装引用）。
   入口见 [PART C · 场景编排与组装](executions/part-c-scene-assembly.md)。
2. **角色 / 生物 / 软体**（人、动物、怪物、吉祥物、需要**平滑弯曲蒙皮**而非刚性关节的东西；
   **会走 / 会跑 / 会动的动物也在此列**，运动靠骨骼动画不是关节）→ **PART D · 角色 / 生物**
   （骨架 + 平滑蒙皮的角色路）。判据：你想要的是**一块连续表皮随骨骼平滑弯曲**（关节处不裂、
   不露缝），而不是机械那种刚性分件绕轴转。
3. **房屋 / 建筑 / 房间 / 多层壳体 / 建筑构件**（墙、楼板、楼梯、门窗、屋顶、栏杆、柱）→
   **PART B · 建筑**（Architecture 家族）。
4. **单个物件 / 机械件 / 装配体**（枪、宝箱、齿轮组、机械臂…）→ **PART A · 资产 / 机械**。

### 角色 vs 机械装配的边界（软体蒙皮 vs 刚性关节）

- **PART D（角色）= 一块连续表皮随骨架平滑弯曲**：肢体弯折处表皮连续过渡、不裂缝。用
  `bone`/`skeleton`/`skin`（组装时手写骨架 + 一行自动蒙皮），走**角色路**编译成
  RigSpec，前端**测地体素绑定**求每顶点 4 骨平滑权重。适合人/动物/怪物/布偶。
- **PART A（机械装配）= 刚性分件绕 URDF 轴转**：每个 part 是硬邦邦的整块，用 `joint(...)` 绕轴/
  限位联动。关节处是**硬接缝**（机械臂、齿轮、带盖宝箱）。
- 一句话区分：**「表皮要跟着骨头平滑弯」→ D；「零件绕轴硬转」→ A。**
- **⚠️ 动作不改变路线（最常踩）**：会走 / 会跑 / 会游的**活物依然是角色路（D）**——它的运动是
  **骨骼动画**（`animation` 通道键=骨骼名，驱动腿 / 脊柱绕各自弯曲轴摆动，四肢交替相位就是行走），
  **不是** URDF 关节动画。**别因为需求里出现「走 / 跑 / 动 / 走路」就退回 A 连 `joint`**——一只会走的
  动物是角色，不是关节机器。只有**机械件**（门、夹爪、齿轮、机械臂、会走的机器人）的运动才走关节动画。
- **编译分诊由 DSL 内容自动判定（三管线）**：按内容选终端链，一个模型只走其中一条——
  - **含 `bone`/`skeleton`/`skin` → 角色路**（终端链
    `g_skin_qc → g_bake_object → g_to_rig → rig_preview`，导出 `mode="character"` skinned glb）；
  - **含 `joint` → URDF 路**（终端链 `g_geometry_qc → g_to_urdf`，机械/关节联动，导出 URDF/动画 glb）；
  - **两者都无 → 静态路**（终端链 `g_geometry_qc → [g_bake_object] → g_to_scene → scene_preview`，
    纯静态物体/场景合并成**单个多材质 `.glb`**，导出 `mode="static"`）。
  **同一文件里既有 `joint` 又有 `skin`/`skeleton` 会报「混合模型」错**——把机械件与角色分文件。
- **可选显式覆盖**：`model.apply` 支持 `pipeline: 'static' | 'mechanical' | 'urdf' | 'character'`
  强制指定管线（绕过内容推断，`mechanical` 归一化到 `urdf`）；一般不用，让内容推断即可。

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
| 角色 / 生物 / 软体（人、动物、怪物、吉祥物）——**逐件建模 + bake（同 A）→ 组装时手写 `bone`/`skeleton` 骨架 + 一行 `skin(auto)` 自动蒙皮 → 骨骼 K 帧 → 导出 skinned glb** | **PART D · 角色 / 生物** | [executions/part-d-character.md](executions/part-d-character.md) |
| 房屋 / 建筑 / 房间 / 多层壳体 / 建筑构件（墙、楼板、楼梯、门窗、屋顶、栏杆、柱）——**用 Architecture 家族** | **PART B · 建筑** | [executions/part-b-building.md](executions/part-b-building.md) |
| **场景 / 城市 / 多物体 + 建筑的空间组合**——先列详细清单、逐件**打开并完整跟做** A/B execution 文件 + bake（同一场景项目内），再按位姿组装成整场 `.glb`（**静态路**） | **SCENE 编排（终段 = PART C）** | [executions/part-c-scene-assembly.md](executions/part-c-scene-assembly.md) |

> **SCENE 编排不是独立的第四套流程**，而是**包裹 A/B 逐件建模 + PART C 终段组装**的编排循环。
> 场景里的每个 unique item 仍先经 A 或 B 建模并 bake；PART C 是这套编排的**最终组装阶段**——把
> 这些已 bake 的 mesh 按算好的位姿摆进 DSL。**无 joint 的场景走静态路**（`g_to_scene`），前端逐条
> 加载 mesh + 套位姿/材质合并成**单个多材质 `.glb`**；不再用 URDF auto-stitch 缝根。

## 三、各 PART 一句话提要（细节进 execution 文件；共同的「列清单+逐件建模」见上方🔑）

- **PART A · 资产 / 机械** → [part-a-asset.md](executions/part-a-asset.md)：逐件 `bake` 成 `<sha>.obj`
  → 阶段2 `mesh(filename=...)` → `part` → `material` →（机械件才 `joint`）组装。有 `joint` 走 URDF 路，
  无 joint 走静态路。
- **PART D · 角色 / 生物** → [part-d-character.md](executions/part-d-character.md)：逐件 `bake` 成
  `<sha>.obj`（同 A）→ 组装时 `mesh` 引用 + **你亲手写 `bone`/`skeleton` 建骨架**（父子按解剖，四肢挂中轴骨、
  绝不腿挂腿）→ 一行 `skin(method="auto")` 自动蒙皮 → `animation`（通道键=骨骼名）K 帧 → 导出 `mode="character"`。
  终端 `g_bake_object` 会**把引用的各 `<sha>.obj` 回读合并成一张可蒙皮网格**，所以照 A 分件 bake 即可、不必内联。
  **骨架你写、只有蒙皮权重自动**（前端测地体素绑定，对分离/有缝 part 鲁棒）。
- **PART B · 建筑** → [part-b-building.md](executions/part-b-building.md)：Architecture 家族
  （`g_wall`/`g_floor_slab`/`g_stairs`/`g_roof`/`g_window`/`g_door`/`g_railing`/`g_column`）是默认、
  裸 `g_box` 是例外；无整栋编排器，逐条元件 `part` 包壳后 `joint`（门窗扇 `revolute`）拼到单一根件。
- **SCENE 编排（终段 = PART C）** → [part-c-scene-assembly.md](executions/part-c-scene-assembly.md)：
  先列详细场景清单、逐件走 A/B 建模 + bake（**必须同一场景项目内**，blob 库内容寻址才能稳定引用），
  再每实例 `g_mesh(<sha>.obj)` → `g_part(origin/rpy/material)` 摆位——**不写 joint、走静态路**合成一个
  多材质 `.glb`。⚠️ **别用 `g_translate`/`g_array_*` 给引用 mesh 摆位**（会重烘毁掉实例化）；大量复用 =
  同一 `<sha>.obj` + 多个不同 origin 的 `g_part`。多色整体物件可用 `g_bake_object` 烘成一个带色 `<sha>.glb`。

## 四、共享参考（按需读取，不要一次全读）

一次标准建模只需要：**对应的 execution 文件（A/B/C/D）+ 它顶部链接的 op-directory 分片 +
[dsl-quickref.md](dsl-quickref.md)**。其余仅在需要时才查。

| 何时读 | 内容 | 文件 |
|---|---|---|
| **必读** | op 签名家族索引（authoring SSOT，链到分片） | [op-directory.md](op-directory.md) |
| **必读** | DSL 语法速查（grammar + 值类型 + 最小示例 + 铁律） | [dsl-quickref.md](dsl-quickref.md) |
| 选型拿不准时 | 家族列表 + 路由表 | [battery-catalog.md](battery-catalog.md) |
| 忘了流程时 | DSL-first 工作流 + 回执/QC 循环 | [quickstart.md](quickstart.md) |
| A/D 写 Phase 0 清单或反 primitive 纪律时 | 拆件清单字段规范 + 反 primitive 规则（A/D 共用，一处改全处生效） | [shared-conventions.md](shared-conventions.md) |

**op-directory 按家族分片**（[op-directory.md](op-directory.md) 索引页有完整表格），各 execution
文件顶部只链接自己要用的那几个，别把全部家族都读一遍：

| 分片 | 覆盖 | 谁用 |
|---|---|---|
| [op-directory/core.md](op-directory/core.md) | Profile + CSG + Transform + 基础 primitive（含 `rock`） | A / B / D 都要（任何真实建模的地基） |
| [op-directory/parts-mechanical.md](op-directory/parts-mechanical.md) | Parts（把手/铰链/风扇/面板…）+ 全部齿轮 | A 常用；B 点缀装饰件时按需 |
| [op-directory/architecture.md](op-directory/architecture.md) | 墙/楼板/楼梯/屋顶/窗/门/栏杆/柱 | 仅 B |
| [op-directory/rig-character.md](op-directory/rig-character.md) | `bone`/`bone_chain`/`skeleton`/`skin` | 仅 D |
| [op-directory/assembly-misc.md](op-directory/assembly-misc.md) | `part`/`joint`/`material` + collision/inertial/animation/texture | A / B / C / D 组装收尾都要 |

⚠️ **旧格式背景资料**（`modeling-guide.md` / `pipeline-schema.md`）已迁出 agent 读取路径，存档在
`docs/superpowers/archive/`（人工历史查阅用，非 DSL、别照它的 `createNode` 格式写）。

**最常踩的三条铁律**（展开与依据见顶部「Token 纪律」）：

1. **op 名 / 参数以 [op-directory.md](op-directory.md) 及其分片为权威、绝不凭记忆编**——它由
   op-registry 自动生成，覆盖全部 op 签名；`model.apply` 回执会对未知 op / 参数错误**报出具体 DSL
   行号**。
2. **只写 DSL、交给 `model.apply`**：编译器按 op→电池映射自动建图连线、自动追加 QC/URDF 终端节点；
   遇到映射表外的 op 会显式报错（带行号），不会静默降级。不要手写 `createNode`/`connect`。
3. **两阶段，不堆 mega-model**：把整个物件/场景写进一坨 DSL 必然退化成方块拼接。PART A 每件单独建模、
   `g_bake_part` 烘成 `<sha>.obj`（`parts.list` 可查），阶段2 再用 `mesh(filename=...)` 引用组装。
