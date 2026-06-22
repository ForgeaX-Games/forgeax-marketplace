# Battery Catalog

The battery catalog is runtime data. Always query it instead of copying stale
IDs from old scene generator docs.

## List Batteries

```json
{
  "toolId": "lowpoly:batteries.list",
  "args": {},
  "caller": { "kind": "ai" }
}
```

Each item includes the op `id`, display names, inputs, outputs, params, dynamic
ports, lacing, and principal output hints.

## Get One Battery

```json
{
  "toolId": "lowpoly:batteries.get",
  "args": { "id": "g_box" },
  "caller": { "kind": "ai" }
}
```

Use the returned `inputs`, `outputs`, and `params` exactly when building graph
batches. Do not infer port names from labels.

## Lowpoly Guidance

## Battery Families

The op id (`g_*`) is authoritative from `lowpoly:batteries.list`; the families
below tell you **which op to even look for**. See
[modeling-guide.md](modeling-guide.md) for per-family params and wiring.

| Family | Examples | Produces | Use when |
|---|---|---|---|
| **Primitive** | `g_box` `g_cylinder` `g_sphere` `g_cone` `g_capsule` `g_torus` `g_dome` `g_mesh` | a `geometry` + `id` | the visible form genuinely *is* that primitive (slab, plain rod, ball); **`g_mesh` references a Phase-1 staged `<sha>.obj`** to reassemble a baked part (set its optional `bbox_min`/`bbox_max` from `g_bake_part` so the scene mesh resolves an AABB for QC overlap) |
| **Profile** | `g_profile_rect` `g_profile_rounded_rect` `g_profile_circle` `g_profile_polygon` `g_profile_regular_polygon` | a 2D `profile` + `id` | you need a cross-section to feed extrude / revolve / loft / sweep |
| **CSG** | `g_difference` `g_union` `g_intersection` `g_extrude` `g_extrude_with_holes` `g_loft` `g_revolve` `g_sweep` `g_lathe` `g_pipe` `g_section_loft` | a `geometry` + `id` | hollow shells, cut openings/holes, recesses, lofted/swept/revolved bodies, merged solids |
| **Parts** | `g_knob` `g_bezel` `g_wheel` `g_tire` `g_vent_grille` `g_perforated_panel` `g_slot_panel` `g_barrel_hinge` `g_piano_hinge` `g_clevis_bracket` `g_pivot_fork` `g_trunnion_yoke` `g_fan_rotor` `g_blower_wheel` | a `geometry` + `id` | the prompt names a real mechanical part (knob, bezel, wheel, hinge, vent, fan, bracket) |
| **Gears** | `g_spur_gear` `g_bevel_gear` `g_ring_gear` `g_rack_gear` `g_worm` `g_planetary_gearset` `g_herringbone_gear` … | a `geometry` + `id` | the prompt names gears / gearing / transmission |
| **Architecture** | `g_wall` `g_floor_slab` `g_stairs` `g_roof` `g_facade_panel` `g_window` `g_door` `g_railing` `g_column` + generator `g_building_shell` | a `geometry` + `id` (generator also returns `root_id`) | the prompt names a building / house / room / wall / floor / stair / roof / door / window / railing / column (static low-poly architecture) |
| **Transform** | `g_translate` `g_rotate` `g_scale` `g_mirror` `g_array_linear` `g_array_radial` | transformed `geometry` | place / orient / mirror / repeat an existing shape |
| **Assembly** | `g_part` + `g_joint_fixed` `g_joint_revolute` `g_joint_prismatic` `g_joint_continuous` `g_joint_planar` `g_joint_floating` `g_joint_mimic` `g_joint_on_surface` | a `geometry` (URDF links/joints) + `id` | wrap a shape into a link (`g_part`) and connect links into one rooted tree (`g_joint_*`) |
| **Utils** | `g_bake_part` `g_material` `g_named_color` `g_align_centers` `g_place_on_face` `g_place_on_surface` `g_collision_box` `g_collision_clustered` `g_auto_collision` `g_inertial_from_geometry` `g_validate` `g_geometry_qc` `g_to_urdf` | varies | **`g_bake_part`** = Phase-1 bake-staging (one part subgraph → reusable `<sha>.obj` mesh; also returns `bbox_min`/`bbox_max`/`size` for placement + feeding `g_mesh`); plus materials, placement helpers, collision/inertia, QC sensors, and the terminal **`g_to_urdf`** URDF emitter |
| **Preview** | `urdf_preview` `g_preview` | URDF / preview | make the model visible in the URDF viewer |

### Which family? (routing — try these top-to-bottom, primitive is LAST)

Default to a richer family; only fall through to **Primitive** when every row
above genuinely does not apply.

- The prompt names a recognizable part (knob, bezel, wheel, tire, hinge, vent,
  grille, fan, bracket, fork, yoke) → **Parts**.
- The prompt mentions gears / gearing / transmission → **Gears**.
- The prompt names a building / house / room / interior or a building element
  (wall, partition, floor/slab, stair, roof, door, window, facade/siding) →
  **Architecture** (see the dedicated [PART B · 建筑](executions/part-b-building.md)). Prefer
  the `g_building_shell` generator over hand-wiring walls (use `floors=1,
  rooms_per_floor=1, roof_type=none` for a single room).
- The form is hollow, has a cut/hole/recess/pocket, or is a lofted / revolved /
  swept / extruded / tapered / rounded body → **Profile → CSG** (build a profile,
  then extrude/revolve/loft, then `g_difference` to cut openings).
- The object has multiple parts and/or anything that moves (door, lid, wheel,
  switch, arm) → wrap each shape with **`g_part`** and connect with
  **`g_joint_*`** so it is one rooted URDF tree.
- **Only if none of the above apply** and the form is literally a flat slab /
  plain rod / ball / ring with no cut, cavity, curve, or fillet → **Primitive**.

For any non-trivial object this routing runs **per part inside Phase 1**: each
part is modeled in its own subgraph and baked with **`g_bake_part`** into a staged
`<sha>.obj`. Phase 2 then references those meshes with **`g_mesh`**, wraps each in
`g_part`, colors with `g_material`, and connects with `g_joint_*`.

Then always end Phase 2 with **Utils QC** (`g_geometry_qc` + `g_validate`) →
optional `g_auto_collision` → **Preview** (`g_to_urdf` → `urdf_preview`).

- **Prefer the semantic family over faking a form with primitives + transforms.**
  A box-stack that "reads as" the object is the most common failure here — if you
  reach for a second or third primitive to imitate one part, you are on the wrong
  family. Re-route to CSG/Parts.
- New parametric detail on Parts (so you don't fake it with extra primitives):
  `g_knob` has `bore_d`/`skirt_diameter`+`skirt_height`/`indicator`; `g_bezel` has
  `flange_width`/`recess_depth`; `g_tire` has `tread_depth`+`tread_count`/
  `sidewall_depth`; `g_wheel` has `bore_d`/`spoke_count`; `g_vent_grille` has
  `slat_direction`. Gears expose `bore_d`; `g_bevel_gear` takes `helix_angle` for
  spiral bevels; `g_herringbone_rack_gear` builds a real V-chevron. Always confirm
  exact param names with `lowpoly:batteries.get`.
- Read the richer sensor/report outputs: `g_geometry_qc` emits
  `floating_links` / `orphan_profiles` / `primitive_only` and a structured
  `signals[]`; `g_to_urdf` emits a `report` (mesh/triangle counts, `bakeFallbacks`,
  `fingerprint`). `g_auto_collision` derives `<collision>` for every part.
- Use preview/output batteries already present in the catalog to make the
  result visible in the URDF viewer.
- Treat missing batteries as a capability gap and report it instead of
  inventing op IDs.
