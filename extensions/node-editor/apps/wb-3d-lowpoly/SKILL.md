---
id: wb-3d-lowpoly:author-guide
trigger: /wb-3d-lowpoly
displayName:
  en: 3D Lowpoly Generator Author Guide
  zh: 3D 低多边形生成器 作者指引
---

# 3D Lowpoly Generator · AI guide

This plugin extends `@forgeax/node-runtime` with domain ops and surfaces
specific to **3D Lowpoly Generator** workflows. AI agents drive editor actions
through Studio ToolRegistry (`/api/tools/call`) tools declared in
`forgeax-extension.json`; nothing in this plugin requires a human-only path.

## Workflow shape — DSL-first

Geometry **DSL is the single source of truth**. You write DSL text; the backend
compiles it to a graph, executes it, bakes, and runs QC in **one** call. You
**never** hand-wire nodes/edges (`createNode`/`connect`).

1. `lowpoly:projects.list` / `lowpoly:projects.open` — choose the active project.
2. `lowpoly:model.apply({ source })` — the main entry point. Pass the **full**
   Geometry DSL text; the backend validates → compiles to a graph → imports (the
   visual editor updates) → executes → QC → URDF, and returns a **compact
   receipt**: `errors` / `qc.signals` / `meshQc.signals` are **mapped back to DSL
   line numbers**, plus mesh-aware interpenetration hard signals, baked-mesh
   suggestions (concrete translation deltas), and a URDF fingerprint. Read the
   receipt, fix the offending lines, re-`apply`. `model.apply` replaces the whole
   model each call, so always send the complete DSL.
3. `lowpoly:model.get` — read back the current model as DSL source (reconstructed
   from the graph, so any human edits in the editor round-trip back to DSL).
4. `lowpoly:parts.list` — list meshes you have baked (`name → sha256 + bbox +
   dims`); use these names in `mesh(filename=...)` for phase-2 assembly. Solves
   "I can't find the mesh I baked".

Syntax and op signatures: see `skills/compose-lowpoly/dsl-quickref.md` (DSL grammar
cheat-sheet) and `skills/compose-lowpoly/op-directory.md` (auto-generated, complete
op signatures — the SSOT for authoring; you do not need `batteries.list`).

The completion gate is a clean `model.apply` receipt (no `errors`, `qc.valid`,
`meshQc.clean`, no URDF errors) — judge the model purely from the receipt.

> **Transitional / legacy:** the low-level `lowpoly:pipeline.get` /
> `pipeline.applyBatch` / `pipeline.execute` tools still exist for humans and old
> flows, but agents should drive modeling through `model.apply` and never emit
> `createNode`/`connect`.

## Domain op catalogue

For DSL authoring, `skills/compose-lowpoly/op-directory.md` is the op-signature
SSOT — agents do **not** call `batteries.list` / `batteries.get`. The plugin ships
these geometry families under `batteries/<Stage>/<Family>/` — organised by pipeline
stage (**Generate → Modify → Assemble → Output**). Prefer the richer families over
stacking primitives:

### Generate
- **Primitive** — `g_box` `g_cylinder` `g_sphere` `g_cone` `g_capsule` `g_torus`
  `g_dome` `g_mesh`. Use only when the form genuinely is that primitive. `g_mesh`
  takes optional `bbox_min`/`bbox_max` (wired from `g_bake_part`) so a referenced
  mesh resolves an AABB for QC overlap checks.
- **Profile** — `g_profile_rect` `g_profile_rounded_rect` `g_profile_circle`
  `g_profile_polygon` `g_profile_regular_polygon`. 2D sections for CSG.
- **Parts** — semantic mechanical parts **and gears**:
  `g_knob` `g_bezel` `g_wheel` `g_tire` `g_vent_grille` `g_perforated_panel`
  `g_slot_panel` `g_barrel_hinge` `g_piano_hinge` `g_clevis_bracket`
  `g_pivot_fork` `g_trunnion_yoke` `g_fan_rotor` `g_blower_wheel`, plus the 6
  gear families: **`g_gear`** (one op covering spur / helical / herringbone /
  hyperbolic via a `tooth_profile` enum), `g_ring_gear`, `g_rack_gear`,
  `g_planetary_gearset` (each with a `tooth_profile` enum: spur|herringbone,
  rack adds straight), `g_bevel_gear`, and `g_worm`.
- **Architecture** — `g_wall` `g_floor_slab` `g_stairs` `g_roof`
  `g_facade_panel` `g_window` `g_door` `g_railing` `g_column`.
  Static low-poly building elements (walls with openings, slabs with wells,
  stairs, pitched roofs, framed windows/doors). Each exposes optional shaping
  knobs (all default off / backward-compatible): walls take an auto `window_band`
  and a `plinth` base; roofs split eave/verge overhang and add flat-roof
  parapets + coping; stairs add thin/open treads and a mid landing; columns take
  taper + base/capital styles + flutes; doors add panel grids + transom/sidelight;
  windows auto-divide panes by width and add sill/arch tops; railings pick post
  shape/spacing + bottom/mid rails; slabs add perimeter downstand beams + edge
  chamfer; facade panels choose groove direction/spacing + lap/shiplap board
  style. No whole-building orchestrator —
  emit the element ops and assemble them into one rooted tree by hand with
  `g_part` + `g_joint_fixed`. See **PART B** of the `skills/compose-lowpoly/` skill
  (`skills/compose-lowpoly/executions/part-b-building.md`).

### Modify
- **CSG** — `g_difference` `g_union` `g_intersection` `g_extrude`
  `g_extrude_with_holes` `g_loft` `g_revolve` `g_sweep` `g_lathe` `g_pipe`
  `g_section_loft` `g_fillet`. Hollow shells, cuts, recesses, lofted/swept/revolved
  solids. **`g_fillet`** rounds (`type=round`) or bevels (`type=chamfer`) a solid's
  edges (`edges=all` / `vertical`) — the general edge-treatment op; only works on
  solids, not on the meshes from `g_pipe`/`g_sweep`/`g_section_loft`, which emit a
  **mesh**, not a solid, and can't feed a boolean either.
- **Transform** — `g_translate` `g_rotate` `g_scale` `g_mirror` `g_array_linear`
  `g_array_radial`.
- **Material** — `g_material` `g_named_color`.
- **Placement** — `g_align_centers` `g_place_on_face` `g_place_on_surface`.

### Assemble
- **Assembly** — `g_part` + `g_joint_fixed` `g_joint_revolute`
  `g_joint_prismatic` `g_joint_continuous` `g_joint_planar` `g_joint_floating`
  `g_joint_mimic` `g_joint_on_surface`. Links + joints into one rooted URDF tree.
- **Collision** — `g_collision_box` `g_collision_clustered` `g_auto_collision`
  `g_inertial_from_geometry`.

### Output
- **Bake** — `g_bake_part` `g_bake_object`. `g_bake_part` also returns
  `bbox_min`/`bbox_max`/`size` (baked mesh local AABB + dimensions in meters) for
  placement and feeding `g_mesh`.
- **QC** — `g_validate` `g_geometry_qc`.
- **Export** — `g_to_urdf` (the terminal URDF emitter + OCCT baker; collision
  defaults to a coarse AABB box proxy for composite/baked meshes), `g_preview`,
  `urdf_preview`.

> **Gears** consolidated to 6 *batteries* (`g_gear`, `g_ring_gear`, `g_rack_gear`,
> `g_planetary_gearset`, `g_bevel_gear`, `g_worm`). **When authoring DSL, write the
> gear op names exactly as [op-directory.md](skills/compose-lowpoly/op-directory.md)
> lists them** (`spur_gear`, `herringbone_gear`, `ring_gear`, `rack_gear`,
> `bevel_gear`, `worm`, `planetary_gearset`, …) — there is **no bare `gear` DSL op**,
> and helical is `spur_gear` with a non-zero `helix_angle`. op-directory.md is the
> DSL SSOT; do not invent op names from this battery-level list.

The end-user modeling guidance lives in the single `skills/compose-lowpoly/`
skill — an entry/router (`SKILL.md`) over three flows: **PART A · asset /
mechanical** (philosophy, family routing, id-port wiring, runnable assembly
example, QC loop — `executions/part-a-asset.md`); **PART B · building** (the
architecture-flavoured walls/slabs/stairs/roofs/openings workflow + the building
brief — `executions/part-b-building.md`); and **PART C · scene assembly** (place
already-baked meshes into one URDF tree and export the whole scene to .glb —
`executions/part-c-scene-assembly.md`). The **required** shared references are
`op-directory.md` (op signatures) + `dsl-quickref.md` (syntax); `battery-catalog.md`
and `quickstart.md` are consulted on demand, and `modeling-guide.md` /
`pipeline-schema.md` are legacy `createNode`-format background only. Keep the op
catalogue in sync with the families under `batteries/<Stage>/<Family>/` when ops
are added or removed, and regenerate `op-directory.md`
(`node scripts/gen-op-directory.mjs`) so the DSL SSOT stays current.

## Domain surfaces

- `wb-3d-lowpoly.projects` — project list/create/open/remove actions.
- `wb-3d-lowpoly.model` — **DSL-first** modeling: `model.apply` (validate +
  compile + execute + QC in one call), `model.get` (read back DSL), `parts.list`
  (baked-mesh manifest). This is the primary agent surface.
- `wb-3d-lowpoly.pipeline` — low-level graph get/apply/execute/import/export
  actions (transitional / human; agents use `model.*`).
- `wb-3d-lowpoly.preview` — asset inspection actions (human-only; not an agent step).

## Path slots

(empty — populated when path slots are declared)
