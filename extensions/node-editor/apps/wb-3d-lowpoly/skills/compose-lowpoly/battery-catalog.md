# Battery Catalog — which op to use (routing only)

This is a **routing aid** for picking a family/op. It is *not* where you get op
signatures: exact arg names/kinds live in [op-directory.md](op-directory.md) (the
authoring SSOT). **Do not call `batteries.list` / `batteries.get`.**

## Battery Families

The DSL op name is authoritative from [op-directory.md](op-directory.md); the
families below tell you **which op to even look for** (they list `g_*` battery ids;
the DSL op you write is the un-prefixed name from op-directory.md).

| Family | Examples | Produces | Use when |
|---|---|---|---|
| **Primitive** | `g_box` `g_cylinder` `g_sphere` `g_cone` `g_capsule` `g_torus` `g_dome` `g_mesh` `g_rock` | a `geometry` + `id` | the visible form genuinely *is* that primitive (slab, plain rod, ball); **`g_mesh` references a Phase-1 staged `<sha>.obj`** to reassemble a baked part (set its optional `bbox_min`/`bbox_max` from `g_bake_part` so the scene mesh resolves an AABB for QC overlap); **`g_rock`** (DSL `rock`/`boulder`) = icosphere + deterministic per-seed displacement for terrain decoration/rubble/boulders — **use this instead of `g_sphere`** for irregular rocks; mesh-backed like `g_pipe`/`g_sweep`/`g_section_loft`, so it **cannot** feed union/difference/intersection |
| **Profile** | `g_profile_rect` `g_profile_rounded_rect` `g_profile_circle` `g_profile_polygon` `g_profile_regular_polygon` | a 2D `profile` + `id` | you need a cross-section to feed extrude / revolve / loft / sweep |
| **CSG** | `g_difference` `g_union` `g_intersection` `g_extrude` `g_extrude_with_holes` `g_loft` `g_revolve` `g_sweep` `g_lathe` `g_pipe` `g_section_loft` `g_fillet` | a `geometry` + `id` | hollow shells, cut openings/holes, recesses, lofted/swept/revolved bodies, merged solids; **`g_fillet`** rounds (`type=round`) or bevels (`type=chamfer`) the edges of a solid |
| **Parts** (incl. gears) | `g_knob` `g_bezel` `g_wheel` `g_tire` `g_vent_grille` `g_perforated_panel` `g_slot_panel` `g_barrel_hinge` `g_piano_hinge` `g_clevis_bracket` `g_pivot_fork` `g_trunnion_yoke` `g_fan_rotor` `g_blower_wheel` · gears: **`g_gear`** `g_ring_gear` `g_rack_gear` `g_planetary_gearset` `g_bevel_gear` `g_worm` | a `geometry` + `id` | the prompt names a real mechanical part (knob, bezel, wheel, hinge, vent, fan, bracket) **or a gear / gearing / transmission** |
| **Gears** (in Parts) | **DSL op names** (per op-directory.md): `spur_gear`, `herringbone_gear`, `crossed_helical_gear`, `hyperbolic_gear`, `ring_gear`, `rack_gear`, `planetary_gearset`, `bevel_gear`, `worm` (helical = `spur_gear` with non-zero `helix_angle`). There is **no bare `gear` op** | a `geometry` + `id` | the prompt names gears / gearing / transmission |
| **Architecture** | `g_wall` `g_floor_slab` `g_stairs` `g_roof` `g_facade_panel` `g_window` `g_door` `g_railing` `g_column` (assemble by hand with `g_part` + `g_joint_fixed`) | a `geometry` + `id` | the prompt names a building / house / room / wall / floor / stair / roof / door / window / railing / column (static low-poly architecture) |
| **Transform** | `g_translate` `g_rotate` `g_scale` `g_mirror` `g_array_linear` `g_array_radial` | transformed `geometry` | place / orient / mirror / repeat an existing shape |
| **Assembly** | `g_part` + `g_joint_fixed` `g_joint_revolute` `g_joint_prismatic` `g_joint_continuous` `g_joint_planar` `g_joint_floating` `g_joint_mimic` `g_joint_on_surface` | a `geometry` (URDF links/joints) + `id` | wrap a shape into a link (`g_part`) and connect links into one rooted tree (`g_joint_*`) |
| **Utils** | `g_bake_part` `g_bake_object` `g_material` `g_texture` `g_named_color` `g_align_centers` `g_place_on_face` `g_place_on_surface` `g_collision_box` `g_collision_clustered` `g_auto_collision` `g_inertial_from_geometry` `g_validate` `g_geometry_qc` `g_metrics` `g_to_urdf` | varies | **`g_bake_part`** = Phase-1 bake-staging (one shape → reusable colorless `<sha>.obj`; returns `bbox_min`/`bbox_max`/`size`). **`g_bake_object`** = bake a whole object of multiple colored parts into ONE multi-material `<sha>.glb` (per-part colors embedded) — reference once via `g_mesh` with NO link material to keep the colors; use for fixed-palette objects reused as a unit. Each part's shape can be a REAL shape **or** a `g_mesh` reference to a pre-baked `<sha>.obj` (read back + merged by pose) — the character path relies on this to merge separately-baked parts into one skinnable mesh. **`g_material`** now also takes `metalness`/`roughness` (both 0..1) and an optional `texture_id` (ref to a `g_texture`) — the texture/PBR values only actually render when the material's part goes through `g_bake_object` (plain URDF `<color>` has no texture slot; metalness/roughness there are a non-standard `<pbr>` hint for this project's own viewer only). **`g_texture`** = declare a `texture(image, repeat, offset, rotation)` statement (`image` path is relative to the project's `assets/textures/`) to feed into `g_material`'s `texture_id`. Plus placement helpers, collision/inertia, QC sensors (**`g_geometry_qc`** = boolean signals for fix loops; **`g_metrics`** = quantitative numbers + a 0–100 `score`/`grade`), and the terminal **`g_to_urdf`** URDF emitter |
| **Animation** | `g_bake_animation` (DSL `animation`, 关节路，通道键=URDF 关节名) · `g_bake_skin_animation` (DSL `animation`, 角色路自动走，通道键=骨骼名 + 可选 `root_motion`) | a `geometry` (+ `animation`/`report`/`error`) | 导出的 GLB 要**播一段动作**。**路线由「谁在动」决定，不看动作词**：**活物**（人 / 动物 / 怪物）走 / 跑 / 游 / 摆尾 / 呼吸 / 跳跃 = **角色路骨骼动画**（先建 skeleton，再 `animation`；骨骼弯曲写 `keyframes`，整体前进/腾空写米制 bind-relative `root_motion=[{t,x,y,z},…]`，模型根帧 X 向前、Z 向上）；**机械件**门扇 / 夹爪 / 齿轮转 / 机械臂 = **关节路关节动画**（先建 `joint`，再 `animation` 通道键=关节名）。**一只会走的动物是角色，不是关节机器** |
| **Character rig** (角色路) | **DSL ops**: `bone` · `bone_chain`（一个 part 对应多段骨骼链，如尾巴/蛇身）· `skeleton` · `skin`（组装时手写骨架 + 一行 `skin(auto)`）。终端链电池（自动追加）：`g_skin_qc` `g_bake_object` `g_to_rig` `rig_preview` | a `geometry` → **RigSpec**（角色 IR） | 角色 / 生物 / 软体：要**一块连续表皮随骨架平滑弯曲**（非刚性关节）。出现 `bone`/`bone_chain`/`skeleton`/`skin` 即触发角色路（见 [PART D · 角色](executions/part-d-character.md)）。骨架手写、父子按解剖，只有蒙皮权重由前端测地体素绑定自动求解、不在 DSL |
| **Static scene** (静态路终端，自动追加) | `g_geometry_qc` `g_bake_object`(仅真实形态件) `g_to_scene` `scene_preview` | a `geometry` → **SceneSpec**（静态 IR） | 无 `joint`、无 `skin`/`skeleton` 的物体/场景自动走静态路：`g_to_scene` 按各 part origin/rpy/material 合并成**单个多材质 `.glb`**，导出 `mode="static"`（见 [PART C · 场景](executions/part-c-scene-assembly.md)） |
| **Preview** | `urdf_preview` `g_preview`（机械/URDF 路） · `scene_preview`（静态路，passthrough SceneSpec） · `rig_preview`（角色路，passthrough RigSpec） | URDF / SceneSpec / RigSpec / preview | make the model visible in the 3D viewer |

### Which family? (routing — try these top-to-bottom, primitive is LAST)

Default to a richer family; only fall through to **Primitive** when every row
above genuinely does not apply.

- The prompt asks for a whole **scene / city / multi-object + building
  composition** (a street, a village, a small city, props + buildings staged in
  one environment) → **SCENE orchestration** (see
  [PART C · 场景编排与组装](executions/part-c-scene-assembly.md)): write a
  **detailed** scene inventory (per item: A or B, 2–3-sentence real form, target
  size, count, which reuse one mesh), then model each **unique** item through its
  PART A/B execution file + `g_bake_part` — **all baked in the same scene project**
  (the blob library is workspace-level/content-addressed, so same-project bakes
  resolve straight from `g_mesh`). Assemble by giving each `g_part` an `origin` (no
  `g_joint` — a jointless scene routes to the STATIC pipeline and `g_to_scene`
  merges the placed parts into one multi-material `.glb`; no URDF auto-stitch).
  Reuse one `<sha>.obj`
  across N instances via N `g_part` origins; **do not** `g_array_*` / `g_translate`
  a referenced mesh for placement (those `SUBGRAPH_BAKE_OPS` re-bake a fresh OBJ per
  instance and kill instancing — use `g_array_*` only for genuine rule-based
  repetition where the re-bake cost is acceptable). **No new scene-level battery is
  needed** — per-item `g_bake_part` + reference assembly already covers it.
- The prompt names a recognizable part (knob, bezel, wheel, tire, hinge, vent,
  grille, fan, bracket, fork, yoke) → **Parts**.
- The prompt mentions gears / gearing / transmission → **Parts** gear ops, written
  with the DSL names in op-directory.md: `spur_gear` / `herringbone_gear` /
  `crossed_helical_gear` / `hyperbolic_gear` / `ring_gear` / `rack_gear` /
  `planetary_gearset` / `bevel_gear` / `worm`.
- The prompt names a building / house / room / interior or a building element
  (wall, partition, floor/slab, stair, roof, door, window, facade/siding) →
  **Architecture** (see the dedicated [PART B · 建筑](executions/part-b-building.md)).
  There is no whole-building orchestrator: emit each element op and assemble them
  into one rooted tree with `g_part` + `g_joint_fixed` (placing each via the joint
  `origin`/`rpy`).
- The form is hollow, has a cut/hole/recess/pocket, or is a lofted / revolved /
  swept / extruded / tapered / rounded body → **Profile → CSG** (build a profile,
  then extrude/revolve/loft, then `g_difference` to cut openings).
- The object has multiple parts and/or anything that moves (door, lid, wheel,
  switch, arm) → wrap each shape with **`g_part`** and connect with
  **`g_joint_*`** so it is one rooted URDF tree.
- The prompt names a **character / creature / soft body** (person, animal,
  monster, mascot) — anything that should be **one continuous skin bending
  smoothly with a skeleton** (not rigid parts turning about axes) → **Character
  rig** (see [PART D · 角色](executions/part-d-character.md)): bake each body part
  like PART A, then in assembly **author the bone tree by hand** — one
  `bone(origin=head, tail=, parent=)` per part with the parent chain set by anatomy
  (limbs each parent to a central bone, never leg-to-leg) — plus `skeleton(root=…)`
  and one `skin(method="auto")`. A single continuous part that wants several smoothly
  bending segments (tail, snake body, whip) uses **`bone_chain(origin=, tail=, count=N, parent=)`**
  instead of hand-writing N `bone` lines. Export with `export-glb({ mode: "character" })`. **This holds even when the creature MOVES:
  a walking / running / swimming animal is still a character — its locomotion is
  bone animation, never URDF joints.** **Never mix `joint` and `skin`/`skeleton`
  in one file** (mixed-model error).
- The prompt wants the exported GLB to **perform a motion** → **route by what is
  moving, not by the motion word.** A **living creature** that walks / runs /
  swims / wags → it is a character: build the skeleton (PART D) and add one
  `animation(...)` whose **channel keys are bone names** (value = bend radians
  about the bone's authored `axis`; e.g. a walk = each leg bone with `axis=[0,1,0]` swinging fore/aft, legs
  in alternating phase). A **mechanical / articulated** thing (door, lid,
  gripper, gear, robot arm, even a *walking robot*) → build the `joint`s first,
  then add one `animation(...)` whose **channel keys are joint names**. Either
  way describe the motion as sparse **`keyframes`** — a few `{t, q}` points per
  channel, never a full per-frame array (the battery samples/interpolates it).
  Joint example: `anim1 = animation(fps=30, keyframes="{\"wrist\":[{\"t\":0,\"q\":0},{\"t\":1,\"q\":1.2},{\"t\":2,\"q\":0}]}")`.
- The form is an **irregular rock / boulder / rubble / terrain decoration** → **`g_rock`**
  (DSL `rock`/`boulder`), not `g_sphere` — a plain sphere reads as an obviously artificial
  ball, `g_rock`'s seeded displacement gives a genuinely irregular silhouette for free.
- **Only if none of the above apply** and the form is literally a flat slab /
  plain rod / ball / ring with no cut, cavity, curve, or fillet → **Primitive**.

For any non-trivial object this routing runs **per part inside Phase 1**: each
part is modeled in its own subgraph and baked with **`g_bake_part`** into a staged
`<sha>.obj`. Phase 2 then references those meshes with **`g_mesh`**, wraps each in
`g_part`, colors with `g_material`, and connects with `g_joint_*`.

Then always end Phase 2 with QC + a terminal — but **the compiler auto-appends
the right chain by content, so you never hand-write the terminal**: jointless
object/scene → `g_geometry_qc → [g_bake_object] → g_to_scene → scene_preview`
(static, single merged GLB); has `joint` → `g_geometry_qc → g_to_urdf →
urdf_preview` (URDF); has `skin`/`skeleton` → `g_skin_qc → g_bake_object →
g_to_rig → rig_preview` (character).

- **Prefer the semantic family over faking a form with primitives + transforms.**
  A box-stack that "reads as" the object is the most common failure here — if you
  reach for a second or third primitive to imitate one part, you are on the wrong
  family. Re-route to CSG/Parts.
- New parametric detail on Parts (so you don't fake it with extra primitives):
  `g_knob` has `bore_d`/`skirt_diameter`+`skirt_height`/`indicator`; `g_bezel` has
  `flange_width`/`recess_depth`; `g_tire` has `tread_depth`+`tread_count`/
  `sidewall_depth`; `g_wheel` has `bore_d`/`spoke_count`; `g_vent_grille` has
  `slat_direction`. Gears expose `bore_d`; helical = `spur_gear` with a non-zero
  `helix_angle`; `bevel_gear` takes `helix_angle` for spiral bevels. Always confirm
  exact param names in [op-directory.md](op-directory.md).
- Read the richer sensor/report outputs: `g_geometry_qc` emits
  `floating_links` / `orphan_profiles` / `primitive_only` and a structured
  `signals[]`; `g_to_urdf` emits a `report` (mesh/triangle counts, `bakeFallbacks`,
  `fingerprint`). `g_auto_collision` derives `<collision>` for every part.
- Use preview/output batteries already present in the catalog to make the
  result visible in the URDF viewer.
- Treat missing batteries as a capability gap and report it instead of
  inventing op IDs.
