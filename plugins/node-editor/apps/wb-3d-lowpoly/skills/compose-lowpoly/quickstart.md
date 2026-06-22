# Quickstart

Use Studio ToolRegistry as the only control plane:

1. `lowpoly:projects.list` to find the active project.
2. `lowpoly:projects.create` or `lowpoly:projects.open` when needed. Call
   `lowpoly:projects.close` when you are done driving a project to release the
   per-agent lock (otherwise the project stays locked to you).
3. `lowpoly:batteries.list` and `lowpoly:batteries.get` to inspect exact op
   IDs, params, inputs, and outputs.
4. **Write the Phase 0 part manifest** before touching the graph — one **detailed**
   row per part (name + function → real form in 2–3 sentences → concrete op route
   → dimensions with axes & proportions → detail features and where they sit →
   local datum/orientation → assembly link/joint → material → per-primitive
   justification). It is the build spec Phase 1 models against, so a thin
   "A: box, B: cylinder" list is a failed manifest — see
   [part-a-asset.md](executions/part-a-asset.md#phase-0--part-manifest-hard-gate) (with a worked example)
   and [modeling-guide.md](modeling-guide.md). Prefer `CSG`/`Parts`/`Assembly`
   over stacked primitives. **Never build the whole object in one batch.**
5. **Phase 1 — model + bake each part** (loop): for every part build an
   independent subgraph (`applyBatch`/`execute`), end it with `g_bake_part`
   (`shape_id` = the terminal shape), and record the returned `filename`
   (`<sha>.obj`).
6. **Phase 2 — assemble** (rewrite a clean DSL): `g_mesh(filename=<sha>.obj)` per
   non-trivial part (trivial primitives stay `g_box`/`g_cylinder`), wrap with
   `g_part`, color with `g_material`, connect with `g_joint_*`, then
   `g_geometry_qc` + `g_validate` + `g_to_urdf` + `urdf_preview`.
7. `lowpoly:pipeline.get` / `lowpoly:pipeline.applyBatch` /
   `lowpoly:pipeline.execute` to read, mutate, and run the graph in each phase.
8. `lowpoly:screenshot.capture` and `lowpoly:assets.list` to inspect the
   assembled (Phase 2) result.
9. `lowpoly:export-glb` to bake the live scene to a binary glTF (with joint
   preview animation) when you need a portable model artifact.

Do not write runtime JSON directly. The backend persists graphs, history, and
outputs through node-runtime so human UI actions and AI tool calls stay on the
same path.

## Example Tool Call

```json
{
  "toolId": "lowpoly:batteries.list",
  "args": {},
  "caller": { "kind": "ai" }
}
```

## Iteration Loop

The iteration loop runs in **Phase 2** (assembly). Phase 1 is a bake loop with no
per-part screenshot/QC gate — model each part, `g_bake_part` it, move on. Once the
meshes are staged, assemble and loop. After every meaningful Phase-2 graph change:

1. Execute the graph.
2. **Run the QC sensors.** Wire `g_geometry_qc` and `g_validate` into the
   geometry just before `g_to_urdf`, then read their outputs:
   - `g_geometry_qc` → `report`, `islands` (> 1 = floating parts),
     `missing_aabb`, `overlaps`, `floating_links` (parts with no joint path to
     root — dropped at runtime), `orphan_profiles` (profiles never
     extruded/lofted/revolved), `primitive_only` (every shape is a bare primitive
     with no CSG solid / Parts / Gears / baked mesh — fires **even when the boxes
     are wrapped in g_part + g_joint**, so wrapping a box-stack does not silence
     it; **stop and re-decompose, do not ship a box-stack**),
     and the structured `signals[]` (`{code, severity, message, ids?}`) — loop on
     the codes (`floating_link` / `orphan_profile` / `lathe_xy_profile` /
     `mesh_boolean_misuse` / …).
   - `g_validate` → `errors` / `valid` (≥ 1 part, joints reference real parts,
     no cycles).
   - Also read each CSG/Assembly op's `error` output — a bad `*_id` ref drops
     silently while the batch still reports `ok`.
   - `g_to_urdf.report` → compare `fingerprint` across iterations to confirm the
     output actually changed; check `signalBundle.errors/warnings`. In Phase 2,
     because every part is a native `g_mesh` reference, expect `bakeFallbacks = 0`
     and `report.meshFileCount = 0` (the meshes were already staged in Phase 1);
     `bakeFallbacks > 0` means a composite snuck into the assembly DSL or a
     `g_mesh.filename` is wrong — investigate.
3. **Capture and review the preview screenshot in the right order.**
   `lowpoly:screenshot.capture` returns an **orthographic 4-view contact sheet**
   (Front / Side / Top / Iso, labeled 2×2). Review it **after** the QC signals,
   not instead of them:
   - First read the QC structured signals above (especially `aabb_overlap` and
     joint-origin distance) — those are the machine-checked truth.
   - Then read the contact sheet and, **per view**, write a short
     expected-vs-observed note: alignment, interpenetration, proportions, gaps.
     Orthographic views make these obvious where a single perspective shot hides
     them.
   - A step is only done when **both** pass. **Do not capture one frame, glance
     at it, and declare success.**
4. Inspect assets when the model/export path is relevant.
5. For physics/sim, add `g_auto_collision` before `g_to_urdf` to derive
   `<collision>` for every part (it reports `added` / `skipped`).
6. Apply another focused batch if QC, the screenshot, or the outputs show a
   mismatch — fix the **decomposition**, not just the symptom. Do not declare
   completion from a single green batch; iterate until QC is clean *and* the
   preview (all four views) matches the request.
