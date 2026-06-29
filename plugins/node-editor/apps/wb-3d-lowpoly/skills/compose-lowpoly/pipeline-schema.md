# Pipeline And Batch Shape

The lowpoly plugin uses `@forgeax/node-runtime` graph storage. Agents should
mutate it with `lowpoly:pipeline.applyBatch`.

## Read

Call:

```json
{ "toolId": "lowpoly:pipeline.get", "args": {}, "caller": { "kind": "ai" } }
```

The result is the active pipeline snapshot:

```json
{
  "id": "main",
  "hash": "...",
  "nodes": {},
  "edges": {},
  "metadata": {}
}
```

## Mutate

Call:

```json
{
  "toolId": "lowpoly:pipeline.applyBatch",
  "args": {
    "ops": [],
    "opts": {
      "actor": "ai:lowpoly",
      "label": "add lowpoly body"
    }
  },
  "caller": { "kind": "ai" }
}
```

### Op shapes (node-runtime `Op` union — discriminator is `type`)

Each entry of `ops[]` MUST be one of these. The discriminator field is **`type`**
(NOT `kind` / `op` / `addNode`). `opId` is the battery id from
`lowpoly:batteries.list`; port names come from `lowpoly:batteries.get`.

```jsonc
// create a node from a battery
{ "type": "createNode", "nodeId": "body", "opId": "g_box",
  "position": { "x": 0, "y": 0 }, "params": { "size": [2,1,1] }, "name": "座舱" }

// wire one node's output port → another node's input port
// (port names are authoritative from lowpoly:batteries.get — e.g. g_to_urdf's
//  geometry input is "geometry", NOT "links")
{ "type": "connect", "edgeId": "e_body_urdf",
  "source": { "nodeId": "body", "port": "geometry" },
  "target": { "nodeId": "urdf", "port": "geometry" } }

{ "type": "updateNode", "nodeId": "body", "params": { "size": [2.2,1,1] } }   // params merge
{ "type": "updateNode", "nodeId": "body", "position": { "x": 40, "y": 0 } }   // move only (layout-only)
{ "type": "deleteNode", "nodeId": "body" }                                    // cascades its edges
{ "type": "disconnect", "edgeId": "e_body_urdf" }
{ "type": "setMetadata", "key": "viewport", "value": { } }
// groups: createGroup / updateGroup / ungroup / deleteGroup (see node-runtime)
```

Worked mini-example (box → urdf → preview), real op ids:

```json
{ "toolId": "lowpoly:pipeline.applyBatch", "caller": { "kind": "ai" }, "args": {
  "opts": { "actor": "ai:lowpoly", "label": "body→urdf→preview" },
  "ops": [
    { "type": "createNode", "nodeId": "body", "opId": "g_box",       "position": {"x":0,"y":0},   "params": {} },
    { "type": "createNode", "nodeId": "urdf", "opId": "g_to_urdf",   "position": {"x":260,"y":0}, "params": {} },
    { "type": "createNode", "nodeId": "view", "opId": "urdf_preview","position": {"x":520,"y":0}, "params": {} },
    { "type": "connect", "edgeId": "e1", "source": {"nodeId":"body","port":"geometry"}, "target": {"nodeId":"urdf","port":"geometry"} },
    { "type": "connect", "edgeId": "e2", "source": {"nodeId":"urdf","port":"urdf"},     "target": {"nodeId":"view","port":"urdf"} }
  ]
}}
```

> ⚠️ **Silent-drop gotcha (this is the #1 way batches "succeed" but nothing appears):**
> `applyBatch` has all-or-nothing semantics ONLY for *recognized* ops. An op whose
> `type` is not in the union above matches no case and emits no diagnostic, so the
> batch returns `{ ok: true, newHash }` while the graph is unchanged. If you used
> `kind`/`addNode`/`opId`-without-`type`, you get a green "ok" and an empty canvas.
> **Always `lowpoly:pipeline.get` right after `applyBatch` and confirm `nodes`
> actually grew** before moving on. Op ids and port names are authoritative only
> from `lowpoly:batteries.list` / `lowpoly:batteries.get` — never guess them.
>
> **A second silent-drop layer lives *inside* an op's outputs.** Even when the
> node exists and `execute` is green, CSG / Assembly ops that reference another
> statement by **id** (`base_id`, `tool_id`, `a_id`/`b_id`, `profile_id(s)`,
> `outer_id`, `hole_ids`, `shape_id`, `parent_id`, `child_id`) will, on a bad or
> missing ref, return `{ geometry: <unchanged>, id: "", error: "<reason>" }` —
> they append **nothing** and do not fail the batch. After `execute`, read each
> such op's `error` output (and the `g_geometry_qc` / `g_validate` `report`)
> before trusting the result.

## Id-port wiring (CSG / Parts / Assembly)

Geometry ops thread a single `geometry` value through the graph (each op
*appends* its statement and passes the accumulated geometry forward). To
reference an earlier statement, an op takes a **string id input** that must match
an id already present in that geometry. Two equivalent ways to supply it:

1. **Wire the id port (canonical).** Connect the upstream shape's `id` **output**
   to the downstream `*_id` **input** with a `connect` op. The downstream op then
   resolves the live id even if it was auto-generated.
2. **Set a deterministic id as a param.** Give the upstream shape an explicit
   `id` param (e.g. `"body"`), then pass that same literal into the downstream
   `base_id` / `shape_id` / `parent_id` param. Easier to read; you own the names.

The id map for the common ops (always confirm with `lowpoly:batteries.get`):

| Op | id inputs (what they reference) |
|---|---|
| `g_difference` | `base_id` (kept), `tool_id` (subtracted) — both are *shape* ids |
| `g_union` / `g_intersection` | `a_id`, `b_id` — shape ids |
| `g_extrude` / `g_revolve` / `g_lathe` | `profile_id` — a `Profile` id |
| `g_extrude_with_holes` | `outer_id` + `hole_ids` (delimited list) — profile ids |
| `g_loft` | `profile_ids` (delimited list) — profile ids |
| `g_part` | `shape_id` — the shape this link wraps; the `id` output is the **part** id |
| `g_joint_*` | `parent_id`, `child_id` — **part** ids (from `g_part`, not shapes) |

## Runnable multi-part assembly (shape → CSG → part → joint → QC → URDF → preview)

A cabinet whose front opening is **cut** (CSG difference, not a faked box) with a
door on a **revolute** hinge. Shapes carry explicit ids; `g_difference` cuts the
opening; two `g_part`s become links; one `g_joint_revolute` stitches them into a
single rooted tree; `g_geometry_qc` + `g_validate` are read before preview.

```json
{ "toolId": "lowpoly:pipeline.applyBatch", "caller": { "kind": "ai" }, "args": {
  "opts": { "actor": "ai:lowpoly", "label": "cabinet+door (CSG cut + revolute joint)" },
  "ops": [
    { "type": "createNode", "nodeId": "n_body",  "opId": "g_box",            "position": {"x":0,"y":0},    "params": { "size": [0.4,0.3,0.5], "id": "body" } },
    { "type": "createNode", "nodeId": "n_open",  "opId": "g_box",            "position": {"x":0,"y":160},  "params": { "size": [0.34,0.05,0.44], "id": "opening" } },
    { "type": "createNode", "nodeId": "n_diff",  "opId": "g_difference",     "position": {"x":260,"y":0},  "params": { "base_id": "body", "tool_id": "opening", "id": "shell" } },
    { "type": "createNode", "nodeId": "n_door",  "opId": "g_box",            "position": {"x":260,"y":200},"params": { "size": [0.34,0.02,0.44], "id": "door_shape" } },
    { "type": "createNode", "nodeId": "n_pcase", "opId": "g_part",           "position": {"x":520,"y":0},  "params": { "shape_id": "shell", "id": "case" } },
    { "type": "createNode", "nodeId": "n_pdoor", "opId": "g_part",           "position": {"x":520,"y":200},"params": { "shape_id": "door_shape", "id": "door", "ox": 0.17, "oy": -0.16, "oz": 0 } },
    { "type": "createNode", "nodeId": "n_jrev",  "opId": "g_joint_revolute", "position": {"x":780,"y":0},  "params": { "parent_id": "case", "child_id": "door", "az": 1, "lower": 0, "upper": 1.57, "ox": 0.17, "oy": -0.16 } },
    { "type": "createNode", "nodeId": "n_qc",    "opId": "g_geometry_qc",    "position": {"x":1040,"y":0}, "params": {} },
    { "type": "createNode", "nodeId": "n_val",   "opId": "g_validate",       "position": {"x":1040,"y":160},"params": {} },
    { "type": "createNode", "nodeId": "n_urdf",  "opId": "g_to_urdf",        "position": {"x":1300,"y":0}, "params": {} },
    { "type": "createNode", "nodeId": "n_view",  "opId": "urdf_preview",     "position": {"x":1560,"y":0}, "params": {} },

    { "type": "connect", "edgeId": "g1", "source": {"nodeId":"n_body","port":"geometry"}, "target": {"nodeId":"n_open","port":"geometry"} },
    { "type": "connect", "edgeId": "g2", "source": {"nodeId":"n_open","port":"geometry"}, "target": {"nodeId":"n_diff","port":"geometry"} },
    { "type": "connect", "edgeId": "g3", "source": {"nodeId":"n_diff","port":"geometry"}, "target": {"nodeId":"n_door","port":"geometry"} },
    { "type": "connect", "edgeId": "g4", "source": {"nodeId":"n_door","port":"geometry"}, "target": {"nodeId":"n_pcase","port":"geometry"} },
    { "type": "connect", "edgeId": "g5", "source": {"nodeId":"n_pcase","port":"geometry"},"target": {"nodeId":"n_pdoor","port":"geometry"} },
    { "type": "connect", "edgeId": "g6", "source": {"nodeId":"n_pdoor","port":"geometry"},"target": {"nodeId":"n_jrev","port":"geometry"} },
    { "type": "connect", "edgeId": "g7", "source": {"nodeId":"n_jrev","port":"geometry"}, "target": {"nodeId":"n_qc","port":"geometry"} },
    { "type": "connect", "edgeId": "g8", "source": {"nodeId":"n_qc","port":"geometry"},   "target": {"nodeId":"n_val","port":"geometry"} },
    { "type": "connect", "edgeId": "g9", "source": {"nodeId":"n_qc","port":"geometry"},   "target": {"nodeId":"n_urdf","port":"geometry"} },
    { "type": "connect", "edgeId": "g10","source": {"nodeId":"n_urdf","port":"urdf"},     "target": {"nodeId":"n_view","port":"urdf"} }
  ]
}}
```

Notes:

- The single `geometry` wire is threaded through every op so each statement lands
  in one document; `g_difference` then resolves `base_id`/`tool_id` against it.
- `n_diff` carves the opening out of the body (CSG) instead of stacking boxes.
- `g_part` ids (`case`, `door`) are what the joint's `parent_id`/`child_id`
  reference — **part** ids, not the shape ids.
- The id ports can also be wired as edges (e.g. `n_diff.id` → `n_pcase.shape_id`)
  instead of repeating literals; either is valid.
- After `execute`, read `n_diff.error`, `n_qc.report`/`n_qc.islands`/
  `n_qc.signals`/`n_qc.floating_links`/`n_qc.orphan_profiles`, and `n_val.errors`
  before declaring success — a wrong ref drops silently.
- For physics/sim, insert `g_auto_collision` on the geometry wire just before
  `g_to_urdf` (e.g. `n_jrev → n_qc → n_coll → n_urdf`) to derive a `<collision>`
  for every part; read its `added`/`skipped` outputs.
- `g_to_urdf` also outputs a `report` object (`meshFileCount`/`totalTriangles`/
  `bakeFallbacks`/`fingerprint`/`signalBundle`); compare `fingerprint` between
  iterations to confirm the baked output actually changed, and treat
  `bakeFallbacks > 0` as a composite that silently degraded to an AABB box.

## Runnable two-phase example (g_bake_part stage → g_mesh assemble)

This is the [mandatory two-phase workflow](executions/part-a-asset.md#mandatory-two-phase-workflow-read-before-the-first-applybatch)
made concrete for a tiny cup = a CSG-cut **shell** + a **knob** lid handle. Phase 1
models and **bakes each part on its own**; Phase 2 **references** the staged meshes
and assembles. Confirm every op id / port with `lowpoly:batteries.get`.

**Phase 1a — model + bake the cup shell** (its own subgraph → `g_bake_part`):

```json
{ "toolId": "lowpoly:pipeline.applyBatch", "caller": { "kind": "ai" }, "args": {
  "opts": { "actor": "ai:lowpoly", "label": "phase1: cup shell → bake" },
  "ops": [
    { "type": "createNode", "nodeId": "a_outer", "opId": "g_cylinder",   "position": {"x":0,"y":0},   "params": { "radius": 0.04, "height": 0.1, "id": "outer" } },
    { "type": "createNode", "nodeId": "a_inner", "opId": "g_cylinder",   "position": {"x":0,"y":160}, "params": { "radius": 0.035, "height": 0.09, "id": "cavity" } },
    { "type": "createNode", "nodeId": "a_diff",  "opId": "g_difference", "position": {"x":260,"y":0}, "params": { "base_id": "outer", "tool_id": "cavity", "id": "shell" } },
    { "type": "createNode", "nodeId": "a_bake",  "opId": "g_bake_part",  "position": {"x":520,"y":0}, "params": { "shape_id": "shell" } },
    { "type": "connect", "edgeId": "a1", "source": {"nodeId":"a_outer","port":"geometry"}, "target": {"nodeId":"a_inner","port":"geometry"} },
    { "type": "connect", "edgeId": "a2", "source": {"nodeId":"a_inner","port":"geometry"}, "target": {"nodeId":"a_diff","port":"geometry"} },
    { "type": "connect", "edgeId": "a3", "source": {"nodeId":"a_diff","port":"geometry"},  "target": {"nodeId":"a_bake","port":"geometry"} }
  ]
}}
```

After `execute`, read `a_bake.filename` (e.g. `"<shaA>.obj"`) and `a_bake.sha256`.

**Phase 1b — model + bake the knob** (single-op composite → `g_bake_part`):

```json
{ "toolId": "lowpoly:pipeline.applyBatch", "caller": { "kind": "ai" }, "args": {
  "opts": { "actor": "ai:lowpoly", "label": "phase1: knob → bake" },
  "ops": [
    { "type": "createNode", "nodeId": "b_knob", "opId": "g_knob",      "position": {"x":0,"y":0},   "params": { "diameter": 0.03, "height": 0.02, "body_style": "domed", "bore_d": 0.006, "id": "knob" } },
    { "type": "createNode", "nodeId": "b_bake", "opId": "g_bake_part", "position": {"x":260,"y":0}, "params": { "shape_id": "knob" } },
    { "type": "connect", "edgeId": "b1", "source": {"nodeId":"b_knob","port":"geometry"}, "target": {"nodeId":"b_bake","port":"geometry"} }
  ]
}}
```

After `execute`, read `b_bake.filename` (e.g. `"<shaB>.obj"`).

**Phase 2 — assemble from the staged meshes** (fresh DSL; paste the two
`<sha>.obj` from Phase 1 into `g_mesh.filename`, color per part, one rooted tree):

```json
{ "toolId": "lowpoly:pipeline.applyBatch", "caller": { "kind": "ai" }, "args": {
  "opts": { "actor": "ai:lowpoly", "label": "phase2: assemble cup from baked meshes" },
  "ops": [
    { "type": "createNode", "nodeId": "m_shell", "opId": "g_mesh",         "position": {"x":0,"y":0},    "params": { "filename": "<shaA>.obj", "id": "shell_mesh" } },
    { "type": "createNode", "nodeId": "m_knob",  "opId": "g_mesh",         "position": {"x":0,"y":160},  "params": { "filename": "<shaB>.obj", "id": "knob_mesh" } },
    { "type": "createNode", "nodeId": "p_shell", "opId": "g_part",         "position": {"x":260,"y":0},  "params": { "shape_id": "shell_mesh", "id": "cup" } },
    { "type": "createNode", "nodeId": "mat_a",   "opId": "g_material",     "position": {"x":260,"y":80}, "params": { "rgba": [0.85,0.85,0.9,1] } },
    { "type": "createNode", "nodeId": "p_knob",  "opId": "g_part",         "position": {"x":260,"y":200},"params": { "shape_id": "knob_mesh", "id": "lid_knob", "oz": 0.06 } },
    { "type": "createNode", "nodeId": "mat_b",   "opId": "g_material",     "position": {"x":260,"y":280},"params": { "rgba": [0.2,0.4,0.7,1] } },
    { "type": "createNode", "nodeId": "j_fix",   "opId": "g_joint_fixed",  "position": {"x":520,"y":0},  "params": { "parent_id": "cup", "child_id": "lid_knob", "oz": 0.06 } },
    { "type": "createNode", "nodeId": "z_qc",    "opId": "g_geometry_qc",  "position": {"x":780,"y":0},  "params": {} },
    { "type": "createNode", "nodeId": "z_val",   "opId": "g_validate",     "position": {"x":780,"y":160},"params": {} },
    { "type": "createNode", "nodeId": "z_urdf",  "opId": "g_to_urdf",      "position": {"x":1040,"y":0}, "params": {} },
    { "type": "createNode", "nodeId": "z_view",  "opId": "urdf_preview",   "position": {"x":1300,"y":0}, "params": {} },

    { "type": "connect", "edgeId": "c1",  "source": {"nodeId":"m_shell","port":"geometry"}, "target": {"nodeId":"m_knob","port":"geometry"} },
    { "type": "connect", "edgeId": "c2",  "source": {"nodeId":"m_knob","port":"geometry"},  "target": {"nodeId":"p_shell","port":"geometry"} },
    { "type": "connect", "edgeId": "c3",  "source": {"nodeId":"p_shell","port":"geometry"}, "target": {"nodeId":"mat_a","port":"geometry"} },
    { "type": "connect", "edgeId": "c4",  "source": {"nodeId":"mat_a","port":"geometry"},   "target": {"nodeId":"p_knob","port":"geometry"} },
    { "type": "connect", "edgeId": "c5",  "source": {"nodeId":"p_knob","port":"geometry"},  "target": {"nodeId":"mat_b","port":"geometry"} },
    { "type": "connect", "edgeId": "c6",  "source": {"nodeId":"mat_b","port":"geometry"},   "target": {"nodeId":"j_fix","port":"geometry"} },
    { "type": "connect", "edgeId": "c7",  "source": {"nodeId":"j_fix","port":"geometry"},   "target": {"nodeId":"z_qc","port":"geometry"} },
    { "type": "connect", "edgeId": "c8",  "source": {"nodeId":"z_qc","port":"geometry"},    "target": {"nodeId":"z_val","port":"geometry"} },
    { "type": "connect", "edgeId": "c9",  "source": {"nodeId":"z_qc","port":"geometry"},    "target": {"nodeId":"z_urdf","port":"geometry"} },
    { "type": "connect", "edgeId": "c10", "source": {"nodeId":"z_urdf","port":"urdf"},      "target": {"nodeId":"z_view","port":"urdf"} }
  ]
}}
```

Notes:

- **Phase 1 is one small batch per part**, each ending in `g_bake_part`; you read
  back a `<sha>.obj` `filename` (and `sha256`) per part. Native primitives skip
  baking (empty `filename` + `note`) — reference those with `g_box`/`g_cylinder`
  in Phase 2 instead of `g_mesh`.
- **Phase 2 is a clean rewrite** that only references the staged meshes. You can
  paste the `<sha>.obj` literals (shown) or, if you keep the `g_bake_part` nodes
  in the same graph, wire each `g_bake_part.filename` **output** into the matching
  `g_mesh.filename` **input** instead of hardcoding the sha.
- Color is applied in Phase 2 with `g_material` (it rides the URDF `<material>`);
  the OBJ meshes carry pure geometry only.
- After the Phase-2 `execute`, confirm the staging actually paid off: `z_urdf`'s
  `report.bakeFallbacks` should be `0`, `report.meshFileCount` should be `0`, and
  `stats.meshProvenance` should be **all `native`** — Phase 2 must not re-bake.
- If a part's geometry is wrong, fix it by **re-modeling + re-baking that one part
  in Phase 1**, not by editing Phase-2 internals.

## Execute

```json
{
  "toolId": "lowpoly:pipeline.execute",
  "args": { "nodeId": "optional-node-id" },
  "caller": { "kind": "ai" }
}
```

Omit `nodeId` for a full graph execution.
