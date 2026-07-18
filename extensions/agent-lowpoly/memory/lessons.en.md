# Poly · Accumulated lessons

## 2026-06-17 · Tool output tidied up (execute default summary + incremental)
- **`lowpoly:pipeline.execute` returns only a KB-scale summary by default** (status + port shape hints), no longer the full mesh/buffers. Judge success by `status` / `itemCount`.
- **Pass the `nodeId` of whichever node you changed to run its downstream closure** (incremental; upstream is taken from cache). Don't naively re-run the whole graph every time. Only the rare case that truly needs the full run uses `raw:true`.
- Any tool result over ~24KB is auto-spilled to `<cwd>/.cache/tool-results/*.json`, returning only `{path, preview}`; `batteries.list/get` already strip inline icons and are clean text.

## 2026-06-01 · Initialization
- Memory system in place
- Dedicated to 3D low-poly modeling (wb-3d-lowpoly), tools `lowpoly:*`, default skill `compose-lowpoly` (entry + routing: PART A assets/mechanical · PART B architecture · PART C scene assembly)


## 2026-06-01 · Pitfalls of articulated lowpoly assembly (tank)

### Screenshot chain
- `screenshot.capture`'s `timeout` is in **milliseconds** — pass 20000 (not 20/60).
- The returned `dataUrl` is an in-memory base64, too large to view directly: `curl -s POST http://127.0.0.1:9567/api/v1/agent/screenshot/capture -d '{"timeout":20000}'` → decode base64 to a png on disk → `read_file` to view it. `/latest` returns 404 on 9567.

### pipeline execute / cache
- Running `pipeline.execute` with a single `nodeId` (e.g. view) will **eat the upstream cache** — you changed an upstream node but see the old URDF. After editing, run the **whole graph** execute (no nodeId) to force-recompute `g_to_urdf`, then screenshot / read the urdf.
- **The op type of a node/joint cannot be changed with updateNode** (it only merges params); you must `deleteNode` + `createNode` (reuse the same nodeId) + **reconnect the edges that got cascade-deleted**. Only pure parameter changes (size/limit/origin) use updateNode.

### Joints / coordinate frames (most important)
- **The fixed→articulated frame trap**: when a fixed joint's origin is all-zero, every part's visual origin is in **world coordinates**; once you set a joint origin to a non-zero pivot (turret rotation axis, trunnion), that child's visual origin must become the **local coordinate relative to the pivot = world coordinate − pivot**, otherwise it swings out in a big arc around the wrong center.
- **Kinematic following is free**: as long as a joint's `parent` points at the parent part, the child moves with it (turret turns → gun shield/barrel/commander cupola follow automatically); no need to handle it separately.
- **revolute pitch sign**: for an object along +X rotating about +Y, +θ tips the front toward −Z (depress), −θ toward +Z (elevate). For "large elevation range, small depression range" use `lower=large negative` (elevation limit) / `upper=small positive` (depression limit). Don't trust intuition on direction; drag the slider / render to confirm.
- Joint ops: `g_joint_continuous` (unlimited 360°, e.g. turret/wheels), `g_joint_revolute` (with lower/upper limits, e.g. pitch), `g_joint_fixed` (rigid).
