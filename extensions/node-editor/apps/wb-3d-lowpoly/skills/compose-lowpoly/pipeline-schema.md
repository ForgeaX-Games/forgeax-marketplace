# DSL → graph compilation (what `model.apply` does for you)

> ⚠️ **Optional / background.** The example blocks lower in this file still use the
> old `createNode` JSON form to illustrate what the compiler *produces*. You never
> write that — author DSL and submit `model.apply`. For a runnable DSL template use
> the example in [dsl-quickref.md](dsl-quickref.md); for signatures use
> [op-directory.md](op-directory.md). Read this page only to understand how the
> receipt maps back to your DSL.

You author **Geometry DSL** and submit it with `lowpoly:model.apply({ source })`.
The backend `dsl-to-graph` compiler turns that text into the `@forgeax/node-runtime`
graph — **you never emit `createNode`/`connect`**. This page explains the mapping so
you can reason about the receipt.

## The compilation rules

For a DSL like:

```
b1 = box(size=[1, 1, 1])
p1 = part(shape=b1)
```

the compiler produces, deterministically:

- **one node per statement** — the op name maps to a battery id (`box`→`g_box`,
  `part`→`g_part`, `joint(type=revolute)`→`g_joint_revolute`, `fillet`/`chamfer`→
  `g_fillet`, `spur_gear`→`g_gear`, …). An op with **no** battery mapping is a hard
  error reported with its **DSL line number** — never silently dropped.
- **a linear `geometry` edge** threading every statement in source order (each op
  appends its statement to the accumulating geometry document).
- **`ref` edges**: every `ref` arg (`shape=b1`, `base=…`, `parent=…`) becomes an edge
  from the referenced statement's `id` output into this node's matching input port.
- **auto-appended terminals** `g_geometry_qc` → `g_to_urdf`, so validation and URDF
  come for free on every apply.

## The receipt

`model.apply` returns a compact receipt. Read it instead of re-fetching the graph:

- `errors[]` — parse / validate / unmapped-op errors, each with a `line`.
- `execution.status` (`completed`/`error`/`timeout`) and, on failure, `execution.error`
  with the offending `nodeId` + `line`.
- `qc` — `valid`, counts (`islands`/`overlaps`/`missing_aabb`/`floating_links`/
  `orphan_profiles`), and `signals[]` each carrying the DSL `line`(s) they refer to.
- `meshQc` — mesh-aware interpenetration (`clean`, `signals[]` with executable
  `suggestion` translation deltas), using real baked-mesh bounding boxes.
- `urdf` — `fingerprint` (compare across iterations to confirm the output changed)
  and any `errors`.

> **Ref resolution is still validated per statement.** A `ref` to a missing/wrong id
> (`base`, `tool`, `a`/`b`, `profile`, `shape`, `parent`, `child`, …) is caught by
> `validateStatements` and reported with the line number, so you fix that one line and
> re-apply. This is the DSL-first replacement for the old "silent id-drop" gotcha.

The id inputs the compiler wires for you (for reference — you write the ref by name,
not the battery port):

| op | ref args → battery id ports |
|---|---|
| `difference` | `base`→`base_id` (kept), `tool`→`tool_id` (subtracted) |
| `union` / `intersection` | `a`→`a_id`, `b`→`b_id` |
| `extrude` / `revolve` / `lathe` | `profile`→`profile_id` |
| `extrude_with_holes` | `outer`→`outer_id`, `holes`→`hole_ids` |
| `loft` | `profiles`→`profile_ids` |
| `part` | `shape`→`shape_id`, `material`→`material_id` (its `id` output is the **part** id) |
| `joint` | `parent`→`parent_id`, `child`→`child_id` (**part** ids, not shapes) |

## Runnable multi-part assembly (CSG cut + revolute joint)

A cabinet whose front opening is **cut** (CSG difference, not a faked box), with a
door on a **revolute** hinge — the whole thing as ~7 lines of DSL:

```
n_body = box(size=[0.4, 0.3, 0.5])
n_open = box(size=[0.34, 0.05, 0.44])
shell  = difference(base=n_body, tool=n_open)     # carve the opening
door_s = box(size=[0.34, 0.02, 0.44])
case   = part(shape=shell)
door   = part(shape=door_s, origin=[0.17, -0.16, 0])
hinge  = joint(type="revolute", parent=case, child=door,
               axis=[0, 0, 1], origin=[0.17, -0.16, 0], lower=0, upper=1.57)
```

`lowpoly:model.apply({ source })` compiles this (adding QC + URDF terminals), executes,
and returns the receipt. Notes:

- `difference` resolves `base`/`tool` against the accumulated geometry; `shell` is a
  real CSG solid, not stacked boxes.
- `case`/`door` are **part** ids — the joint references those, not the shape ids.
- Read the receipt's `qc.signals` (islands / overlaps / floating links) and
  `urdf.fingerprint`; `urdf` errors or a `bakeFallbacks`-style degrade surface there.

## Runnable two-phase example (bake each part → reference the meshes)

The [mandatory two-phase workflow](executions/part-a-asset.md#mandatory-two-phase-workflow-read-before-the-first-applybatch)
for a tiny cup = a CSG-cut **shell** + a **knob** lid handle. Phase 1 models and
**bakes each part on its own** (`bake` mode); Phase 2 **references** the staged meshes.

**Phase 1a — model + bake the cup shell.** Apply the shell's DSL with `bake` set to the
shape id to bake:

```json
{ "toolId": "lowpoly:model.apply", "caller": { "kind": "ai" }, "args": {
  "source": "outer = cylinder(radius=0.04, length=0.1)\ncavity = cylinder(radius=0.035, length=0.09)\nshell = difference(base=outer, tool=cavity)",
  "bake": "shell"
}}
```

The receipt's `baked` block gives `filename` (`"<shaA>.obj"`), `sha256`, `bbox_min/max`,
`dims` — and the part is auto-registered into `parts.json` (query later with
`lowpoly:parts.list`). Native primitives (`box`/`cylinder`/`sphere`) return an empty
`filename` + `note` — reference those directly in Phase 2, no baking needed.

**Phase 1b — model + bake the knob:**

```json
{ "toolId": "lowpoly:model.apply", "caller": { "kind": "ai" }, "args": {
  "source": "knob = knob(diameter=0.03, height=0.02, body_style=\"domed\", bore_d=0.006)",
  "bake": "knob"
}}
```

Record its `baked.filename` (`"<shaB>.obj"`). Each bake `model.apply` **replaces** the
graph with just that part's subgraph, so nothing accumulates — you only carry the two
`<sha>.obj` names forward (or re-query `parts.list`).

**Phase 2 — assemble from the staged meshes.** Reference the two `<sha>.obj` by name,
color per part, one rooted tree:

```json
{ "toolId": "lowpoly:model.apply", "caller": { "kind": "ai" }, "args": {
  "source": "mat_a = material(rgba=[0.85, 0.85, 0.9, 1])\nmat_b = material(rgba=[0.2, 0.4, 0.7, 1])\nshell_m = mesh(filename=\"<shaA>.obj\")\nknob_m = mesh(filename=\"<shaB>.obj\")\ncup = part(shape=shell_m, material=mat_a)\nlid_knob = part(shape=knob_m, material=mat_b, origin=[0, 0, 0.06])\nj = joint(type=\"fixed\", parent=cup, child=lid_knob, origin=[0, 0, 0.06])",
  "name": "cup"
}}
```

Notes:

- **Phase 1 is one small `model.apply` per part** with `bake`. You read back a
  `<sha>.obj` per part; the graph never grows.
- **Phase 2 is a clean apply** referencing the staged meshes by their `<sha>.obj`
  literals. The bake is content-addressed, so the literal resolves the same mesh.
- Color rides Phase 2's `material` refs; the OBJ meshes carry pure geometry.
- Confirm staging paid off from the Phase-2 receipt: no `urdf.errors`, and the
  fingerprint changes only when geometry actually changes.
- If a part's geometry is wrong, fix it by **re-modeling + re-baking that one part**
  in Phase 1, not by editing Phase-2 internals.
