# PART A · 资产 / 机械（逐件建模 → 引用 mesh 组装）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART A** 的完整执行步骤。
> 授权参考只需两份：DSL 语法 + 可跑示例 [dsl-quickref.md](../dsl-quickref.md)、op 签名
> [op-directory.md](../op-directory.md)。选型拿不准再查 [battery-catalog.md](../battery-catalog.md)
> 的路由表——按需，别一次全读。

> **DSL-first（唯一流程）**：**只写 DSL、用 `lowpoly:model.apply({ source })` 提交**——后端一次完成
> 校验+编译成图+执行+QC，回执把错误/QC 信号**定位到 DSL 行号**。**阶段1 烘焙**用
> `model.apply({ source, bake: "<shape_id>" })`（回执 `baked.filename`=`<sha>.obj`，自动登记
> `parts.json`，`lowpoly:parts.list` 可查）；**阶段2 组装**写 `mesh(filename="<sha>.obj")` → `part`
> → `joint` 再 `model.apply`。语法见 [dsl-quickref.md](../dsl-quickref.md)，op 签名见
> [op-directory.md](../op-directory.md)（authoring SSOT，不必再读 battery-catalog / modeling-guide）。
> **完成门禁 = 回执干净**（无 errors / `qc.valid` / `meshQc.clean` / 无 urdf 错误）——完成判定只看回执。

适用：单个物件 / 机械件 / 装配体（枪、宝箱、齿轮组、机械臂…）——任何非平凡物件都走下面的
**强制两阶段工作流**。建筑走 [PART B](part-b-building.md)；把已 bake 的件摆成场景走
[PART C](part-c-scene-assembly.md)。

---

## Workflow spine — model each part → bake → assemble

`caller.kind = "ai"`. Every non-trivial object is built in two passes and **never
in a single mega-model**:

1. **Set up.** Open/create a project with `lowpoly:projects.*`. Get op signatures
   from [op-directory.md](../op-directory.md) — do **not** call `batteries.list` /
   `batteries.get`.
2. **Phase 0 — part manifest (hard gate).** One detailed row per part *before* any
   DSL (see below). No manifest, no building.
3. **Phase 1 — model + bake each part (loop).** For each part write a small DSL that
   builds the real detail (CSG / Parts / gears / Architecture) and submit
   `model.apply({ source, bake: "<shape_id>" })`. Record the returned `<sha>.obj`
   filename + bbox. One part per `apply`.
4. **Phase 2 — assemble (one clean DSL).** `mesh(filename=<sha>.obj)` → `part` →
   `material` → `joint` into one rooted tree, then `model.apply({ source })` (the
   compiler auto-appends the QC + URDF terminals — you do not write them).
5. **Iterate on the assembly only** from the receipt signals. To change a part's
   geometry, re-model + re-bake that single part in Phase 1.

## Mandatory Two-Phase Workflow (read before the first `model.apply`)

> **The default failure mode of this skill is laziness: the agent heaps the whole
> object into one big batch, stacks a few `g_box`/`g_cylinder` primitives, the
> batch turns green, and ships a blocky toy that does not look like the object.**
> One mega-batch that builds the entire graph at once *forces* this degradation —
> there is no room to model any single part properly.

**Hard rule — never compose the whole object in a single batch.** Build every
non-trivial object in two phases: model each part *on its own*, bake it to a
reusable mesh, then assemble a clean graph that only *references* those meshes.

This works because the backend already content-addresses baked meshes: when
`g_to_urdf` (or `g_bake_part`) bakes a non-native shape it writes a
content-addressed `.obj` into the workspace-level `library/blobs/` and hands you a
`<sha>.obj` filename. `g_mesh(filename=<sha>.obj)` references it, and the viewer
resolves it over the same baseUrl. So Phase 1 *stages* meshes and Phase 2
*references* them — no re-baking, no re-running heavy CSG at assembly time.

### Phase 0 — Part manifest (hard gate)

This manifest is the **build spec that Phase 1 models against**, so it must be
detailed enough that someone could model each part *from the row alone, without
seeing the original object*. A thin list like "A: box, B: cylinder, C: box" is a
**failed manifest** — it carries no form, no function, no features, and Phase 1
will degrade straight back into stacked primitives. Be specific and concrete:
describe the *real thing*, not a placeholder shape.

First decompose the object into its real parts (a part = a piece that is a
distinct solid, a distinct material/color, or a piece that moves independently —
do not merge two functionally different pieces into one row, and do not invent
filler parts). Then write **one row per part** with **all** of these fields:

- **part name + function** — what this part *is* and what it *does* in the whole
  object (e.g. "barrel — houses the piston and forms the main pressure body";
  "trigger — the pivoting lever the finger pulls"). Function drives form.
- **real form** — 2–3 sentences describing the actual geometry so it is
  recognizable: overall silhouette, the cross-section/profile, whether it is
  hollow vs solid, tapered/curved/straight, symmetry, and what makes it read as
  *this* object and not a generic block. Ban placeholder phrases ("a box-ish
  thing", "roughly cylindrical", "some kind of cover").
- **family / op route** — the concrete modeling route, as an op sketch, not just a
  family name: e.g. "Profile→CSG: `g_profile_rounded_rect` → `g_extrude` →
  `g_difference` (bore the cavity)", or "Parts: `g_knob` (body_style=domed,
  bore_d=…)". Use the [battery-catalog.md](../battery-catalog.md) routing table.
- **key dimensions** — meters, with the axis each one runs along (length X / depth
  Y / height Z, radii, wall thickness) **and** rough proportion to neighbouring
  parts so scale stays consistent across the assembly.
- **detail features** — every feature that must show up and *where it sits*: holes
  / bores / cavities / recesses / chamfers / fillets / grilles / slots / ribs /
  embossed text / tapers. For each, say roughly where on the part and how big.
  This is the list Phase 1 must actually build (mostly via CSG/Parts).
- **local origin / datum + orientation** — where the part's local origin sits
  (which face / axis / centerline) and how it is oriented, because Phase 1 bakes
  *local* coordinates and Phase 2 places the part by this datum. State which face
  or axis mates to the parent.
- **assembly link** — which part it attaches to and the joint: `g_joint_fixed`
  for static, or `g_joint_revolute`/`prismatic`/`continuous` for moving parts
  (give the axis and rough limits). This is the Phase-2 wiring reference.
- **material / color** — the part's color/finish (applied in Phase 2 via
  `g_material`, not baked into the mesh).
- **per-primitive justification** — if (and only if) a part is routed to a bare
  `Primitive`, finish the sentence: *"this part is a primitive because the real
  form here is literally a {slab|rod|ball|ring}, with no cut, cavity, curve, or
  fillet."* If you need a "but it also has a hole / it's rounded / it's close
  enough", it is **not** a primitive — route it to CSG/Parts. "Close enough" and
  "I'll approximate it" are banned.

**Worked example of the required level of detail (one row):**

> **Part: `barrel` — function:** the main body of the spray bottle; holds the
> liquid and threads onto the cap. **Real form:** a tall hollow cylinder with a
> slight shoulder taper near the top and a rounded bottom; open at the top with an
> external thread collar, walls thin (it's a vessel, not a solid rod).
> **Op route:** Profile→CSG — `g_profile_circle` → `g_revolve` for the tapered
> body, then `g_difference` with an inner `g_revolve` to hollow it (wall ~2 mm).
> **Dimensions:** height 0.18 (Z), outer radius 0.035, wall 0.002, shoulder starts
> at Z≈0.15. **Detail features:** internal cavity (full hollow); thread collar
> ring at the top rim (Z 0.17–0.18); rounded bottom fillet r≈0.01. **Datum:**
> local origin at the center of the base, axis = +Z; top rim mates to the cap.
> **Assembly link:** parent of `cap` via `g_joint_fixed` at the top rim (or
> `revolute` about Z if the cap should twist). **Material:** translucent white.

A correct manifest has every part at roughly that density. **Do not build any
node until the manifest is complete** — and if a row reads as thin/generic, fix
the row before modeling, not during.

### Phase 1 — Per-part standalone modeling + bake staging (loop)

Iterate over the manifest, **one part at a time**. For each part:

1. Write a **small standalone DSL** for just this part. Use `CSG` / `Parts` (incl.
   gears) / `Architecture` to make the real detail — this is where form quality is
   won or lost.
2. Submit `model.apply({ source, bake: "<shape_id>" })` where `<shape_id>` is the
   terminal shape's `id`. The backend bakes it into `library/blobs/` and returns
   `baked.filename = <sha>.obj` (plus `bbox_min` / `bbox_max` / `size`), and
   auto-registers it (query later via `lowpoly:parts.list`).
3. **Record the returned `<sha>.obj` filename + bbox** for Phase 2.
4. Move to the next part — each `bake` apply replaces the graph, so nothing
   accumulates; you carry only the recorded filenames forward.

Phase-1 quality is enforced **only in prose**: pay attention to each part's detail
and formal plausibility as you model it. Phase 1 has **no per-part QC gate** — bake
as soon as the part reads right and move on. Model each part around its **own local
origin / assembly datum**: the bake stores *local* coordinates, so all placement
happens later in Phase 2 via part/joint origins.

The anti-primitive rules still govern Phase-1 modeling. Real objects are
**shells, cuts, curves, recesses, grilles, gears, hinges and fillets** — almost
none are a bare box or cylinder. Before placing any primitive, default to "which
CSG/Parts op builds this for real?":

- hollow shell / casing / enclosure → profile → `g_extrude`/`g_revolve` then
  `g_difference` (cut the cavity), **not** a box.
- opening / window / port / slot / vent → `g_difference` (or `g_vent_grille` /
  `g_perforated_panel` / `g_slot_panel`), **not** a smaller box laid on top.
- round / domed / bottle / nozzle / barrel body → `g_revolve` / `g_lathe` /
  `g_loft`, **not** a cylinder.
- pipe / cable / handle / duct → `g_pipe` / `g_sweep`, **not** stacked cylinders.
- knob, bezel, wheel, tire, hinge, fan, gear → the matching `Parts` op (gears via
  the `spur_gear` / `herringbone_gear` / `bevel_gear` / `ring_gear` / `rack_gear` /
  `worm` / `planetary_gearset` DSL ops in op-directory.md; parametric and already
  correct), **not** an approximation.
- rounded edges / chamfers / fillets → build them into the profile
  (`g_profile_rounded_rect`) or via CSG, **not** ignored.

`g_bake_part` skips native primitives on purpose: if `shape_id` points at a
`box`/`cylinder`/`sphere` it bakes nothing and returns an empty `filename` plus a
`note`. Such trivial parts need no mesh — assemble them in Phase 2 with `g_box`
/ `g_cylinder` / `g_sphere` directly.

### Phase 2 — Reference meshes to assemble (rewrite a clean lightweight DSL)

Start a **fresh, clean geometry DSL** — do **not** reuse Phase-1 subgraphs. For
each part:

- **non-trivial part** → `g_mesh(filename = the <sha>.obj staged in Phase 1)`
  (wire `g_bake_part.filename` straight into `g_mesh.filename`, or paste the
  literal). 
- **trivial primitive part** → `g_box` / `g_cylinder` / `g_sphere` directly.
- wrap each shape with `g_part`.
- **color each part with `g_material` / `g_named_color`** — color rides on the
  URDF `<material>` on the link, it does **not** go into the mesh.
- connect parts with `g_joint_*` into a **single rooted tree**.
- optionally `g_auto_collision` (a mesh visual gets an AABB collision).
- submit `model.apply({ source })`. The compiler auto-appends the QC + URDF
  terminals; judge completion from the receipt signals (see
  [quickstart.md](../quickstart.md#iteration-loop)).

If the assembled object is wrong, only adjust **joints / placement / color** in
Phase 2 — do **not** reach back into a part's internals. To change a part's
geometry, re-model and re-bake that single part in Phase 1.

**Material decision (PART A default):** the per-part stage format is **OBJ (pure
geometry)**; `g_bake_part` bakes geometry only and color is applied in Phase 2 by
`g_material` on the link. This keeps geometry deduped and lets you recolor per
instance.

> **Alternative — one reusable colored asset:** if this object will be **placed into
> scenes as a fixed-palette unit** (and has no moving joints), you can instead skip
> the per-part OBJ staging and bake the whole colored object into a **single
> multi-material `<sha>.glb`** with **`g_bake_object`**: build all parts with their
> real shapes + `g_material` in one graph, then `g_bake_object`. Scenes reference it
> once via `g_mesh(filename=<sha>.glb)` with **no link material**. See
> [PART C · route A](part-c-scene-assembly.md). Trade-off: color is baked in, so the
> `.glb` is not recolorable per instance and same-shape/different-color does not
> dedup. Use the OBJ + Phase-2 `g_material` route when you need per-instance recolor.

**Phase-2 efficiency check:** because Phase 2 is all native `g_mesh` references,
`g_to_urdf` should report `bakeFallbacks = 0`, `report.meshFileCount = 0`, and
`stats.meshProvenance` all `native` — it does **not** re-bake; the meshes were
already staged in `library/blobs/` during Phase 1.

### Forbidden anti-pattern

A single mega-model that heaps the entire object's shapes, parts and joints into
one DSL. It always degrades into primitive stacking and under-modeled parts.
Phase 1 (per-part bake) and Phase 2 (mesh references → assembly) are mandatory
and separate.

## Modeling Decisions

- Prefer semantic ops (Parts, gears, Architecture, CSG) over stacked primitives;
  route with the table in [battery-catalog.md](../battery-catalog.md). Op
  signatures come from [op-directory.md](../op-directory.md) — never guess, never
  call `batteries.list` / `batteries.get`.
- **Two-phase for any non-trivial object**: Phase 1 bakes each part to a
  `<sha>.obj` (one `model.apply({bake})` per part), Phase 2 references them with
  `mesh` and assembles in one `model.apply`. Keep units in meters, Z-up.
- Judge completion from the receipt signals (`errors` / `qc` / `meshQc` / `urdf`).

## References

- [dsl-quickref.md](../dsl-quickref.md): DSL grammar + a minimal runnable example.
- [op-directory.md](../op-directory.md): the authoritative op signatures (SSOT).
