# PART A · 资产 / 机械（逐件建模 → 引用 mesh 组装）

> [SKILL.md](../SKILL.md) 路由到此。本文件是 **PART A** 的完整执行步骤。
> 共享参考：ToolRegistry-first 工作流见 [quickstart.md](../quickstart.md)；各家族页见
> [modeling-guide.md](../modeling-guide.md)；电池速查见 [battery-catalog.md](../battery-catalog.md)；
> 图结构 / 可跑的两阶段示例见 [pipeline-schema.md](../pipeline-schema.md)。

适用：单个物件 / 机械件 / 装配体（枪、宝箱、齿轮组、机械臂…）——任何非平凡物件都走下面的
**强制两阶段工作流**。建筑走 [PART B](part-b-building.md)；把已 bake 的件摆成场景走
[PART C](part-c-scene-assembly.md)。

---

## Compose Lowpoly 3D Pipeline

## Purpose

Build and iterate a **3D Lowpoly Generator** project by calling Studio
ToolRegistry tools (`/api/tools/call`) that proxy to the plugin backend
`/api/v1/*` contract. Do not directly edit runtime files, do not drive the UI by
clicking, and do not use the legacy scene/renderer APIs.

## Official Tool Path

Call tools with `caller.kind = "ai"` unless the host provides a different
caller context:

```json
{
  "toolId": "lowpoly:pipeline.applyBatch",
  "args": { "ops": [], "opts": { "actor": "ai:lowpoly", "label": "compose model" } },
  "caller": { "kind": "ai" }
}
```

Use these tools:

- `lowpoly:projects.list`, `lowpoly:projects.create`, `lowpoly:projects.open`,
  `lowpoly:projects.remove`
- `lowpoly:batteries.list`, `lowpoly:batteries.get`
- `lowpoly:pipeline.get`, `lowpoly:pipeline.applyBatch`,
  `lowpoly:pipeline.execute`, `lowpoly:pipeline.import`,
  `lowpoly:pipeline.export`
- `lowpoly:assets.list`
- `lowpoly:screenshot.capture`, `lowpoly:screenshot.latest`

`lowpoly:projects.remove` requires destructive confirmation for AI callers.
`lowpoly:screenshot.store` is an internal renderer callback and is not exposed
to AI.

## Workflow — the normalized pipeline: **model Parts → assemble URDF**

The pipeline is fixed and non-negotiable. Every non-trivial object is built in
two passes: **(1) model each part on its own and bake it to a mesh, then
(2) assemble those meshes into one URDF.** Never build the whole object in a
single batch (see [the mandatory two-phase workflow](#mandatory-two-phase-workflow-read-before-the-first-applybatch)
below for the full rules — this list is the spine, that section is the law).

1. **Set up.** Open/create a project with `lowpoly:projects.*`. Inspect ops with
   `lowpoly:batteries.list` / `lowpoly:batteries.get` (never guess port names).
   Read the current graph with `lowpoly:pipeline.get`.
2. **Phase 0 — part manifest (hard gate).** Write one row per part *before* any
   node: name → real form → family/op route → key dimensions → detail points →
   per-primitive justification. No manifest, no building.
3. **Phase 1 — model + bake each part (loop, one part per pass).** For each part:
   build an independent `CSG` / `Parts` / `Gears` / `Architecture` subgraph that
   makes the real detail, end it with `g_bake_part`, and record the returned
   `filename` (`<sha>.obj`). One small `applyBatch` + `execute` per part.
4. **Phase 2 — assemble (one clean rewrite).** Reference each staged mesh with
   `g_mesh(filename=<sha>.obj)` → wrap in `g_part` → color with `g_material` →
   connect with `g_joint_*` into a single rooted tree → end with
   `g_geometry_qc` + `g_validate` + `g_to_urdf` + `urdf_preview`. Trivial
   primitive parts stay `g_box`/`g_cylinder`/`g_sphere` directly.
5. **Iterate on the assembly only.** Use `lowpoly:assets.list` /
   `lowpoly:screenshot.capture` / `lowpoly:screenshot.latest` as feedback; in
   Phase 2 only adjust joints / placement / color. To change a part's geometry,
   re-model + re-bake that single part in Phase 1.
6. When it matches the request, optionally save a template with
   `lowpoly:pipeline.export`.

Use `opts.actor = "ai:lowpoly"` and a concise `opts.label` on every
`applyBatch`. Each phase is its own `applyBatch`/`execute` pass (a small batch
per part in Phase 1) — never one mega-batch.

## Mandatory Two-Phase Workflow (read before the first `applyBatch`)

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
  bore_d=…)". Use the [modeling-guide.md](../modeling-guide.md) routing table.
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

1. Build an **independent subgraph from an empty geometry** (do not thread it into
   any other part's wire). Use `CSG` / `Parts` / `Gears` / `Architecture` to make
   the real detail — this is where form quality is won or lost.
2. End the subgraph with **`g_bake_part`** (`shape_id` = the terminal shape's id,
   wired from the upstream `id` output or set as a literal). It bakes that shape
   into a staged mesh in `library/blobs/` and returns `filename = <sha>.obj`.
3. **Record the returned `filename`** for Phase 2.
4. Move to the next part.

Phase-1 quality is enforced **only in prose**: pay attention to each part's detail
and formal plausibility as you model it. For efficiency, Phase 1 deliberately
**does not** require per-part screenshots and **does not** run a per-part detail
QC gate — bake as soon as the part looks right and move on. Model each part around
its **own local origin / assembly datum**: the bake stores *local* coordinates, so
all placement happens later in Phase 2 via part/joint origins.

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
- knob, bezel, wheel, tire, hinge, fan, gear → the matching `Parts` / `Gears`
  battery (parametric and already correct), **not** an approximation.
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
- end with `g_geometry_qc` + `g_validate` + `g_to_urdf` + `urdf_preview`, then
  take a **whole-object screenshot**.

If the assembled object is wrong, only adjust **joints / placement / color** in
Phase 2 — do **not** reach back into a part's internals. To change a part's
geometry, re-model and re-bake that single part in Phase 1.

**Material decision (settled):** the stage format is **OBJ (pure geometry)**;
color is applied in Phase 2 by `g_material` on the link. `g_bake_part` only bakes
geometry — the baker is unchanged and nothing is embedded in the mesh.

**Phase-2 efficiency check:** because Phase 2 is all native `g_mesh` references,
`g_to_urdf` should report `bakeFallbacks = 0`, `report.meshFileCount = 0`, and
`stats.meshProvenance` all `native` — it does **not** re-bake; the meshes were
already staged in `library/blobs/` during Phase 1.

### Forbidden anti-pattern

A single mega-`applyBatch` that heaps the entire object's shapes, parts and joints
at once. It always degrades into primitive stacking and under-modeled parts.
Phase 1 (per-part subgraph → `g_bake_part`) and Phase 2 (mesh references →
assembly) are mandatory and separate.

## Modeling Decisions

- Prefer semantic lowpoly batteries when available; inspect the op catalog
  first (`lowpoly:batteries.list` → families in
  [battery-catalog.md](../battery-catalog.md)).
- **Follow the two-phase workflow above for any non-trivial object**: Phase 1
  models + bakes each part with `g_bake_part` (one independent subgraph per part,
  staged to a `<sha>.obj`), Phase 2 references those meshes with `g_mesh` and
  assembles. Each phase is its own `applyBatch`/`execute` pass (or a small batch
  per part in Phase 1) — never one mega-batch.
- Use node-runtime graph batches for creation, connection, parameter updates,
  grouping, and deletion. Do not write `state/graph.json` by hand.
- Keep model units in meters and preserve the plugin's Z-up viewer convention.
- For previewable results, wire generated geometry toward the URDF preview path
  used by the current battery catalog.
- Use assets and screenshots as feedback for multi-turn iteration; do not
  declare completion from graph edits alone.

## References

- [quickstart.md](../quickstart.md): ToolRegistry-first workflow + brief/QC loop.
- [modeling-guide.md](../modeling-guide.md): per-family pages (when to use, key
  params, minimal wiring snippets).
- [battery-catalog.md](../battery-catalog.md): family list + routing table + how to
  discover batteries.
- [pipeline-schema.md](../pipeline-schema.md): graph/batch shape, id-port wiring,
  a runnable multi-part assembly example, and a runnable **two-phase**
  (`g_bake_part` stage → `g_mesh` assemble) example.
