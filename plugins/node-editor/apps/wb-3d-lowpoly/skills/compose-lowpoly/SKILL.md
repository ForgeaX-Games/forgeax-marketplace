---
name: compose-lowpoly
description: >-
  Compose and iterate ForgeaX 3D Lowpoly Generator projects (wb-3d-lowpoly)
  through the official Studio ToolRegistry tools (lowpoly:*). Covers three
  distinct flows: PART A — asset / mechanical part / assembly (the mandatory
  two-phase workflow: write a part manifest → model + bake each part on its own
  with g_bake_part → reference the staged g_mesh meshes and assemble one rooted
  URDF tree); PART B — static low-poly BUILDINGS (walls, floors, stairs, doors,
  windows, roofs, facades, railings, columns via the Architecture family and
  g_building_shell); PART C — scene assembly (place already-baked meshes into a
  single URDF tree with g_mesh + transforms / arrays + g_joint_fixed, QC, then
  export the whole scene to .glb). Use when the user asks to create, modify,
  preview, screenshot, export, or iterate a low-poly 3D model, mechanical part,
  building, or a composed scene. First clarify the request, then route to the
  right PART and follow its execution file.
trigger: /compose-lowpoly
---

# Compose Lowpoly · 入口与路由

在「3D 低多边形生成器」（wb-3d-lowpoly）里，通过**摆放电池 + 连边 + 运行**产出引擎中立的
低多边形 `.glb`。所有操作走 Studio ToolRegistry 工具（`lowpoly:*`，代理到插件后端
`/api/v1/*`），不要直接改运行时文件，不要点 UI 模拟人工，也不要用旧版 scene/renderer API。

> **本文件只负责路由 + 每个 PART 的要点提要。** 拿到需求先**判断走哪套流程**，再打开对应的
> execution 文件按步骤执行；动手前与执行中遇到的通用规则查「共享参考」。**无论哪个 PART，都先
> 问清/想清需求，再搭管线并运行；不要拿一次绿色 batch 当成品交付——读 QC 信号和截图。**

## 官方工具路径

`caller.kind = "ai"`（除非宿主另给 caller 上下文），`opts.actor = "ai:lowpoly"` + 简短
`opts.label`：

```json
{
  "toolId": "lowpoly:pipeline.applyBatch",
  "args": { "ops": [], "opts": { "actor": "ai:lowpoly", "label": "compose model" } },
  "caller": { "kind": "ai" }
}
```

可用工具：`lowpoly:projects.*`（list/create/open/close/remove，remove 需破坏性确认）、
`lowpoly:batteries.list` / `lowpoly:batteries.get`、`lowpoly:pipeline.get` /
`pipeline.applyBatch` / `pipeline.execute` / `pipeline.import` / `pipeline.export`、
`lowpoly:assets.list`、`lowpoly:screenshot.capture` / `screenshot.latest`、
`lowpoly:export-glb`。（`lowpoly:screenshot.store` 是渲染器内部回调，不对 AI 暴露。）

---

## 一、选哪套流程（路由表）

| 你要做的 | 走哪个 PART | 打开 |
|---|---|---|
| 单个物件 / 机械件 / 装配体（枪、宝箱、齿轮组、机械臂…）——**逐件建模 + 烘焙 → 引用 mesh 组装** | **PART A · 资产 / 机械** | [executions/part-a-asset.md](executions/part-a-asset.md) |
| 房屋 / 建筑 / 房间 / 多层壳体 / 建筑构件（墙、楼板、楼梯、门窗、屋顶、栏杆、柱）——**用 Architecture 家族** | **PART B · 建筑** | [executions/part-b-building.md](executions/part-b-building.md) |
| 把**前面已 bake 的多个 mesh** 摆进同一棵 URDF 树组成一个**场景**，再导出整场 `.glb` | **PART C · 场景组装** | [executions/part-c-scene-assembly.md](executions/part-c-scene-assembly.md) |

## 二、各 PART 要点提要（先看摘要，再进 execution 文件）

### PART A · 资产 / 机械 → [executions/part-a-asset.md](executions/part-a-asset.md)
- **强制两阶段，绝不一个 mega-batch 成图**：阶段0 写**精细拆件清单**（硬门禁，每件一行：
  名称+功能 / 真实形态 / op 路由 / 带轴尺寸 / 细节特征及位置 / 局部原点基准 / 装配关节 /
  材质 / 用 primitive 的逐件理由）。
- **阶段1 逐件建模 + 烘焙**：每件从空几何起搭**独立子图**（CSG / Parts / Gears），末端
  `g_bake_part` 烘成 `<sha>.obj`，记下 filename。一件一个小 batch + execute。
- **阶段2 引用 mesh 组装**：`g_mesh(filename=<sha>.obj)` → `g_part` → `g_material` 配色 →
  `g_joint_*` 连成单一根树 → `g_geometry_qc` + `g_validate` + `g_to_urdf` + `urdf_preview` →
  整体截图。平凡件（真就是一块板/一根杆）才直接 `g_box`/`g_cylinder`/`g_sphere`。

### PART B · 建筑 → [executions/part-b-building.md](executions/part-b-building.md)
- **工具/传输/QC 循环与 PART A 完全一致**，变的是**建模哲学**：建筑里 **Architecture 家族
  （`g_wall` / `g_floor_slab` / `g_stairs` / `g_roof` / `g_window` / `g_door` / `g_railing` /
  `g_column`）是默认**，裸 `g_box` 是例外。
- **先写建筑 brief**（footprint & 层数 / explicit 还是 procedural 布局 / 流线楼梯 / 各墙开洞 /
  屋顶类型）再动手。
- 整栋优先 **`g_building_shell`**（单房间就 `floors=1, rooms_per_floor=1, roof_type=none`），
  别手工连几十面墙；末端同样 `g_geometry_qc` → `g_to_urdf` → `urdf_preview`。

### PART C · 场景组装 → [executions/part-c-scene-assembly.md](executions/part-c-scene-assembly.md)
- 定位：把 PART A/B 阶段已 bake 的 mesh 当**道具库**，摆进同一棵 URDF 树组成场景，导出整场 `.glb`。
  **不建新几何、不加电池**——纯组装。
- **阶段0 布局清单**：每个实例一行——引用哪个 `<sha>.obj` / 位置(x,y,z) / 旋转 / 缩放 /
  挂到哪个父 / 配色。
- **阶段2 搭场景图**：建场景根 → 每实例 `g_mesh` →（按需 `g_translate`/`g_rotate`/`g_scale`
  或 `g_array_linear`/`g_array_radial` 成排成网格）→ `g_part` → `g_joint_fixed`（origin 写
  布局坐标）→ 重复 → QC → `g_to_urdf` → `urdf_preview` → `lowpoly:export-glb`。
- **两条限制**：①OBJ 不带材质，每实例颜色要在阶段2 用 `g_material` 重新指定；②跨项目引用
  `<sha>.obj` 的前提见 part-c（不确定时退化为「同项目内组装本项目已 bake 的件」）。

## 三、共享参考（通用规则 / 防呆，随时查）

| 内容 | 文件 |
|---|---|
| ToolRegistry-first 工作流 + brief/QC 循环 | [quickstart.md](quickstart.md) |
| 各家族页（何时用、关键参数、最小连线片段；含 **Architecture**） | [modeling-guide.md](modeling-guide.md) |
| 电池速查（家族列表 + 路由表 + 如何发现电池） | [battery-catalog.md](battery-catalog.md) |
| 图/batch 形状、id-port 连线、可跑的多件装配与**两阶段**（bake→mesh）示例 | [pipeline-schema.md](pipeline-schema.md) |

**最常踩的三条铁律**：

1. **op id / 端口名只从 `lowpoly:batteries.list` / `batteries.get` 取**，绝不凭记忆编。
2. **每次 `applyBatch` 后立刻 `lowpoly:pipeline.get`**，确认 `nodes` 真变了——op 的 `type`
   拼错时内核既不命中也不报错，照样返回 `{ok:true}`，但图没变（「ok 却空」陷阱）。
3. **两阶段，不堆 mega-batch**：把整个物件/场景堆进一个 batch 必然退化成方块拼接。每阶段
   （PART A 每件一个小 batch）各自 `applyBatch`/`execute`，先 bake/暂存再引用组装。
