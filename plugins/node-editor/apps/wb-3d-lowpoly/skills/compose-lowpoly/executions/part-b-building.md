# PART B · 建筑（Architecture 家族）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART B** 的完整执行步骤。
> 授权参考只需两份：DSL 语法 [dsl-quickref.md](../dsl-quickref.md)、op 签名
> [op-directory.md](../op-directory.md)。选型拿不准再查 [battery-catalog.md](../battery-catalog.md)
> 的路由表——按需，别一次全读。

> **DSL-first（唯一流程）**：只写 DSL、用 `lowpoly:model.apply({ source })` 提交。逐条
> 写 Architecture op（`wall`/`floor_slab`/`stairs`/`roof`/`window`/`door`/`railing`/`column`），各自
> `part(...)` 包壳后用 `joint(type="fixed",...)`（可开门窗扇用 `type="revolute"`）连到单一根件，靠
> joint `origin`/`rpy` 摆位，一次 `model.apply` 跑完（编译器自动追加 QC+URDF 终端）。语法见
> [dsl-quickref.md](../dsl-quickref.md)，op 签名见 [op-directory.md](../op-directory.md)。
> **完成门禁 = 回执干净。**

适用：房屋 / 建筑 / 房间 / 多层壳体 / 室内布局，或栏杆、护栏、柱这类建筑构件——而不是单个
机械件（机械件走 [PART A](part-a-asset.md)）。

---

Architecture-flavoured sibling of [PART A](part-a-asset.md): **same DSL-first flow
and completion gate**, what changes is the **modeling philosophy** — for buildings
the semantic `wall` / `floor_slab` / `stairs` / `roof` / `window` / `door` /
`railing` / `column` ops are the **default**, not bare `box`. A building = many
element shapes, each `part(...)`-wrapped and connected with `joint(type="fixed")`
into one rooted URDF tree (openable leaves may use `type="revolute"`). Meters, Z up.

## Modeling Philosophy

> **Important reference, not a hard gate.** The catalog ships an **Architecture**
> family because for buildings these ops are usually the *better* choice than raw
> `g_box` slabs: walls have door/window openings, slabs have stair wells, roofs
> are pitched, windows have frames and mullions — all of which the semantic ops
> express directly. Reach for them first. Using a plain box to rough something in
> is **not an error** and won't fail QC; just prefer the Architecture op whenever
> the feature it models (an opening, a pitch, a stair well) actually matters.

### 1. Prefer Architecture ops (strong recommendation)

These are the recommended op for each element — they beat boxes specifically on
openings, pitched/complex roofs, and stair wells:

- A wall (with or without a door/window hole) → **`g_wall`** — its `openings`
  list cuts the holes for you, instead of faking a window by laying smaller
  boxes on top.
- A floor / ceiling / landing, with or without a stair/shaft well → **`g_floor_slab`**
  (`holes`) rather than a flat box you then have to cut by hand.
- Stairs / steps → **`g_stairs`** (`type=straight` or `spiral`) rather than a
  stack of boxes.
- A pitched / hipped / shed / flat / gambrel / mansard / pyramid roof → **`g_roof`**
  rather than a wedge faked from primitives.
- A window (frame + `cross` / `grid` / `louver`) → **`g_window`**; a door (frame +
  one or two **separate** leaves, `flush` / `panel` / `glazed`) → **`g_door`**.
- Exterior cladding / siding → **`g_facade_panel`**.
- A railing / guardrail / handrail / balustrade → **`g_railing`**.
- A column / pillar / post → **`g_column`** (`round` / `square`, optional base &
  capital).

> Soft hint: if you do rough a feature in with a `g_box` (e.g. a placeholder
> mass), that's acceptable — just note it and upgrade to the Architecture op when
> the opening / pitch / well becomes relevant. No redo is forced.

### 1.5 用别的家族丰富细节（鼓励，不止 9 个 Architecture 电池）

Architecture 家族只是**外壳与主结构**的首选，**不是唯一可用的电池**。一栋只有墙/板/
顶/门窗的房子会很空——主动混用其它家族把细节做足，让成品更丰富可信：

- **Primitive**（`g_box`/`g_cylinder`/`g_sphere`/`g_cone`/…）：烟囱、女儿墙压顶、窗台
  花箱、雨棚、门槛、台阶踏步、灯柱、屋顶水箱、简单家具体块。
- **CSG**（`g_difference`/`g_extrude`/`g_revolve`/`g_loft`/…）：任何 Architecture 电池
  参数覆盖不到的异形——凸窗、老虎窗、拱廊、装饰线脚、掏空的壁龛、异形阳台板。
- **Parts**：`g_knob`→门把手/球形拉手，`g_vent_grille`/`g_perforated_panel`→通风口/
  空调百叶/檐口通气，`g_bezel`→灯具/门铃环圈，`g_wheel`→装饰圆窗。
- **Architecture 里的配件电池**别忘了用：`g_column`（柱廊/门廊/雨棚支柱）、
  `g_railing`（阳台/露台/楼梯/女儿墙护栏）、`g_facade_panel`（外墙挂板/板缝质感）。
- **Transform**（`g_array_linear`/`g_array_radial`）：把一个窗/柱/栏杆条**阵列**成一排，
  别手动复制几十遍。
- **Material**（`g_material`/`g_named_color`）：给墙、屋顶、门窗、木作分别上色，颜色对比
  是低模"看起来完成度高"的关键——别整栋一个灰。

原则不变：**能用语义电池（含 Architecture 的开洞/坡顶/梯井）就用**（见上一节），而语义
电池表达不了的细节，大胆用 Primitive/CSG/Parts 补。所有补充件同样要 `g_part`+`g_joint_*`
挂进那棵唯一的根树，并遵守 R1–R5 的对齐/不重叠规则。

### 2. Compose a building by hand from the element ops

There is **no whole-building orchestrator** — build the shell explicitly from the
Architecture element ops and wire them into one rooted tree:

- Emit each element with its own op: floors/landings → `g_floor_slab` (with
  `holes` for stair wells), walls → `g_wall` (with `openings` for door/window
  holes), stairs → `g_stairs`, roof → `g_roof`, plus `g_window` / `g_door` /
  `g_railing` / `g_column` as needed.
- Wrap each element shape in a `g_part`, then connect them with `g_joint_fixed`
  (openable doors/windows may use `g_joint_revolute`) so everything reaches a
  **single root** part (e.g. the ground-floor slab).
- Place elements via the **joint origin** (meters, Z up): walls sit on a slab by
  giving the joint `origin=[cx, cy, slabTopZ]`; a wall running along Y is rotated
  with joint `rpy=[0,0,π/2]`. Stack floors by `origin=[0,0,floorIndex*storeyH]`.

### 3. Write the **building brief** before building

Before writing any DSL, write a short internal brief in this order:

- **Footprint & scale** → overall `w × d` (meters), number of **floors**, storey
  height.
- **Layout** → list the room rectangles / wall centerlines yourself (centers in
  meters, relative to the footprint center). Deduplicate shared interior walls so
  two rooms don't each emit an overlapping wall on their common edge.
- **Circulation** → where do the stairs / wells go (which floors connect).
- **Openings** → per wall, the door/window holes (`openings = [[x, width, sill,
  head], …]`).
- **Roof** → `flat` / `shed` / `gable` / `hip` / `gambrel` / `mansard` /
  `pyramid`, ridge height, overhang.
- **Detail elements** → guard a balcony / landing / open stairwell edge or stair
  side with **`g_railing`**; carry a porch / colonnade / portico with
  **`g_column`** (round or square, optional base & capital). Reach for these
  instead of faking handrails or pillars with stray boxes.

Only after the brief exists do you start creating nodes.

### 4. Single rooted tree, then QC

Every part must reach one root via joints (you wire this yourself — no
orchestrator does it for you). Submit one `model.apply({ source })` — the compiler
auto-appends the QC + URDF terminals. A clean receipt is the gate: read the QC
signals (`islands` / `floating_links` / `overlaps`). Add `g_auto_collision` before
the terminal if you need `<collision>`.

## Element quick reference

| Want | Op | Key params |
|---|---|---|
| straight wall + holes | `g_wall` | `length` `height` `thickness` `openings=[[x,w,sill,head]]` · opt `window_band`+`band_sill`/`band_head`/`band_margin`/`pane_width`/`mullion`, `plinth_height`/`plinth_projection` |
| slab + wells | `g_floor_slab` | `width` `depth` `thickness` `holes=[[x,y,w,d]]` · opt `beam_depth`/`beam_width`, `edge_chamfer` |
| stair flight | `g_stairs` | `total_rise` `run` `width` `step_count` `type=straight\|spiral` (`radius` `inner_radius` `sweep_deg`) · opt `tread_thickness`, `open_riser`, `landing_depth`/`landing_after` |
| roof | `g_roof` | `width` `depth` `type=flat\|shed\|gable\|hip\|gambrel\|mansard\|pyramid` `height` `overhang` · opt `eave_overhang`/`verge_overhang`, `parapet_height`/`parapet_thickness`/`coping_width` |
| siding | `g_facade_panel` | `panel_w` `panel_h` `thickness` `orientation=wall\|slab` `groove_count` · opt `groove_direction=horizontal\|vertical\|both`, `groove_spacing`, `board_style=flush\|lap\|shiplap` |
| window | `g_window` | `width` `height` `depth` `frame` `type=cross\|grid\|louver` `rows` `cols` `glass` · opt `pane_width`, `sill`, `arch_top` |
| door (frame + leaf/leaves) | `g_door` | `width` `height` `depth` `hinge` `leaves=1\|2` `style=flush\|panel\|glazed` `openable` · opt `panel_rows`/`panel_cols`, `transom`, `sidelight` |
| railing / balustrade | `g_railing` | `length` `height` `baluster_count` `post_size` `rail_height` · opt `post_shape=round\|square`/`post_radius`, `post_spacing`, `bottom_rail`/`mid_rail`, `top_rail_width`/`top_rail_height` |
| column / pillar | `g_column` | `height` `radius` `shape=round\|square` `base_height` `capital_height` · opt `taper`, `base_style`/`capital_style=plain\|stepped`, `flutes` (round) |
| assemble the shell | `g_part` + `g_joint_fixed` | wrap each element, place via joint `origin`/`rpy`, all under one root slab |

Confirm exact param names/defaults in [op-directory.md](../op-directory.md) before wiring;
the family/routing table is in [battery-catalog.md](../battery-catalog.md).

## 对齐配方 · Placement recipes（对不上就是这里没做对）

> 所有元素 shape 都是 **X、Y 居中、底面 Z=0**（`g_stairs` 从 Z=0 起步、`g_roof`
> footprint 居中）。装配错位不是电池的几何算错，而是下面这套坐标契约没照做。
> 单位=米，Z 上。

### R1 · 洞口 ↔ 窗/门（"墙上的洞和窗对不上"的根因）

`g_wall` 切洞（`openings`）和 `g_window`/`g_door` 是**两个独立 shape**——你必须把窗/门
摆进洞里，它们不会自动对齐。规则：

- 每个洞口 `[x, width, sill, head]` 对应的配套窗：`width=width`、
  **`height = head − sill`**（不是 head）、`depth = 墙的 thickness`。
- **把窗/门 part 以"这面墙"为父**（`g_joint_fixed` 的 `parent` = 墙 part），关节
  `origin = [x, 0, sill]`（窗底在 Z=0 → 对 `sill`，不是 `(sill+head)/2`）。
- **为什么必须以墙为父**：这样洞口的 `x`/`sill` 直接就是关节 origin。若改以根 slab
  为父，你得手动把墙的平移**和旋转**套进去——**沿 Y 方向的墙（`rpy=[0,0,π/2]`）几乎
  必然算错**，这就是"洞和窗经常对不上"的头号原因。
- 偷懒法：`g_wall` 现在直接返回 **`opening_placements`**（JSON 数组，每项
  `{origin:[x,0,sill], width, height, depth}`）；照抄即可，别自己重算。

### R2 · 门框 + 门扇（"门建模有问题"的根因）

`g_door` 出**门框 `door_frame` + 独立门扇 `door_leaf`**两条 shape。关键陷阱：
**门扇的局部原点在铰链边、不在几何中心**（`hinge=left` → 扇占局部 X∈[0,leafW]、
转轴在 X=0）。所以：

- 门框：以墙为父，`origin = [x, 0, 0]`（用 R1 里门洞的 `x`）。
- 门扇：**不要**和门框同心摆，否则会整体偏移半扇、戳出框外。以门框 part 为父时
  `origin` = `g_door` 返回的 **`leaf_origin`/`leaf_origins`**（单扇 `[∓clearW/2,0,0]`、
  双扇分置两门挺）。可开门用 `g_joint_revolute`（轴 `az=1`）、静态用 `g_joint_fixed`。

### R3 · 楼板（"地板大小不对 & 二楼缺地板"的根因）

- **尺寸对齐 footprint**：`g_floor_slab` 默认 `6×4`，必须显式把 `width`/`depth` 设成
  你在 brief 里定的 footprint，别用默认值。
- **每一层楼面各要一块**：一层地面一块、**二层楼面一块**、三层一块……用
  `origin=[0,0,i*storeyH]` 逐层堆叠。**屋顶不是楼面**——`g_roof` 不能顶替二层楼板。
  最常见的漏项就是"忘了给二层 emit 一块 `floor_slab`"。

### R4 · 楼梯 ↔ 楼梯井（"缺楼梯 / 楼梯不通"的根因）

跨层楼梯要三件套一起做，缺一层就"没有楼梯"或楼梯穿板：

1. `g_stairs` 的 `total_rise = storeyH`（一层楼高），摆到 `origin=[sx, sy, i*storeyH]`。
2. **上层** `g_floor_slab` 在楼梯正上方开一个对齐的 `holes` 井
   `[[sx, sy, wellW, wellD]]`（洞的 x/y 用楼梯落点、尺寸略大于梯段投影）。
3. 楼梯落点 `[sx,sy]` 与楼板井 `[sx,sy]` **必须同坐标**，否则梯上去顶到实心板。

### R5 · 别让结构重叠 & "门为什么还是不行"（可动关节的陷阱）

**QC 对重叠的判定是有条件的**（`g_geometry_qc` 第 180–319 行）：

- **全 `g_joint_fixed` 的静态建筑**：兄弟 part 的 AABB 互穿只当**非致命 warning**。
  因为低模建筑里"合理交叠"很多——墙在墙角/T 形接头按一个墙厚交叠、窗/门框嵌在墙
  平面里、门扇的 AABB 落在门框 AABB 内、楼梯占着楼板的楼梯井——这些都是 AABB 保守
  估计的常态，不算缺陷。
- **一旦模型里出现任意一个可动关节**（`g_joint_revolute`/`prismatic`/…），QC 会把
  **整个模型**的所有 AABB 互穿**升级为致命 issue**。

**这正是"窗没问题、门还不行"的根因**：窗用 `g_joint_fixed` → 全 fixed → 上面那些
交叠都是 warning；而门只要做成可开的 `g_joint_revolute`，就给模型引入了一个可动
关节 → 全楼的墙角交叠、嵌框交叠、楼梯井交叠**全部变致命** → 门（连同整栋楼）过不了 QC。

处理原则（二选一）：

1. **静态建筑就全用 `g_joint_fixed`（推荐默认）。** 低模房子通常不需要真的会开的门；
   门框 + 门扇都用 fixed 连上，门扇摆在 `leaf_origin` 关着的位置即可。这样不引入可动
   关节，全部交叠回到 warning 级。`g_door` 的 `openable` 只是给生成器的提示，不代表
   一定要用 revolute。
2. **确实要能开的门/窗**：用 `g_joint_revolute` 之后，必须在 `g_geometry_qc` 上用
   **`allow_pairs`** 白名单掉那些**合理**交叠对（如 `"door1:wall_s"`、
   `"door1:door1_leaf"`、相邻墙 `"wall_s:wall_e"`、`"stair1:slab1"`），
   必要时配 `allow_joints`；这样只剩**真正的**运动碰撞会报错。别用白名单去盖真穿模。

**真正要消除的重叠**（这些是真缺陷，白名单不能盖）：共享内墙要**去重**（相邻两房间别
在公共边各画一道墙）、别把两块 shape 叠在同一处、窗/门要**恰好填满**洞口而不是比洞
大一圈捅进墙体、楼梯别插进实心楼板（见 R4）。先用 `g_metrics` 读
`max_penetration`/`overlap_ratio` 判断是真穿模还是 AABB 保守误报。

## References

- [PART A · 资产 / 机械](part-a-asset.md): the shared DSL-first flow + QC loop.
- [op-directory.md](../op-directory.md) · [dsl-quickref.md](../dsl-quickref.md):
  op signatures + DSL syntax (the authoring SSOTs).
- [battery-catalog.md](../battery-catalog.md): family list + routing table.
