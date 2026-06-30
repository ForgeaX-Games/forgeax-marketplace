# Modeling Guide — per-family pages

Use this **after** writing the decomposition brief
([executions/part-a-asset.md](executions/part-a-asset.md#phase-0--part-manifest-hard-gate)) to
pick the right family for each part. Op ids and exact port names are
authoritative from `lowpoly:batteries.get` — the snippets below show the *shape*
of the wiring, not a substitute for inspecting the battery.

Conventions used in every snippet:

- All ops thread one `geometry` value: each op's `geometry` output feeds the next
  op's `geometry` input (omitted for brevity below; see
  [pipeline-schema.md](pipeline-schema.md) for the full edge list).
- `*_id` inputs reference an id already in that geometry — set it as a param or
  wire the upstream `id` output into the `*_id` input.
- Units are meters; the viewer is Z-up.

---

## Primitive — `g_box` `g_cylinder` `g_sphere` `g_cone` `g_capsule` `g_torus` `g_dome` `g_mesh`

**When to use:** the visible form genuinely *is* that primitive — a slab, a plain
rod, a ball, a ring — **and** you can say the rule-2 justification out loud (no
cut, cavity, curve, or fillet). **Not** for hollow shells, cuts, recesses,
openings, or curved/lofted/tapered bodies, and **never** as two/three boxes
stacked to imitate a richer shape — that is the #1 failure mode; re-route to CSG
or Parts the moment you reach for a second primitive to fake one part.

Key params: `size`/`radius`/`height` per shape; `id` (set it for deterministic
refs). Outputs `geometry` + `id`.

```jsonc
{ "type": "createNode", "nodeId": "n_rod", "opId": "g_cylinder",
  "params": { "radius": 0.02, "height": 0.3, "id": "rod" } }
```

**`g_mesh`** is the Phase-2 workhorse: it references an external mesh by
`filename`. In the two-phase workflow that filename is a Phase-1 staged
`<sha>.obj` (see [the bake-staging section](#bake-staging--reference-assembly-two-phase)).
`g_mesh.filename` is a wireable input port, so you can connect a `g_bake_part`
`filename` **output** straight into a `g_mesh` `filename` **input**, or paste the
`<sha>.obj` literal as a param. `g_mesh` also takes optional **`bbox_min` /
`bbox_max`** (the unscaled local AABB, usually wired from `g_bake_part`'s same-named
outputs): set them so the scene mesh resolves an AABB (scaled by `sx/sy/sz`) and
`g_geometry_qc`'s overlap check works — without them a mesh is `missing_aabb` and
interpenetration goes undetected.

```jsonc
{ "type": "createNode", "nodeId": "n_mesh", "opId": "g_mesh",
  "params": { "filename": "<sha>.obj", "id": "body_mesh",
              "bbox_min": [-0.1,-0.05,0], "bbox_max": [0.1,0.05,0.3] } }
```

---

## Profile — `g_profile_rect` `g_profile_rounded_rect` `g_profile_circle` `g_profile_polygon` `g_profile_regular_polygon`

**When to use:** you need a 2D cross-section to feed a CSG `extrude` / `revolve` /
`loft` / `sweep`. A profile alone is not a solid.

Key params: shape dimensions (`width`/`height`/`radius`/`points`); `id`. Output
`id` feeds a CSG `profile_id`.

```jsonc
{ "type": "createNode", "nodeId": "n_prof", "opId": "g_profile_rounded_rect",
  "params": { "width": 0.2, "height": 0.1, "radius": 0.02, "id": "face" } }
```

---

## CSG — `g_difference` `g_union` `g_intersection` `g_extrude` `g_extrude_with_holes` `g_loft` `g_revolve` `g_sweep` `g_lathe` `g_pipe` `g_section_loft`

**When to use:** the form is hollow, has a cut/hole/recess, or is a lofted /
revolved / swept / extruded body. This is the anti-primitive workhorse — reach
here before stacking boxes.

Id ports (reference *shape* / *profile* ids): `base_id`+`tool_id` (difference),
`a_id`+`b_id` (union/intersection), `profile_id` (extrude/revolve/lathe),
`outer_id`+`hole_ids` (extrude_with_holes), `profile_ids` (loft). On a bad ref
the op appends nothing and returns `{ error }` — read it.

```jsonc
// cut an opening out of a body instead of faking it with a box
{ "type": "createNode", "nodeId": "n_cut", "opId": "g_difference",
  "params": { "base_id": "body", "tool_id": "cavity", "id": "shell" } }

// solid from a profile
{ "type": "createNode", "nodeId": "n_ext", "opId": "g_extrude",
  "params": { "profile_id": "face", "height": 0.05, "id": "panel" } }
```

---

## Parts — `g_knob` `g_bezel` `g_wheel` `g_tire` `g_vent_grille` `g_perforated_panel` `g_slot_panel` `g_barrel_hinge` `g_piano_hinge` `g_clevis_bracket` `g_pivot_fork` `g_trunnion_yoke` `g_fan_rotor` `g_blower_wheel`

**When to use:** the prompt names a recognizable mechanical part. Trigger words →
op:

- knob / dial / cap → `g_knob`; bezel / ring frame → `g_bezel`
- wheel / rim → `g_wheel`; tire → `g_tire`
- vent / louver / grille → `g_vent_grille`; perforated / mesh panel →
  `g_perforated_panel`; slotted panel → `g_slot_panel`
- hinge → `g_barrel_hinge` / `g_piano_hinge`; bracket / clevis → `g_clevis_bracket`;
  fork → `g_pivot_fork`; yoke / trunnion → `g_trunnion_yoke`
- fan / impeller → `g_fan_rotor`; blower / squirrel-cage → `g_blower_wheel`

Each appends one parametric shape (`geometry` + `id`); wrap the `id` with
`g_part` to make it a link. **Use the part's own parameters instead of bolting on
extra primitives** — the batteries already cut bores, recesses, treads, spokes,
indicators and flanges for you:

- `g_knob`: `bore_d` (center shaft hole), `skirt_diameter` + `skirt_height` (base
  skirt), `indicator` (top pointer groove), `body_style`
  (cylindrical/tapered/domed/mushroom/skirted/…).
- `g_bezel`: `flange_width` (rear mounting flange), `recess_depth` (front seat).
- `g_tire`: `tread_depth` + `tread_count` (circumferential grooves),
  `sidewall_depth` (side recess).
- `g_wheel`: `bore_d` (hub hole), `spoke_count` (radial spokes instead of a solid
  disc).
- `g_vent_grille`: `slat_direction`, `slat_angle_deg`, `duct_depth`.

Confirm exact names/defaults with `lowpoly:batteries.get` before wiring.

```jsonc
{ "type": "createNode", "nodeId": "n_knob", "opId": "g_knob",
  "params": { "diameter": 0.03, "height": 0.02, "body_style": "domed",
              "bore_d": 0.006, "indicator": true, "id": "knob1" } }
```

---

## Gears — `g_gear` `g_ring_gear` `g_rack_gear` `g_planetary_gearset` `g_bevel_gear` `g_worm`

**When to use:** the prompt mentions gears / gearing / transmission. The 15 old
gear ops were consolidated into 6 parameterized families under **Parts**:

- **`g_gear`** — the workhorse cylindrical gear; pick the kind with
  `tooth_profile` = `spur` | `helical` | `herringbone` | `hyperbolic`
  (`helical`/`hyperbolic` add a twist; `hyperbolic` uses `twist_angle`, the rest
  share `helix_angle`). Replaces `g_spur_gear`/`g_herringbone_gear`/
  `g_crossed_helical_gear`/`g_hyperbolic_gear`.
- **`g_ring_gear`** / **`g_rack_gear`** / **`g_planetary_gearset`** — each takes a
  `tooth_profile` (`spur`|`herringbone`; rack uses `straight`|`herringbone`).
- **`g_bevel_gear`** (`cone_angle` + `helix_angle` for spiral bevel) and
  **`g_worm`** stay standalone.

Parametric by `module` / `teeth_number` / `width` (note: `teeth_number`, not
`teeth`); outputs `geometry` + `id`, wrapped by `g_part` like any other shape.
Most gears expose `bore_d` (center shaft hole), `pressure_angle`, `clearance`,
`backlash`. `g_planetary_gearset` requires `sun_teeth_number`/
`planet_teeth_number` ≥ 3 and `n_planets` ≥ 1. The old per-profile ids
(`g_spur_gear`, `g_herringbone_*`, `g_crossed_*`, `g_hyperbolic_*`, `*_pair`)
were **removed** — always use the 6 ops above; a graph saved with a removed id
must be re-created with `g_gear`. Do not approximate a gear with a bare cylinder.

```jsonc
{ "type": "createNode", "nodeId": "n_gear", "opId": "g_gear",
  "params": { "tooth_profile": "spur", "teeth_number": 20, "module": 0.002,
              "width": 0.01, "bore_d": 0.006, "id": "gear1" } }
```

---

## Architecture — `g_wall` `g_floor_slab` `g_stairs` `g_roof` `g_facade_panel` `g_window` `g_door` `g_railing` `g_column` + `g_building_shell`

**When to use:** the object is a building / house / room / interior, or a single
building element. These semantic ops are the **default** for architecture — do
**not** fake a windowed wall with a box plus smaller boxes, or a pitched roof
with a wedge. Units are meters, Z up; element shapes put their base at Z=0 so a
generator can `translateZ` them per floor. See the dedicated
[PART B · 建筑](executions/part-b-building.md) for the
building brief and the full philosophy.

Element ops (each appends one shape `geometry` + `id`, wrap with `g_part`):

- `g_wall` — straight wall `length`×`height`×`thickness`. `openings` is a JSON
  list `[[x, width, sill, head], …]` (x = hole center offset from the wall
  midpoint) that cuts doors/windows out of the wall in one shot.
- `g_floor_slab` — slab `width`×`depth`×`thickness`; `holes` JSON `[[x,y,w,d]]`
  for stair/shaft wells.
- `g_stairs` — `type=straight` (flight from `total_rise` / `run` / `width` /
  `step_count`) or `type=spiral` (treads around a center pole; `radius` /
  `inner_radius` / `sweep_deg`).
- `g_roof` — `type` = `flat` / `shed` / `gable` / `hip` / `gambrel` / `mansard` /
  `pyramid` over a `width`×`depth` footprint, with `height` (ridge) and `overhang`.
- `g_facade_panel` — cladding/siding sheet with optional horizontal `groove_count`
  reveals.
- `g_window` — frame + `type` = `cross` / `grid` (`rows`×`cols`) / `louver`
  (`rows` slats) + optional `glass`, one fused shape; `depth` matches the wall.
- `g_door` — emits a `door_frame` + **separate** `door_leaf` shape(s) (returns
  `frame_id` + `leaf_id`/`leaf_ids`). `leaves=2` makes a double door; `style` =
  `flush` / `panel` / `glazed`. Wrap a leaf with `g_part` and join it
  `g_joint_revolute` for an openable door or `g_joint_fixed` for a static one.
- `g_railing` — balustrade: end posts + top handrail + evenly spaced balusters
  (`length` / `height` / `baluster_count`). Good for balconies, landings, stairs.
- `g_column` — `round` / `square` pillar with optional `base_height` /
  `capital_height` plinth & capital.

Generator (emits a whole shape→part→fixed-joint subtree; returns `root_id`):

- `g_building_shell` — multi-storey orchestrator. **Dual-mode layout**: pass an
  explicit `rooms` JSON `[[x,y,w,d], …]` (room centers + sizes), **or** go
  procedural with `rooms_per_floor` + `seed` (recursive BSP split of the
  footprint). Adds per-floor slabs, interior/exterior walls, an optional stair
  well, and a roof — all under a single root part. For a single room use
  `floors=1, rooms_per_floor=1, roof_type=none`.

```jsonc
// a windowed exterior wall
{ "type": "createNode", "nodeId": "n_wall", "opId": "g_wall",
  "params": { "length": 6, "height": 2.8, "thickness": 0.2,
              "openings": "[[ -1.5, 1.2, 0.9, 2.2 ], [ 1.5, 0.9, 0, 2.1 ]]", "id": "wall_s" } }

// a whole 2-storey building, procedural layout
{ "type": "createNode", "nodeId": "n_bldg", "opId": "g_building_shell",
  "params": { "footprint_w": 12, "footprint_d": 8, "floors": 2,
              "rooms_per_floor": 3, "seed": 7, "roof_type": "gable", "id": "house" } }
```

---

## Transform — `g_translate` `g_rotate` `g_scale` `g_mirror` `g_array_linear` `g_array_radial`

**When to use:** place / orient / mirror / repeat an existing shape. Operates on
the threaded `geometry` (often targeting a shape by id). Prefer transforms over
re-modeling a duplicate.

```jsonc
{ "type": "createNode", "nodeId": "n_arr", "opId": "g_array_radial",
  "params": { "count": 6, "id": "bolts" } }
```

---

## Assembly — `g_part` + `g_joint_fixed` `g_joint_revolute` `g_joint_prismatic` `g_joint_continuous` `g_joint_planar` `g_joint_floating` `g_joint_mimic` `g_joint_on_surface`

**When to use:** any object with multiple parts, and anything that moves (door,
lid, wheel, switch, arm). Wrap each shape into a link with `g_part` (`shape_id` →
the shape, `id` → the part id), then connect links with `g_joint_*`
(`parent_id`/`child_id` reference **part** ids).

> Every part must reach a single root via joints. A part not connected into the
> one rooted tree becomes a **floating island** and is **dropped** from the URDF
> (`g_geometry_qc` reports `islands > 1`). Use `g_joint_fixed` when a part should
> not move but still must attach.

```jsonc
{ "type": "createNode", "nodeId": "n_p1", "opId": "g_part",
  "params": { "shape_id": "shell", "id": "case" } }
{ "type": "createNode", "nodeId": "n_p2", "opId": "g_part",
  "params": { "shape_id": "door_shape", "id": "door" } }
{ "type": "createNode", "nodeId": "n_j", "opId": "g_joint_revolute",
  "params": { "parent_id": "case", "child_id": "door", "az": 1, "lower": 0, "upper": 1.57 } }
```

Joint quick reference: `fixed` (rigid attach), `revolute` (hinge, limited),
`continuous` (unlimited spin — wheels), `prismatic` (slide), `planar`/`floating`
(2D/6-DOF), `mimic` (follow another joint), `on_surface` (place + attach).

---

## Bake staging + reference assembly (two-phase)

**When to use:** every non-trivial object. This is the backbone of the
[mandatory two-phase workflow](executions/part-a-asset.md#mandatory-two-phase-workflow-read-before-the-first-applybatch).
Instead of one giant graph, model each part alone, bake it to a reusable mesh, and
assemble a clean graph that only references those meshes.

The chain per part is:

```
part subgraph (CSG/Parts/...) → g_bake_part → filename(<sha>.obj) → g_mesh → g_part → g_joint_*
            └─────────── Phase 1 (one part) ───────────┘   └──────── Phase 2 (assembly) ────────┘
```

**`g_bake_part`** (Utils) — bakes the terminal shape of a part subgraph into a
content-addressed OBJ staged in `library/blobs/`:

- inputs: `geometry` (the part subgraph), `shape_id` (the terminal shape id —
  wire the upstream `id` output, or set the literal; empty falls back to the
  geometry's focused/last shape).
- outputs: `filename` (`<sha>.obj`, wire into `g_mesh.filename`), `sha256`,
  `vertexCount`, `triangleCount`, `cacheHit`, **`bbox_min` / `bbox_max` / `size`**
  (the baked mesh's local AABB and dimensions in meters — wire `bbox_min`/`bbox_max`
  into `g_mesh` so the scene mesh resolves an AABB, and use `size` to compute
  placement/grounding/spacing), `geometry` (pass-through), `note`, `error`.
- op routing is automatic and matches `g_to_urdf`: CSG/profile subgraph chains
  bake via the geometry-subgraph path; single-op composites (gears / parts /
  architecture / cone…) bake via the op path; **native primitives
  (box/cylinder/sphere) are not baked** — `filename` comes back empty with a
  `note`, and you should reference them in Phase 2 with `g_box`/`g_cylinder`/
  `g_sphere` directly.

Phase-1 bake (one part):

```jsonc
{ "type": "createNode", "nodeId": "n_prof", "opId": "g_profile_rounded_rect",
  "params": { "width": 0.2, "height": 0.1, "radius": 0.02, "id": "face" } }
{ "type": "createNode", "nodeId": "n_body", "opId": "g_extrude",
  "params": { "profile_id": "face", "height": 0.3, "id": "body" } }
{ "type": "createNode", "nodeId": "n_bake", "opId": "g_bake_part",
  "params": { "shape_id": "body" } }
// thread the geometry wire n_prof → n_body → n_bake, then read n_bake.filename
```

Phase-2 assembly (reference the staged meshes — no re-baking):

```jsonc
{ "type": "createNode", "nodeId": "n_m1", "opId": "g_mesh",
  "params": { "filename": "<sha-of-body>.obj", "id": "body_mesh",
              "bbox_min": "<n_bake.bbox_min>", "bbox_max": "<n_bake.bbox_max>" } }
  // wire n_bake.bbox_min/bbox_max → n_m1.bbox_min/bbox_max so the mesh resolves an AABB
{ "type": "createNode", "nodeId": "n_p1", "opId": "g_part",
  "params": { "shape_id": "body_mesh", "id": "body" } }
{ "type": "createNode", "nodeId": "n_mat", "opId": "g_material",
  "params": { "rgba": [0.2,0.5,0.8,1] } }   // color rides the URDF <material>, not the mesh
```

Color is applied here in Phase 2 (OBJ stages pure geometry); meshes carry no
material. A correct Phase-2 `g_to_urdf` reports `bakeFallbacks = 0` and
`meshProvenance` all `native`.

---

## Output (QC / Bake / Export) — QC sensors and the visible path

**When to use:** every model. End the graph with the QC sensors, optional
auto-collision, then URDF.

- `g_geometry_qc` → read **all** of `report` / `islands` / `missing_aabb` /
  `overlaps` / `primitive_only` / `floating_links` (parts with no joint path to
  root — dropped at runtime) / `orphan_profiles` (profiles never extruded/lofted)
  / and the structured `signals[]` (`{code, severity, message, ids?}`, covering
  `islands` / `aabb_missing` / `joint_origin` / `aabb_overlap` / `primitive_only`
  / `floating_link` / `orphan_profile` / `lathe_xy_profile` / `mesh_boolean_misuse`).
  Loop on the `signals` codes. `primitive_only: true` = every shape in the model
  is a bare primitive with no CSG solid / Parts (incl. gears) / baked mesh; it fires
  **even when the boxes are wrapped in `g_part` + `g_joint`** (wrapping a
  box-stack no longer hides it), so on a real object this means go back and model
  the parts for real (CSG/Parts → `g_bake_part` → `g_mesh`).
- `g_validate` → `errors` / `valid` (structural URDF checks).
- `g_material` / `g_named_color` → appearance; `g_align_centers` /
  `g_place_on_face` / `g_place_on_surface` → compute joint/part origins.
- `g_auto_collision` → derive `<collision>` for every part from its visual
  (box/cylinder/sphere copied exactly; everything else AABB-boxed). Outputs
  `added` / `skipped` / `report`. Drop it just before `g_to_urdf` for
  physics/sim; `padding` grows the shells, `replace: true` rebuilds them.
- `g_to_urdf` → `urdf` + a `report` object (`meshFileCount` / `totalTriangles` /
  `bakeFallbacks` / `fingerprint` / `signalBundle`). Compare `fingerprint` across
  iterations to confirm the output actually changed; `bakeFallbacks > 0` means a
  composite shape silently degraded to an AABB box — investigate. Then
  `urdf_preview` makes the result visible.

```jsonc
{ "type": "createNode", "nodeId": "n_qc",    "opId": "g_geometry_qc",  "params": {} }
{ "type": "createNode", "nodeId": "n_coll",  "opId": "g_auto_collision","params": {} }
{ "type": "createNode", "nodeId": "n_urdf",  "opId": "g_to_urdf",      "params": {} }
{ "type": "createNode", "nodeId": "n_view",  "opId": "urdf_preview",   "params": {} }
```
