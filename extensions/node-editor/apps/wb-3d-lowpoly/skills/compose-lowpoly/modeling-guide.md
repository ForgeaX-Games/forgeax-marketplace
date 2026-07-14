# Modeling Guide — per-family pages

> ⚠️ **Legacy format — optional read.** The JSON snippets below use the old
> `createNode` node-wiring form, **not** DSL. For DSL-first authoring you do **not**
> need this file: get op signatures from [op-directory.md](op-directory.md) and
> syntax from [dsl-quickref.md](dsl-quickref.md). Read this only for per-family
> *concepts* (when to use a family, which params matter) — translate any snippet to
> the equivalent DSL statement; never emit `createNode` or call `batteries.get`.

Use this **after** writing the decomposition brief
([executions/part-a-asset.md](executions/part-a-asset.md#phase-0--part-manifest-hard-gate)) to
pick the right family for each part.

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

## CSG — `g_difference` `g_union` `g_intersection` `g_extrude` `g_extrude_with_holes` `g_loft` `g_revolve` `g_sweep` `g_lathe` `g_pipe` `g_section_loft` `g_fillet`

**When to use:** the form is hollow, has a cut/hole/recess, or is a lofted /
revolved / swept / extruded body. This is the anti-primitive workhorse — reach
here before stacking boxes.

Id ports (reference *shape* / *profile* ids): `base_id`+`tool_id` (difference),
`a_id`+`b_id` (union/intersection), `profile_id` (extrude/revolve/lathe),
`outer_id`+`hole_ids` (extrude_with_holes), `profile_ids` (loft),
`shape_id` (fillet). On a bad ref the op appends nothing and returns `{ error }` —
read it.

```jsonc
// cut an opening out of a body instead of faking it with a box
{ "type": "createNode", "nodeId": "n_cut", "opId": "g_difference",
  "params": { "base_id": "body", "tool_id": "cavity", "id": "shell" } }

// solid from a profile
{ "type": "createNode", "nodeId": "n_ext", "opId": "g_extrude",
  "params": { "profile_id": "face", "height": 0.05, "id": "panel" } }
```

**`g_fillet`** — round (`type=round`, arc) or bevel (`type=chamfer`, flat cut) the
edges of a solid: the general edge-treatment op (soften an enclosure, break a
sharp corner). `shape_id` references the solid; `radius` is the fillet radius /
chamfer distance (meters, keep < half the adjacent face or OCCT rejects it and
`g_to_urdf` falls back to an AABB box); `edges` = `all` (default) or `vertical`
(only edges parallel to Z, e.g. a box's four uprights). Works on CSG/primitive
**solids only** — not on the meshes from `g_pipe`/`g_sweep`/`g_section_loft`.

```jsonc
// round the four upright edges of a box body by 8 mm
{ "type": "createNode", "nodeId": "n_fil", "opId": "g_fillet",
  "params": { "shape_id": "body", "radius": 0.008, "type": "round",
              "edges": "vertical", "id": "body_soft" } }
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

## Architecture — `g_wall` `g_floor_slab` `g_stairs` `g_roof` `g_facade_panel` `g_window` `g_door` `g_railing` `g_column`

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
  midpoint) that cuts doors/windows out of the wall in one shot. Optional
  `window_band` cuts one continuous horizontal opening (`band_sill` / `band_head`
  / `band_margin`) instead of listing each hole, and `pane_width` + `mullion`
  drop evenly spaced vertical mullions into it. Optional `plinth_height` adds a
  thicker base course projecting `plinth_projection` per face.
- `g_floor_slab` — slab `width`×`depth`×`thickness`; `holes` JSON `[[x,y,w,d]]`
  for stair/shaft wells. Optional `beam_depth` (+`beam_width`) hangs a perimeter
  downstand beam below the slab; `edge_chamfer` bevels the top edges.
- `g_stairs` — `type=straight` (flight from `total_rise` / `run` / `width` /
  `step_count`) or `type=spiral` (treads around a center pole; `radius` /
  `inner_radius` / `sweep_deg`). Optional `tread_thickness` + `open_riser` give
  thin floating treads with no risers; `landing_depth` inserts a mid-run landing
  after step `landing_after` (straight only).
- `g_roof` — `type` = `flat` / `shed` / `gable` / `hip` / `gambrel` / `mansard` /
  `pyramid` over a `width`×`depth` footprint, with `height` (ridge) and `overhang`.
  For pitched roofs `eave_overhang` / `verge_overhang` override `overhang`
  independently along the slope vs the ridge. Flat roofs take a `parapet_height`
  (+`parapet_thickness`) upstand with an optional `coping_width` cap.
- `g_facade_panel` — cladding/siding sheet with optional `groove_count` reveals.
  `groove_direction` = `horizontal` (default) / `vertical` / `both`, or set
  `groove_spacing` to lay grooves by pitch instead of count; `board_style` =
  `flush` (default) / `lap` / `shiplap` steps the boards for a lapped look.
  `orientation=wall` (default) stands it up like a wall (`panel_h` along Z, base
  at Z=0); `orientation=slab` lays it flat (`panel_h` along Y).
- `g_window` — frame + `type` = `cross` / `grid` (`rows`×`cols`) / `louver`
  (`rows` slats) + optional `glass`, one fused shape; `depth` matches the wall.
  Optional `pane_width` auto-divides the glazing into columns of that target
  width, `sill` adds a projecting ledge, and `arch_top` rounds the head into a
  semicircular arch (needs `height` > `width`/2 + `frame`).
- `g_door` — emits a `door_frame` + **separate** `door_leaf` shape(s) (returns
  `frame_id` + `leaf_id`/`leaf_ids`). `leaves=2` makes a double door; `style` =
  `flush` / `panel` / `glazed`. `panel` style takes a `panel_rows`×`panel_cols`
  recessed grid. The frame accepts an optional `transom` (glazed head band) and
  `sidelight` (glazed side lights). Wrap a leaf with `g_part` and join it
  `g_joint_revolute` for an openable door or `g_joint_fixed` for a static one.
- `g_railing` — balustrade: end posts + top handrail + evenly spaced balusters
  (`length` / `height` / `baluster_count`). Optional `post_shape` = `round`
  (+`post_radius`) / `square`, `post_spacing` derives the baluster count from a
  target pitch, `bottom_rail` / `mid_rail` add lower rails, and
  `top_rail_width` / `top_rail_height` size the handrail. Good for balconies,
  landings, stairs.
- `g_column` — `round` / `square` pillar with optional `base_height` /
  `capital_height` plinth & capital. `taper` sets the top/bottom radius ratio
  (entasis), `base_style` / `capital_style` = `plain` / `stepped`, and `flutes`
  cuts that many vertical grooves into round shafts.

Assembling a building: there is **no whole-building orchestrator** — emit the
elements above and wire them by hand into one rooted tree. Wrap each element shape
in a `g_part`, then connect with `g_joint_fixed` (openable leaves →
`g_joint_revolute`) so every part reaches a single root (e.g. the ground slab).
Place each element via the **joint origin** (`origin=[cx, cy, z]`, meters, Z up);
a wall running along Y is rotated with joint `rpy=[0,0,π/2]`; stack floors with
`origin=[0,0,floorIndex*storeyH]`. Deduplicate shared interior walls so adjacent
rooms don't each emit an overlapping wall on their common edge.

### Placement contract (get this right or holes/windows/doors won't line up)

All element shapes are **X/Y-centered, base at Z=0**. Misalignment is almost never
a baker bug — it's this contract not being followed. The full recipes (opening↔
window/door, door-leaf hinge origin, per-storey slabs, stairs↔well) live in the
**对齐配方 · Placement recipes** section of
[PART B · 建筑](executions/part-b-building.md). Essentials:

- **Opening ↔ window/door**: a wall `openings=[[x,w,sill,head]]` entry only cuts a
  hole; the matching `g_window`/`g_door` is a *separate* shape you must place into
  it. Use `width=w`, **`height=head−sill`**, `depth=wall thickness`, and
  **parent the window/door part to that wall part** with joint `origin=[x,0,sill]`
  (Z→`sill`, since the shape's base is at Z=0). Parenting to the wall (not the root
  slab) is what makes a wall running along Y still line up. `g_wall` returns
  ready-made **`opening_placements`** JSON (`{origin,width,height,depth}` per hole).
- **Door leaf origin is at the hinge, not the center**: don't place a leaf concentric
  with its frame or it pokes out. Use the `leaf_origin`/`leaf_origins` JSON that
  `g_door` returns (single `[∓clearW/2,0,0]`; double = one per jamb).
- **Every storey needs its own `g_floor_slab`** sized to the footprint (defaults are
  `6×4` — set `width`/`depth`) at `origin=[0,0,i*storeyH]`; the **roof is not a floor**.
- **Stairs need a matching well**: put `g_stairs` (`total_rise=storeyH`) at `[sx,sy,…]`
  and cut an aligned `holes=[[sx,sy,wellW,wellD]]` in the slab **above** it.
- **Overlap + the moving-joint trap (why doors fail when windows don't)**: in an
  **all-`g_joint_fixed`** building, benign AABB overlaps (wall corners, an embedded
  window/door frame, a leaf inside its frame, stairs in a well) are only *warnings*.
  The moment you add **one moving joint** (`g_joint_revolute` for an openable door),
  `g_geometry_qc` promotes **every** overlap in the whole model to a **fatal** issue.
  So prefer `g_joint_fixed` for a static building; only go `g_joint_revolute` when the
  door truly needs to swing, and then whitelist the benign pairs via
  `g_geometry_qc` `allow_pairs` (e.g. `"door1:wall_s"`, `"door1:door1_leaf"`). Use
  `g_metrics` (`max_penetration`/`overlap_ratio`) to tell real clashes from
  conservative AABB false positives. Still eliminate *real* overlaps: dedupe shared
  walls, fill (not overrun) openings, keep stairs out of solid slabs.

**Not limited to the 9 Architecture ops.** They're the default for the shell/main
structure, but enrich detail with other families: Primitive/CSG for chimneys,
sills, bay/dormer windows, cornices; `g_column`/`g_railing`/`g_facade_panel` for
porches, balconies, cladding; Parts (`g_knob`→handles, `g_vent_grille`→vents);
`g_array_*` to repeat windows/balusters; `g_material`/`g_named_color` for color
variety. Wire every added piece into the same rooted tree under R1–R5. See
[PART B §1.5](executions/part-b-building.md).

```jsonc
// ground slab (root) sized to the 6×8 footprint
{ "type": "createNode", "nodeId": "n_slab0", "opId": "g_floor_slab",
  "params": { "width": 6, "depth": 8, "thickness": 0.2, "id": "slab0" } }
{ "type": "createNode", "nodeId": "n_slab0_p", "opId": "g_part", "params": { "shape_id": "slab0", "id": "slab0_part" } }

// south wall with a window hole (x=-1.5) and a door hole (x=1.5)
{ "type": "createNode", "nodeId": "n_wall", "opId": "g_wall",
  "params": { "length": 6, "height": 2.8, "thickness": 0.2,
              "openings": "[[ -1.5, 1.2, 0.9, 2.2 ], [ 1.5, 0.9, 0, 2.1 ]]", "id": "wall_s" } }
{ "type": "createNode", "nodeId": "n_wall_p", "opId": "g_part", "params": { "shape_id": "wall_s", "id": "wall_s_part" } }
{ "type": "createNode", "nodeId": "n_wall_j", "opId": "g_joint_fixed",
  "params": { "parent_id": "slab0_part", "child_id": "wall_s_part", "origin": "[0, -4, 0.2]" } }

// window sized to the hole (w=1.2, h=2.2-0.9=1.3), parented to the WALL, origin=[x,0,sill]
{ "type": "createNode", "nodeId": "n_win", "opId": "g_window",
  "params": { "width": 1.2, "height": 1.3, "depth": 0.2, "id": "win1" } }
{ "type": "createNode", "nodeId": "n_win_p", "opId": "g_part", "params": { "shape_id": "win1", "id": "win1_part" } }
{ "type": "createNode", "nodeId": "n_win_j", "opId": "g_joint_fixed",
  "params": { "parent_id": "wall_s_part", "child_id": "win1_part", "origin": "[-1.5, 0, 0.9]" } }

// door: frame at the hole, leaf placed at leaf_origin (hinge edge), openable via revolute
{ "type": "createNode", "nodeId": "n_door", "opId": "g_door",
  "params": { "width": 0.9, "height": 2.1, "depth": 0.2, "hinge": "left", "id": "door1" } }
{ "type": "createNode", "nodeId": "n_df_p", "opId": "g_part", "params": { "shape_id": "door1", "id": "door1_part" } }
{ "type": "createNode", "nodeId": "n_df_j", "opId": "g_joint_fixed",
  "params": { "parent_id": "wall_s_part", "child_id": "door1_part", "origin": "[1.5, 0, 0]" } }
{ "type": "createNode", "nodeId": "n_leaf_p", "opId": "g_part", "params": { "shape_id": "door1_leaf", "id": "door1_leaf_part" } }
// Static building → fixed leaf at door1.leaf_origin (≈ [-clearW/2, 0, 0]), no moving
// joint so architectural AABB overlaps stay non-fatal. To make it swing, swap to
// g_joint_revolute (az=1, lower=0, upper=1.57) AND whitelist the benign overlaps on
// g_geometry_qc: allow_pairs=["door1:wall_s","door1:door1_leaf"].
{ "type": "createNode", "nodeId": "n_leaf_j", "opId": "g_joint_fixed",
  "params": { "parent_id": "door1_part", "child_id": "door1_leaf_part", "origin": "<door1.leaf_origin>" } }

// upper floor: its own slab, sized to footprint, at storey height, with a stair well
{ "type": "createNode", "nodeId": "n_slab1", "opId": "g_floor_slab",
  "params": { "width": 6, "depth": 8, "thickness": 0.2, "holes": "[[ 2, 3, 1.2, 3 ]]", "id": "slab1" } }
{ "type": "createNode", "nodeId": "n_slab1_p", "opId": "g_part", "params": { "shape_id": "slab1", "id": "slab1_part" } }
{ "type": "createNode", "nodeId": "n_slab1_j", "opId": "g_joint_fixed",
  "params": { "parent_id": "slab0_part", "child_id": "slab1_part", "origin": "[0, 0, 3.0]" } }

// stairs spanning the storey, landing under the well at the same [sx,sy]=[2,3]
{ "type": "createNode", "nodeId": "n_stair", "opId": "g_stairs",
  "params": { "total_rise": 3.0, "run": 0.28, "width": 1.0, "step_count": 15, "id": "stair1" } }
{ "type": "createNode", "nodeId": "n_stair_p", "opId": "g_part", "params": { "shape_id": "stair1", "id": "stair1_part" } }
{ "type": "createNode", "nodeId": "n_stair_j", "opId": "g_joint_fixed",
  "params": { "parent_id": "slab0_part", "child_id": "stair1_part", "origin": "[2, 3, 0.2]" } }
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
