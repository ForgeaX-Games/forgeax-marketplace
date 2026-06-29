# PART C · 场景编排与组装（SCENE 编排的终段）

> [SKILL.md](../SKILL.md) 的**意图分诊**把「场景 / 城市 / 多物体 + 建筑的空间组合」路由到此。
> 本文件是 **SCENE 编排**的完整执行步骤——它**包裹** [PART A](part-a-asset.md) /
> [PART B](part-b-building.md) 的逐件建模，再以本文件的**组装阶段**收尾。
> 共享参考：op 写法 / 图结构见 [pipeline-schema.md](../pipeline-schema.md)；电池速查见
> [battery-catalog.md](../battery-catalog.md)；各家族页见 [modeling-guide.md](../modeling-guide.md)。

适用：用户要的不是单个物件，而是**多个各自独立的物体 / 建筑共处一个环境**——一条街、一个村子、
一座小城、一片柱列 + 道具阵、一整个小院落。SCENE 编排是一个**单 agent 内部循环**：
**先列场景清单 → 逐个 unique item 走 A/B 建模 + bake → 最后按位姿把它们摆进同一棵 URDF 树并导出
整场 `.glb`**。

> **这不是「纯组装」**——它前面包着完整的逐件建模（A/B）。真正「不建新几何」的只有**最后的组装
> 阶段**：那一段只引用现成 `<sha>.obj`、给每个实例摆位姿、补色、QC、导出。要新增 / 修改某个件的
> 几何，回 PART A / PART B 重建并重新 bake。

> **本 PART 的核心是摆放的合理性与正确性。** 一堆漂亮的件随手堆在一起、互相穿插、悬空、比例错乱，
> 比单个件建得糙更糟。摆位必须**按真实尺寸算出来**，不能拍脑袋：每个件先拿到它的
> `bbox_min/bbox_max/size`（来自 `g_bake_part` 的同名输出），据此算底面落地、相邻间距、朝向、
> 不互相穿插，位姿（`g_part` 的 origin / rpy）填**算出来的坐标**。把 bbox 填进 `g_mesh` 后，末端
> `g_geometry_qc` 才能对 mesh 解出 AABB、真正跑 overlap 检测——这是验收摆放的硬信号（见下方
> 「按 bbox 摆位纪律」）。

---

## 阶段-2 · 场景 brief（动手前先想清）

和单件的「拆件清单」对应，场景动手前先写一段**场景 brief**，定下全局约束：

| 字段 | 说明 |
|---|---|
| 意图 / 主题 | 这是什么场景（中世纪集市、赛博街角、农家院落…）、给谁用、什么气氛 |
| 整体尺度 | 场景总体多大（米），主物体的参考尺寸，用来定相对比例 |
| footprint | 场景占地范围（如 40×40m），以及地面 / 地形怎么表示（薄板地面？分区？） |
| 布局范式 | **grid（网格）/ 街道网（street network）/ cluster（聚簇）/ scatter（散布）** 之一或组合——决定后面位姿怎么算 |

布局范式直接决定位姿算法：grid → 等距行列；街道网 → 沿路中线两侧排布；cluster → 几个中心点周围
成团；scatter → 在 footprint 内按密度随机但不穿插。先定范式，位姿才有章法可循。

## 阶段-1 · 场景清单（每个 item 一段详细描述）

按 brief 列一张**场景清单**——这是 SCENE 编排的硬门禁（对应单件的拆件清单）。**关键：每个 item 不是
一行字，而是一段含真实形态的详细描述**。一行流水账（「房子、树、路灯」）会让单件细节在场景里整体
流失——细致度要对齐 PART A 的拆件清单。每个 item 至少写清下面这些字段：

| 字段 | 说明 |
|---|---|
| item 名 | 可读名（`house_a` / `pine_tree` / `street_lamp` …） |
| 走 A 还是 B | 单物件 / 机械 → **PART A**；建筑 / 房屋 / 构件 → **PART B** |
| **真实形态描述** | **2~3 句**讲清这件东西长什么样：整体轮廓、主要结构 / 分件、关键细节特征（屋顶类型、窗格、枝叶层次、灯头造型…）、材质质感。这是保住单件细节的关键——描述写不细，建模阶段就没有可对齐的目标 |
| **目标尺寸** | 该 item 的目标尺寸（米，带轴：长×宽×高），用来和别的 item 对比例 |
| 数量 | 这种 item 在场景里出现几份 |
| **实例化复用** | 这数量份是不是**同一个 `<sha>.obj` 摆 N 份**（强烈推荐）？还是各不相同需各建各的？ |
| 落位 / footprint | 大致摆在哪、占多大地方（配合布局范式） |

> **失败清单判据**：如果某个 item 只有「名字 + A/B + 数量」而没有 2~3 句真实形态描述和目标尺寸，
> 这份清单就**不合格**，回去补细——别带着一行流水账进分发循环，否则每个 unique item 建出来都会是
> 缺细节的方块壳。

**用复用控制面数预算**：城市级场景里「200 栋同款楼」绝不是建 200 次，而是建 **1 个** `<sha>.obj`、
摆 200 个不同 origin 的 `g_part`。清单里先圈出哪些 item 可以这样复用——这是场景能不能跑得动的关键。
真正需要逐个建模的，只有**unique**（造型互不相同）的那几种 item。

## 阶段0 · 分发循环（单 agent 逐件建模 + bake，全部在同一场景项目里）

**先 `lowpoly:projects.open`（或 `projects.create`）打开你的场景项目**，然后按场景清单，对每个
**unique** item（不是每一份实例！）跑一遍逐件建模——**全部就在这个场景项目里 bake**：

- 走 PART A 的 item → **先 `read` [part-a-asset.md](part-a-asset.md)**，照它的两阶段建模纪律单独
  建一轮 + `g_bake_part` 烘成 `<sha>.obj`。
- 走 PART B 的 item → **先 `read` [part-b-building.md](part-b-building.md)**，照它的 Architecture
  流程建模 + bake。
- 每烘出一个 unique item，**记下它的 `<sha>.obj` filename + `bbox_min`/`bbox_max`/`size`**——
  组装阶段摆位和填 `g_mesh.bbox_*` 都要用。
- **多色 item 有两条路**（详见下方「组装阶段限制」）：①**首选 `g_bake_object`**——把 item 的各 part
  用**真形状**建在一个图里 + 各配 `g_material`，整组烘成**一个带色 `<sha>.glb`**，场景里当一个 mesh 摆
  （引用它的 `g_part` 不要再上 material；**别先 `g_bake_part` 成 OBJ 再喂**）；适合配色固定、整体复用。
  ②配色多变 / 要同款换色的，按颜色分区各 `g_bake_part` 成多个 `<sha>.obj`，组装阶段每件各上一次
  `g_material`。**别把多色物体烘成单个无色 OBJ**（那在场景里只会是一个颜色）。
- **复用的 item 只建一次**：同款的 N 份共用同一组 `<sha>.obj`，循环里不重复建。

> **硬默认 · 同项目 bake**：本循环里所有 unique item 都**在同一个场景项目内 bake**——blob 库是
> workspace 级、内容寻址，同项目 bake 出的 `<sha>.obj` 阶段4 直接 `g_mesh` 引用得到，最稳。**不要
> 把不同物体分散到不同项目里 bake**。（确需跨项目复用别处已 bake 的件，见下方「进阶注脚」，但默认
> 走同项目。）

这是个**单 agent 的内部循环**（不分发子任务）：开场景项目 → 列清单 → 逐个 unique item `read`
execution 文件并建模 bake → 记账 → 进入下面的组装阶段。

---

## 进阶注脚：能不能跨项目引用别处已 bake 的 `<sha>.obj`？

**默认不需要看这一节**——按上面的硬默认，所有 unique item 都在同一个场景项目里 bake，阶段4 直接
在本项目 `g_mesh` 引用即可。这一节只解决一个进阶场景：你想复用**别的项目**早先 bake 出来的件。

**结论（已核对后端源码，可在同一后端实例下放心跨项目引用）：** 烘焙出的 mesh 是
**workspace 级、内容寻址**的 blob，可被同一后端实例下的任意项目解析。依据：

- 后端的 library blob 存储是**进程级单例**，绑定在 `<FORGEAX_PROJECT_ROOT>/library`
  （`backend/src/runtime.ts`），而 `FORGEAX_PROJECT_ROOT` 就是整个 workspace 根
  （`ProjectRegistry.workspaceRoot`）。用 `lowpoly:projects.create` 建的每个「项目」都活在这一个
  registry 里，**共享同一个 blob 库**。
- blob 按内容哈希落盘（`library/blobs/{sha[0:2]}/{sha[2:4]}/{sha}`），由
  `GET /api/v1/library/blob/:sha256` **纯按 sha 返回，和当前激活哪个项目无关**。
- viewer 用 `baseUrl + '/' + filename` 取 mesh，`baseUrl = /api/v1/library/blob/`。

所以在某个项目里 bake 出的 `<sha>.obj`，在另一个「场景」项目里用 `g_mesh(filename=<sha>.obj)`
也能引用得到。**前提：** 源项目和场景项目必须由**同一个后端实例（同一个 `FORGEAX_PROJECT_ROOT` /
workspace）**服务。若部署给不同项目起了不同后端实例（不同 `FORGEAX_PROJECT_ROOT`），blob 不互通
——此时**没有任何理由跨项目**，老老实实回到同项目 bake 默认即可。

> 注：跨项目可行性结论来自后端源码核对（singleton library + content-addressed blob route），
> 不是一次 live viewer 实跑。真要跨项目用，建议先用一个真实 `<sha>.obj` 跑一遍组装阶段（阶段4）+
> `urdf_preview` 截图确认 mesh 真的渲染出来了，再批量摆放。

## 组装阶段限制：OBJ 不带材质 → 颜色是「每 part 一种」（多色物体要分件 bake）

`g_bake_part` 烘的是**纯几何 OBJ**，不带任何材质/颜色（baker 不写 `usemtl`/`vt`）。颜色只在组装阶段
用 `g_material` / `g_named_color` 加在 **URDF link 的 `<material>`** 上——而 **URDF 一个 visual / 一个
link 只能挂一种材质**。所以：

> **一个 `<sha>.obj` = 一个 `g_part` = 一种颜色。** 想"先把颜色烤进 mesh 再 bake"是行不通的——bake
> 一定把材质丢掉。

这就是为什么"整只物体烘成一个**单材质 OBJ** mesh"在场景里**只有一个颜色**。有两条路让一件物体身上
带多种颜色，按场景需求二选一：

### 路线 A（推荐做"造型+配色固定、整体复用"的物体）：`g_bake_object` 带色烘成多材质 GLB

把物体的各 part **用真形状（primitive / CSG / Parts / composite）直接建在一个图里**、每个 `g_part`
配 `g_material`，然后**整组喂给 `g_bake_object`**——它逐 part 三角化、把颜色按 part 内嵌进**单个
`<sha>.glb`**（多材质 GLB），返回 filename + bbox。场景里就当**一个 mesh**摆：

```
g_box/g_cylinder/g_revolve/g_knob…（各 part 的真形状） → g_material(各自颜色)
  → g_part(shape, material, origin/rpy) ×N                ← part 引用真形状，不是 g_mesh
  → g_bake_object  → <sha>.glb (+ bbox)
场景项目里：g_mesh(filename=<sha>.glb, bbox) → g_part(origin=物体落位)  ← 这个 g_part 不要再上 material！
```

> **关键约束（否则报错 / 串色）：**
> - **`g_bake_object` 吃的是"真形状"的 part，不是 `g_mesh` 引用。** 不要先用 `g_bake_part` 把各 part
>   烘成 `<sha>.obj` 再喂——那是路线 B 的接法，`g_bake_object` 遇到 `mesh` part 会直接报错（mesh 已是
>   烘好的三角面、无法再细分、也没有颜色源）。路线 A 就是"跳过 OBJ 暂存、整只物体一次烘成带色 GLB"。
> - **引用 `<sha>.glb` 的 `g_part` 不要再上 `g_material`。** GLB 自带每-part 颜色，viewer 只有在该 link
>   **没有** material 时才保留内嵌色；一旦上了 link material 就会把整只物体重新刷成那一种颜色。
> - **只适合静态物体**：`g_bake_object` 把各 part 的位姿烘进顶点、合成一个静态 mesh，**不保留可动关节**。
>   带联动关节的物件别走路线 A（那本就是 PART A 装配体，不是场景道具）。
>
> 取舍：颜色进了内容哈希 → **同款不同配色 = 不同 `<sha>.glb`、不去重**，也不能"同款临时改色"。所以
> 路线 A 适合"配色固定、整体大量复用"的物体（树、路灯、同款车）。需要"同款几何 + 每实例换色"时走路线 B。

### 路线 B（推荐做"同款几何、配色多变"的物体）：分件 bake + 组装阶段各自上色

**必须按颜色把它拆成多个件分别 `g_bake_part`**，再在组装时各自上色：

- **多色物体 = 多个 baked 件**：在 PART A/B 里就把物体按**颜色分区**拆件（车身 / 车窗 / 轮胎；屋顶 /
  墙体 / 门窗…），**每个颜色区各自 `g_bake_part` 成一个 `<sha>.obj`**（记各自的 bbox）。不要把整只物体
  塞进一个 `g_bake_part`——那只会得到一坨单色几何。
- **组装时按件上色**：该物体的每个 `<sha>.obj` → `g_mesh` → `g_part`（origin 用件在物体内的相对位姿）
  → 各配一次 `g_material`。这几个 part 共同组成"这一件物体"，靠 auto-stitch 缝在一起。
- **实例化照旧成立**：同款多色物体复用时，是**这一组 `<sha>.obj`**整组复用——每份实例按物体基准 origin
  平移即可，单件仍只烘一次。
- **单色物体才一个 mesh**：确实通体一个颜色的物体（一根原木柱、一块石头），整只烘成一个 `<sha>.obj`
  + 一个 `g_material` 就够。

同一个 `<sha>.obj` 摆多份、想要不同颜色（比如同款楼染成不同墙色），给每个实例的 `g_part` 各配一次
`g_material` 即可（几何复用、颜色各异）。

---

## 阶段1 · 实例布局清单（组装动手前必做）

阶段-1 的场景清单是 **item 级**（哪种东西、几份、能不能复用）；这里的布局清单是 **实例级**——把每一份
要落地的实例展开成一行，列清它的最终位姿：

| 字段 | 说明 |
|---|---|
| 实例名 | 稳定可读的 nodeId 前缀（`pillar_01` / `house_a_03` …） |
| 引用 mesh | 哪个 `<sha>.obj`（来自阶段0 的 bake 记录或 `lowpoly:assets.list`） |
| bbox / size | 该件未缩放局部 AABB `bbox_min`/`bbox_max` 与 `size`（米）——来自 `g_bake_part` 输出，**记下来用于算摆位** |
| 位置 (x,y,z) | 米；该实例 `g_part` 的 **origin** 坐标，**按 bbox 算出来**（见下），不是拍脑袋 |
| 旋转 (rpy) | 弧度；该实例 `g_part` 的 **rpy**；没有就 0 0 0 |
| 缩放 (sx,sy,sz) | 写在 `g_mesh` 上；默认 1 |
| 配色 | 引用 `<sha>.obj` 时：该实例的 `g_material` 颜色（OBJ 无材质，必填）。引用 `g_bake_object` 的 `<sha>.glb` 时：**不要**上 `g_material`（颜色已内嵌） |

**实例化复用是这里的主力**：同款的 N 份**共用同一个 `<sha>.obj`**，只是每行 origin / rpy 不同——
一栋楼建一次、摆 200 个 `g_part`。**不要**为「摆位」去 transform / 阵列引用 mesh（见下方重烘陷阱）。

地面根：用 `g_box`（薄板当地面）或建筑场景用 PART B 的 `g_floor_slab` 当根 link。**场景模式下其余
实例不必显式连 joint**——`g_to_urdf` 的 auto-stitch 会把无 joint 的根 part 自动用 fixed joint 缝成
单一根树（位姿已经在每个 `g_part` 自己的 origin 上了）。

## 阶段2 · 按 bbox 摆位纪律（摆放正确性的核心）

每个件烘焙时 `g_bake_part` 会返回 `bbox_min` / `bbox_max` / `size`（米，未缩放的局部 AABB）。
摆位**全部据此计算**，`g_part` 的 origin 用算出来的坐标：

- **底面落地**：件的局部最低点是 `bbox_min.z`。要让它正好踩在地面（z=0）上，`g_part` origin 的
  `z = -bbox_min.z * sz`（有缩放就乘 `sz`）。不要把件埋进地里或浮在半空。
- **相邻间距 / 不互相穿插**：相邻两件中心距 ≥ 各自半宽之和（`size/2 * 缩放`）再留点缝。成排成网格
  按布局范式的步距 ≥ 单件对应轴 `size` × 缩放，避免相邻实例 AABB 互相穿插。
- **朝向**：先想清楚件的局部前向/轴向（PART A/B 的家族约定），再用 rpy 摆正，让朝向符合场景逻辑
  （门朝外、楼梯朝上、车头朝前）。
- **符合物理与场景逻辑**：物体落在地面而不是穿过它；栏杆/护栏贴边沿布置；柱子等距成列；道具不叠在一起。
  这些都能用 bbox/size 算出确定坐标。
- **把 bbox 填进 `g_mesh`**：组装阶段给每个 `g_mesh` 填 `bbox_min` / `bbox_max`（直接接 `g_bake_part`
  的同名输出即可）。**只有填了 bbox，场景里的 mesh 才能解出 AABB**，末端 `g_geometry_qc` 的
  `aabb_overlap` 检测才会生效；不填则每个件判 `missing_aabb`、整段 overlap 检测被跳过，穿模根本不会被报出来。

## 阶段3 · 盘点可用 mesh

- `lowpoly:projects.open` 打开（或 `projects.create` 新建）**场景项目**。
- `lowpoly:assets.list` 列出已 bake 的 mesh / blob，核对每个要用的 `<sha>.obj` filename 真实存在。
- 默认（同项目 bake）：filename 取自阶段0 在本项目的 bake 返回值，也能在当前项目 `assets.list` 里查到；
  进阶（跨项目引用，见上方注脚）：filename 取自源项目的 bake 返回值。
- **同时记下每个件的 `bbox_min` / `bbox_max` / `size`**（`g_bake_part` 输出）——摆位与填
  `g_mesh.bbox_*` 都要用。
- `lowpoly:batteries.get` 把 `g_mesh` / `g_part`（确认 `origin` / `rpy` 端口名）/ `g_material` 的
  端口名查清（**绝不凭记忆编**），`lowpoly:pipeline.get` 读现状。

## 阶段4 · 搭场景图（一段干净 DSL）

按布局清单**重写一段干净的几何 DSL**。**默认配方：每实例 `g_mesh → g_part(origin=位姿, rpy,
material)`，不写 `g_joint_fixed`**，靠 auto-stitch 成树：

1. **建场景根**：`g_box`（薄地面板）或 `g_floor_slab` → `g_part`（root link，origin 在原点）。
2. **每个实例**：
   - `g_mesh(filename=<sha>.obj 或 <sha>.glb, sx/sy/sz=…, bbox_min=…, bbox_max=…)` 引用 mesh
     （viewer 支持 `.obj` / `.glb` / `.gltf`）。**`bbox_min`/`bbox_max` 直接接 `g_bake_part` /
     `g_bake_object` 的同名输出**——填了 mesh 才能解出 AABB、QC overlap 才生效（见阶段2）。
   - `g_part` 包成 link，**位姿写在这个 `g_part` 自己的 `origin`（xyz）/ `rpy` 上**——填阶段2 按 bbox
     算出来的坐标（底面落地 `z=-bbox_min.z*sz`、间距、朝向）。它会直接渲染成 link 的
     `<visual><origin>`。
   - `g_material` / `g_named_color` 给这个实例配色（引用 `<sha>.obj` 时**必做**，OBJ 无材质）。
     **例外**：若引用的是 `g_bake_object` 的 `<sha>.glb`（自带多色），**这个 `g_part` 不要上 material**，
     否则会把整只物体刷成单色。
   - **不连 `g_joint_fixed`**：导出端 auto-stitch 会把这些无 joint 的根 part 缝成单一根树。
     （真正有机构联动的子装配——比如一扇会开的门——才在那个子装配内部用 `g_joint_*`；场景层级的
     纯摆放不用。）
3. **重复**直到所有实例都建好。同款复用 = **同一 `<sha>.obj` + 多个不同 origin 的 `g_part`**。
4. **QC + 导出**：`g_geometry_qc` → `g_validate` → `g_to_urdf` → `urdf_preview` →
   `lowpoly:screenshot.capture` 看整场。读 QC structured signals：
   - **`aabb_overlap`（warning，硬信号）**：rest pose 下相邻件 AABB 互相穿插——只要 `g_mesh` 填了
     bbox 就会报出来。有 overlap 就回去**改对应 `g_part` origin / 布局步距**（拉开间距、修落地高度），
     重跑 QC，直到不再报穿模。**这是场景模式下最该看的信号。**
   - **`islands` / `floating_links` 可忽略**：场景模式丢了 joint 后，N 个无 joint 的 part 会被
     `g_geometry_qc` 报成 N 个孤岛——这是**纯噪声**，导出端 auto-stitch 已经把它们缝进同一棵树。
     别为消掉 islands 去乱加 joint，那只会把场景层级的位姿搬错地方。
   - Phase 全是 `g_mesh` 引用，`g_to_urdf` 应报 `bakeFallbacks=0`、`report.meshFileCount=0`、
     `stats.meshProvenance` 全 `native`（不应重新 bake）。
5. **导出整场**：确认 QC 无穿模/错位、截图四视图也看过之后，才 `lowpoly:export-glb`（`name` = 输出
   文件名，落到项目 `assets/3d/<name>.glb`）。

每个阶段各自一个 `applyBatch`（`opts.actor="ai:lowpoly"` + 简短 `label`）+ `execute`；**每次
applyBatch 后立刻 `lowpoly:pipeline.get`** 确认 `nodes` 真变了（防「ok 却空」）。布局不对**只调
`g_part` origin / rpy / 配色**——别回头改 mesh 内部几何（那要回 PART A/B 重 bake）。

> ⚠️ **重烘陷阱：别用 transform / 阵列给引用 mesh 摆位。** `g_translate` / `g_rotate` / `g_scale` /
> `g_array_linear` / `g_array_radial` 都在 `SUBGRAPH_BAKE_OPS` 里——**它们会把每个实例重新烘成一个
>全新的 OBJ**，彻底毁掉实例化（一城 200 栋同款楼 = 烘 200 次）。所以场景里**摆位一律靠 `g_part` 的
> origin / rpy**，大量同款复用一律「同一 `<sha>.obj` + 多个不同 origin 的 `g_part`」。规则化布局
> （等距网格、环形）可以用 `g_array_*`，但要清醒它会重烘——城市级大量复用时优先 origin 方案。

## 迭代

复盘顺序：**先读 `g_geometry_qc` 的 structured signals（场景模式只盯 `aabb_overlap`，`islands` 当
噪声忽略），再看 `lowpoly:screenshot.capture` 返回的正交四视图 contact sheet**，逐视图对照 brief 看
摆位、间距、朝向、配色、有没有穿模/悬空。两者都过才算摆放正确。有穿模/错位 → 改 `g_part` origin /
布局步距 / 落地高度，重跑 QC + 截图，别只截一张就说没问题。要换某个件的造型 → 回
[PART A](part-a-asset.md) / [PART B](part-b-building.md) 重建 + 重 bake 那一个，filename / bbox
变了再回这里把对应 `g_mesh` 的 `filename` 与 `bbox_min`/`bbox_max` 一起换掉。

场景层迭代分两层：**先逐件**（unique item 各自在 A/B 里建对、bake 对），**再整场**（组装后看整场 QC +
四视图）。先把单件建对，再谈全场摆位，别在场景图里反复试探单件造型。

---

## Deferred · 未来的场景级电池（不在本次实现）

现在每个实例都要写一组 `g_mesh → g_part(origin)` 样板。未来可新增**场景级电池**
（`g_scene_root` / `g_place` / `g_scatter`）把「mesh + 一串位姿 → 自动出多个 link」一口吃下，连
`g_part` 样板都省掉——但那要动 backend（新增电池 + baker），**本次只做文档、不实现**。在那之前，
场景层一律按上面的 `g_part` origin 配方手摆。
