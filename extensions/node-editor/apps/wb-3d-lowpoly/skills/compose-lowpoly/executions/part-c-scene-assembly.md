# PART C · 场景编排与组装（SCENE 编排的终段）

> [SKILL.md](../SKILL.md) 的**意图分诊**把「场景 / 城市 / 多物体 + 建筑的空间组合」路由到此。
> 本文件是 **SCENE 编排**的完整执行步骤——它**包裹** [PART A](part-a-asset.md) /
> [PART B](part-b-building.md) 的逐件建模，再以本文件的**组装阶段**收尾。
> 授权参考：DSL 语法 [dsl-quickref.md](../dsl-quickref.md)、op 签名——组装阶段只需
> [core](../op-directory/core.md)（`mesh`）+ [assembly-misc](../op-directory/assembly-misc.md)
> （`part`/`material`），逐件建模阶段的分片由你打开的 A/B execution 文件各自链接；
> 选型拿不准再查 [battery-catalog.md](../battery-catalog.md)。按需读取，别一次全读。

> **DSL-first（读这条，覆盖下方旧写法）**：逐件建模 + 烘焙用 `lowpoly:model.apply({ source, bake })`
> （每件 `baked.filename`=`<sha>.obj`，`lowpoly:parts.list` 可查）。**组装阶段只写 DSL**：每实例
> `mesh(filename="<sha>.obj", bbox_min=..., bbox_max=...)` → `part(origin=位姿, rpy, material=...)`，
> **不写 joint**。无 joint 的场景 DSL **走静态路**（终端 `g_geometry_qc → g_to_scene → scene_preview`）：
> `g_to_scene` 从每个 mesh-ref part 读 filename + 位姿 + 颜色装成 `SceneSpec`，前端逐条加载合并、导出为
> **单个多材质 `.glb`**（`export-glb mode="static"`）——**不再走 URDF auto-stitch**。一次 `model.apply`
> 收尾。大量同款复用 = **同一 `<sha>.obj` + 多个不同 origin 的 `part`**（别用 `translate`/`array_*` 摆位，
> 会重烘）。完成判定看回执——`meshQc` 穿模才是硬信号（`mesh` 必须带 `bbox_min/max`）。语法见
> [dsl-quickref.md](../dsl-quickref.md)，op 签名见 [core](../op-directory/core.md) /
> [assembly-misc](../op-directory/assembly-misc.md)。

适用：用户要的不是单个物件，而是**多个各自独立的物体 / 建筑共处一个环境**——一条街、一个村子、
一座小城、一片柱列 + 道具阵、一整个小院落。SCENE 编排是一个**单 agent 内部循环**：
**先列场景清单 → 逐个 unique item 走 A/B 建模 + bake → 最后按位姿把它们摆进一段无 joint 的 DSL（走
静态路 `g_to_scene`）、合并导出整场 `.glb`**。

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
- **记完账就 `deleteNode` 删掉这个 item 的建模子图**（级联删边）：往后只需要记下的
  `<sha>.obj`/`<sha>.glb` filename + bbox，不必把每件的搭建子图留在场景项目图里。这样分发循环里
  unique item 再多，场景项目的图也不会越堆越大——组装阶段从一张干净的图起步。
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
> 不是一次 live viewer 实跑。真要跨项目用，建议先用一个真实 `<sha>.obj` 跑一遍组装阶段（阶段4），
> 看回执 `meshQc.meshResolved` 是否解析到该 mesh，确认引用有效后再批量摆放。

## 组装阶段限制：OBJ 不带材质 → 颜色是「每 part 一种」（多色物体要分件 bake）

`g_bake_part` 烘的是**纯几何 OBJ**，不带任何材质/颜色（baker 不写 `usemtl`/`vt`）。颜色只在组装阶段
用 `g_material` / `g_named_color` 加在 **引用它的 `g_part`** 上——静态路的 `g_to_scene` 把每个 mesh-ref
part 的颜色读成该 `SceneSpec` item 的 `rgba`，而 **一个 mesh-ref part 只承载一种颜色**。所以：

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

> **关键约束（否则串色）：**
> - **路线 A 首选用"真形状"的 part 直接烘**（跳过 OBJ 暂存、整只物体一次烘成带色 GLB）。`g_bake_object`
>   **现在也接受 `g_mesh` 引用的预烘 `<sha>.obj`**（会回读该 blob 的三角面、按 part 位姿合并、颜色取该
>   part 的 `g_material`，缺省灰）——所以"分件 `g_bake_part` → 引用组装再整组烘"也能出带色 GLB。仍**只支持
>   `<sha>.obj`**，别把另一个 `g_bake_object` 的 `<sha>.glb` 再喂进来。
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
  → 各配一次 `g_material`。这几个 part 各自成为一个 `SceneSpec` item，共同组成"这一件物体"。
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

地面根：用 `g_box`（薄板当地面）或建筑场景用 PART B 的 `g_floor_slab` 当一个普通实例。**场景走静态路，
实例之间无需任何 joint**——每个 mesh-ref `g_part` 就是 `g_to_scene` 眼里的一个独立 `SceneSpec` item，
位姿直接取自它自己的 `origin`/`rpy`（不再有"根树"概念）。

地形/瓦砾装饰件（岩石、石堆、碎石）**用 `g_rock`（DSL `rock`/`boulder`）而不是 `g_sphere`**——不同
`seed` 一次生成多个不重复的不规则外形，无需单独 bake（不是 replicad 实体，可直接当 primitive 摆位）；
但它是三角网格产物，**不能**参与 `union`/`difference`/`intersection`。

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
- `mesh` 的参数名查 [core](../op-directory/core.md)；`part`（`origin` / `rpy`）/ `material` 查
  [assembly-misc](../op-directory/assembly-misc.md)（**绝不凭记忆编**）；要读当前 DSL 用
  `lowpoly:model.get`。

## 阶段4 · 搭场景图（一段干净 DSL，走静态路）

按布局清单**重写一段干净的几何 DSL**。**默认配方：每实例 `g_mesh → g_part(origin=位姿, rpy,
material)`，不写 `g_joint_fixed`**。无 joint 的 DSL 自动走**静态路**（`g_geometry_qc → g_to_scene →
scene_preview`）——`g_to_scene` 把每个 mesh-ref part 装成 `SceneSpec` item：

1. **每个实例**（包括地面板 `g_box` / `g_floor_slab`，也只是一个普通实例，无需当"根"）：
   - `g_mesh(filename=<sha>.obj 或 <sha>.glb, sx/sy/sz=…, bbox_min=…, bbox_max=…)` 引用 mesh
     （viewer 支持 `.obj` / `.glb` / `.gltf`）。**`bbox_min`/`bbox_max` 直接接 `g_bake_part` /
     `g_bake_object` 的同名输出**——填了 mesh 才能解出 AABB、QC overlap 才生效（见阶段2）。
   - `g_part` 包成一个 scene item，**位姿写在这个 `g_part` 自己的 `origin`（xyz）/ `rpy` 上**——填阶段2
     按 bbox 算出来的坐标（底面落地 `z=-bbox_min.z*sz`、间距、朝向）。`g_to_scene` 把它读成该 item 的
     `origin`/`rpy`/`scale`。
   - `g_material` / `g_named_color` 给这个实例配色（引用 `<sha>.obj` 时**必做**，OBJ 无材质）——被读成
     该 item 的 `rgba`。**例外**：若引用的是 `g_bake_object` 的 `<sha>.glb`（自带多色），**这个 `g_part`
     不要上 material**，否则会覆盖内嵌色。
   - **不连 `g_joint_fixed`**：静态路每个 mesh-ref part 本就是独立的一件，无需缝根。
     （真正有机构联动的子装配——比如一扇会开的门——那是 PART A 机械件、走 URDF 路，不属于静态场景。）
2. **重复**直到所有实例都建好。同款复用 = **同一 `<sha>.obj` + 多个不同 origin 的 `g_part`**。
3. **一次 `model.apply({ source })`**：编译器自动追加 QC + 静态终端（`g_to_scene`），回执 `mode:"static"`、
   `scene.items`/`scene.fingerprint`，并把信号定位到 DSL 行号。完成判定看回执的 QC structured signals：
   - **`aabb_overlap` / `mesh_overlap`（note/warning，不 fail valid）**：rest pose 下 AABB 互穿在低模里
     很常见（墙角/T 形接头/嵌框/落地贴合）。**默认忽略 `note`；`warning` 视情况审查**（用 `g_metrics`
     `max_penetration`/`overlap_ratio` 判断是真穿模还是保守误报）。只有明显错位/大体积穿模才回去改
     `g_part` origin / 布局步距。
   - **静态路无 `islands` / `floating_links` 判据**：不再有 URDF 根树，每个 mesh-ref part 就是一件，
     不会被报孤岛，也无需加 joint 缝根。
4. **导出整场**：确认回执 `ok:true`、无 **error** 级信号（`missing_aabb` 等）、`scene.items` 符合预期之后，
   **用户要成品文件时**才 `lowpoly:export-glb({ mode: "static" })`（`name` = 输出文件名，落到项目
   `assets/3d/<name>.glb`；静态路把各 item 合并成单个多材质 GLB）。

组装是一次 `model.apply({ source })`——回执把错误/QC 信号定位到 DSL 行号，读回执即可，不必额外拉图。
布局不对**只调 `part` 的 origin / rpy / 配色**——别回头改 mesh 内部几何（那要回 PART A/B 重 bake）。

> ⚠️ **重烘陷阱：别用 transform / 阵列给引用 mesh 摆位。** `g_translate` / `g_rotate` / `g_scale` /
> `g_array_linear` / `g_array_radial` 都在 `SUBGRAPH_BAKE_OPS` 里——**它们会把每个实例重新烘成一个
>全新的 OBJ**，彻底毁掉实例化（一城 200 栋同款楼 = 烘 200 次）。所以场景里**摆位一律靠 `g_part` 的
> origin / rpy**，大量同款复用一律「同一 `<sha>.obj` + 多个不同 origin 的 `g_part`」。规则化布局
> （等距网格、环形）可以用 `g_array_*`，但要清醒它会重烘——城市级大量复用时优先 origin 方案。

## 迭代

**完成判定看 `g_geometry_qc` 的 structured signals**（静态路：overlap 当信息信号，只有明显穿模才修）：
对照 brief 用 bbox/size 核对每个实例的摆位、间距、朝向、配色。明显穿模/悬空 → 改 `g_part` origin /
布局步距 / 落地高度。静态路无 `floating_link`/`islands` 判据（无 URDF 根树）。
要换某个件的造型 → 回 [PART A](part-a-asset.md) /
[PART B](part-b-building.md) 重建 +
重 bake 那一个，filename / bbox 变了再回这里把对应 `g_mesh` 的 `filename` 与
`bbox_min`/`bbox_max` 一起换掉。

场景层迭代分两层：**先逐件**（unique item 各自在 A/B 里建对、bake 对），**再整场**（组装后看整场
QC）。先把单件建对，再谈全场摆位，别在场景图里反复试探单件造型。

---

## Deferred · 未来的场景级电池（不在本次实现）

现在每个实例都要写一组 `g_mesh → g_part(origin)` 样板。未来可新增**场景级电池**
（`g_scene_root` / `g_place` / `g_scatter`）把「mesh + 一串位姿 → 自动出多个 link」一口吃下，连
`g_part` 样板都省掉——但那要动 backend（新增电池 + baker），**本次只做文档、不实现**。在那之前，
场景层一律按上面的 `g_part` origin 配方手摆。
