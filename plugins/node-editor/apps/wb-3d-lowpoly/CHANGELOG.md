# Changelog

> **Maintenance convention.** Add an entry under `## Unreleased` for every
> substantive change, grouped by `Added` / `Changed` / `Fixed` / `Removed`, and
> state the *why*. The kernel is the in-repo `workspace:*` packages under
> `packages/*` — there is no `external/` submodule pin to cite. Every commit that
> touches `apps/wb-3d-lowpoly/*` source updates this file. History is
> **append-only** — never rewrite past entries; corrections append a new entry
> stating the reason. See [`AGENTS.md`](./AGENTS.md).

## Unreleased

### Fixed

- **AI tool handlers transparently recover project lock after backend restart.**
  `tool-handlers.ts` re-opens active project on `mutation-denied-not-open` and retries once.
- **Mutation routes forward `expectedPrevHash` and surface lock `code` on HTTP 403.**
  `mutations.ts`, `projects.ts`, `execute.ts`, `pipelineImport.ts`.

### Added

- **Battery SVG icons migrated from the legacy dev branch.** Adds explicit icons
  for the 3D Assembly, CSG, Gears, Parts, Preview, Primitive, Profile, Transform,
  and Utils batteries so the palette no longer falls back to generic glyphs.
- **`pnpm dev` HMR launcher (`scripts/dev.mjs`).** Runs the backend
  (`tsx --watch src/main.ts`) and the frontend (Vite dev server, which proxies
  `/api`,`/ws` to the backend via `vite.config`) together — the hot-reloading
  counterpart to `serve` (built dist). Builds `vendor/dist` first if missing
  (the `tsx --watch` path skips the backend `prebuild` that `serve` gets). Both
  halves share one process group so the host can group-kill the watcher tree on
  teardown. The studio `scripts/run.sh` now prefers `pnpm dev` for standalone
  plugins by default (set `FORGEAX_PLUGIN_HMR=0` for the `serve`/dist path), so
  editing plugin/kernel source hot-reloads the iframe instead of requiring a
  rebuild.
- **Richer architecture elements.** New shape types and ops so buildings read as
  more than boxes-with-pitched-lids:
  - `roof` gained `gambrel` / `mansard` / `pyramid` (on top of flat/shed/gable/hip);
    `g_roof` and `g_building_shell` accept them.
  - `stairs` gained `type=spiral` (treads around a center pole; `radius` /
    `inner_radius` / `sweep_deg`) in addition to `straight`.
  - `window` gained `type=cross|grid|louver` with `rows` / `cols` (grid mullion
    matrix; louver slat stack).
  - `door` gained `leaves=2` (double / French door, two opposed leaves) and
    `style=flush|panel|glazed` on the leaf.
  - New `g_railing` (balustrade: end posts + top handrail + balusters) and
    `g_column` (round/square pillar with optional base & capital) batteries +
    `railing` / `column` baker ops, registry specs and analytic AABBs.
- **Architecture family — static low-poly buildings.** New `batteries/3d/Architecture/`
  family (its own palette category, derived from the folder) plus matching baker
  ops and DSL `OpSpec`s, so buildings compose from semantic elements instead of
  bare `g_box` stacks:
  - **Elements**: `g_wall` (straight wall minus an `openings` list of
    `[x, width, sill, head]` door/window holes), `g_floor_slab` (slab with
    optional `[x,y,w,d]` stair/shaft wells), `g_stairs` (fused stepped flight),
    `g_roof` (`flat`/`shed`/`gable`/`hip` via extruded prism / loft, with
    overhang), `g_facade_panel` (siding sheet with reveal grooves).
  - **Openings**: `g_window` (frame + cross mullion + optional glass, one fused
    shape) and `g_door` (emits a `door_frame` **and a separate** `door_leaf`
    shape so a generator can join the leaf `revolute`/openable or `fixed`).
  - **Generator**: `g_building_shell` (multi-storey slabs, interior/exterior walls,
    stair well, roof under a single root; a single room = `floors=1,
    rooms_per_floor=1, roof_type=none`). Layout is **dual-mode**: an explicit
    `rooms` JSON pass-through, or procedural recursive BSP split via the shared
    `subdivideFootprint`/`roomToWalls` helper (`vendor/shared/types/geometry/
    arch-layout.ts`, re-exported at `backend/src/services/baker/arch/layout.ts`).
  - **Baker**: `backend/src/services/baker/ops/architecture.ts` (8 builders:
    wall/floor_slab/stairs/roof/facade_panel/window/door_frame/door_leaf) wired
    into `ops/index.ts`; new `OpSpec`s in
    `vendor/shared/types/geometry/op-registry.ts` (rebuilt `vendor/dist`).
  - **Skill + docs**: new `skills/compose-lowpoly-building/` skill (reuses the
    same ToolRegistry/QC loop, recasts the modeling philosophy as a *building
    brief*); enumerated the Architecture family in top-level `SKILL.md`, the
    `battery-catalog.md` family table + routing, and a new **Architecture** page
    in `modeling-guide.md`; registered the skill in `forgeax-plugin.json`.
  - **Tests**: `backend/tests/architecture.test.ts` — real OCCT bakes
    (wall ±opening, slab, stairs, gable/hip/shed roof, window, door leaf),
    `g_wall`/`g_window`/`g_door` DSL emission + validate, `subdivideFootprint`
    determinism, and `g_building_shell` single-rooted-tree checks.
- **Parametric Parts templates (articraft-style).** Wired new optional, genuinely
  geometric parameters into both the baker and the battery meta/index:
  - `Parts/g_knob`: `bore_d` (center bore), `skirt_diameter`/`skirt_height` (base
    skirt), `indicator` (top pointer groove).
  - `Parts/g_bezel`: `flange_width` (rear mounting lip), `recess_depth` (front seat
    for a screen/lens).
  - `Parts/g_tire`: `tread_depth`/`tread_count` (circumferential tread grooves),
    `sidewall_depth` (side-face annular recess).
  - `Parts/g_wheel`: `spoke_count` (N radial spokes replacing the solid twin discs)
    plus `bore_d` (optional center bore, removing the hard-coded `0.18*radius`).
- **`Utils/g_auto_collision`** — derive `<collision>` for *every* part from its
  visual in one pass (mirrors articraft `exact_collisions.py`): native primitives
  are copied exactly (box→box, cylinder→cylinder, sphere→sphere), everything else
  falls back to an AABB box; parts that already have a collision are skipped unless
  `replace=true`.
- **`Utils/g_to_urdf` compile report.** New `report` output: `meshFileCount`,
  `meshTotalBytes`, `totalVertices/Triangles`, `bakeMs`, `cacheHits`,
  `bakeFallbacks`, a content `fingerprint`, and a `signalBundle`
  (errors/warnings/notes + per-code counts) for agent fix loops.
- **`Utils/g_geometry_qc` structured signals + new sensors.** Added a `signals[]`
  output (`{code, severity, message, ids?}`) plus new checks: **floating links**
  (no joint path to root), **orphan profiles** (a `profile_*` not consumed by
  extrude/loft/revolve/part), **lathe/revolve fed an XY-centered profile**, and
  **mesh-backed boolean misuse** (pipe/sweep/section_loft into union/difference/
  intersection). Exposes `floating_links`/`orphan_profiles` counts.

### Changed

- **`primitive_only` QC signal now fires for box-stacks wrapped in parts/joints.**
  The original gate required `no part` **and** `no joint`, so the moment a model
  wrapped its boxes in `g_part` + `g_joint_*` — i.e. the exact lazy
  "stacked-boxes assembled into a URDF" failure mode — the signal went silent and
  never warned. `Utils/g_geometry_qc` now judges **only the shapes**: it warns
  when *every* shape is a bare primitive with no rich geometry at all (no CSG
  solid, no Parts/Gears/Architecture, no baked `mesh`), independent of
  part/joint wrapping. Pure-placement transforms and 2D profiles do not count as
  rich geometry. Still non-fatal (`severity: warning`, does not affect `valid`)
  per the "QC as a sensor" design. `meta.json` output doc updated to match.
- **`compose-lowpoly-3d-pipeline` SKILL workflow normalized to "model Parts →
  assemble URDF".** The generic 7-step tool loop (whose step 4 "apply graph
  changes" invited a single mega-batch) is replaced by a phase-structured spine
  (Phase 0 manifest → Phase 1 per-part model + `g_bake_part` → Phase 2 reference
  meshes + assemble), so the first procedure the agent reads already enforces the
  two-phase discipline. Refreshed the stale `primitive_only` descriptions in
  `quickstart.md` / `modeling-guide.md` to note it now fires even when boxes are
  wrapped in parts/joints.
- **Phase 0 manifest now demands a detailed per-part build spec.** The manifest
  schema in `compose-lowpoly-3d-pipeline/SKILL.md` was a thin field list that the
  agent satisfied with placeholder rows ("A: box, B: cylinder"), giving Phase 1
  nothing to model against. It now requires, per part, the function, a 2–3
  sentence real-form description, a concrete op route, dimensions with axes &
  proportions, located detail features, local datum/orientation, the assembly
  link/joint, and material — with a worked example row setting the expected
  density and an explicit "a thin/generic row is a failed manifest" gate.
  `quickstart.md` Phase 0 step updated to match.
- **Kernel source now hot-reloads in dev (no `pnpm -r build` needed).** The
  frontend imported the kernel via package `exports`→`dist`, so editing
  `node-runtime` / `node-runtime-react` only took effect after a rebuild +
  restart. `frontend/vite.config.ts` now adds a dev-only `resolve.alias` mapping
  `@forgeax/node-runtime-react` (`.`, `/editor`, `/themes`) and
  `@forgeax/node-runtime` (`.`, `/layer1`) to their `src/*.ts`, with
  `optimizeDeps.exclude` (serve unbundled) and `dedupe: [react, react-dom,
  reactflow, zustand]` (single React across app + kernel source). `scripts/dev.mjs`
  runs the backend's `tsx --watch` with `--conditions=source` so the kernel's
  new `"source"` export condition resolves backend imports to `src` too — kernel
  edits hot-restart the backend. Verified: a `node-runtime-react/src` edit fires
  a Vite `hmr update`, and a `node-runtime/src` edit restarts the backend, both
  with zero build. `vite preview` / `serve` (dist) are untouched.
- **Docs realigned to monorepo (kernel is `workspace:*` `packages/*`, not an
  `external/` submodule); removed dead `.gitmodules` + `.cursor/rules/kernel-cascade.mdc`;
  hygiene-check kernel-submodule guard removed.**
- **Removed the `g_room` battery.** It rendered as nothing useful in the viewer
  and fully overlapped `g_building_shell`; a single room is now
  `g_building_shell(floors=1, rooms_per_floor=1, roof_type=none)`. Docs and the
  architecture test suite were updated accordingly.
- **Gears real geometry (P2).**
  - `herringbone_rack_gear` no longer reuses the straight rack body; it now slices
    the rack along its width with a symmetric half-helix X-shift so the teeth form
    a real V/chevron (distinct mesh from `rack_gear`).
  - `bevel_gear`/`bevel_gear_pair` now consume `helix_angle` (progressive per-slice
    Z-rotation → spiral-bevel tooth trace; `0` = straight bevel) and the pair routes
    `pressure_angle`/`clearance`/`backlash` through to each side's slices.
  - `worm` pitch/lead math made self-consistent: lead `L = n_threads·π·module`,
    `d0 = L/(π·tan(lead_angle))`, total twist `= 2π·length/L`, all derived from a
    single source so the radius and twist no longer disagree.
- **Hinges A/B knuckle interleave (P2).** `barrel_hinge`/`piano_hinge` knuckles now
  alternate ownership between the two leaves (each leaf is fused with its own
  knuckles, then leaf B rotates with its knuckles), so the fold reads as interleaved
  fingers; `barrel_hinge` `knuckle_count` is forced odd to match `piano_hinge`.
- **Gears metadata truthfulness (P1).** Removed dead inputs from meta+index
  (`hub_d`/`hub_length`/`chamfer` on spur/herringbone/ring; `trim_top`/`trim_bottom`
  on bevel; `helix_angle` on rack/bevel_pair); aligned `helix_angle`/pitch/sweep
  default *descriptions* with the baker's real fallbacks (e.g. herringbone 25°,
  crossed-helical 15°, fan/blower sweep); exposed `slat_direction` on
  `Parts/g_vent_grille`; and rewrote every `Gears/*` meta to the Parts style
  (`principal: geometry`, per-input `description-en`, when-to-use triggers).
- **Planetary validation alignment (P1).** `g_planetary_gearset`/
  `g_herringbone_planetary_gearset` index now require sun/planet teeth `>= 3` and
  `n_planets >= 1`, matching the baker.

### Fixed

- **Visible baker safety (P3).** The mesh-backed boolean error message now names the
  offending upstream (pipe/sweep/section_loft) and suggests solid alternatives;
  `lathe`/`revolve` now report a clear error (with the source op) when fed an
  XY-centered profile instead of silently producing a wrong solid of revolution.
  (AABB fallback already surfaces a configurable `BAKE_FALLBACK_USED` diagnostic +
  mesh provenance.)

- **Anti-primitive modeling guidance + richer battery metadata (docs/metadata only,
  plus one non-fatal QC signal).** The LLM almost always fell back to `g_box`/
  `g_cylinder` stacks even though the catalog ships full `CSG` / `Parts` / `Gears`
  / `Assembly` families, because the skill was ~90% tool-call mechanics with
  primitive-biased modeling advice, the families were never enumerated, and the
  `*_id` wiring (plus its silent failure) was undocumented. Ported the articraft
  approach:
  - **Skill rewrite** (`skills/compose-lowpoly-3d-pipeline/`): added a *Modeling
    Philosophy* (realistic-geometry-first, explicit anti-primitive rule, a
    mandatory decomposition **brief** before the first `applyBatch`) to
    `SKILL.md`; replaced the primitive-biased *Lowpoly Guidance* in
    `battery-catalog.md` with a **family list + routing table** and a
    "read the `error`/`report` outputs" note; added the **id-port wiring** rules
    and a **runnable multi-part assembly example**
    (`shape → CSG → g_part → g_joint_* → g_geometry_qc → g_to_urdf → urdf_preview`)
    to `pipeline-schema.md`; inserted the brief + a **QC step** into the
    `quickstart.md` iteration loop; and added a new per-family `modeling-guide.md`.
    Top-level `SKILL.md` now enumerates the geometry families instead of only
    pointing at `batteries.list`.
  - **Battery metadata** (no runtime/logic change): filled in `description-en`,
    "when to use" clauses, `*_id` upstream-port wiring, and a documented `error`
    output for every `CSG/*` op; clarified `shape_id`/`parent_id`/`child_id`
    wiring and added a single-rooted-tree drop warning to `Assembly/g_part` and
    `Assembly/g_joint_*`; and added `description-en`, trigger words, and a
    consistent `principal: geometry` hint to every `Parts/*` op.
  - **QC sensor** (`Utils/g_geometry_qc`): added a non-fatal **geometry-richness
    signal** — when the model is all bare primitives with no CSG/Parts/Gears and
    no `part`/`joint`, it appends a `primitive_only` note to `report` and exposes
    a new `primitive_only` boolean output. Does not affect `valid` or block
    execution; it is the articraft-style "QC as a sensor" gate the loop reads.

- **Kernel cascade: bump `external/forgeax-wb-node-core` to `f831fe6`.** The
  kernel retires the obsolete `asset_grid` core port type and the legacy
  texture-binding executor hook.

- **`pnpm serve` matches scene-generator dist contract.** Replaced
  `backend dev` + `vite preview` with `scripts/serve-dist.mjs`: serves
  `frontend/dist`, runs `backend/dist/main.js`, auto-builds missing dist
  bundles, proxies `/api/*` and `/ws` (same host `run.sh` integration).

### Fixed

- **`batteryRoots` loads shared common batteries from `external/forgeax-wb-node-core`.**
  Same resolution order as scene-generator: `external/` submodule path, then
  sibling `../forgeax-wb-node-core`, then plugin `batteries/` (marketplace vs
  forgeax-studio layouts).

### Changed

- **Kernel cascade: bump `external/forgeax-wb-node-core` to `afd18d0`.** Kernel
  `isTemplateBattery` now keys off the big label (`getBigLabel !== 'groups'`)
  instead of an exact `displayGroup` match, so `groups/<cat>` group batteries
  stay in the Develop palette (GROUPS tab, sub-categorized) while `templates/*`
  stay in Templates mode. No lowpoly code change — pin + dist sync only;
  existing lowpoly groups/templates are unaffected (backward compatible).

### Added

- **Multi-project management in the left pane + per-agent project lock** (kernel
  cascade — bump `external/forgeax-wb-node-core`; see its CHANGELOG Unreleased).
  - The left pane (`frontend/src/workbench/WorkbenchLeftPane.tsx`) now mounts the
    kernel **`<ProjectPanel>`** (cards: switch / create / delete) as its top section;
    it configures its own editor transport + `subscribeProjectActivation()` so it
    stays live with the center editor. The old read-only "Recent projects" list was
    removed (superseded by the interactive panel). The static flow / outputs / tips
    sections are kept.
  - New AI tool **`lowpoly:projects.close`** (release the exclusive lock) +
    backend `POST /api/v1/projects/:id/close` (`backend/src/routes/projects.ts`).
    Open-then-operate: an agent opens (locks) a project, operates, then closes;
    it cannot open a second project until it closes the first, and cannot open a
    project another agent holds. Tool calls forward the caller via
    `x-forgeax-caller-*` headers (`backend/src/tool-handlers.ts`); the activate +
    batch/execute/import routes enforce the lock (`ensureMutationAccess`).
- **Agent-callable GLB export + headless rendering loop** (plugin-only, no kernel cascade).

### Changed (multi-project)

- **The canvas top-right "projects" button + modal were removed** in favour of the
  left-pane `<ProjectPanel>` (`frontend/src/workbench/WorkbenchHost.tsx`). *Why:*
  one project-management surface, in the left pane, for both the human and the LLM.
  - New AI tool **`lowpoly:export-glb`** (`forgeax-plugin.json` provides.tools, `exposedToAI`):
    bakes the current pipeline model to an engine-neutral `.glb` (with joint-preview
    animation) under `<projectRoot>/assets/3d/<name>.glb`. Mirrors the screenshot WS
    round-trip — backend `/api/v1/agent/glb/{export,store}` (`backend/src/agent/{routes,
    glb.service}.ts`) broadcast `glb:request` → the viewer's new `useGlbExport`
    (`frontend/src/surfaces/urdf/useGlbExport.ts`) bakes via the existing
    `exportAnimatedGlbBlob` → POSTs back → backend writes the file + returns its path.
    *Why:* the GLB exporter was client-only (titlebar button); agents had no API to export.
  - **Headless renderer daemon** `scripts/headless-renderer.mjs` (launched by the host
    `run.sh`): runs the existing `?pane=urdf` surface in a headless Chromium so
    `lowpoly:screenshot.capture` / `lowpoly:export-glb` always have a live renderer —
    no human-opened panel needed. Added a `serve` npm script + a `vite preview` config
    block so the frontend is served as a bundled build (faster than the dev server).
  - Default capture timeout 5s → 10s (cap 20s); glb export 30s (cap 60s). *Why:* cold
    heavy-URDF renders exceeded 5s and surfaced as a misleading "no renderer connected"
    timeout. (NB: the `timeout` arg is **milliseconds**.)
  - Verified: agent `lowpoly:export-glb` → valid glTF 2.0 written to
    `assets/3d/heavy_tank.glb`; headless `screenshot.capture` returns the rendered model.

### Fixed

- **Runtime WS had no reconnect → silent dead renderer.** `HttpApiClient` (graph/exec
  channel), `useScreenshotCapture` and the new `useGlbExport` opened their `/ws` socket
  once with no reconnect, so a stack restart / WS blip permanently stopped
  `exec:completed` delivery — the headless viewer never live-synced the URDF and
  screenshots/exports silently captured an empty scene (a green "ok" with no model).
  Added capped-backoff reconnect (+ re-subscribe) to all three. The render/export loop
  now self-heals after restarts and blips.

### Added (geometry chain — prior)

- **3D geometry chain — assetKind + strict delivery validation + collision/QC batteries**
  (ports upstream `6fa0a167` + `9f9c4a2e`; plugin-only, no kernel cascade).
  - `g_to_urdf` gains `strict` / `asset_kind` (`static|assembly|mechanism`) plus
    `allow_bake_fallback` / `allow_auto_wrap_orphans` / `allow_auto_stitch_roots`
    inputs and structured `diagnostics` / `stats` outputs. Default stays the old
    lenient preview (`strict=false`); strict mode promotes AABB bake-fallbacks,
    implicit orphan links, auto-root-stitching and mechanism-without-moving-joint
    to hard errors. *Why:* let callers gate on real URDF deliverability without
    breaking lenient previews.
  - New batteries under `batteries/3d/Utils/`: `g_collision_box` (single AABB
    collider), `g_collision_clustered` (per-instance / split colliders), and
    `g_geometry_qc` (geometry quality-control report). `g_inertial_from_geometry`
    extended to match.
  - Added a `collision` op to the geometry DSL op-registry
    (`vendor/shared/types/geometry/op-registry.ts`); rebuilt `vendor/dist`. A part
    may carry multiple `collision` statements (box/cylinder/sphere/shape-ref),
    each emitted as a URDF `<collision>`; parts with none keep visual-as-collision.
  - Ported the upstream `geometry-dsl.test.ts` end-to-end regression suite to
    `backend/tests/geometry-dsl.test.ts` (parser/validate/serialize/make/summary/
    op-registry/desk_lamp URDF + strict diagnostics). Reconciliation: dropped the
    `summarizeGeometryForBroadcast` case — that helper was deliberately removed in
    our refactor as dead code (port values summarize locally via
    `summarizeGeometry`); did **not** re-add it.
  - Skipped upstream `.claude/skills/compose-3d-pipeline/**` (legacy skill docs +
    standalone `validate.ts`); the strict-validation logic they describe is ported
    into `g_to_urdf` proper.
  - Verified: backend `50 passed` (incl. new suite), battery load `114 ops
    (0 skipped)` with the 3 new ops in `/api/v1/ops`, and a collision→URDF smoke
    emitting `<collision>`.

- **CAD geometry validation + baker subgraph cache/memo + collision DSL op**
  (ports upstream `7bccdc20`; plugin-only, no kernel cascade).
  - Geometry DSL core (vendored `shared/types/geometry/`) advanced to the
    `7bccdc20` revision: new `subgraph.ts` (`reachableSubgraphSource` /
    `collectReachableStatements`), stronger semantic validation in `validate.ts`
    (`checkSemanticRefs`: part/joint/collision/inertial/CSG/transform/profile ref
    *kind* checks, parent≠child, single collision descriptor), expanded
    `surface.ts` / `aabb.ts` / `op-registry.ts` (adds `opProduces`,
    `listBakeableShapeOps`, surface/profile ops), `make.ts` / `mutate.ts`.
  - Baker: `bakeGeometryShape` cache key now hashes only the **root-reachable
    shape/profile subgraph** (`reachableSubgraphSource`) instead of the whole
    source, and `buildStatementShape` memoizes built sub-shapes within a single
    bake (`BakeBuildMemo` + `cloneBakeProduct`/`disposeMemo`). Preserves the
    single-WASM serialized bake queue + in-proc cache semantics. `listBakeableOps`
    now intersects locally-registered builders with the registry's bakeable shape
    ops. *Why:* avoid redundant re-bakes when unrelated parts/joints/materials
    change, and avoid rebuilding shared sub-shapes.
  - ~26 batteries (joints, gears, `g_part`, `g_box`, `g_align_centers`,
    `g_place_on_face`, collision/QC/inertial, `g_to_urdf`, CSG/Profile metas)
    advanced to their `7bccdc20` revisions to match the new core API.
  - Build/SSOT seam: `scripts/build-vendor.mjs` now emits `.d.ts`
    (`--declaration true`) so the backend baker shim
    (`backend/src/services/baker/shared-types.ts`) re-exports the **real**
    compiled vendored runtime (`reachableSubgraphSource`, `listBakeableShapeOps`)
    + types instead of a hand-maintained mirror — single source of truth, still
    `tsc -b` clean (vendor ships declarations, treated as a library reference).
  - Reconciliation / not-applicable: upstream `7bccdc20` also touched legacy
    plugin-backend services (`battery.service` algTag index, `pipeline.service`
    mtime name-cache, `project.service` throttled index save, `watcher.service`,
    `websocket/manager`) — those services do not exist in this refactored plugin
    (their concerns now live in the kernel runtime/transport), so their perf
    tweaks have no landing site here. The standalone `geometry-dsl.smoke.ts`
    (a no-vitest fallback harness) and `.claude/skills/**` docs/`validate.ts`
    were skipped; the vitest `geometry-dsl.test.ts` already covers the contract.
  - Verified: backend `tsc --noEmit` clean, `50 passed`, load `114 ops
    (0 skipped)`, and a real OCCT CSG-difference bake (32 tris) with a warm-cache
    re-bake (71ms → 2ms) confirming the subgraph cache key.

### Changed

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `1441ca5`.** Picks up
  the debounced-persist editor change (`schedulePersistSession` + skippable
  `incrementalExecute({ persist:false })`). This is the **editor half of upstream
  `7bccdc20`**; the backend (baker subgraph cache/memo) + geometry (CAD validation,
  collision DSL op, new batteries) halves of `7bccdc20` landed plugin-side in this
  repo (see the `Added` entries above). Editor-only kernel change; no 3d
  backend/frontend source change beyond the submodule pin. Kernel dist rebuilt
  under `external/`. Pin matches the scene plugin. Verified: 3d frontend
  `4 passed`, backend `50 passed`.

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `a2a848e`.** Picks up
  the upstream `wb-scene` editor-parity batch (i18n preview labels `7c1206cd`,
  relay fork-delete `e0c567d7`, relay capsule `09388e3f`, preview-disabled ring
  `b2beda9e`, group-view overlap `1506493a`, port handle z-index `e75d91aa`,
  annotation Ctrl-drag/copy `440da6a5`, the bbox/frame chain
  `3b907c5c`/`0993136a`/`40f27e51`, favorites context-menu affordances
  `51dceee2`, frame-persistence reconciliation `f3414fe1`). Editor-only kernel
  change; no 3d backend/frontend source change required beyond the submodule
  pin. Kernel dist rebuilt under `external/`. Pin matches the scene plugin.

### Added

- **Architecture docs.** Added [`ARCHITECTURE.md`](./ARCHITECTURE.md),
  [`docs/architecture/`](./docs/architecture/) (backend · frontend ·
  extension-and-contracts) and [`AGENTS.md`](./AGENTS.md): a code-grounded map of
  the 3d-lowpoly plugin (backend routes/runtime/baker/library, the URDF/3D viewer
  surface, the geometry domain seam) and a read-before-write protocol.

### Fixed

- **Kernel bump → `483431c`** (cascade). Bumped `external/forgeax-wb-node-core`
  for the deterministic battery scan + first-wins duplicate-id guard. Backend
  loads `111 ops (0 skipped)`; verified the load path + resolution are healthy
  (no regression). Documented in `docs/architecture/extension-and-contracts.md`.

- Bumped the shared editor kernel so grouped nodes persist as real kernel
  groups across live-sync/refetch instead of immediately expanding back to
  member nodes.
- Bumped the shared editor kernel so double-clicking a wire reliably hits the
  ReactFlow edge interaction path and inserts a typed Relay in the browser.

### Added

- Added lowpoly group-template REST support (`/api/v1/group-templates*`) so the
  shared editor can save collapsed groups as reusable template batteries, list
  them in Templates mode, and instantiate them back onto the canvas without
  touching the existing live chest project.
- **Staged visual composition helper.** Added `pnpm compose:visual-staged-demo`
  for LLM/CLI graph edits that must be visible step-by-step: each small batch
  waits for its exact `graph:applied` batch id, runs execute, waits for
  `exec:completed`, and can optionally capture the live URDF pane (`CAPTURE=1`).
  The script defaults to an isolated lowpoly project so existing work, including
  chest compositions, is not overwritten.
- **Relay double-click parity.** Bumped the shared editor kernel to restore the
  legacy relay interactions for every plugin: double-click a wire to insert a
  typed relay, double-click a relay node to remove it and restore the direct wire
  when possible.
- **Programmatic batch labels.** `/api/v1/batch` now forwards `label` and caller
  `batchId` into kernel history, so staged AI/CLI edits show meaningful history
  rows and can be acknowledged by exact batch id.

- **OCCT baker + content-addressed mesh library.** Added the backend baker service,
  slim `/api/v1/library/blob/<sha>.obj` route, runtime `ctx.services.baker`
  injection, and URDF viewer `baseUrl` wiring so composite Parts/Gears bake to real
  OBJ meshes instead of AABB placeholders. Added Parts/Gears batteries plus baker
  unit/smoke coverage for OCCT, CSG, full Parts/Gears catalogs, HTTP blob serving,
  URDF `<mesh>` emission, and real-pixel mesh loading.

- **Shared Projects/Open/Save editor chrome.** Bumped the kernel submodule to the
  unified editor-core and wired the 3d workbench to the same shared
  `ProjectsDialog` / `PipelineFileDialog`, Toolbar `onOpen` / `onSave`,
  project-store cascade, and project/import/export API methods used by
  scene-generator. 3d-specific code now stays in the URDF preview pane, lowpoly
  project defaults, and baker/renderer services.
- **Projects/import backend routes.** Added `/api/v1/projects`,
  `/api/v1/workspace`, and `/api/v1/pipeline/{templates,import,export}` over the
  shared `ProjectRegistry` / `importPipelineGraph` kernel path. Default project
  type is `lowpoly`; project activation rebinds WS subscriptions and broadcasts
  `graph:applied` so the editor and URDF preview reload through the standard
  live-sync cascade.
- **Shared editor probe / relay affordances.** Bumped the kernel submodule so the
  inherited editor exposes the data-probe toggle directly in the toolbar and adds a
  Canvas quick-search **Relay** entry that creates the kernel `__relay__` sentinel.
  Relay remains kernel/editor infrastructure rather than a common battery pack item.
- **Shared `common` batteries.** The backend now scans
  `forgeax-wb-node-core/packages/batteries-common/batteries` in addition to this
  plugin's `batteries/3d`, so generic ops such as `number_const`, `range_list`,
  and `tree_merge` are available in the 3d-lowpoly catalog and palette under the
  `common` tab without duplicating battery source. Category discovery now treats
  every scan-root top-level folder as an automatic tab, so future sibling packs
  become available to this plugin by being added next to `common`.

### Changed

- Frontend dev server port + backend proxy target are now env-overridable
  (`VITE_DEV_PORT`, `VITE_API_TARGET`); defaults preserve the original `9555 -> 9557`.
  Lets this plugin run on its own address (e.g. `9565 -> 9567`) alongside the
  scene-generator without colliding.

- Bumped the `external/forgeax-wb-node-core` kernel submodule `ff1c884 → f7e1ba2`,
  reconciling the scene-generator kernel improvements onto this plugin's own kernel
  delta. The reconcile is a cherry-pick of this plugin's `opSpecToBattery`
  `nodeType`/`hideOutputs` forwarding (`ff1c884`) on top of scene-gen's `ea5c538`,
  so the new kernel commit contains BOTH sets of work (merge-base `013c2d0`; the
  parallel pre-`ea5c538` chain was content-identical, so the only local delta was
  the mapper forwarding). Inherited kernel improvements now available to this plugin:
  - **Incremental canvas reconcile** (`edfcca5`): dragging/adding one battery no longer
    rebuilds every ReactFlow node — unchanged nodes keep object identity. Fixes the
    drag-add full-reload bug here too (active via the mounted kernel `<Editor>`).
  - **tree_merge `inferredAccess` connect-hook** (`d57038a`) restored in `useCanvasConnect`.
  - **History bridge** (`3dcc6b7`): AI/CLI batches flow into the History panel
    (+ optional `label` on `HistoryEntryV1`); served via the existing `GET /api/v1/history`.
  - **Keyboard Undo/Redo** (`ea5c538`): global Ctrl/⌘+Z / Ctrl+Y / Ctrl+Shift+Z wired into
    the editor canvas (`useCanvasUndoRedo`), reversible through History — active here.
  - **Graph import** (`dc59a61`): kernel `importPipelineGraph` + react mapper/adapter
    + `pipeline import` CLI. Kernel-ready; app-level wiring (backend route + UI) is a
    follow-up — not yet user-facing in this plugin.
  - **Multi-project management** (`64a24e9`): kernel `ProjectRegistry` + store + CLI +
    `createRuntime(registry?)`. Kernel-ready; this plugin still runs single-project, so
    project-switch wiring (registry + routes/UI) is a follow-up — not yet user-facing.
  The `nodeType`/`hideOutputs` specialized-panel path (`g_preview → name_list_panel`) is
  preserved and verified working after the reconcile.

### Added

- Kernel `forgeax-wb-node-core` vendored as a git submodule, consumed via pnpm `link:`.
- Backend Fastify kernel bridge: `/health`, `/api/v1/{pipeline,nodes,edges,ops,history,groups}`,
  `/api/v1/batch`, `/api/v1/execute`, `/ws`. `/api/v1/batch` broadcasts `graph:applied`
  so external/LLM/CLI batches live-sync (scene-generator lesson applied from day one).
- Battery category projection on `GET /api/v1/ops` for palette grouping.
- Frontend mounts the shared kernel `<Editor>` in a `WorkbenchHost`; `HttpApiClient`
  over fetch + WebSocket.
- `scripts/smoke-livesync.mjs` headless broadcast regression test.
- Geometry DSL (`shared/types/geometry`) vendored + `build:vendor` step that compiles it to `vendor/dist`.
- 49 no-baker 3D-modeling batteries ported under `batteries/3d/`: Primitive (8), Profile (5),
  CSG (11), Transform (6), Assembly (9), Utils (8, incl. `g_to_urdf`), Preview (2).
- `/api/v1/ops` forwards `frontend.nodeType` / `hideOutputs`; the shared kernel mapper
  (`opSpecToBattery`) updated to apply them, so `g_preview` renders `name_list_panel`.
- `g_to_urdf` emits URDF; composite / non-native shapes degrade to analytic AABB `<box>`
  placeholders (OCCT baker + Parts/Gears deferred to Plan 5).
- `scripts/smoke-urdf.mjs` headless geometry → URDF pipeline test.
- Ported the three.js URDF viewer as a `?pane=urdf` surface embedded in `WorkbenchHost`
  (same-origin iframe; editor selection forwarded over the `workbench:editor-selection`
  postMessage channel).
- Live URDF sync on exec/graph events (REST pull via `HttpApiClient` + `flattenWire`),
  with stale eviction that empties the viewport when no `urdf_preview` / `g_to_urdf`
  source node remains.
- Best-effort editor-selection → link highlight: a selected node's `id` param maps to a
  URDF `<link name>` (or `<id>_link`) and emissive-tints matching link meshes; a mapping
  miss is a clean no-op and can never break rendering.
- Agent screenshot routes `/api/v1/agent/screenshot/{capture,store,latest}`:
  `/capture` broadcasts `screenshot:request{captureId}` over `/ws` and blocks until a
  renderer POSTs the frame to `/store` (or 504s); `/latest` returns the cached record.
- URDF viewer WS capture hook (`useScreenshotCapture`) + a synchronous `renderFrame`:
  the live `?pane=urdf` page answers `screenshot:request` by force-painting a fresh
  frame and POSTing the canvas PNG back, so the agent screenshot equals the human view.
- `scripts/smoke-screenshot-plumbing.mjs` (`pnpm smoke:screenshot`): headless,
  browser-free proof of the capture handshake (WS → `/capture` → `/store` → `/latest`
  round-trip with a valid 1×1 PNG).
- `scripts/north-star-loop.mjs` (`pnpm north-star`): the Playwright real-pixel LLM loop —
  API-drive a `g_box → g_part → g_to_urdf → urdf_preview` pipeline, live-render it in a
  headless chromium `?pane=urdf` page, capture a REAL non-blank PNG via the agent API,
  then iterate (box → cylinder) and assert the new PNG differs. The `urdf_preview.urdf`
  XML is the always-available textual observation; gracefully degrades to a documented
  data-only PASS when chromium is unavailable.
- Screenshot PNG toolbar button (Camera) exporting the current frame via
  `renderer.domElement.toBlob('image/png')` — the manual image-export path, backed by a
  reusable `captureFrame` / `getFrameCanvas` seam shared with the headless capture loop.
- Primitives render with no mesh backend (empty `baseUrl`); mesh visuals await the Plan 5
  baker blob route.
- Initial scaffold consuming `@forgeax/node-runtime` via git URL dependency.
- Backend / frontend / batteries / schemas directory skeleton.
- ForgeaX plugin manifest with split surface layout.
- Hygiene check, ESLint, Prettier, CI workflow.
