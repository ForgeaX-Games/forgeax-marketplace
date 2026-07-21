# Quickstart

DSL-first. Studio ToolRegistry (`lowpoly:*`) is the only control plane; you write
Geometry DSL text and submit it — never hand-wire nodes.

1. `lowpoly:projects.list` / `lowpoly:projects.open` (or `create`) to pick the
   active project. `lowpoly:projects.close` when done to release the per-agent lock.
2. **Op signatures come from [op-directory.md](op-directory.md)** (the authoring
   SSOT) and syntax from [dsl-quickref.md](dsl-quickref.md). Do **not** call
   `batteries.list` / `batteries.get`.
3. **Phase 0 — part manifest** (hard gate): one detailed row per part (name +
   function → real form → op route → dimensions with axes → detail features →
   local datum → assembly link → material → per-primitive justification). A thin
   "A: box, B: cylinder" list is a failed manifest — see
   [part-a-asset.md](executions/part-a-asset.md#phase-0--part-manifest-hard-gate).
   Prefer CSG / Parts / Assembly over stacked primitives. Never build the whole
   object in one model.
4. **Phase 1 — model + bake each part** (loop): write a small DSL per part and
   submit `model.apply({ source, bake: "<shape_id>" })`; record the returned
   `<sha>.obj` filename + bbox (`lowpoly:parts.list` can re-list them).
5. **Phase 2 — assemble** (one clean DSL): `mesh(filename=<sha>.obj)` per
   non-trivial part (trivial primitives stay `box`/`cylinder`), wrap with `part`,
   color with `material`, connect with `joint`, then `model.apply({ source })`
   (the compiler auto-appends the QC + URDF terminals).

Do not write runtime JSON directly.

## Iteration Loop

A **self-check → self-fix → re-apply closed loop the agent owns**: diagnose and fix
mechanical defects yourself from the `model.apply` receipt, loop until it is clean
*and* each part's size/AABB matches the Phase-0 manifest. Only stop to ask the user
on subjective / unclear-requirement calls. The loop runs in **Phase 2** (assembly);
Phase 1 is a bake loop with no per-part gate.

For a **scene** (see [part-c-scene-assembly.md](executions/part-c-scene-assembly.md)):
per-unique-item `model.apply({bake})` (all in the same project) → reference assembly
by giving each `part` an `origin` (one `<sha>.obj` reused across N instances). A
jointless scene **auto-routes to the STATIC pipeline** (`g_geometry_qc → g_to_scene`),
which merges every placed part into **one multi-material `.glb`** — there is **no
URDF, no auto-stitch, and no `islands`/`floating_link`** in scene mode. Only overlap
signals apply, and they are informational — fix obvious real clashes, not every AABB touch.

The **`model.apply` receipt is the whole completion gate** — read it after every
apply:

- `errors` — parse / validate / unmapped-op, each mapped to a DSL line number. Fix
  that line and re-apply.
- `qc` — `valid`, `islands`, `overlaps`, `missing_aabb`, `floating_links`,
  `orphan_profiles`, plus structured `signals[]` with a per-signal `severity`
  (`error`/`warning`/`note`). **Loop until `valid` is true / no `error`-severity
  signal remains.** **`islands`/`floating_link` are the hard connectivity defects**
  — a part with no joint path to the root gets silently dropped from the URDF, so
  wire it in with `g_joint_*`. **`aabb_overlap`/`mesh_overlap` never fail `valid`**
  — low-poly models often have benign rest-pose AABB touches (wall corners, embedded
  frames, stair wells). Rigid fixed-joint overlaps emit `note`; moving-joint-chain
  overlaps emit `warning`. Review case-by-case with `g_metrics max_penetration` /
  `overlap_ratio`, but **do not detach or reposition parts just to silence overlap**
  — that trades informational noise for a real `floating_link`/`islands` error.
- `meshQc` — mesh-aware interpenetration (needs `mesh` `bbox_min/max`); same
  note/warning split as `aabb_overlap` above. Only `joint_child_detached` on a moving
  joint fails `clean`.
- `urdf` — `fingerprint` (compare across iterations to confirm the output changed),
  `bytes`, and any `errors`.
- Cross-check each part's size/AABB against the Phase-0 manifest to catch
  scale/proportion errors.

Fix the **decomposition**, not just the symptom; do not declare completion from a
single clean apply if a part still doesn't match its manifest row. For physics/sim,
add `g_auto_collision` before the assembly's terminal.
