# PART C · 场景组装（复用已 bake 的 mesh）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART C** 的完整执行步骤。
> 共享参考：op 写法 / 图结构见 [pipeline-schema.md](../pipeline-schema.md)；电池速查见
> [battery-catalog.md](../battery-catalog.md)；各家族页见 [modeling-guide.md](../modeling-guide.md)。

适用：把 [PART A](part-a-asset.md) / [PART B](part-b-building.md) **已经建模并 bake 的 mesh**
当作道具库，把它们摆进**同一棵 URDF 树**组成一个场景（一排栏杆、一片柱列、一组道具阵、一整个
小院落…），再导出**整场 `.glb`**。

**本 PART 不建新几何、不加电池**——纯组装：引用现成 `<sha>.obj`、做 transform / 阵列、连
`g_joint_fixed`、补色、QC、导出。要新增/修改某个件的几何，回 PART A / PART B 重建并重新 bake。

> **本 PART 的核心是摆放的合理性与正确性。** 一堆漂亮的件随手堆在一起、互相穿插、悬空、比例错乱，
> 比单个件建得糙更糟。摆位必须**按真实尺寸算出来**，不能拍脑袋：每个件先拿到它的
> `bbox_min/bbox_max/size`（来自 `g_bake_part` 的同名输出），据此算底面落地、相邻间距、朝向、
> 不互相穿插，joint origin 填**算出来的坐标**。把 bbox 填进 `g_mesh` 后，末端 `g_geometry_qc`
> 才能对 mesh 解出 AABB、真正跑 overlap 检测——这是验收摆放的硬信号（见下方「按 bbox 摆位纪律」）。

---

## 前提：已 bake 的 `<sha>.obj` 能不能跨项目引用？

**结论（已核对后端源码，可放心按 docs-only 跨项目组装）：** 烘焙出的 mesh 是
**workspace 级、内容寻址**的 blob，可被同一后端实例下的任意项目解析。依据：

- 后端的 library blob 存储是**进程级单例**，绑定在 `<FORGEAX_PROJECT_ROOT>/library`
  （`backend/src/runtime.ts`），而 `FORGEAX_PROJECT_ROOT` 就是整个 workspace 根
  （`ProjectRegistry.workspaceRoot`）。用 `lowpoly:projects.create` 建的每个「项目」都活在这一个
  registry 里，**共享同一个 blob 库**。
- blob 按内容哈希落盘（`library/blobs/{sha[0:2]}/{sha[2:4]}/{sha}`），由
  `GET /api/v1/library/blob/:sha256` **纯按 sha 返回，和当前激活哪个项目无关**。
- viewer 用 `baseUrl + '/' + filename` 取 mesh，`baseUrl = /api/v1/library/blob/`。

所以**在 PART A/B 里 bake 出的 `<sha>.obj`，在另一个「场景」项目里用
`g_mesh(filename=<sha>.obj)` 引用得到，viewer 能解析出来。**

**唯一前提 / 退化条件：** 源项目和场景项目必须由**同一个后端实例（同一个
`FORGEAX_PROJECT_ROOT` / workspace）**服务。若你的部署给不同项目起了不同后端实例（不同
`FORGEAX_PROJECT_ROOT`），blob 不互通——此时 PART C **退化为「在同一个项目内组装本项目已 bake
的件」**：先在该项目里跑 PART A/B 把各件 bake 出来（filename 记下），再在**同一项目**里按下面
的阶段2 组装即可。流程完全相同，只是所有 mesh 来自当前项目自己的 `library/`。

> 注：上面的可行性结论来自后端源码核对（singleton library + content-addressed blob route），
> 不是一次 live viewer 实跑。落地第一次组装时，建议先用一个真实 `<sha>.obj` 跑一遍阶段2 +
> `urdf_preview` 截图确认 mesh 真的渲染出来了，再批量摆放。

## 另一条限制：OBJ 不带材质 → 每个实例都要补色

`g_bake_part` 烘的是**纯几何 OBJ**，不带任何材质/颜色。所以场景里每个 `g_mesh` 实例的颜色都要在
**阶段2** 用 `g_material` / `g_named_color` 重新指定（颜色挂在 URDF link 的 `<material>` 上，
不进 mesh）。同一个 `<sha>.obj` 摆多份、想要不同颜色，就给每个实例各配一次 `g_material`。

---

## 阶段0 · 场景布局清单（动手前必做）

先写一张**布局清单**，每个实例一行，列清：

| 字段 | 说明 |
|---|---|
| 实例名 | 稳定可读的 nodeId 前缀（`pillar_01` / `crate_a` …） |
| 引用 mesh | 哪个 `<sha>.obj`（来自 PART A/B 的 bake 记录或 `lowpoly:assets.list`） |
| bbox / size | 该件未缩放局部 AABB `bbox_min`/`bbox_max` 与 `size`（米）——来自 `g_bake_part` 输出，**记下来用于算摆位** |
| 位置 (x,y,z) | 米；挂到父的 joint origin 坐标，**按 bbox 算出来**（见下），不是拍脑袋 |
| 旋转 (rpy) | 弧度；没有就 0 0 0 |
| 缩放 (sx,sy,sz) | `g_mesh` 自带或 `g_scale`；默认 1 |
| 父 | 挂到哪个父（默认一个地面根） |
| 配色 | 该实例的 `g_material` 颜色（OBJ 无材质，必填） |

成排 / 成网格 / 成环（栏杆、柱列、道具阵）的实例，**不要逐个写一行**——记成「一组 N 个，间距 d，
沿哪个轴」，阶段2 用 `g_array_linear` / `g_array_radial` 一次摆出来。

地面根：用 `g_box`（薄板当地面）或建筑场景用 PART B 的 `g_floor_slab` 当根 link，所有实例都
`g_joint_fixed` 挂到它。

## 阶段0.5 · 按 bbox 摆位纪律（摆放正确性的核心）

每个件烘焙时 `g_bake_part` 会返回 `bbox_min` / `bbox_max` / `size`（米，未缩放的局部 AABB）。
摆位**全部据此计算**，joint origin 用算出来的坐标：

- **底面落地**：件的局部最低点是 `bbox_min.z`。要让它正好踩在父地面（z=0）上，joint origin 的
  `z = -bbox_min.z * sz`（有缩放就乘 `sz`）。不要把件埋进地里或浮在半空。
- **相邻间距 / 不互相穿插**：相邻两件中心距 ≥ 各自半宽之和（`size/2 * 缩放`）再留点缝。成排成网格的
  阵列步距 ≥ 单件对应轴 `size` × 缩放，避免相邻实例 AABB 互相穿插。
- **朝向**：先想清楚件的局部前向/轴向（PART A/B 的家族约定），再用 rpy 摆正，让朝向符合场景逻辑
  （门朝外、楼梯朝上、车头朝前）。
- **符合物理与场景逻辑**：物体落在地面而不是穿过它；栏杆/护栏贴边沿布置；柱子等距成列；道具不叠在一起。
  这些都能用 bbox/size 算出确定坐标。
- **把 bbox 填进 `g_mesh`**：阶段2 给每个 `g_mesh` 填 `bbox_min` / `bbox_max`（直接接 `g_bake_part`
  的同名输出即可）。**只有填了 bbox，场景里的 mesh 才能解出 AABB**，末端 `g_geometry_qc` 的
  `aabb_overlap` 检测才会生效；不填则每个件判 `missing_aabb`、整段 overlap 检测被跳过，穿模根本不会被报出来。

## 阶段1 · 盘点可用 mesh

- `lowpoly:projects.open` 打开（或 `projects.create` 新建）**场景项目**。
- `lowpoly:assets.list` 列出已 bake 的 mesh / blob，核对每个要用的 `<sha>.obj` filename 真实存在。
- 跨项目场景：filename 取自 PART A/B 阶段的 bake 返回值；同项目退化场景：filename 取自当前项目
  `assets.list`。
- **同时记下每个件的 `bbox_min` / `bbox_max` / `size`**（`g_bake_part` 输出）——阶段2 摆位与
  填 `g_mesh.bbox_*` 都要用。
- `lowpoly:batteries.get` 把 `g_mesh` / `g_joint_fixed` / `g_array_*` / `g_material` 的端口名
  查清（**绝不凭记忆编**），`lowpoly:pipeline.get` 读现状。

## 阶段2 · 搭场景图（一段干净 DSL）

按布局清单**重写一段干净的几何 DSL**（和 PART A 阶段2 同构，只是几何来源全是 `g_mesh` 引用）：

1. **建场景根**：`g_box`（薄地面板）或 `g_floor_slab` → `g_part`（root link）。
2. **每个实例**：
   - `g_mesh(filename=<sha>.obj, sx/sy/sz=…, bbox_min=…, bbox_max=…)` 引用 mesh（`meta.json` 确认
     支持 OBJ/STL/DAE，按 filename/URL 引用）。**`bbox_min`/`bbox_max` 直接接 `g_bake_part` 的同名
     输出**——填了 mesh 才能解出 AABB、QC overlap 才生效（见阶段0.5）。
   - 需要摆位/转向/再缩放 → `g_translate` / `g_rotate` / `g_scale`；
     成排成网格成环 → `g_array_linear` / `g_array_radial`（一次出 N 份）。
   - `g_part` 包成 link。
   - `g_material` / `g_named_color` 给这个实例配色（**必做**，OBJ 无材质）。
   - `g_joint_fixed` 把这个 link 连到父（默认场景根），**joint origin 的 xyz/rpy 写阶段0.5 按 bbox
     算出来的坐标**（底面落地 `z=-bbox_min.z*sz`、间距、朝向），不是拍脑袋。
3. **重复**直到所有实例都挂上，形成**单一根树**。
4. **QC + 导出**：`g_geometry_qc` → `g_validate` → `g_to_urdf` → `urdf_preview` →
   `lowpoly:screenshot.capture` 看整场。读 QC structured signals：
   - `islands` / `floating_links`：确认没漂浮 / 孤岛件。
   - **`aabb_overlap`（warning）**：rest pose 下相邻件 AABB 互相穿插——只要 `g_mesh` 填了 bbox 就会
     报出来。有 overlap 就回去**改对应 joint origin / 阵列步距**（拉开间距、修落地高度），重跑 QC，
     直到不再报穿模。
   - joint origin 距离 warning：joint origin 离父/子 AABB 太远 → 摆位坐标算错，按 bbox 修正。
   - Phase-2 全是 `g_mesh` 引用，`g_to_urdf` 应报 `bakeFallbacks=0`、`report.meshFileCount=0`、
     `stats.meshProvenance` 全 `native`（不应重新 bake）。
5. **导出整场**：确认 QC 无穿模/错位、截图四视图也看过之后，才 `lowpoly:export-glb`（`name` = 输出
   文件名，落到项目 `assets/3d/<name>.glb`）。

每个阶段各自一个 `applyBatch`（`opts.actor="ai:lowpoly"` + 简短 `label`）+ `execute`；**每次
applyBatch 后立刻 `lowpoly:pipeline.get`** 确认 `nodes` 真变了（防「ok 却空」）。布局不对**只调
joint origin / 阵列参数 / 配色**——别回头改 mesh 内部几何（那要回 PART A/B 重 bake）。

## 迭代

复盘顺序：**先读 `g_geometry_qc` 的 structured signals（尤其 `aabb_overlap` / joint origin 距离），
再看 `lowpoly:screenshot.capture` 返回的正交四视图 contact sheet**，逐视图对照需求看摆位、间距、
朝向、配色、有没有穿模/悬空。两者都过才算摆放正确。有穿模/错位 → 改 joint origin / 阵列步距 / 落地
高度，重跑 QC + 截图，别只截一张就说没问题。要换某个件的造型 → 回 [PART A](part-a-asset.md) /
[PART B](part-b-building.md) 重建 + 重 bake 那一个，filename / bbox 变了再回这里把对应 `g_mesh` 的
`filename` 与 `bbox_min`/`bbox_max` 一起换掉。
