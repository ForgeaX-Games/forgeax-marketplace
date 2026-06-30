# PART B · 建筑（Architecture 家族）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART B** 的完整执行步骤。
> 共享参考：各家族页（含 **Architecture**）见 [modeling-guide.md](../modeling-guide.md)；
> 电池速查见 [battery-catalog.md](../battery-catalog.md)；图结构见
> [pipeline-schema.md](../pipeline-schema.md)。

适用：房屋 / 建筑 / 房间 / 多层壳体 / 室内布局，或栏杆、护栏、柱这类建筑构件——而不是单个
机械件（机械件走 [PART A](part-a-asset.md)）。

---

## Compose Lowpoly Building

Architecture-flavoured sibling of [PART A · 资产 / 机械](part-a-asset.md). The
**tooling, transport, and QC loop are identical** — same ToolRegistry tools
(`lowpoly:projects.*`, `lowpoly:batteries.*`, `lowpoly:pipeline.*`,
`lowpoly:assets.*`, `lowpoly:screenshot.*`), same
`… → g_geometry_qc → g_to_urdf → urdf_preview` ending. What changes is the
**modeling philosophy**: for buildings the semantic `wall` / `floor_slab` /
`stairs` / `roof` / `window` / `door` / `railing` / `column` ops are the
**default**, not bare `g_box`.

A building = many element shapes, each wrapped in a `g_part`, connected with
`g_joint_fixed` into one rooted URDF tree (openable doors/windows may use
`g_joint_revolute`). Units = meters, Z up.

## Tool path (unchanged)

Use the exact workflow from [PART A](part-a-asset.md):

1. `lowpoly:projects.*` to open/create a project.
2. `lowpoly:batteries.list` / `lowpoly:batteries.get` to read the **Architecture**
   family ports — never guess port names.
3. `lowpoly:pipeline.get` → `lowpoly:pipeline.applyBatch`
   (`opts.actor = "ai:lowpoly"`) → `lowpoly:pipeline.execute`.
4. `lowpoly:assets.list` + `lowpoly:screenshot.capture` to verify.

## Modeling Philosophy (read before the first `applyBatch`)

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

### 2. Compose, don't hand-place every wall

- A whole building → **`g_building_shell`** (multi-storey slabs, interior/exterior
  walls, stair well, roof — one rooted tree). Prefer it over wiring dozens of
  walls by hand. For a single room, call it with `floors=1`, `rooms_per_floor=1`,
  `roof_type=none`.

### 3. Write the **building brief** before building

Before the first `applyBatch`, write a short internal brief in this order:

- **Footprint & scale** → overall `w × d` (meters), number of **floors**, storey
  height.
- **Layout mode** → **explicit** (you list room rectangles `[x, y, w, d]`,
  centers relative to the footprint center) **or** **procedural** (give
  `rooms_per_floor` + `seed` and let `g_building_shell` recursively split the
  footprint — BSP via the shared `arch-layout` helper).
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

Every part must reach one root via joints (`g_building_shell` already
guarantees this). End the graph with `g_geometry_qc` (read `islands` /
`floating_links`) → optional `g_auto_collision` → `g_to_urdf` → `urdf_preview`.
A green batch proves nothing — read the QC signals and the screenshot.

## Element quick reference

| Want | Op | Key params |
|---|---|---|
| straight wall + holes | `g_wall` | `length` `height` `thickness` `openings=[[x,w,sill,head]]` |
| slab + wells | `g_floor_slab` | `width` `depth` `thickness` `holes=[[x,y,w,d]]` |
| stair flight | `g_stairs` | `total_rise` `run` `width` `step_count` `type=straight\|spiral` (`radius` `inner_radius` `sweep_deg`) |
| roof | `g_roof` | `width` `depth` `type=flat\|shed\|gable\|hip\|gambrel\|mansard\|pyramid` `height` `overhang` |
| siding | `g_facade_panel` | `panel_w` `panel_h` `thickness` `groove_count` |
| window | `g_window` | `width` `height` `depth` `frame` `type=cross\|grid\|louver` `rows` `cols` `glass` |
| door (frame + leaf/leaves) | `g_door` | `width` `height` `depth` `hinge` `leaves=1\|2` `style=flush\|panel\|glazed` `openable` |
| railing / balustrade | `g_railing` | `length` `height` `baluster_count` `post_size` `rail_height` |
| column / pillar | `g_column` | `height` `radius` `shape=round\|square` `base_height` `capital_height` |
| whole building (or single room) | `g_building_shell` | `footprint_w/d` `floors` `rooms`/`rooms_per_floor`+`seed` `roof_type` → `root_id` |

Confirm exact port names/defaults with `lowpoly:batteries.get` before wiring.
For deeper per-family detail, see the **Architecture** page in
[modeling-guide.md](../modeling-guide.md#architecture)
and the family table in
[battery-catalog.md](../battery-catalog.md).

## References

- [PART A · 资产 / 机械](part-a-asset.md):
  the shared ToolRegistry workflow + QC loop (this PART reuses it verbatim).
- [modeling-guide.md](../modeling-guide.md): per-family
  pages, including **Architecture**.
- [battery-catalog.md](../battery-catalog.md): family
  list + routing table.
