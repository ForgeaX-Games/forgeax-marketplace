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
`forgeax-plugin.json`; nothing in this plugin requires a human-only path.

## Workflow shape

1. `lowpoly:projects.list` / `lowpoly:projects.open` to choose the active
   project.
2. `lowpoly:batteries.list` and `lowpoly:batteries.get` to inspect exact op
   IDs and ports.
3. `lowpoly:pipeline.get` to read the graph.
4. `lowpoly:pipeline.applyBatch` to create/update/remove nodes and edges.
5. `lowpoly:pipeline.execute` to run the graph.
6. `lowpoly:screenshot.capture` (returns an orthographic Front/Side/Top/Iso 2×2
   contact sheet) and `lowpoly:assets.list` to verify the preview and
   exported/project assets.

## Domain op catalogue

`lowpoly:batteries.list` is authoritative (dynamic; includes plugin domain ops
plus shared node-runtime ops). The plugin ships these geometry families under
`batteries/<Stage>/<Family>/` — organised by pipeline stage (**Generate →
Modify → Assemble → Output**). Prefer the richer families over stacking
primitives:

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
  `g_facade_panel` `g_window` `g_door` `g_railing` `g_column` + generator
  `g_building_shell`.
  Static low-poly building elements (walls with openings, slabs with wells,
  stairs, pitched roofs, framed windows/doors) and room/building orchestrators
  that emit shape→part→fixed-joint subtrees. See **PART B** of the
  `skills/compose-lowpoly/` skill
  (`skills/compose-lowpoly/executions/part-b-building.md`).

### Modify
- **CSG** — `g_difference` `g_union` `g_intersection` `g_extrude`
  `g_extrude_with_holes` `g_loft` `g_revolve` `g_sweep` `g_lathe` `g_pipe`
  `g_section_loft`. Hollow shells, cuts, recesses, lofted/swept/revolved solids.
  (`g_pipe`/`g_sweep`/`g_section_loft` emit a **mesh**, not a solid — they can't
  feed a boolean.)
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

> **Gears were consolidated 15 → 6** and the old per-profile battery ids
> (`g_spur_gear`, `g_herringbone_*`, `g_crossed_*`, `g_hyperbolic_*`, the
> `*_pair` ops) were **removed** — there is no Legacy palette group. Use `g_gear`
> + `tooth_profile` (or the parameterized ring/rack/planetary ops) for all gears.
> The baker still understands every underlying gear DSL op, but graphs saved with
> a removed battery id must be re-created with `g_gear`.

The end-user modeling guidance lives in the single `skills/compose-lowpoly/`
skill — an entry/router (`SKILL.md`) over three flows: **PART A · asset /
mechanical** (philosophy, family routing, id-port wiring, runnable assembly
example, QC loop — `executions/part-a-asset.md`); **PART B · building** (the
architecture-flavoured walls/slabs/stairs/roofs/openings workflow + the building
brief — `executions/part-b-building.md`); and **PART C · scene assembly** (place
already-baked meshes into one URDF tree and export the whole scene to .glb —
`executions/part-c-scene-assembly.md`). Shared references (modeling-guide,
battery-catalog, pipeline-schema, quickstart) sit at the skill root. Keep this
catalogue in sync with the families under `batteries/<Stage>/<Family>/` when ops
are added or removed — `lowpoly:batteries.list` remains the authoritative SSOT.

## Domain surfaces

- `wb-3d-lowpoly.projects` — project list/create/open/remove actions.
- `wb-3d-lowpoly.pipeline` — graph get/apply/execute/import/export actions.
- `wb-3d-lowpoly.preview` — screenshot and asset inspection actions.

## Path slots

(empty — populated when path slots are declared)
