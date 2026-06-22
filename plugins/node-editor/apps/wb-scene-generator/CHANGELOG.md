# Changelog — `wb-scene-generator`

All notable changes to this app.

Format: [Keep a Changelog](https://keepachangelog.com/) · semver. Dates are
calendar dates in the project timezone.

> **Maintenance contract (see [`AGENTS.md`](./AGENTS.md)).** Every commit that
> touches this app's source MUST add a bullet under `## Unreleased`, grouped by
> Added / Changed / Fixed / Removed / Deferred, and state the *why*. Kernel
> changes go in the root [`CHANGELOG.md`](../../../../CHANGELOG.md). History
> below is **append-only** — never rewrite past entries; corrections append a
> new entry stating the reason.
>
> The kernel is in-repo `workspace:*` packages (`packages/*` in the monorepo
> root). There is no `external/forgeax-wb-node-core` submodule, no `link:` pin,
> and no cascade SHA to cite. Reference the changed `packages/*` file directly.

## Unreleased

### Fixed

- **共享沙箱资产发布后场景侧不再需要手动刷新页面。** 根因：`scene:library.useGameTextures`
  绑定沙箱 `textures/` 目录时，2D 应用的首次 `publishToGame` 往往还没创建该目录，于是
  `gameSandboxStore.startGameSandboxWatcher` 里的 `fs.watch(dir)` 抛 ENOENT 被静默吞掉，
  watcher 永远没挂上 → 之后每次发布都不广播 `library:changed` → 用户必须手动刷新才能看到
  导入/匹配结果。修复（`backend/src/library/gameSandboxStore.ts`）：① 挂 watcher 前先
  `mkdirSync(dir,{recursive:true})`，保证目录存在、watcher 必定挂上（它本就是 2D 端要写入的共享路径）；
  ② 增加 1.5s 轮询 index.json 的 mtime/size 作为**跨进程兜底**（2D 与场景是两个独立后端进程，
  `fs.watch` 跨进程/原子重命名写入本就不可靠），变更即广播 `library:changed`；fs.watch 与轮询经同一
  debounce + 广播时回填签名，避免重复刷新；轮询 `unref()` 不阻塞事件循环。*为什么：* 资产导入是
  AI 高频操作，少了热更新每次都要手刷，体验断裂。验证：`gameSandboxStore.test.ts` 新增「绑定早于目录存在」
  用例（模拟真实顺序）并通过，原用例仍过；`tsc --noEmit` 干净。
- **模板实例化保留组边界端口类型。** `backend/src/lib/templateOps.ts` 的 `remapContract`
  重建 createGroup 契约时补带 `portType`，与内核新约定（契约可携带、缺省回退派生）一致，
  避免 AI/模板实例化路径丢失用户设置的端口类型。

### Added

- **User-template save route + scan root ("Save to templates").**
  `backend/src/routes/groupTemplates.ts` gained `POST
  /api/v1/group-templates/save-user`, which writes the posted group to the
  workspace `.forgeax` area at `<workspaceRoot>/user-content/templates/My
  templates/<smallTag>/<templateName>.json` (FORGEAX_PROJECT_ROOT-derived, read
  at request time for test isolation). The user-template root is appended to the
  template scan roots (`getKinds()`/`templateRoots()`), so `GET
  /api/v1/group-templates` lists built-in + user templates uniformly under the
  fixed **"My templates"** big-label. `frontend/src/api/HttpApiClient.ts`
  implements `saveUserTemplate`. Test: `backend/tests/groupTemplates.test.ts`
  (save-user round-trip + 400 on empty smallTag). *Why:* let users persist their
  own reusable group templates as project-shared user content.

### Fixed

- **Screenshot capture WS auto-reconnect and longer default timeout.** `useScreenshotCapture.ts`
  reconnects with capped exponential backoff (aligned with wb-3d-lowpoly); agent route default
  timeout raised to 10s. `agent/routes.ts`, `useScreenshotCapture.test.tsx`.
- **AI tool handlers transparently recover project lock after backend restart.**
  `tool-handlers.ts` re-opens active project on `mutation-denied-not-open` and retries once.
- **Mutation routes forward `expectedPrevHash` and surface lock `code` on HTTP 403.**
  `mutations.ts`, `projects.ts`, `execute.ts`, `pipelineImport.ts`, `groupTemplates.ts`.

- **HttpApiClient WebSocket reconnect after drop (aligned with 3d/2d).** Exponential
  backoff 500ms→5s cap; renderer/assetstore live-sync survives backend restart without
  full page reload. Scope: `frontend/src/api/HttpApiClient.ts`.

### Added

- **Tile atlas dimension validation on publish (`autotileKind` binding).** When
  publishing a tile (`publishExternal` / shared sandbox path), PNG width×height is
  checked against `assets/rules/<autotileKind>.json` sprite bounds. `common_16`
  accepts **64×64** (no variant row) or **64×80** (with randomRules variants);
  other rules require the exact bounding box from the rule JSON. Mismatch → 400/422
  with `allowedSizes`. Files: `backend/src/library/tileRuleAtlasValidation.ts`,
  `privateStore.ts`; 2D `publish-to-game` mirrored; tests +
  `skills/texture-pipeline/SKILL.md` updated.

- **Shared-game-sandbox asset source — generated textures live in the sandbox,
  not an app-internal store, and are merged into the AssetStore view + renderer
  pool.** The two workbenches each run under an isolated `FORGEAX_PROJECT_ROOT`
  and cannot see each other's internal stores; the only cross-app common ground
  is the project's `.forgeax/games/<slug>/` sandbox. New flow: the 2D app
  publishes a finished texture into `<projectRoot>/.forgeax/games/<slug>/textures/`
  (`asset2d:publishToGame` → 2D `POST /api/v1/publish-to-game`, writing
  `blobs/<sha>.png` + a raw descriptor in `index.json`), and the scene workbench
  binds that dir as a READ-ONLY third asset source via
  `scene:library.useGameTextures` (→ `POST /api/v1/library/use-game-textures`).
  `library/gameSandboxStore.ts` composes the renderer's 13-bracket alias +
  autotile binding from the descriptor (reusing the new exported
  `composeRendererAlias` + `deriveAliasMeta`) and is merged into
  `/api/v1/library/{list,aliases-meta,serve}` alongside base ∪ private (sandbox
  records sort first, `private:true`). Binding broadcasts `library:changed` so
  the AssetStore + renderer re-pull. No app-internal store is written. Files:
  `backend/src/library/{gameSandboxStore.ts,routes.ts,privateRoutes.ts,privateStore.ts}`,
  `backend/src/tool-handlers.ts`, `forgeax-plugin.json`,
  `skills/texture-pipeline/SKILL.md`; 2D side mirrored in `wb-2d-scene-asset-generator`.

### Changed

- **Texture hand-off no longer routes bytes through the agent — retires the
  base64/private-library path as the main flow.** Earlier iterations shuttled
  base64 (`scene:library.publishExternal({dataBase64})`) which auto-compaction
  dropped, causing publish retry loops; a server-to-server `from2dAlias` variant
  fixed the loop but still landed in the app-internal private store. Per the
  "files stay in the sandbox, separate from built-in assets" constraint, the
  main path is now the shared sandbox (see Added). `scene:library.publishExternal`
  is kept as a LEGACY fallback (manifest description flags it). `texture-pipeline`
  §4/§6 + Sino `lessons.md` rewritten to the `publishToGame` + `useGameTextures`
  flow.

### Fixed

- **Renderer matching pool now refreshes after a publish / project switch
  (textures applied without a manual reload).** `frontend/src/renderer/bridge/
  useAliasMetas.ts` previously fetched `/api/v1/library/aliases-meta?zone=raw`
  ONCE on mount, so a texture published via `scene:library.publishExternal`
  after the renderer mounted never matched onto voxels until a full reload, and
  switching the active project kept the stale pool. It now also opens `/ws` and
  re-pulls on `library:changed` (already broadcast by every library mutation
  incl. publish-external) and on project activation (`runtime`
  `project:activated` / `workbench:project-changed`), mirroring `useBakedLayers`.
  This was a primary cause of "the generated scene didn't show the texture
  applied".

### Added

- **`scene:library.list` AI tool — lets an agent SEE/verify the private library
  (incl. published textures).** Previously the only asset-listing tool exposed
  to AI was `scene:assets.list`, which proxies `/api/v1/assets` → the kernel
  AssetResolver over the shared **filesystem** `<workspaceRoot>/assets` dir, NOT
  the private library DB — so an agent could not confirm what
  `scene:library.publishExternal` landed (and `texture-pipeline` §6 told it to
  verify with the wrong tool). New tool proxies `/api/v1/library/list`
  (base ∪ active-project private, paginated, defaults to `zone=raw`).
  `texture-pipeline` §6 + Sino persona now verify publishes via
  `scene:library.list` and list the "texture not applied" diagnosis checklist
  (field4 == template `xxxAsset`; right active project; `asset_type=tile` →
  non-cutout pool; `raw` not `staging`). Files: `backend/src/tool-handlers.ts`,
  `forgeax-plugin.json`, `skills/texture-pipeline/SKILL.md`,
  `agent-sino/persona/zh.md`. (`scene:assets.list`'s description now states it
  is filesystem-only.)

### Removed

- **Dropped the standalone `@forgeax-plugin/agent-atlas` supervisor agent;
  folded the texture-pipeline capability into Sino instead.** Supersedes the
  Phase-3 "supervisor agent" entry below. Why: in testing, Atlas could not
  connect the scene graph correctly — its connection know-how lived only in the
  `compose-sino-scene` skill BODY, which (being a prompt-kind skill) is **not**
  auto-injected into context unless the skill is explicitly triggered; Atlas's
  always-on persona only covered texture orchestration. Sino, by contrast, works
  because its persona itself embeds every connection hard rule (`edgeId`, op
  schema, `in_0` wiring, PathConnection POI, `tree_merge` params). Rather than
  duplicate Sino's large skill into Atlas's persona (violating single-source /
  cleanliness), we delete Atlas and give Sino the 2D capability as an opt-in
  extension. Files removed: `packages/marketplace/plugins/agent-atlas/**`.

### Changed

- **`texture-pipeline` skill retargeted from Atlas → Sino's "freshly-generated
  textures" extension.** Frontmatter `audience`, intro, and §0.1 now address
  Sino; §0.1 keeps the "create a brand-new scene project every task" hard rule
  (`scene:projects.create` + `projects.open`, never reuse/modify the active
  graph; new id recorded in the contract `sceneProjectId`). A new top note makes
  explicit that the texture pipeline **does not change any graph-connection
  rule** — `edgeId` / op schema / `in_0` wiring / PathConnection POI /
  `tree_merge` params all defer to `/compose-sino-scene`; textures only swap the
  template `xxxAsset` from a built-in name to a contract semantic name and add
  generate→publish→verify steps.
- **Sino agent gains the 2D / texture capability (opt-in).**
  `agent-sino/forgeax-plugin.json`: `tools` now `["scene:*","asset2d:*"]`;
  `defaultSkills` adds `texture-pipeline` + `generate-2d-asset`; `produces` adds
  the contract + generated-assets paths; description updated. `persona/zh.md`
  adds a clearly-scoped "扩展能力：现生成贴图（按需触发，默认不用）" section + a
  publish-bridge / asset2d tool listing, and carves the texture exception out of
  the "不画 2D" boundary. `memory/lessons.md` records the same as an additive
  capability. Pure composition tasks are unchanged (ignore the texture section).
- **Sino's persona/lessons now EMBED the 2D image-generation operational core
  (not just a skill reference).** Because `generate-2d-asset` is a prompt-kind
  skill whose body is only inlined on trigger, listing it in `defaultSkills`
  alone does not make Sino "know" how to generate — mirroring why Atlas couldn't
  connect graphs. So a distilled, always-injected "2D 生图操作核心" was added to
  `agent-sino/persona/zh.md` + `memory/lessons.md`: the three hard rules
  (op-ids/ports only from `batteries.list`; `image_gen` is manualTrigger so
  `generation.generateImage(nodeId)` once THEN `pipeline.execute`; `pipeline.get`
  after every `applyBatch`), type-driven constant batteries
  (`text_panel`/`number_const`/`toggle`), and the PART A (single/object,
  cutout) / PART B (tile atlas, tile-count = 4×(maskH÷cellW) aligned to the
  contract rule cell count) / PART C (shape-controlled house) battery chains.
  Full step-by-step sequences stay in `/generate-2d-asset` as the deep reference.

- **Texture pipeline — screenshot-vision test toggle
  (`FORGEAX_SCENE_SCREENSHOT_NO_VISION`).** New env flag (declared in
  `forgeax-plugin.json::requestedEnv`, read in `backend/src/tool-handlers.ts`)
  that, when set (`1|true|yes|on`), makes `scene:screenshot.capture/latest`
  return the plain capture metadata (path + size + `visionDisabled:true`)
  **without** the `image_file` content part, so the agent never ingests the
  screenshot into its context. Default (unset) keeps vision ON (unchanged). Why:
  during texture-pipeline testing the user wants screenshot self-reading turned
  off so the agent verifies via `pipeline.execute` summaries + names projection
  while the human eyeballs the canvas. `texture-pipeline` §6 and Sino's
  persona/lessons document the off-path behaviour.

### Added

- **Texture pipeline Phase 3 — orchestration skill + supervisor agent.** New
  plugin skill `texture-pipeline` (`skills/texture-pipeline/SKILL.md`, registered
  in `forgeax-plugin.json`) is the top-level conductor manual: it pins the naming
  contract carrier at `<active_game>.dir/texture-pipeline/contract.json` (a
  plugin-internal SSOT in the game workspace, since the two apps'
  `FORGEAX_PROJECT_ROOT`s are isolated), gives the 8-rule autotile alignment
  table (`floor_1`/`fence_7`/`slope_9`/`bridge_horizontal_9`/`flower_bed_11`/
  `bridge_vertical_15`/`common_16`/`wall_outer_16`, all ppu=16) tiles must match,
  the object cutout flow, the per-asset publish loop, and the `topBillboard`
  verification loop. Paired with a NEW agent plugin
  `@forgeax-plugin/agent-atlas` (Atlas · map-texture supervisor) that wields BOTH
  `scene:*` and `asset2d:*` tool sets and discloses three skills on demand
  (`texture-pipeline` + `compose-sino-scene` + `generate-2d-asset`). Files:
  `skills/texture-pipeline/SKILL.md`, `forgeax-plugin.json` (scene skill reg),
  `ARCHITECTURE.md`; new plugin under `packages/marketplace/plugins/agent-atlas/`.
- **Texture pipeline Phase 2 — scene-side publish bridge
  (`scene:library.publishExternal`).** New atomic, idempotent endpoint
  `POST /api/v1/library/publish-external` (+ tool + manifest tool/surface) that
  lands a 2D-generated PNG (base64) into the active scene project's private
  `raw` zone with a renderer-shaped alias in ONE call: composes the 13 bracket
  fields (field4=`assetName`, field8=type), binds a tile's autotile rule via
  `cropTypeOriginal='瓦片组'` + `assetKind=<rule>` (covers rules the field[8]
  legacy map can't, e.g. `slope_9`), marks objects as cutout (`抠图`), records
  `provenance` (`sourceBlobId`, `source='pipeline'`), and de-duplicates on
  re-publish (same `sourceBlobId` updates in place + GCs the stale blob). This
  is the single write entry-point the supervisor agent uses instead of
  hand-stitching import→repair→field-edit→move. Files: `library/privateStore.ts`
  (`publishExternalAsset` + `PublishExternalInput`), `library/privateRoutes.ts`,
  `tool-handlers.ts`, `forgeax-plugin.json`; covered by
  `tests/library-publish-external.test.ts`.
- **Texture pipeline Phase 1 — renderer matching pool now merges private
  assets.** `GET /api/v1/library/aliases-meta` previously returned base-library
  aliases ONLY, so any imported / cross-app-published texture was invisible to
  the billboard renderer and could never be matched onto a voxel. The route now
  merges project-private records of the requested zone (mapped through the same
  `deriveAliasMeta` the base library uses, so a published tile binds to its
  autotile rule identically); a private record OVERRIDES a base one of the same
  alias (the user's asset wins). This is the foundational gap for the
  scene↔2D-asset texture-generation workflow — it lets a 2D-app-generated PNG,
  once published into the active scene project's private `raw` zone, enter the
  matching pool. `PrivateAssetRecord` gained optional `assetKind` /
  `cropTypeOriginal` / `geometryJson` / `sourceBlobId` fields so a published tile
  can carry an exact rule binding (`cropTypeOriginal='瓦片组'` + `assetKind=<rule>`,
  covering rules the field[8] legacy map can't, e.g. `slope_9`) and so
  re-publishing the same bytes stays idempotent. Files: `library/routes.ts`,
  `library/privateStore.ts`; covered by `tests/library-aliases-meta-merge.test.ts`.
- **AssetStore search-by-alias candidate dropdown (left pane).** Typing in the
  Basic Operations search box now opens a debounced list of current-zone alias
  candidates (thumbnail + alias + private badge) below the input
  (`AssetStorePanel.tsx`, `WorkbenchLeftPane.css`). Picking a candidate (click or
  ↑/↓ + Enter) fills the input and reveals that asset in the right-side grid —
  selecting it, jumping the continuous scroll to its page, and surfacing it in the
  left-pane Preview · Anchor · Collision section — **without** committing a
  grid-filtering search, so the rest of the grid stays put. Wired via a new
  `left → surface` reveal command on the localStorage control bus
  (`assetControlBus.ts` `requestReveal`/`subscribeReveal`) plus a `revealAlias`
  store action (`assetStoreStore.ts`) consumed by `AssetStoreSurface.tsx`.
  *Why:* the search box gave no feedback while typing; users had to scroll the
  grid manually to find a known alias.

### Changed

- **Scene export now reproduces the editor billboard render under the shipped
  viewer's own algorithm (render→export parity).** The cook no longer re-derives
  rules on a second code path — it routes terrain/object resolution through the
  renderer's shared resolvers (`pickFaceSpriteIndex` / `computeValidVariantIdxs` /
  `variantCandidates` / `compareBillboardDrawOrder`). Terrain converged per-cell:
  **per-layer** (not unioned) autotile neighbour keys, **sheet-aware `template_id`**
  so two same-named layers on different sheets don't collide variant filters, and
  region-gated wall variants (incl. gated-out door footprints). The cook still shifts
  the scene to a non-negative origin (the viewer's `cols×rows` grid can't store
  negative billboard coords) while the editor keeps raw coords — both internally
  correct, intentionally not aligned. See
  [`docs/scene-export-parity.md`](./docs/scene-export-parity.md) and the
  `backend/tests/scene-export-{renderer-parity,cooker}.test.ts` locks.
  (`9119b05`, `087cfdb`, `36b3a1d`). *Why:* a billboard 2D consumer must get the
  editor's exact image, and a parallel rule path inevitably drifts from the renderer.

- **Left-pane typography unified on the section-title style.** Projects header,
  New-project / Save-scene modal headings, the panel tabs (AssetStore / Preview /
  Scene Gen) and the group tabs are a full transplant of the computed "Node Info"
  heading (16px / weight 400 / 0.04em / uppercase / accent green). Panel tabs
  share the row width (grow from each label's width, centred, no wrap; the panel
  tabs drop to 12px + tight padding so all three fit one narrow line without
  truncation); the hero title drops its
  vertical `scaleY` stretch and gets a roomier line box so descenders (the "g")
  aren't clipped, and the hero is layered above neighbours. Body copy across the
  pane (Node Info, Data Types, History, Help, hints) is enlarged proportionally so
  relative sizes are preserved — Data Types reads name 15px > desc 12px, and the
  History toolbar (step count / Clear) plus entry timestamps sit at 12px, and the
  New-project wizard field labels (Name / Description / Template) are bumped to
  14px (`WorkbenchLeftPane.css`). *Why:* consistent heading
  identity and readable body text; the first pass approximated the title (smaller +
  bolder) and flattened the Data Types name/desc ratio.

- **Node Info stats are a responsive grid + centred empty hint.** Added a sixth
  tally (Selected: 0/1) and laid the stats out as an auto-fit grid that fills the
  width and reflows from 3-per-row to 2-per-row when cramped. The "click a battery"
  prompt now centres in the section, and the section's scrollbar chrome is hidden
  while keeping scroll (`SceneGeneratorControlsPanel.tsx`, `WorkbenchLeftPane.css`).
  *Why:* even, readable tallies and a tidy empty state without a stray scrollbar.

- **Scene Generator Help rewritten as short titled blocks.** Replaced the single
  paragraph with concise, compact titled sections (Build a scene / Inspect & edit /
  Preview & assets / Projects) carrying step-by-step guidance, EN + 中文. Titles
  are plain white (no accent, no bold, no divider) for a dense skim
  (`SceneGeneratorControlsPanel.tsx`, `WorkbenchLeftPane.css`). *Why:* the prior
  blob was hard to scan; titled steps are easier to follow.

- **AssetStore initial width decoupled from the editor battery bar.**
  `WorkbenchHost.tsx` renamed `BATTERY_BAR_WIDTH_DEFAULT` → `ASSETSTORE_WIDTH_DEFAULT`
  (now 290px) and dropped the "right edges on one vertical line" coupling.
  *Why:* the two panes are independent; tying AssetStore's default to the
  battery bar was an unnecessary cross-component constraint.

- **Merged `origin/main` into `dev`.** Integrates GitHub main-line preview inspector,
  placement projection, AI wire unwrap, and the 2d scene asset app with dev-only
  AssetStore private-library / left-pane work. *Why:* internal `dev` must track
  `main` without dropping in-flight generator features.

### Fixed

- **Dragging a layer to the very bottom now works (it no longer silently snaps
  back).** With siblings `layer 2, layer, layer`, no drag could move `layer` to the
  last position — you could only cycle between a few upper arrangements. Root
  cause: the drop translates "drag below the last row" into a move with
  `beforeName` omitted (= append last), but `moveBakedLayer` only ran
  `reorderSiblings` *when `beforeName` was set*. With it absent the moved node was
  pruned and re-inserted carrying its **stale `__order`**, so the reorder was
  skipped entirely and the displayed order never changed. Fix: `moveBakedLayer`
  now reorders **unconditionally** — `beforeName` set → just ahead of that
  sibling, omitted → appended last — and seeds the new order from the **current
  display sequence** (sorted by `__order`, via a shared `displayOrderedChildNames`)
  rather than the physical name-sorted array, so moving one node preserves the
  others' established order. Regression: `backend/tests/baked.test.ts` "move
  without beforeName appends the node last (drag-to-bottom)" (drags the middle of
  three to the bottom and asserts it ends up truly last).
  (`backend/src/baked/store.ts`).

- **Box-select now places objects (it no longer silently no-ops on object
  assets).** With an object asset selected and the Box brush active, dragging a
  rectangle did nothing — object placement existed only on the free-brush path
  (`paintAt`), while the box path (`commitBoxToKey`) hit an early
  `if (asset.type === 'object') return`. Fix: box-select on an object asset now
  **batch-places instances tiled across the dragged rectangle**, stepping by the
  object's footprint so neighbours sit edge-to-edge and skipping any cell already
  occupied (no overlap/clobber) — the most intuitive "stamp objects across where I
  dragged" behaviour. The single-placement math (footprint + column height +
  bottom-center snap + instance cells) is now a shared pure helper
  `resolveObjectPlacement` reused by both the free brush and the box fill, so the
  two paths can't drift. Regression: `renderer/framework/geometry/__tests__/objectPlacement.test.ts`
  (`resolveObjectPlacement` shape + a non-overlapping tiling-stride lock).
  (`renderer/host/RenderCanvas.tsx`, `renderer/framework/geometry/objectPlacement.ts`).

- **"+ Layer" no longer clobbers an existing layer; corrupted baked trees self-heal
  on load.** Clicking "+ Layer" could silently overwrite a populated layer (e.g. a
  913-cell layer collapsed into a fresh empty one). Root cause: a layered invariant
  break. The vendored scene tree (`vendor/shared/types/scene/tree.ts`) keeps each
  node's `children` array **strictly name-sorted** and relies on that for its
  `readNode` / `upsertCells` **binary search**. But the baked store overloaded
  *array order* and *`version`* to also encode the panel's *display order* — its
  `reorderSiblings` / `withChildren` reshuffled the children array (and renumbered
  versions) on every drag-reorder / bake, destroying the name-sorted invariant.
  Once the array was out of order, `findChildIdx`'s binary search could miss an
  existing same-name node, so `addBakedLayer`'s dedup (`uniqueChildPath` →
  `readNode('/Layer')`) reported "no collision" and `upsertCells` inserted a
  **second** `/Layer`; the frontend `buildPathTree` then mapped both to the same
  `pathKey`, the empty one winning → the populated layer "disappeared". Verified on
  the live corrupted project: stored top children were
  `["Layer","Layer 2","Layer","Layer 3","Layer 4"]` (two `Layer`s, not name-sorted).
  Fix (single source of truth, decoupled order): display order now lives in an
  explicit reserved `__order` attribute (`BAKED_ORDER_ATTR`), never in array order
  or version. `reorderSiblings` / `bakeLayers` / `addBakedLayer` / `ensurePaintTarget`
  stamp `__order` via `setAttribute` (which preserves the name-sorted array), and
  `projectBaked` sorts by `__order` (falling back to legacy `version`, then name for
  smooth migration). `version` reverts to its sole meaning — a content fingerprint
  for the renderer's dirty-check / incremental-bake contract. `withChildren` (the
  invariant-breaking array rewriter) and the now-unused `uniqueChildPath` are
  removed; `addBakedLayer` dedup gains a linear-name-scan defense
  (`uniqueChildPathSafe`). `load()` heals legacy data: it re-sorts every node's
  children by name and merges duplicate same-name siblings (keeping the richest —
  most cells, then bound asset, then highest version) while pinning the pre-merge
  display order onto `__order`; the existing corrupted project files were migrated
  in place (`*.pre-heal.bak` kept). Regression locks: `backend/tests/baked.heal.test.ts`
  (reproduces the exact on-disk corruption → asserts single merged node, preserved
  order, and that repeated "+ Layer" clicks each append a distinct node — proven to
  fail without the heal). All `backend/tests/baked.test.ts` (30) still pass.
  (`backend/src/baked/store.ts`). *Why:* sibling order and node identity must not
  share a storage channel with a structure (the sorted array / the content version)
  that another layer depends on — overloading it silently corrupted lookups.

- **Structural editable-layer changes (add / auto-sub-layer / drag-reorder /
  reparent / delete / bake / rename) now appear immediately instead of needing a
  manual reload.** Placing an object that auto-creates a sub-layer, or dragging a
  layer to a new order, often did nothing visible until refresh. Root cause: every
  structural op pulled the new backend structure with the *default*
  `refreshBakedLayers()`, which `deferIfLocalPending`-defers while ANY local paint
  edit is still dirty/persisting (the paint-protection that stops a refresh
  clobbering an in-flight stroke). A paint right before the structural op (the
  place-object → auto-sub-layer flow always has one) leaves that flag set, so the
  structural refresh was silently deferred — and its deferred replay only fires
  from a *paint* persist's settle path, which may never come, so the new layer /
  new order stayed invisible until a reload. The backend (authoritative for tree
  shape + sibling order) had already applied the change; only the frontend pull
  was lost. Fix: structural ops now **drain in-flight paint persists first, then
  force the refresh in** (`deferIfLocalPending:false`) via a shared
  `structuralBakedRefresh` helper (`surfaces/RendererSurface.tsx`); `RenderCanvas`
  publishes its `awaitPaintPersists` drain primitive through a new
  `paintPersistsRef` so the surface can flush+await without owning the paint
  pipeline. Paint-commit refresh (`handleBakedEditCommitted`) keeps the deferring
  default — only *structural* refreshes force. New locks in
  `renderer/bridge/__tests__/useBakedLayers.test.tsx`: a default refresh is still
  deferred while paint is dirty (the old "must reload" behavior), while a forced
  refresh lands the new structure (e.g. a new `/Layer/layer-1`) immediately.
  *Why:* a structural change must never collide with paint protection, and the
  panel must reflect the one authoritative backend tree without a second,
  manually-triggered sync.

- **Painting while the canvas pans/zooms no longer makes the in-progress stroke
  vanish until a refresh.** Drawing to the edge (auto/middle-button pan) or
  wheel-zooming mid-stroke would wipe everything just painted; the cells were
  safely in the store but the screen dropped them. Root cause was a *second*
  render source of truth for the baked master: an additive paint advances
  `masterRef.current` in place (a fresh master — often a grown NEW canvas) via
  `appendCellsToVoxelMaster` and deliberately does **not** bump `structuralKey`
  (so `useLayerSurface` doesn't re-bake — the O(k) draw contract), leaving the
  React-state `voxelMaster` stale. A viewport change then re-rendered and the
  full `composeFrame` redrew from that **stale** state master (old canvas/bbox),
  repainting the new cells away; only a later op that bumped `rebuildEpoch`
  ("refresh") let state catch up. Fixed by converging the render master to the
  single authoritative `masterRef.current`: `compose` now draws `masterRef`'s
  live master, and `maxRows/maxCols` are derived inline from `masterRef.current.bbox`
  each render (a ref read can't go through `useMemo`) instead of the stale
  `voxelMaster` memo (`modes/topBillboard/index.tsx`). The state `voxelMaster`
  (`useLayerSurface`) is now used only to *feed* the authoritative ref on a real
  structural rebuild, not as a parallel draw source — removing the data
  duplication that caused the desync. New lock:
  `modes/topBillboard/__tests__/billboard.paint.pan.test.tsx` paints an
  out-of-bbox cell (incremental grow → new master) then `panViewport2d`s and
  asserts the resulting full compose draws a master whose bbox spans the painted
  cell, with **no** new `buildVoxelMaster` call. *Why:* both performance
  contracts had to hold — "viewport changes only re-send the frame, never rebuild
  the surface" and "drawing is O(k) incremental, not O(N) re-bake" — so the fix
  changes only *which* master `composeFrame` reads (still one `drawImage`),
  never the bake path.


  `POST /api/v1/execute`, and the dropped group keeps its custom name.** The
  execute route (`backend/src/routes/execute.ts:13`) returns `handle.done`
  directly, so a rejected execution promise became an opaque 500 (this app runs
  Fastify with `logger:false` at `backend/src/main.ts:19`, swallowing the stack).
  The reject came from a drop-then-execute *race* in the editor: the dropped
  group's execute fired in the same tick as its `createGroup` persist, reaching
  the backend before the node existed, so the kernel's `buildExecutionClosure`
  threw `target node not found`. Fixed in the kernel (execute now resolves a
  structured `status:'error'` result instead of throwing — see root
  [`CHANGELOG.md`](../../CHANGELOG.md)) and in the editor drop path (execute now
  chains off the persist commit). New lock:
  `backend/tests/bridge.test.ts` asserts `POST /api/v1/execute` with an unknown
  `nodeId` returns `200` + `status:'error'` rather than a bare 500. *Why:* a
  client/timing input error must not present as a server fault, and the dropped
  group must round-trip its custom name.

- **Group-battery save no longer 500s on a malformed body
  (`POST /api/v1/group-templates/save`).** The save handler
  (`backend/src/routes/groupTemplates.ts:181`) had no input validation or error
  handling, so any request missing `group`/`categoryName`/`batteryName` — or
  carrying a non-string name — threw a raw `TypeError`
  (`safeName(undefined).trim` → `Cannot read properties of undefined (reading
  'trim')` at `groupTemplates.ts:101`; `req.body.group.nameEn` → `...reading
  'nameEn'` at `groupTemplates.ts:190`) which Fastify surfaced as an opaque
  **500** (the app runs `logger:false`, so the real stack was invisible). Now:
  `safeName` tolerates non-string input (`groupTemplates.ts:100`); the handler
  validates the body up front and returns a clear **400** with the offending
  field instead of a 500 (`groupTemplates.ts:183`); and the `mkdir`/`writeFile`
  are wrapped in try/catch that `log.error`s the real cause and returns a
  structured **500** carrying the message (`groupTemplates.ts:201`). The save
  still writes to `batteries/groups/<cat>/<name>/<name>.json` (unchanged落点
  semantics). Covered by `backend/tests/groupTemplates.test.ts` (200 happy path +
  three 400 validation paths). *Why:* users hit `Error:
  /api/v1/group-templates/save → 500` with no actionable message; a malformed or
  edge-case payload silently crashed the handler.

  defects fixed so the shipped (unmodified) viewer seats objects like the editor
  bake. (1) **Placement** — objects anchor via the renderer's `chooseObjectAnchor`
  (columnDz ASC, footprintDy DESC, x ASC = front row) at `(x,y)=(anchor.x,
  anchor.y−anchor.z)`, and the tsj `pivot` is emitted as the alias's **already-
  normalized** anchor fraction; `atlas.ts` previously divided that fraction by the
  tile px again, double-normalizing it and sliding multi-cell sprites (the ambulance
  "sprawl") off their cell (`e57ae13`, `a1415ad`). (2) **Occlusion** — the viewer
  paints all `objects[]` last (no per-object depth, `obj.height` unused at draw time),
  so objects could never be occluded by terrain. PPU=16 objects are now encoded as
  **elevation-keyed terrain-stack tiles** (carrier template `obj__<type>` registered
  into the terrain atlas, pushed onto the anchor cell at its footprint elevation), so
  the viewer's elevation-ascending terrain paint lets higher walls overdraw them —
  reproducing IMAGE-2-style occlusion with **no viewer change**. Coarse per-object
  (not per-pixel-sliced); PPU≠16 objects keep the legacy `objects[]` path
  (`f550e24`). See [`docs/scene-export-parity.md`](./docs/scene-export-parity.md).
  *Why:* the exported bundle must match the renderer's billboard output, including
  the multi-voxel footprint and terrain↔object occlusion.

- **Node Info "Selected" stat now reflects the real selection count.** The
  stat read the single mirrored `selectedNode` (so it was 0 or 1, and 0 for a
  marquee of ≥2). It now uses the new `stats.selectedCount` from the editor
  mirror (`SceneGeneratorControlsPanel.tsx`, `NodeInfoPanel`), so a multi-node
  marquee shows the true count. *Why:* the previous single-node source could
  never represent multi-selection.
- **Left-pane section titles: hover layout shift + drag resize cursor drift.** Draggable
  titles keep stable margin/padding in and out of `:hover`. During a drag the panel locks
  `minHeight` to its start size; height deltas cascade into sections above when the direct
  target hits its minimum (`applySectionDragDelta` + `usePanelDragMinHeight` in
  `sectionDragResize.ts`) so handles track the pointer without sticking at one boundary.
  *Why:* hover-only padding and drag math regressed after the shared `controlSections`
  chrome landed.

### Changed

- **AssetStore left pane: five English sections with Scene Generator chrome.** Menus
  are reorganized into Basic Operations (search, import, repair, batch), Asset
  Preview · Anchor · Collision, Filters, Library Info, and a dedicated Help (separate
  from Scene Generator). `AssetStorePanel.tsx` uses `editor-controls-panel` with
  shared `controlSections.tsx` (drag heights, collapse triangles, persisted state);
  `WorkbenchLeftPane` wraps the panel in `scene-left-pane__section--controls`; CSS
  aligns accent tokens with the generator panel. Private assets can PATCH
  `alias` / `anchorX` / `anchorY` via `privateStore` + `privateRoutes`. *Why:* match
  the Scene Generator UX and group related asset-library actions in one place.

### Added

- **Scene export cooker for baked workbench layers.** The backend can now cook
  the active project's baked scene into a reference-style `scene.zip` plus an
  unpacked mirror under `exports/scene/<bundleId>/`, with terrain/object JSON,
  atlas metadata, a static viewer bundle, and edit-mode attribute templates for
  export metadata. *Why:* billboard 2D engine consumers need a self-contained
  bundle that reflects the Preview baked-layer scene.
- **AssetStore left-pane menus + a writable project-private asset library.** The
  AssetStore group of the left nav (`frontend/src/workbench/AssetStorePanel.tsx`)
  gains six menus: 搜索, 过滤标签 (13-field, ported from the legacy CategoryNav),
  资产操作 (本地导入 + 资产修复), 批量操作 (移入回收站/恢复/永久删除 over the grid's
  selection), 资产预览 (缩略图 + 可编辑别名 + 单项操作), 资产库信息 (merged monitor).
  Because the shipped `library.db` is read-only, user imports/edits live in a new
  per-project store `backend/src/library/privateStore.ts`
  (`<activeProject>/private-assets/{index.json,blobs/}`); `privateRoutes.ts` adds
  `/api/v1/library/{import,private/*,monitor,field-values}`, and `routes.ts`
  merges private records into `/list`,`/zones`,`/facets`,`/serve` flagged
  `private:true` (grid badges them「私」). Left pane ↔ grid (sibling iframes) sync
  over `frontend/src/surfaces/library/assetControlBus.ts` (control / selection /
  refresh). Tests: `backend/tests/privateLibrary.test.ts`,
  `frontend/src/surfaces/library/__tests__/assetControlBus.test.ts`. *Why:* the
  new generator pane had a read-only AssetStore with no left menu, so users could
  not import their own art, fix non-standard names, bulk-clean, or inspect library
  stats the way the legacy AssetStore allowed.

- **Placement projection feedback for Billboard edit mode.** The Preview now treats
  the cursor as the target voxel's front/bottom face, highlights the actual target
  face, shows the nearest lower top-face projection (or a ground fallback), and
  connects the two with a dashed arrow. The Selected Layer inspector also has
  stronger visual grouping plus matched-asset thumbnails/fallback states. *Why:*
  authors need to see both where the voxel will be placed and what it is aligned
  above.
- **Preview panel inspector redesign.** The left Preview group now splits permanently
  into **Edit tools** (mode-aware: Z layer only in Billboard + Asset edit mode) and
  **Selected layer** (scene node summary, voxel ranges, read-only reserved attributes,
  editable custom attributes on baked layers, seed template apply). The renderer publishes
  multi-selection snapshots via `selectedLayerBus.ts`; baked custom attrs persist through
  `PATCH /api/v1/baked/layers/attributes`. *Why:* authors need full layer metadata and
  batch attribute tooling without leaving the workbench.
- **Asset mismatch confirmation for Preview edit mode.** Painting an asset onto
  an editable layer already bound to a different asset now opens a renderer-pane
  dialog showing the current layer asset and the target paint asset, lets the
  user name a new child layer, then selects that layer and continues the first
  stroke. *Why:* automatic sub-layer routing could stall the first paint and made
  layer ownership unclear.
- **Collapsible editable/output layer trees and selected-layer asset highlight.**
  Both Layers-panel sections now render a shared path tree with carets on parents
  that are real layers, and the Asset Store highlights the asset bound to the
  active editable layer. *Why:* large scenes need navigable layer hierarchy and a
  visible link between selected layer and source asset.
- **Z-layer editing for Preview edit mode.** The left pane's Preview edit tools
  now publish an integer **Z Layer** via `frontend/src/surfaces/library/editToolbarBus.ts`,
  mirrored into `frontend/src/renderer/store.ts`; `RenderCanvas` passes that z to
  the active renderer plugin's edit mapping before writing baked cells. *Why:*
  hand-editing should support authoring voxels at multiple heights, not only the
  former hard-coded z=0 plane.
- **Asset Store folder taxonomies — browse a flat zone as nested folders.** The
  store previously piled a whole zone into one continuous scroll grid; assets now
  bucket into folders by any of 5 schemes derived from the alias's bracket fields
  (`[f0]…[f12]`): **类型** (f8: 抠图/tilemap/forest/…), **场所** (two-level: f1
  室内/室外 → f3 房间), **风格** (f6), **尺寸** (f9), **适用场景** (f0, a `-`-joined
  multi-value tag list → overlapping folders). Backend adds
  `GET /api/v1/library/facets?zone=&by=&parent=` (`listFacets` groups in JS for
  multi-value + 4-sample covers) and extends `/library/list` with `by/value/parent`
  filters (`facetClause`, reusing the `bracket_value` SQLite UDF; scene matches
  whole dash-delimited tokens via `'-'||f0||'-' LIKE '%-tok-%'`). Frontend gains a
  「分类方式」titlebar dropdown, a breadcrumb, and Windows-explorer-style folder
  cards that peek up to 4 thumbnails inside. `taxonomy: null` keeps the legacy flat
  behaviour (zero regression). See `backend/src/library/{service,routes}.ts`,
  `frontend/src/surfaces/library/{libraryApi,assetStoreStore}.ts`,
  `frontend/src/surfaces/AssetStoreSurface.{tsx,css}`, with tests in
  `backend/tests/library.test.ts` and `frontend/src/surfaces/library/__tests__/
  assetStoreStore.test.ts`. *Why:* with thousands of look-alike pixel assets in one
  zone, a flat 600+-page scroll made finding anything by type/room/style hopeless.

- **"Node Info" panel above History in the Scene Generator controls.** A new top
  section shows whole-canvas tallies as plain inline text (batteries /
  connections / annotations / groups / frames) and, when a battery is clicked on
  the canvas, a faithful miniature of its node: the accent-green card with its
  title, input ports on the left edge and output ports on the right edge, each
  connected port drawing a short colour-typed wire out into the gutter to plain
  text naming the peer node + port (upstream for inputs, downstream for outputs).
  No boxes or icons around the peers — text only. Fed by the editor sync bridge's
  new `stats` / `selectedNode` snapshot fields (cross-iframe, so the side pane
  needs no pipeline store of its own); port dots use `getPortTypeColor` with the
  pane's `scenePortTypes`. The section is collapsible and its height drag-resizes
  (cascading into the sections below). See
  `apps/wb-scene-generator/frontend/src/workbench/SceneGeneratorControlsPanel.tsx`
  (`NodeInfoPanel` / `SelectedBatteryDiagram` / `PortRow`) and the `.scene-node-info*`
  / `.ni-*` styles in `WorkbenchLeftPane.css`. *Why:* users had no at-a-glance
  read of canvas composition, and inspecting a node's wiring meant tracing edges
  on the canvas.

- **Brush tools for edit mode: free brush + box-select, with per-asset
  sub-layer routing and a translucent ghost preview.** The left pane's Edit tools
  gains a **Free brush / Box select** toggle (crosses panes via the new
  `brushMode` channel on `editToolbarBus`). Painting routes by asset: an asset
  matching the active layer (or an empty layer) writes into it; a *different*
  asset auto-creates/reuses a `layer-n` **sub-layer** bound to that asset
  (backend `ensurePaintTarget` + `POST /api/v1/baked/target`; the renderer
  resolves the target synchronously when it can, else creates on first stroke).
  A dedicated overlay canvas (`mode-top-billboard-overlay`) draws a **half-opaque
  sprite** at the hovered cell (tile → its rule's base sprite, object → the whole
  image) and a rubber-band rectangle while box-selecting. **tile vs object** is
  derived from the alias's `tileType` in `aliasMetas`: a rule-bearing tile binds
  `asset_type='tile'` (autotile auto-applies via the existing render pipeline); a
  rule-less prop binds `asset_type='object'` (plain placement). Box-select fills
  every cell in the rectangle for both. *Why:* edit mode could only free-paint a
  single asset per layer; real authoring needs multi-asset layers, area fills,
  and a live preview of what you're about to drop.
- **Preview "edit mode" + a second, graph-independent "baked scene-layer"
  service.** Two independent logics now meet only in the preview canvas
  (visualisation) and at the Bake snapshot — mirroring Rhino's GH-preview vs
  bake-to-document model. *Why:* the node editor's output is a live, recomputed
  *preview* (not hand-editable); users needed real, persistent, hand-editable
  layers.
  - **New backend service** `backend/src/baked/` (`store.ts` + `routes.ts`,
    registered in `main.ts`). Persists a scene-tree JSON (`baked-scene.json`) in
    the **active project's folder** — resolved via the new `getActiveProjectDir()`
    in `runtime.ts` (handles the legacy `main` project) — completely separate
    from `state/graph.json`. Reuses the SAME vendored tree helpers + voxel
    projection the `scene_output` battery uses (`upsertCells` / `setAttribute` /
    `upsertSubtree`; ambient-typed via `baked/vendorScene.d.ts` since the dist
    bundle ships no `.d.ts`), so baked layers render identically to graph layers.
    Routes: `GET/POST /baked/layers`, `POST /baked/sublayer`,
    `PATCH /baked/layers/cells`, `PATCH /baked/move`, `DELETE /baked/layers`,
    `POST /baked/bake`; each broadcasts + logs `[baked] …`.
  - **Renderer** gains a `bakedLayers` store bucket (key `baked:<nodePath>`),
    fed by `useBakedLayers` from the new service. The graph-refresh GC
    (`retainVoxelNodes`/`retainPreviewLayers`) never touches it, so **baking does
    not remove the original Output layer — the two coexist as independent
    layers.** The billboard+asset pipeline renders both buckets through one
    master bake.
  - **Edit mode toggle** (✎, gated to Billboard view + Asset draw mode): paint
    with the AssetStore-selected tile directly on the canvas at **z=0**
    (`screenToEditCellZ0`), optimistic local update + debounced persist. Selected
    paint tile crosses panes via `paintAssetBus` (localStorage + `storage`).
  - **Layers panel split into Editable vs Output.** Editable layers support
    multi-select (click / ⌘-ctrl-toggle / shift-range), **drag-to-reorder** and
    **drag-to-reparent** (drop on a row's top/bottom edge = reorder, middle =
    nest as child; backed by `PATCH /baked/move`), `+ Layer`, `+ Sub`, and batch
    **Delete (N)**. Selected-layer detail is published to the left pane's Preview
    tab via `selectedLayerBus`.
- **"Rules" pseudo-zone in the AssetStore + rule detail in the left pane.**
  Tilemap stitching (autotile) rules — vendored JSON under `assets/rules/` and
  previously only reachable indirectly via a tile's `tileType` — are now a
  browsable category. New backend `GET /api/v1/library/rules` (normalises v1/v2
  rule schema into one `RuleListItem`); the AssetStore zone dropdown gains a
  **Rules** entry rendering metadata cards; selecting one shows its detail
  (schema/ppu/sprites/faces/regions) under the left pane's AssetStore group via
  `rulesApi`'s cross-pane bus. *Why:* rules were invisible in the UI.
- **Edit toolbar in the left pane's Preview tab (collapsed unless editing).** A
  new `editToolbarBus` (localStorage + `storage`, same pattern as the other
  cross-pane buses) carries two facts in opposite directions: the renderer pane
  publishes `editMode` (it owns the ✎ toggle) so the toolbar only expands while
  editing; the toolbar publishes `showGrid` back, mirrored into the render store.
  First tool: **Show grid lines** — an *infinite*, viewport-spanning alignment
  grid (`compose.ts` `drawInfiniteGrid`, cell-aligned to the same origin as the
  content and the coordinate readout, with the col-0/row-0 axes emphasised; it
  bails out when cells get sub-4px to avoid a dense smear). Drawn **last**, so it
  overlays every layer as a guide rather than being hidden behind content.
  *Why:* edit mode needed an alignment aid, and the toolbar gives later edit
  tools a home.

### Fixed

- **Editable layer drag-reorder now stays in the order returned by the baked
  layer service.** The shared path-tree helper no longer alphabetically sorts
  siblings after refresh. *Why:* the backend persists drag order via layer
  versions, and the frontend must not overwrite that order while rendering the
  collapsible tree.
- **The first stroke no longer disappears when changing assets.** Asset mismatch
  no longer calls the async auto-target route from the pointer path; the stroke
  waits for user confirmation and then paints into the newly selected child layer.
  *Why:* first-paint behavior must be deterministic even when a new asset layer is
  needed.
- **Preview object placement no longer lands one billboard cell above the cursor.**
  `frontend/src/renderer/framework/geometry/topBillboard.ts` now defines the edit
  conversion from selected top-face cell + z to voxel coordinates, and object
  sprites anchor to the footprint/front face in
  `modes/topBillboard/buildVoxelMaster/paintCell.ts`. *Why:* the ghost preview
  used the intended cell, but actual object rendering used the raised top face
  (`y - z - 1`), producing a one-row upward offset at z=0.
- **Painting produced nothing visible.** Two causes: (1) the AssetStore published
  the *full alias* as the paint `name`, but the renderer's `matchAssetEntry`
  (fuzzy=false) keys layers by the alias's item-name field — so no asset ever
  matched and asset-mode `paintCell` skip-renders unmatched cells; (2) the
  optimistic store update added cells but never bound the layer's `asset_name`,
  so the sprite couldn't resolve until a backend round-trip. Now the AssetStore
  publishes `name = aliasItemName(alias)` (field 4) and the paint flow
  optimistically binds `asset_name`/`asset_type` on the target layer
  (`bindBakedLayerAsset`), so strokes render immediately.

### Changed

- **Asset Store folder view honours the List view mode.** Picking a taxonomy
  (e.g. By Scene) previously forced a folder grid and ignored the View toggle;
  folders now render as wide list rows in `list` mode — left cover thumbnail,
  folder name + count on top, a sampled content preview below — while `grid`
  keeps the explorer-style cards. See `AssetStoreSurface.tsx`/`.css`
  (`FolderRow`, `.folder-row`).

- **Asset Store taxonomy selector: English, icon-only trigger, per-scheme
  icons.** The "分类方式" dropdown is now English; the titlebar trigger keeps only
  its icon (no inline label) and that icon reflects the active scheme, and each
  scheme renders as icon + label without the explanatory hint (All, By
  Type/Place/Style/Size/Scene), mirroring the View dropdown. New glyphs in
  `library/icons.tsx`; wired in `AssetStoreSurface.tsx`/`.css`.

- **Node Info miniature: English labels in EN mode, live port values, no
  sideways scrollbar.** The selected-battery diagram now honours `langMode` —
  title uses the battery's `nameEn` (falling back to an id-derived label) and
  port rows use the English port name — and each port's lead-out shows its
  *current value* (formatted host-side) instead of the connected peer's
  node/port. The connection wire is drawn **only for actually-connected ports**,
  so unconnected ports with a default value no longer look wired; unconnected
  ports show their value too (kernel falls back to the catalog default). The
  wire's slot is always reserved (painted only when connected) so wired and
  unwired values line up. The layout is **adaptive**: the node card grows to use
  the pane width (gutters bounded to ~26%), each value box fills its gutter, and
  rows grow to fit via a measuring layout effect + `ResizeObserver`. Values
  render as a **kind label + value on two lines** (`grid` / `979×979`, `Value` /
  the number), and **port names wrap at word boundaries** (zero-width breaks at
  camelCase, e.g. `mainRoad​Grid`) instead of truncating. See
  `frontend/src/workbench/SceneGeneratorControlsPanel.tsx` +
  `WorkbenchLeftPane.css`, backed by the kernel `SelectedNodeView`/
  `SelectedPortView` fields below.

- **Preview left tab now uses the Scene Generator controls-panel layout.**
  Edit tools, Selected layer, and Help render as collapsible, resizable sections
  with their own persisted layout state. *Why:* Preview and Scene Generator share
  the same left-pane shell, so their controls should feel like one UI system.
- **Preview edit mode no longer auto-creates asset-mismatch sub-layers.**
  `RenderCanvas` now paints only into an empty/same-asset active layer, or waits
  for `RendererSurface` to confirm a named child layer. *Why:* one editable layer
  should have one clear asset binding, and the user should choose when a new
  asset layer is introduced.
- **Editable baked layers now render through every Preview renderer mode.**
  `frontend/src/renderer/framework/layerKeys.ts` centralises output+editable key
  ordering, and top / billboard / iso / free3d consume the same buckets instead
  of leaving baked layers billboard-only. *Why:* the editable scene tree is shared
  scene-layer data; only the current editing interaction is billboard-specific.
- **Preview Layers panel sections are resizable.**
  `frontend/src/surfaces/RendererSurface.tsx` adds an accessible splitter between
  Editable and Output, replacing the fixed 180px editable-list cap in
  `RendererSurface.css`. *Why:* users need to freely allocate space between
  authoring layers and live output layers.
- **Open / Save relocated into the Projects panel; Save dialog restyled to match
  the pane.** The standalone left-pane Open/Save row is gone. **Open** is now a
  compact icon button immediately right of the Projects "+" glyph (`ProjectPanel`
  `headerActions` slot): it
  imports a JSON as a *brand-new project named after the file* (wrapper `name`,
  else filename sans extension) and opens it via `createProject` → inline import,
  instead of replacing whatever project was open. **Save** is now a per-project
  action button on each project card (`ProjectPanel` `renderProjectActions` slot
  → `ProjectCard` `extraActions`); it activates the target project if needed so
  `getPipeline()` reads *its* graph, then surfaces the re-importable
  kernel-graph-v1 JSON in a copyable modal whose chrome now reuses the project
  wizard/delete palette (accent-green primary `.proj-btn`, muted secondary).
  *Why:* a single global Open/Save was ambiguous in a multi-project pane and the
  modal looked foreign; tying both to projects makes intent explicit and matches
  the rest of the surface. Kernel: `packages/.../chrome/ProjectPanel.tsx` and
  `projectViews.tsx` gain backward-compatible optional slot props only.
- **Ghost preview and object placement honour PPU + anchor.** An object asset
  (no autotile rule) is no longer stretched to the cell: it renders at its real
  size — `imagePx / PPU` cells (PPU from alias field 9) — with its library anchor
  (`anchorX`/`anchorY`) aligned to the cell-footprint centre, drawn once. The
  edit-mode ghost previews exactly that, so what you see is what gets placed.
  Autotile tiles are unchanged (cell-aligned by their rule). `matchAssetEntry`
  now also surfaces `ppu`; `paintCell` gains `drawAnchoredObject`.
- **Baked layer order is now stable across mutations.** Adding a sub-layer (or
  painting an existing layer) no longer shoves the parent to the end of its
  sibling order. Root cause: the vendored `rewriteAtPath` stamps the fresh
  version onto every node on the mutated path, and `projectBaked` orders siblings
  by version. Fix: after a mutation, restore the version of every pre-existing
  node touched (ancestors always; the leaf if it already existed) — only brand-new
  nodes get the appending version (`setNodeVersion`/`restoreAncestorVersions` in
  `baked/store.ts`). This is also a prerequisite for auto-sub-layer painting.
- **AssetStore no longer hard-codes the paint asset's type as `'tile'`.** It has
  no rule metadata; the renderer now derives tile-vs-object from `aliasMetas` at
  paint time, so object props bind `asset_type='object'` instead of being
  mislabelled tiles.
- **Bake preserves the selection's parent/child hierarchy and order.** Baking a
  set of output layers grafts each at its original `nodePath` (intermediates
  auto-created) in DFS order, remapping only a colliding top-level root so
  re-bakes don't clobber existing editable layers. Previously every layer was
  flattened to a top-level node, losing the `/House → /House/Roof` nesting.
- **"Bake" moved from a per-row button to a header "Bake selected (N)" action**
  over the multi-selected Output layers.
- **Baked-layer operation failures now surface in the console** (`[baked] …`
  warnings) instead of being silently swallowed — surfaced during debugging of a
  stale-backend 404.
- **Baked-layer stacking order fixed (was inverted).** The billboard painter now
  draws baked layers in true tree z-order via `orderBakedKeysForRender`: a child
  renders **on top of** its parent, and an upper-listed sibling renders **on top
  of** a lower one (whole subtrees stack as a unit). Previously the panel's
  top-to-bottom order mapped to bottom-to-top on the canvas. Graph/Output layers
  keep their existing order and stay beneath the baked layers.
- **Billboard coordinate readout is now global.** `screenToCell` no longer clamps
  to the content bbox, so the cursor reports a grid cell anywhere on the canvas
  (may be negative) — the grid is just default alignment, not the coordinate
  domain. *Why:* coordinates vanishing the moment the cursor left the painted
  region was confusing; a stable global frame is expected.

### Removed

- **"Drag batteries into the editor and run" canvas empty-state hint.** *Why:* it
  carried no useful information and cluttered an empty preview.
- **Preview toolbar settings (gear) dropdown.** Its only non-redundant control,
  "回正视角" (reset view), is now a direct toolbar button; zoom stays on the
  canvas wheel (centered on cursor). *Why:* the dropdown wrapped one useful
  action behind an extra click.

### Added

- **Open / Save buttons in the left pane — local import/export of the canvas
  graph JSON.** Restores a direct round-trip for the node graph that does not go
  through server-side template files. **Save** reads the live graph
  (`client.getPipeline()` + `client.listGroups()`) and assembles a
  `kernel-graph-v1` payload — the *same* shape the backend `/api/v1/pipeline/export`
  route writes (`{ format, name, graph: { id, nodes, edges, groups?, metadata? } }`),
  so it is re-importable and interchangeable with server templates. The studio
  wraps each plugin pane in a sandboxed iframe **without `allow-downloads`** (and
  sandboxed popups can't escape it), so a programmatic file download is silently
  blocked here; Save therefore shows the JSON in a copyable modal
  (`.scene-left-pane__save` + a Copy button) for the user to save manually,
  rather than a (blocked) download. **Open** uploads a JSON via the browser file
  dialog and imports it **inline** (the backend `/api/v1/pipeline/import` route
  already accepts a `{ format, graph }` body) with `mode:'replace'` after a
  `window.confirm`; the kernel broadcasts `graph:applied` over `/ws`, so the
  canvas + preview refresh live (no manual reload). Buttons reuse the existing
  `editor-controls__btn` style. App-only — no kernel change here: the inline
  import is a new `importPipelineInline` method on the app's `HttpApiClient`, not
  on the kernel `ApiClient` interface. On a rejected import (HTTP 422) it reads
  the body and surfaces the kernel's `reason` + `diagnostics` (e.g. `unknown opId
  'foo'`) instead of a bare status code, so a file referencing ops this backend
  doesn't have explains itself. (The kernel side — exempting the `__relay__` wire
  sentinel from import validation so reroute graphs round-trip — is recorded in
  the root `CHANGELOG.md`.) See
  `frontend/src/workbench/WorkbenchLeftPane.tsx` (`handleSave` / `handleOpen` /
  `onFileChange`), `frontend/src/api/HttpApiClient.ts` (`importPipelineInline`),
  `WorkbenchLeftPane.css` (`.scene-left-pane__io`), and
  `frontend/src/workbench/__tests__/openSave.smoke.test.tsx`.

- **GTA / worldmap scene30 batteries migrated from legacy `wb-scene`.** Ported the
  remaining Vice City pipeline ops (`city_grid`, `coastal_*`, `connected_roads`,
  `road_trim`, `gta_land`, airport/harbor/heightmap/park/remote_island overlays)
  and refreshed existing `gta_*` / `worldmap_render_layers` implementations to
  match `origin/wb-scene` through `3747d58b`.

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

### Changed

- **Left workbench controls migrated from the legacy dev branch.** The left pane
  now uses the resizable Projects section plus `SceneGeneratorControlsPanel`
  (History / Data Types / Help) from the standalone scene-generator dev commit,
  while keeping node-editor's newer direct Preview reset-view toolbar behaviour.
  AssetStore chrome also drops the old settings gear in favour of the simplified
  fullscreen-only right cluster.
- **Previewer toolbar slimmed (`surfaces/RendererSurface.tsx`).** Dropped the
  settings (gear) button and its dropdown — including the `- 100% +` zoom
  buttons (canvas wheel already zooms around the cursor, so no capability lost) —
  and promoted **Reset view / 回正视角** to a direct toolbar button in the gear's
  old slot (screenshot · layers · reset-view · fullscreen). Removed now-dead
  state/logic (`showSettings`, `settingsRef` + its outside-click effect, `zoomBy`,
  `zoomPct`, `scale`, `setViewport2d`), unused imports (`zoomViewportCentered`,
  `Settings`/`ZoomIn`/`ZoomOut`), and the orphaned `.renderer-settings-*` /
  `.renderer-zoom-*` CSS. Smoke test updated to assert reset-view is a direct
  button. typecheck clean, smoke 7/7.
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
  edits hot-restart the backend. Both verified live with zero build. `serve`
  (dist) is untouched.
- **Docs realigned to monorepo reality.** Rewrote `ARCHITECTURE.md`,
  `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, and
  `docs/architecture/{backend,frontend,extension-and-contracts}.md` to reflect
  that the kernel is `workspace:*` packages in `packages/*`, not an
  `external/forgeax-wb-node-core` submodule consumed via `link:`. Removed all
  references to `external/`, `kernel:setup`, `kernel:build`, and submodule pin
  SHAs. Updated `docs/architecture/extension-and-contracts.md` to reflect that
  `resolveBatteryScanRoots` lives in `@forgeax/editor-host/backend` and always
  resolves both roots from the monorepo (no fallback probing). Removed dead
  `.gitmodules` + `.cursor/rules/kernel-cascade.mdc` references. Repointed
  acceptance-loop CLI bin to `packages/node-runtime-cli/dist/bin.js`. Hygiene
  `external/` submodule guard removed from `scripts/hygiene-check.mjs`.

### Removed

- **Removed the obsolete `texture_bind` battery (kernel cascade: `f831fe6`).** The
  stale `asset_grid` port type is retired in lockstep with `forgeax-wb-node-core`;
  texture helpers now expose only generic `image` / `dict` outputs and no longer
  advertise a texture-grid binding node.

### Fixed

- **`batteryRoots` loads shared common batteries from `external/forgeax-wb-node-core`.**
  Monorepo / marketplace checkouts pin the kernel under `external/`; the loader
  previously only scanned a sibling `../forgeax-wb-node-core` path (forgeax-studio
  layout), so the `batteries-common` pack was missing. Tries `external/` first,
  then sibling, then plugin `batteries/`.

### Added

- **Saved group batteries default to a GROUPS tab in Develop** (kernel cascade —
  bump `external/forgeax-wb-node-core` to `afd18d0`; see its CHANGELOG Unreleased).
  - The group **Save** button now writes a normal group battery to
    `batteries/groups/<category>/` (was `batteries/templates/`), and
    `GET /api/v1/group-templates` lists **both** `groups/*` (Develop → GROUPS,
    sub-categorized by the save-time tag) and `templates/*` (Templates mode — a
    special curated subset; not every group is a template). `findTemplateFile` +
    `/categories` updated to search/list the `groups/` root too
    (`backend/src/routes/groupTemplates.ts`).
  - Kernel `isTemplateBattery` now keys off the big label (`getBigLabel !==
    'groups'`) instead of an exact `displayGroup` match, so `groups/<cat>`
    batteries stay in Develop with sub-categories while `templates/*` stay in
    Templates mode (backward compatible). This also surfaces the previously
    dormant `batteries/groups/` library (architecture / main / tools / general).

- **Multi-project management in the left pane + per-agent project lock** (kernel
  cascade — bump `external/forgeax-wb-node-core`; see its CHANGELOG Unreleased).
  - The left pane (`frontend/src/workbench/WorkbenchLeftPane.tsx`) now mounts the
    kernel **`<ProjectPanel>`** (cards: switch / create / delete) as its top section;
    it configures its own editor transport + `subscribeProjectActivation()` so it
    stays live with the center editor. The old read-only "Recent projects" list was
    removed (superseded by the interactive panel). The static workflow / preview /
    tips sections are kept.
  - New AI tool **`scene:projects.close`** (release the exclusive lock) +
    backend `POST /api/v1/projects/:id/close` (`backend/src/routes/projects.ts`).
    Open-then-operate: an agent opens (locks) a project, operates, then closes;
    it cannot open a second project until it closes the first, and cannot open a
    project another agent holds. Tool calls forward the caller via
    `x-forgeax-caller-*` headers (`backend/src/tool-handlers.ts`); the activate +
    batch/execute/import routes enforce the lock (`ensureMutationAccess`).

### Changed

- **The canvas top-right "projects" button + modal were removed** in favour of the
  left-pane `<ProjectPanel>` (`frontend/src/workbench/WorkbenchHost.tsx`). *Why:*
  one project-management surface, in the left pane, for both the human and the LLM.

### Fixed

- **`serve` now self-builds missing dist artifacts before boot.** Mirrors the
  lowpoly plugin host contract: a cold checkout with no `frontend/dist` runs
  `pnpm -C frontend build` before serving the bundled UI. Scene keeps its
  existing dist-backed backend path, so a missing `backend/dist/main.js` now
  also runs `pnpm -C backend build` instead of failing with a manual-build
  instruction.

### Changed

- **Asset store de-submoduled → built-in `materials/asset-store/`.** *Why:* the
  asset library was a git submodule pointing at an external repo
  (`dev/assetstore`); that coupled the plugin to a separate repo's
  availability/permissions and complicated clones. It is now a plain in-repo
  directory mirroring the legacy `forgeax-wb-scene` layout (`materials/asset-store/`
  with `library.db` + content-addressed `blobs/`), with **no remaining link to the
  upstream repo**. Removed the submodule from `.gitmodules`/`.git/config`/`.git/modules`,
  dropped the now-obsolete `assets:setup` script, and repointed `ASSET_STORE_DIR`
  in `backend/src/library/db.ts` from `external/asset-store` → `materials/asset-store`
  (the only code path constant; `service.ts` consumes it). SQLite WAL sidecars
  (`library.db-shm/-wal`) stay untracked via the dir's `.gitignore`.
  `external/forgeax-wb-node-core` (the kernel) remains the only submodule; SSOT
  model unchanged. Verified: build:vendor / typecheck / build / hygiene green,
  scene frontend `79 passed`, backend `32 passed`, and the `/api/v1/library/*`
  routes still serve assets from the new path.

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `1441ca5`.** Picks up
  the debounced-persist editor change (`schedulePersistSession` + skippable
  `incrementalExecute({ persist:false })`) — the editor half of upstream
  `7bccdc20`. Coalesces persist storms during node/frame drags, panel resizes and
  multi-step canvas edits. Editor-only kernel change; no scene backend/frontend
  source change beyond the submodule pin. Kernel dist rebuilt under `external/`.
  Pin matches the 3d plugin. Verified: scene frontend `79 passed`, backend
  `32 passed`.

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `a2a848e`.** Picks up
  the upstream `wb-scene` editor-parity batch (i18n preview labels `7c1206cd`,
  relay fork-delete `e0c567d7`, relay capsule `09388e3f`, preview-disabled ring
  `b2beda9e`, group-view overlap `1506493a`, port handle z-index `e75d91aa`,
  annotation Ctrl-drag/copy `440da6a5`, the bbox/frame chain
  `3b907c5c`/`0993136a`/`40f27e51`, favorites context-menu affordances
  `51dceee2`, and frame-persistence reconciliation `f3414fe1`). Editor-only
  kernel change; no scene backend/frontend source change required beyond the
  submodule pin. Kernel dist rebuilt under `external/`.

- **Renderer: upstream visualization parity (top mode).** Ported renderer
  changes from the legacy implicit-list upstream (`wb-scene`): `efa4f925`
  (selected layers now draw a thin solid mask outline plus a dashed
  whole-layer bbox to distinguish the two — top mode; the legacy topBillboard
  grid-layer stroke path does not exist here, see note); `c40a7ed0` (multi-value
  `wire` rendering — per-value alpha banding and per-cell outlines on sub-value
  selection — for the GTA zones batteries; the legacy `cellSource` change is a
  no-op for us since our `cellSource` already computes accurate `isMultiValue`
  directly); `b4936837` (preview bridge now also collects grids from
  `any`/`array`/`list` ports so pass-through batteries with dynamic `any`/`tree`
  outputs still render). Frontend-only, no kernel cascade.

### Added

- **Upstream batteries: worldmap + GTA series (`scene30/`).** Ported the
  converged upstream `SCENE 3.0/worldmap`, `gta`, and `gta_cities` battery
  groups (20 self-contained grid ops) from the legacy implicit-list upstream
  (`wb-scene` branch) commits `b4936837` (worldmap group), `0a646ecc` (gta group +
  worldmap fixes), `0cbed07f`/`d47b24f9` (gta main-road), `89136f0f` (gta
  aux-road), `c40a7ed0` (gta zones), `bc92857b` (gta_cities series) into
  `batteries/scene30/{worldmap,gta,gta_cities}`. Ops are self-contained (no
  `_shared`/external imports), no id collisions, and the loader reports the new
  ops with zero new skips. Pure-additive, no kernel cascade.

- **Architecture docs.** Added [`ARCHITECTURE.md`](./ARCHITECTURE.md),
  [`docs/architecture/`](./docs/architecture/) (backend · frontend ·
  extension-and-contracts) and [`AGENTS.md`](./AGENTS.md): a code-grounded map of
  the scene plugin (backend routes/runtime/library/agent, the renderer
  subsystem, the scene domain seam) and a read-before-write protocol.

### Fixed

- **Kernel bump → `483431c`** (cascade). Bumped `external/forgeax-wb-node-core`
  for the deterministic battery scan + first-wins duplicate-id guard. Scene now
  loads `290 ops (0 skipped)` with the `scenealg/*` (`alg_*` id) and legacy
  same-basename ops coexisting deterministically; documented in
  `docs/architecture/extension-and-contracts.md`.

- Bumped the shared editor kernel so grouped nodes persist as real kernel
  groups across live-sync/refetch instead of immediately expanding back to
  member nodes.
- Bumped the shared editor kernel so double-clicking a wire reliably hits the
  ReactFlow edge interaction path and inserts a typed Relay in the browser.

### Added

- Added scene group-template REST support (`/api/v1/group-templates*`) so the
  shared editor can save collapsed groups as reusable template batteries, list
  them in Templates mode, and instantiate them back onto the canvas.
- **Relay double-click parity.** Bumped the shared editor kernel to restore the
  legacy relay interactions inherited by scene-generator: double-click a wire to
  insert a typed relay, double-click a relay node to remove it and restore the
  direct wire when possible.

- **Shared editor chrome.** `WorkbenchHost` now imports `PipelineFileDialog` and
  `ProjectsDialog` from the shared kernel editor package instead of carrying
  scene-local copies. Scene-specific state remains limited to renderer/asset-store
  preview wiring, scene panel renderers, and `scene` project defaults.
- **Shared editor probe / relay affordances.** Bumped the kernel submodule so the
  inherited editor exposes the data-probe toggle directly in the toolbar and adds a
  Canvas quick-search **Relay** entry that creates the kernel `__relay__` sentinel.
  Relay remains kernel/editor infrastructure rather than a common battery pack item.
- **Shared `common` batteries.** The generic number/list/datatree/input batteries
  plus generic grid/annotation preview panels now load from the shared
  `forgeax-wb-node-core/packages/batteries-common` pack instead of living under
  this downstream's `batteries/special/**`. Existing op ids such as
  `number_const`, `range_list`, and `tree_merge` are unchanged, while the palette
  and `/api/v1/ops` now expose them under `common/*` categories. The category
  scanner now accepts multiple battery roots and treats every scan-root top-level
  folder as an automatic palette tab.
- **Keyboard Undo/Redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) is now reversible
  end-to-end.** Inherited from the kernel submodule bump: the shared editor
  (`node-runtime-react`) gained `useCanvasUndoRedo`, which restores the History
  snapshot at the cursor — including the now-visible AI/CLI `batch_applied`
  entries — authoritatively through the kernel (`importPipeline` replace, actor
  `undo`/`redo` → `applyBatch → graph:applied → loadPipeline → reconcile → preview
  refresh`), with `undo`/`redo` marked history-suppressed so restores never loop or
  double-advance the cursor. See the kernel CHANGELOG for the contract.
- Added an end-to-end REST smoke (`scripts/smoke-undo.mjs`, `pnpm smoke:undo`,
  isolated temp root + alt port 9579) proving: an AI batch (`actor:'ai:test'`) is
  applied, UNDO via the canonical import/replace path with `actor:'undo'` returns
  `GET /api/v1/pipeline` to the pre-batch graph, REDO (`actor:'redo'`) moves
  forward, and `undo`/`redo` are history-suppressed.

### Fixed

- **Multi-layer scene assembly produced empty output.** Wiring two `grid2node`
  scene outputs into a `tree_merge` battery yielded empty downstream. Three
  coupled defects fixed:
  - `batteries/special/datatree/tree_merge/index.ts`: the structural-pack default
    branch used `value instanceof DataTree`, which fails across module boundaries
    (the dispatcher's `DataTree` class ≠ the dynamically-imported battery's copy).
    Now uses the same `isDataTree()` duck-type as the item-concat branch.
  - Kernel submodule bump: restores the `tree_merge` `inferredAccess` connect-hook
    in `node-runtime-react`'s `useCanvasConnect` (see kernel CHANGELOG) so
    `access:'item'` scene inputs take the item-concat branch.
  - The correct battery for assembling multi-layer scene trees is **`add_child`**
    (grafts each scene under a parent path), not `tree_merge` (DataTree
    wire-algebra). `tree_merge` now returns an actionable error pointing at
    `add_child` when scene values are wired into it, instead of silently emitting
    empty output.
- Added backend tests (`backend/tests/scene-assembly.test.ts`) covering
  `add_child` + `node_explode`, nested assembly, the `tree_merge` cross-module
  regression, and the scene-misuse guard; plus an end-to-end REST smoke
  (`scripts/smoke-scene-assembly.mjs`, `pnpm smoke:assembly`) proving a
  `grid2node → add_child → scene_output` pipeline yields a 2-child scene and 2
  non-empty voxel layers.

### Added

- **Multi-project management (new/open/delete/switch).** Faithful port of the
  legacy `forgeax-wb-scene` project flow onto the kernel `ProjectRegistry`, with an
  LLM/CLI-callable HTTP API:
  - `GET /api/v1/projects` (list), `POST /api/v1/projects` (create —
    `{ type, name, fromTemplate? }`, fromTemplate resolved against the templates dir
    and seeded via the kernel `importPipelineGraph`), `GET /api/v1/projects/:id`,
    `PUT /api/v1/projects/:id` (rename/update), `DELETE /api/v1/projects/:id`
    (`?assetPolicy=detach|delete`), `POST /api/v1/projects/:id/activate`,
    `GET/PUT /api/v1/workspace`. Registered in `backend/src/main.ts`.
  - **Activate** persists the outgoing project's graph, hot-swaps the active runtime
    to the target project's isolated `state/graph.json` + `history.jsonl` + `outputs/`,
    then forwards `graph:applied` over `/ws` so the canvas refetches live — graph swaps
    reuse the exact `applyBatch`/`loadPipeline → graph:applied → pipelineRevision++ →
    useCanvasGraphSync reconcile → preview refresh` cascade. WS subscriptions re-bind to
    the new runtime (`rebindWsSubscriptions`).
  - **Backfill:** the existing implicit `main` graph at `.forgeax-runtime/state/graph.json`
    is auto-registered as a default project on first run — current users keep their work.
  - Frontend: a `ProjectsDialog` (projects modal + new-project wizard + delete dialog)
    in `WorkbenchHost`, opened from a toolbar button showing the active project name;
    switching remounts the preview iframe and posts `workbench:project-changed` so the
    renderer clears/reloads. `activeProjectType` still filters the battery palette.
  - CLI: `forgeax project list|create|open|delete`.
  - Covered by `scripts/smoke-projects.mjs` (`pnpm smoke:projects`): backfill + two
    isolated projects (graph + history) + activate switching reflected in
    `GET /api/v1/pipeline` + the AI create/open/batch/screenshot path + safe delete.
- **Import a node-connection graph from a file.** Faithful port of the legacy
  `forgeax-wb-scene` `savePipelineAs` / `saved-files` / `load-file` flow onto the
  kernel-batch architecture, with an LLM/CLI-callable HTTP API:
  - `POST /api/v1/pipeline/import` — body is either inline `{ format, graph, options }`
    or `{ file: { path, source }, options }` (server reads from the templates dir).
    `options`: `{ mode:'replace'|'merge', remapNodeIds, idRemap, executeAfter:
    'none'|'downstream'|'full', actor, label }`. Delegates to the kernel
    `importPipelineGraph`, then on success forwards `graph:applied` over `/ws` (so the
    canvas refetches live, identical to `/api/v1/batch`) and, per `executeAfter`, runs
    the affected/whole graph so previews refresh via the existing
    `useNodePreviews`/`exec:completed` path. Replace flows through `applyBatch →
    graph:applied → loadPipeline → pipelineRevision++ → useCanvasGraphSync reconcile`,
    NOT an ad-hoc canvas wipe.
  - `GET /api/v1/pipeline/templates` — scans `<projectRoot>/templates/` and returns
    `{ path, name, source?, format? }[]`. Path traversal is rejected.
  - `POST /api/v1/pipeline/export` — writes the current graph as `kernel-graph-v1`
    (incl. `viewport`/`annotations`/`frames` metadata) to a template file, enabling a
    round-trip (export → re-import → identical graph).
  - **Frontend**: `HttpApiClient` implements `listImportTemplates` /
    `importPipelineFile` / `exportPipelineFile`; `WorkbenchHost` wires the editor
    `Toolbar` `onOpen` / `onSave` to a new `PipelineFileDialog` (open template → import
    → live cascade; save → export).
  - **Headless / LLM**: an agent can `POST /api/v1/pipeline/import` with inline JSON,
    `mode:'replace'`, `executeAfter:'full'`, `actor:'ai:import'`, `label:'…'` to swap
    the canvas + previews live; the `forgeax pipeline import` CLI wraps the same kernel
    function (see kernel CHANGELOG).
  - **Kernel submodule bump** — adds `node-runtime` `importPipelineGraph`,
    `node-runtime-react` `legacyPipelineToOps` + adapter import/export + Toolbar
    `onOpen`/`onSave`, and the `node-runtime-cli pipeline import` subcommand.
  - New `scripts/smoke-import.mjs` (`pnpm smoke:import`, isolated temp project root +
    alt port 9575): imports a saved template (replace, execute full), asserts the
    imported nodes/edges land in `GET /api/v1/pipeline`, a History entry
    (`actor:'import'`) exists, outputs were produced, the export→re-import round-trip is
    identical, and the inline `actor:'ai:import'` path lands + is history-bridgeable.
- **History panel reflects AI/CLI-driven operations.** Programmatic mutations
  (`POST /api/v1/batch` from an AI agent / CLI / another client) now surface in the
  editor's History panel, not just local UI clicks. The `/api/v1/batch` route
  forwards `opts.actor` **and** an optional `opts.label` into the kernel history
  entry, so AI callers can annotate a batch (e.g. `{ actor: 'ai:agent', label:
  'AI: 创建山脉 ×2' }`); the kernel bump (below) adds the history bridge that records
  these committed batches into the editor `useHistoryStore`, while local `editor`
  ops are skipped to avoid double-recording. New `scripts/smoke-history.mjs`
  (`pnpm smoke:history`, isolated temp project root + alt port 9577): POSTs an
  `actor:'ai:test'` batch, asserts `GET /api/v1/history` persists actor + label +
  ops + batchId and that `graph:applied` carries the batchId (the data the bridge
  needs), and that a local `editor` batch is classified as skip-by-the-bridge.
- **Kernel submodule bump** — adds the `node-runtime-react` History bridge
  (`subscribeLiveSync` records non-local committed batches into `useHistoryStore`,
  capturing the pre-batch snapshot and labelling by actor/ops) and the additive
  `node-runtime` `HistoryEntryV1`/`ApplyBatchOptions` `label` field. No regression
  to incremental canvas reconcile, external/LLM live-sync, or tree_merge/add_child
  (see kernel CHANGELOG).
- **Faithful UI replica — kernel bump.** Bump kernel submodule to the faithful
  editor build that adds `Editor` `showRunControl` / `statusBar` props, a wired
  `connectionStatus`, and a battery catalog that honours on-the-wire `category`
  hints.
- **Workbench host** (`frontend/src/workbench/`): legacy-style layout that mounts
  the kernel `Editor` (Run/Stop hidden — the scene generator auto-executes) and
  embeds the renderer + asset-store panes as same-origin iframes, with focus,
  resize, and an aggregated status bar. `App.tsx` routes by `?pane=`.
- **Renderer pane** (`surfaces/RendererSurface`): faithful Preview toolbar
  (view-mode dropdown + Wire/Color/Asset segment), empty-canvas hint, layer side
  panel, screenshot, and WS-driven refresh over the 4-mode render canvas.
- **Asset store pane** (`surfaces/AssetStoreSurface`): zone selector, search,
  grid/list views with per-asset size badges, and centered numbered pagination,
  over new read-only `/api/v1/library/{zones,list}` routes.
- **Battery category projection** (`backend/src/routes/batteryCategories.ts`):
  scans the on-disk `batteries/` tree and re-attaches each op's
  `category`/`displayGroup` to `GET /api/v1/ops`, restoring palette grouping
  (8 big categories: scene30, alg_store, special, components, basic, scenealg,
  scene, ai) that the kernel deliberately strips from `OpSpec`.
- `setLayerVisible` action on the render store for per-layer visibility toggles.

- **Stage-2a (scene battery migration).**
  - Bump kernel submodule to `node-runtime-cli-v0.1.0` (bundles
    `@forgeax/node-runtime` v0.3.0 + the implemented `forgeax` CLI).
  - Vendor `shared/types` under `vendor/` with a `build:vendor` compile step
    (emits `vendor/dist/shared/types/`), so battery `.ts` files loaded via Node
    type-stripping can resolve their `shared/types/index.js` imports.
  - Migrate in-scope scene batteries (copy + import rewrite): `special`, `scene`,
    `scenealg`, plus `scene30`, `basic`, `components`, `alg_store`, `templates`,
    `ai`, `json`, `groups`. Excludes 3D-modeling and image-processing batteries.
  - Headless loop proven: the kernel loader scans the migrated tree with 0 errors
    for the must-run set (`special` except `sort`, `scene`, `scenealg`);
    `pnpm smoke:batteries` runs `executeNode` over the loaded ops; `pnpm accept`
    drives the `forgeax` CLI end-to-end with a deterministic output hash.

- **Scaffold.**
  - Initial scaffold consuming `@forgeax/node-runtime` via git URL dependency.
  - Backend / frontend / batteries / schemas directory skeleton.
  - ForgeaX plugin manifest with split surface layout.
  - Hygiene check, ESLint, Prettier, CI workflow.

### Changed

- **Asset store UI fidelity pass** (`surfaces/AssetStoreSurface.{tsx,css}`): aligned
  the pane to the legacy AssetStore chrome (the design source of truth).
  - Titlebar: replaced the wide plain `<select>` zone field with a compact,
    zone-tinted dropdown (raw→"Ra", staging→"St", …); replaced the plain
    `Grid`/`List` text buttons with an icon-only view-mode dropdown; added the
    legacy settings gear; the search field now lives inside the gear (with a
    clear button and an active-search dot on the gear), and the gear also holds
    the relocated status (zone · total · page · selection) plus a Refresh action.
  - Icons: introduced hand-ported Lucide-style inline SVGs
    (`surfaces/library/icons.tsx`) for the gear, view-mode, fullscreen,
    pagination chevrons, search/clear and refresh glyphs, replacing the prior
    ASCII/emoji arrows and text labels.
  - Grid: dropped the non-legacy checkerboard thumbnail background in favour of
    the legacy solid `--color-bg-secondary` tile, with pixelated image rendering
    and the legacy hover-lift / accent selection treatment.
  - Status/pagination: the bottom bar is now pagination-only (centered numbered
    pages with first/last edges + ellipsis + chevron arrows) and hides on a
    single page; the old "zone · N assets" / "No selection" footer text moved
    into the gear status block.
  - Styling now consumes the shared kernel design tokens (`--color-*`,
    `--radius-*`, `--transition-*`, `--titlebar-height`).
  - Operation logic is unchanged and stays API-backed: zone switch →
    `/api/v1/library/zones` + `/library/list`, search/paging → `/library/list`,
    thumbnails → `/library/serve`; view-mode and selection remain local view
    state. Legacy gear features without a backing route in this read-only backend
    (project filter, upload, batch repair/ops, 13-field review filters, monitor)
    are intentionally omitted rather than shipped as dead buttons.
- **Asset store continuous-scroll pagination** (`surfaces/AssetStoreSurface.tsx`,
  `surfaces/library/{assetStoreStore,pagination}.ts`): replaced the discrete
  one-batch-per-page model with the legacy continuous-scroll model. The store now
  loads the WHOLE active zone (looping the page-capped `/library/list` route in
  500-row batches) into one list; the grid is a single scroll area over every
  asset. `pageSize` is derived from the live viewport (columns × visible rows via
  a `ResizeObserver`, with a window-resize fallback), the page indicator tracks
  scroll position (`setPageFromScroll`), and clicking a page number smooth-scrolls
  to that page's first card (`goToPage` → `pendingScrollToPage`) instead of
  swapping a batch. Scroll vs. programmatic-scroll fights are avoided with a
  short scroll lock. All loading stays API-backed; scroll position / current page
  / pageSize are pure local view state.
- **Renderer/preview UI fidelity + viewport interaction.**
  - **Layers panel is scene-output-only again** (`surfaces/RendererSurface.tsx`):
    removed the `GridLayerRow` that wrongly listed node grid-output previews (e.g.
    `978806ea… 128×128`) in the panel. The panel now lists ONLY `scene_output`
    voxel layers, matching the legacy `LayersSidePanel`, with the legacy empty
    state ("No scene output layers" / "Connect a Scene Output battery to see its
    layers here."). Grid previews still render live on the canvas (the `top` mode
    keeps projecting them via `useNodePreviews`); they are simply no longer listed.
    The canvas empty-state ("Drag batteries into the editor and run") and the
    status layer count still consider both buckets, matching legacy.
  - **Mouse/viewport interaction** restored to match legacy. The host
    `renderer/host/RenderCanvas.tsx` now owns the interaction layer for the 2D
    modes (top / topBillboard / iso): left-drag pan and wheel zoom centered on the
    cursor, both writing the shared `viewport2d` store so every 2D mode benefits;
    `free3d` is left to its own `OrbitControls`. Added a pure, unit-tested
    `renderer/framework/viewport2d.ts` (legacy zoom-around-cursor anchor math,
    nice-step quantization, `MIN_SCALE`/`MAX_SCALE` clamps) plus `panViewport2d` /
    `resetViewport2d` store actions. A top-left overlay shows the cursor cell +
    zoom % readout (legacy `canvas-coords`). Verified `screenToCell`/`cellToScreen`
    still invert the compose transform.
  - **Toolbar fidelity** (`surfaces/RendererSurface.{tsx,css}`): gradient "Preview"
    title, a "Ready" status pill, a scene-layers-panel toggle, a settings gear
    (View zoom −/%/+/reset + Save screenshot), and an icon fullscreen toggle —
    replacing the plain `Reset`/`Shot` text buttons and the ASCII `▾`/`⤢`/`↙`
    glyphs. Hand-ported Lucide-style inline SVGs (`surfaces/icons.tsx`: Layers,
    Settings, Maximize2/Minimize2, ZoomIn/ZoomOut, Home, Camera, Eye/EyeOff, Box,
    ChevronDown) give the legacy icon treatment with no new dependency.
  - **Layers panel row fidelity**: golden-angle value color swatch, node/path
    label, voxel cell count, Eye/EyeOff visibility toggle, hidden-row dimming, and
    a local selection highlight — matching the legacy leaf rows.
  - All styling consumes the shared kernel theme tokens (`--color-*`, `--radius-*`,
    `--spacing-*`). View state (viewport offset/scale, view/draw mode, layers-panel
    open, selection) stays local to the renderer; nothing here mutates graph or
    runtime state. Legacy gear features without a backing API in this build
    (manual refresh / clear-cache / asset-library picker / 3D params / auto-refresh
    toggle) are intentionally omitted rather than shipped as dead buttons.
- **Renderer editor-selection highlight + toolbar height/colour.**
  - **Editor-selection highlight wired end-to-end** (view-only; no graph mutation).
    The legacy renderer learns the editor selection from an `editor:selection` WS
    event → `renderStore.selectedEditorNodeIds`, then strokes the selected node's
    layers green (`SELECT_EDITOR_COLOR`) and highlights their Layers-panel rows.
    This backend emits no such WS event (kernel selection is client-side in the
    host's pipeline store), so the workbench host now reads
    `usePipelineStore.selectedNodeIds` and forwards it to the renderer iframe over
    a new `workbench:editor-selection` postMessage (seeded on iframe load, then on
    every selection change); the renderer mirrors it into a new
    `renderStore.selectedEditorNodeIds`. The highlight is applied across all modes:
    `top` (success-green outline in `compose`, for BOTH voxel layers AND grid
    previews — so selecting a preview battery highlights its grid preview), `iso`
    and `topBillboard` (per-cell green via the master surface inputs + cache key),
    and `free3d` (mesh brighten — its mesh builder has no separate green channel,
    noted as an approximation), plus the green `is-editor-selected` Layers-panel
    row (`RendererSurface.{tsx,css}`).
  - **Screenshot moved to the top toolbar** (`surfaces/RendererSurface.tsx`): the
    (non-legacy, our-addition) screenshot capture is now a `Camera` icon button on
    the toolbar instead of an entry inside the gear menu's Actions section.
  - **Toolbar height & colour matched to legacy** (`surfaces/RendererSurface.css`):
    the Preview toolbar was too tall / off-colour (`6px 8px` padding over
    `--color-bg-secondary`). It now uses the exact legacy values via shared kernel
    tokens — `height: var(--titlebar-height)` (32px, consistent with the editor
    titlebar), `padding: 0 var(--spacing-md)` (12px, no vertical padding), the
    titlebar gradient `linear-gradient(180deg, var(--color-bg-titlebar) #050806 →
    var(--color-bg-titlebar-gradient) #0b120d)`, a `rgba(255,255,255,0.06)` bottom
    border and the legacy drop shadow.
  - **Other parity audit**: implemented selection (above). Intentionally skipped,
    for lack of a data source/API in this build (not legacy-faithfulness gaps in
    intent): the Layers panel's collapsible sink/path TREE with per-value sublayer
    rows + sublayer visibility (the `scene_output` projection yields one value per
    layer key here, so there are no sublayers to nest/toggle); editor-driven
    per-node preview on/off reflected on canvas (legacy `preview:change` WS — not
    emitted here; the per-voxel-layer Eye toggle already covers local visibility);
    and the AI-agent renderer commands (set-view-mode / select-layer / open-all
    sublayers WS) which have no channel on this backend. Hover row highlighting,
    z-ordering by `updatedAt`, and the cursor cell/zoom readout were already
    present.
- **Node editor host chrome fidelity (top-right controls + status).**
  - **`frontend/src/workbench/WorkbenchHost.{tsx,css}`** aligned the kernel-Editor
    host chrome to the legacy editor (the design source of truth), whose top-right
    is just a settings gear + a fullscreen toggle, with embed toggles and status
    living inside the gear menu:
    - Moved the **Render / AssetStore embed toggles** off the top bar and into the
      gear dropdown (kernel's new `settingsActions` slot), rendered as legacy
      `.settings-action-button`s with hand-ported Lucide `Monitor` / `Package`
      inline SVGs — replacing the prior top-bar plain-text `Render` / `Assets`
      buttons.
    - **Fullscreen** now uses the kernel toolbar's Lucide `Maximize2` /
      `Minimize2` control (wired via the new `isFullscreen` / `onToggleFullscreen`
      Editor props) instead of the ad-hoc `⤢` / `↙` glyph button.
    - **Removed the bottom status bar** (`.wb-statusbar`): the legacy editor has no
      status bar and surfaces connection / selection / node-edge counts through the
      gear → Status panel. Embedded Renderer / AssetStore live status now rides into
      that same panel via the kernel's new `settingsStatusExtra` slot.
  - Bump kernel submodule to `dd9ff27` (gear-menu `settingsActions` /
    `settingsStatusExtra` slots + forwarded fullscreen control; faithful 1:1 ports
    of the BatteryBar palette, canvas grid/node cards/edges, minimap and zoom slider
    were already in place and needed no change).
  - **Develop / Templates tabs**: intentionally still not added — the new backend
    has no template system, so a Templates tab would be a dead/empty page; the
    palette stays in its single (Develop) mode and the toggle is omitted rather than
    shipped as a dead control.

### Fixed

- **Dragging in one battery reloaded ALL batteries / fully redrew the preview**
  (regression vs the legacy incremental engine). Root cause was the kernel
  editor's `pipelineRevision`-keyed *blanket* canvas rebuild: every committed
  batch — including a local drag-add's own `incrementalExecute → updatePipeline`
  persist, which the backend broadcasts as `graph:applied` — round-tripped into
  `loadPipeline() → pipelineRevision++ → setNodes(built)`, handing every node a
  fresh object so `memo(BatteryNode)` re-rendered for the whole canvas. The
  legacy editor never blanket-rebuilt on a graph mutation; it only rebuilt on a
  gated session-restore signal and drove local edits incrementally. Ported that
  contract — the canvas now diff-reconciles (`reconcileCanvasNodes` /
  `reconcileCanvasEdges`, in the kernel submodule) so only added/changed/removed
  nodes update and untouched batteries keep their identity (external/LLM/CLI
  live-sync still works). **Evidence:** adding 1 battery to a 24-node canvas now
  rebuilds 1 node object instead of 25 (0/24 unaffected re-render); the kernel
  already scopes execution to the new node's closure (full run = 6 nodes, add =
  1 node executed, 0/6 existing recomputed). Requires the kernel submodule bump.
- **Preview window fully redrew on every graph change.** `useNodePreviews`
  re-pulls every node's output on each `graph:applied` / `exec:completed` and
  re-wrote every layer object, breaking the per-layer subscription contract
  (`useGridLayer` / `useVoxelLayer` are designed so untouched layers keep a
  stable reference). The render store `setPreviewLayer` / `setLayers` now skip
  the write when the re-pulled content is identical, so only the genuinely
  changed region re-renders — the legacy "partial redraw" behaviour. Covered by
  `renderer/__tests__/store.test.ts`.
- **External / LLM-driven graph edits never appeared in the editor** (the
  North-Star "watch the AI work" loop was broken). Two root causes: (1) the
  backend `POST /api/v1/batch` route applied ops but never broadcast a WS event,
  and the kernel bus emits nothing on `applyBatch`, so a batch from any
  out-of-browser actor (CLI / LLM / another tab) produced zero live-sync traffic
  — only the originating browser self-refreshed via a local synthetic event.
  `mutations.ts` now broadcasts a real `graph:applied` RuntimeEvent to every
  connected client after a committed batch. (2) The editor canvas
  (`useCanvasGraphSync`) rebuilt its ReactFlow layer only when
  `currentPipeline.id` changed, but the id is the constant `'main'`, so every
  refetch (with new content, same id) was a no-op. The store now bumps a
  `pipelineRevision` counter on each `loadPipeline()` and the canvas keys its
  rebuild on that (selection preserved across rebuilds).
- **Editor showed an empty canvas after a refresh even though the graph was
  persisted**: on mount `loadBatteries()` and `loadPipeline()` race, and
  `buildCanvasNodes` drops any node whose battery isn't in the catalog yet. When
  the snapshot resolved first, the single rebuild produced 0 nodes and never
  recovered. The canvas now also rebuilds when the battery catalog first becomes
  available. Covered by `canvasGraphSync.rebuild.test.tsx`.
- **Duplicate first page in the Asset Store pager**: for small page counts the
  pager rendered two highlighted "1" buttons ("1 1 2 3 4"). Root cause: the
  centred page window was clamped with `Math.min(centerStart, totalPages-…)`,
  which pulled `windowStart` back to 1 so the always-rendered leading edge "1"
  and the window's first page collided. Replaced the generator with `pageItems()`
  (`surfaces/library/pagination.ts`), which emits each page exactly once — flat
  `[1..n]` for ≤7 pages, else `1 … [window clamped to 2..n-1] … n` — covered by
  new unit tests.
- **Empty preview window**: the renderer only projected `scene_output` voxel
  layers, so wiring up an intermediate chain (e.g. `cellular_noise →
  max_rectangle`) rendered nothing until a scene-output battery was connected —
  diverging from the legacy "watch as you build" preview. Restored the dense 2D
  grid-preview path: a new `previewLayers` store bucket, a `gridLayerCellSource`
  adapter, grid instances in the top render mode, and a `useNodePreviews` bridge
  that pulls every executed node's `grid` output (gated by per-node
  `previewEnabled`, default on) alongside scene-output voxels. The Layers panel
  now lists both grid and voxel layers.
- **Previews crashed / went blank on a NON-EMPTY scene** (`layer.cells is not
  iterable`): `flattenWire` unwraps only one DataTree level, but the kernel
  serializes `scene_output.layers` (`voxel_layers`) and `.names` (`name_list`)
  as `DataTree.fromItem(T[])` — i.e. the whole list is a single item, so the
  wire is DOUBLE-wrapped (`[{path, items:[[ …layers ]]}]`). `flattenWire` then
  returned a one-element array whose element was itself the layer list, and
  `setLayers(… that array)` blew up in the renderer. (Earlier tests only used
  blank scenes, so it was hidden.) Added `flattenWireList` (unwraps the DataTree
  level, then spreads the list-valued leaf) and switched the `voxel_layers` /
  `name_list` call sites (`bridge/useNodePreviews.ts`, `scripts/preview.mjs`,
  `scripts/north-star-loop.mjs`) to it. `grid` stays on `flattenWire` (its
  `fromItem(number[][])` leaf IS the entity and must not be spread), so
  single-wrap grids and double-wrap voxels no longer regress each
  other. Verified against the live 5-node demo scene (`out1`, 380 voxels): the
  preview now renders the real isometric scene instead of crashing. Covered by
  new `flattenWire`/`flattenWireList` unit tests and a non-empty-scene
  `useNodePreviews` regression test.
- **Empty BatteryBar at `:9555`**: caused by `opSpecToBattery` crashing on ops that
  ship no `params` (the whole catalog load rejected). Fixed kernel-side; the
  scene generator now loads all 290 batteries.
- **Editor StatusBar no longer stuck on "Disconnected"** (kernel now drives
  `connectionStatus` from the transport round-trips).
- **Stale preview on node deletion** (`bridge/useNodePreviews.ts`).
  - Deleting a battery/node left its grid/voxel preview on the canvas (stale).
    Root cause: `useNodePreviews` only refreshed on `exec:completed`, and its
    staleness GC (`retainPreviewLayers` / `retainVoxelNodes`) only runs inside
    `refresh()`. Deleting a node with no downstream triggers NO execution, so
    `refresh()` never ran and the orphaned layer was never pruned.
  - Fix: also subscribe to the `graph` channel and re-run `refresh()` on
    `graph:applied`. The backend emits `graph:applied` on every `applyBatch`
    (Layer-2 `apply-batch`) and forwards it over WS, so the renderer iframe
    (subscribed to `graph`/`execution`/`asset`) now re-runs the GC on any graph
    mutation: `listNodes()` is the post-mutation source of truth, so a deleted
    node's grid preview AND voxel layer are both evicted, and a node that loses
    its renderable output (disconnect → empty output) is cleared via the existing
    empty-output `clearLayers` / `retainPreviewLayers` paths. This is the faithful
    analog of the legacy eviction (`removePreviewLayer` + `clearLayers` on the
    `preview:change {remove:true}` delete path, and `clearStale*` on full-exec).
  - Bursts (a delete that also re-executes downstream) are coalesced via a 30ms
    debounce with a single-in-flight guard, so redundant refetches are avoided
    without sacrificing correctness. Live grid-preview-on-connect and the
    editor-selection highlight are unaffected (connect also fires `graph:applied`
    → re-projects; selection is a separate store field/channel).
- **Node editor wire data-probe + annotation parity (kernel)**.
  - Bump kernel submodule to `112c407`: the wire **data-probe** (`ProbeEdge`),
    port tooltips and preview nodes again show real per-connection data. The probe
    reads per-port values from the editor's `nodeOutputs` cache, but nothing
    populated that cache for server-executed nodes (only client-side AI nodes wrote
    to it), so probes rendered the type badge with an empty value. The legacy editor
    fed the cache from a bespoke WS `NODE_OUTPUT` push; the kernel now sources the
    same data through the generic `ApiClient.getNodeOutput(nodeId, portId)`:
    `subscribeLiveSync` listens for `node:output` (fetch + cache the value) and
    `exec:completed` (refresh every connected source port), and a new
    `refreshConnectedOutputs()` seeds the cache from the backend's retained values
    on load and after each graph mutation — so probes update after execution like
    the legacy. Fix lives entirely in the shared kernel editor and stays
    domain-agnostic (the scene-generator host already serves `getNodeOutput` via
    `/api/v1/nodes/:id/outputs/:portId`).
  - Same bump closes a canvas **annotation** parity gap: sticky-note annotations are
    now rebuilt by `buildCanvasNodes` (so they survive a live-sync refetch / reload
    instead of vanishing), and their drag (`moveAnnotation`) and delete
    (`removeAnnotation`) are routed to the store rather than dropped or mistaken for
    graph nodes. Other legacy canvas behaviours (edge colour-by-port-type, marquee
    multi-select with Full/Partial direction, copy/paste, groups + group-view,
    frames, snap guides, ctrl-drag duplicate, double-click search popover, node /
    selection context menus, preview toggle) were already faithfully present and
    needed no change.
