# Sino · Accumulated lessons

> Sino only does **scene composition** (wb-scene-generator, `scene:*` tools + built-in assets). Everything below is hard-won scene-composition experience — recite it before acting; do NOT rediscover it by trial and error in production sessions.

## 2026-06-17 · Tool side now does "output spill / summary" cleanup (context no longer polluted by huge results)
> Both the backend and the host bridge have been hardened. **Below is the new tool behavior — use it as-is, stop worrying about "results too big blowing up the context / the page hanging":**
- **`scene:pipeline.execute` returns only a KB-scale summary by default** (status + per-port item counts / shape hints), and **never returns full voxels/meshes anymore**. Judge success as before via `status` and each port's `itemCount` / child-node names.
  - **Incremental execution (key point)**: passing `nodeId` **re-runs only that node's downstream closure**, taking all upstream from the output cache — this is exactly the editor's "Run button / hot-reload" money-saving path. **Execute the `nodeId` of whichever node you changed; don't naively execute the whole graph every time.**
  - Only the rare case that truly needs the full run uses `raw:true`; even then, the host bridge's safety net spills oversized results to disk.
- **Any tool result over ~24KB is auto-spilled** to `<cwd>/.cache/tool-results/*.json`, returning only `{ note, path, preview }`. **Usually the `preview` is enough**; only `read_file` that path when you truly need the full thing. This is the unified safety net; giant `pipeline.get` / `raw` executes are all caught by it.
- **`scene:templates.list/get` also strip inline images (iconPng/iconSvg)** and output clean text — don't report in chat that "the battery-list rendering is broken."

## Current positioning (quick table)
- Dedicated to scene composition (wb-scene-generator), tools are **only `scene:*`**, default skill is **only `compose-sino-scene`**.
- **Does not generate images/textures/assets**, doesn't touch `asset2d:*`, doesn't do 2D/3D, doesn't write engine code. To generate textures on the fly, hand off to the 2D workbench / Mira.
- Hard boundary: use only the scene template groups (AddBaseGrid / ArchitectureRegions / ArchitectureStructures / PathConnection / LakeRegions / FarmlandRegions / RandomNaturalDecoration / PointSampleBuilding) + whitelisted tool batteries; `applyBatch` carries `opts.actor = "ai:sino"`, and a top-level opId outside the whitelist is rejected by the backend.
- Composition main line: template groups chained Rest→in_0 + `seed_control` distributing seed uniformly + `tree_merge→tree_flatten→scene_merge_subtrees→scene_output`.

## 2026-06-12 · Production-incident retrospective (these traps have been hit; next time just do as written, no trial-and-error in production sessions)
These rules are already hard-coded at the top of the SKILL under "mandatory iron rules," and the docs have verified them for you — **recite before acting; don't spend production time rediscovering them**:
- **connect must carry a unique `edgeId`**: the field name is exactly `edgeId` (not `id`, not `edge_id`). Miss `edgeId` and the edge lands with key=`undefined`; the second edge then throws `edge undefined already exists`. This is **not** "a batch can't connect multiple edges," **nor** "a node can only receive one edge" — those are false symptoms of a missing edgeId, the wrong direction I guessed last time. A batch can connect any number of edges, any number into the same target node, as long as each `edgeId` is unique across the whole graph.
- **Always `pipeline.get` to verify after applyBatch**: a returned ok / changed hash can still be "ok but empty" (the whole batch atomically rolled back by some op, or a misspelled `type` silently ignored). The only legal `type`s are createNode/updateNode/deleteNode/connect/disconnect/createGroup/updateGroup/deleteGroup/ungroup/setMetadata — **there is no addNode/addEdge**.
- **Never read back the full `pipeline.execute` return**: it dumps every layer's complete voxel cells in full and blows up the context directly. Look only at `status`; for details use jq to project the key info of `outputs[nodeId][portName]` (child names / cell counts / asset names), or look at the screenshot.
- **PathConnection's `in_0` (POI) must be connected**: leaving it dangling silently prevents road generation, while execute still reports `completed` (extremely deceptive; I've been caught by this twice in a row). Prefer the advanced POI (BuildingPath + string_concat to build `/outer_door` → scene_focus_path to extract the door → use as POI), so roads run out from the doorway; see PathConnection/README "POI advanced usage."
- **Use query batteries to precisely operate on sub-regions**: scene_focus_path / scene_focus_children / node_explode / scene_get_attribute + string_concat to build paths are all in the whitelist. When you need to operate on only one building / one door / one class of child node, use them proactively; don't shuttle the whole scene group around wholesale.
- **A screenshot is an image — just look at it**: the result of `scene:screenshot.capture` is returned as image content (a ContentPart); judge it directly with your eyes as an image. Don't go Read the spilled file, and don't parse it as a base64 string.

## 2026-06-12 · Non-standard connection retrospective (crowded-block `p_mqb2iv4w_cktxo4` proved 3 errors; next time just do as written)
> Trial-and-error dropped this round, but connections are still non-standard. The 3 mis-connections below are documented with evidence; **the fixes are baked into SKILL/README/persona — next time just do as written, do not repeat**:

- **ArchitectureStructures connects to Buildings, not Rest**: last time I connected `ArchitectureStructures.in_0` to `ArchitectureRegions.out_2` (Rest, leftover empty land) ✗ — that's building on empty land. **Correct: `in_0` ← `ArchitectureRegions.out_0` (Buildings building region) ✓**, because building structures raise buildings/walls on the "building region." **Root cause was over-generalizing the "connect the previous group's Rest → in_0" boilerplate** — that line only applies to groups that "lay new things on empty land" (roads/lakes/fields/decoration); ArchitectureStructures "processes existing output," so connect the main product. When unsure, check the SKILL "which node each template group's `in_0` should connect to" table.

- **PathConnection's POI must extract the door, not connect a whole scene with buildings; and `in_0`/`in_1` are not the same source**: last time `in_0` (POI) directly connected `ArchitectureStructures.out_0` (the whole scene with buildings), and `in_1` also connected the same `out_0` ✗, skipping the advanced pattern. **Correct (default advanced tier) ✓**: `ArchitectureRegions.out_1` (BuildingPath) + `text_panel("/outer_door")` → `string_concat` to build the door path → `scene_focus_path` (focus the door in `ArchitectureStructures.out_0`) → use as POI into `in_0`; connect `in_1` (upstream space) separately to `ArchitectureRegions.out_2` (Rest). **`in_0` (POI=door) and `in_1` (road-layable scene) are two different sources; never connect both to the same `out_0`.** The simplified tier (building out_0 straight into in_0) is only a fallback when there's no structure layer; don't default to it for convenience. Copyable examples: SKILL Step 3 and PathConnection/README "advanced usage of POI."

- **Screenshots are fixed now — you must actually look at the image, stop claiming "I can't read images"**: last time I skipped screenshot verification on the excuse that "the current model can't read images / can't take images in" ✗ — that's pre-fix cognition. **Screenshots are fixed ✓**: a successful `scene:screenshot.capture` returns a **directly viewable image content block**; judge layout correctness with your eyes, no Read path needed. **After adding each template-group layer you must screenshot and actually look**; don't conclude from `execute`'s `completed` or jq alone. **Only errors like `capture timeout (no renderer connected?)` mean you genuinely got no screenshot** (report honestly; don't use it as an excuse to say you can't read images).

## 2026-06-13 · POI door path guessed from BaseName caused focus failure (evidenced; next time do as written)
> In a real session: connecting `scene_focus_path` to PathConnection's POI (in_0), I **hard-coded the door path as `/block/outer_door`** (guessing with AddBaseGrid's BaseName "block" as a path prefix) → that path doesn't exist in the tree → focus failed → the POI chain errored → I just gave up focus and used the whole structure scene as the POI (crude downgrade, violating Example1). **The fix is baked into SKILL/persona; next time just do as written:**

- **Stop guessing door paths from BaseName** (`/block/outer_door`, `/ground/outer_door`, etc.) — BaseName is not a path prefix; a guessed absolute path doesn't exist in the tree, and focus **fails 100%**.
- **Next time**: always take the door-path prefix from `ArchitectureRegions.out_1` (BuildingPath, a runtime dynamic string handle valued like `/architecture_0`) into `string_concat.a`, with `string_concat.b="/outer_door"`, `result` → `scene_focus_path.path`, `scene_focus_path.scene ← ArchitectureStructures.out_0` (the structure scene with doors). Verified with jq against Example1's graph.json — it's exactly this chain.
- **Don't give up focus and stuff the whole structure scene into the POI just because focus errored** — a focus failure is 99% a path-syntax error (using a guessed absolute path); **fix the path rather than bypass it**. Using the whole scene as POI makes the explode range wrong and the doorway extraction inaccurate. Stick to the advanced chain `BuildingPath → string_concat → scene_focus_path`.
- **When unsure of child-node names, use `scene_focus_children`/`scene_get_attribute` (or `node_explode`) on the structure output to probe the real child names**, then build the path with the real names — don't guess from memory.

## 2026-06-16 · RandomNaturalDecoration scatter detours (do not repeat)
> Task "scatter multiple vegetation types over an already-laid lawn" — I took a big detour on **which out of AddBaseGrid to connect**, **how to chain multi-species decoration**, and **which out to take for merge**. See `RandomNaturalDecoration/README.md` "multi-species chained scatter."

### A. AddBaseGrid output: decoration must connect **BaseNode `out_1`** (tripped 3 times)

| Port | What it is | Can the decoration chain connect it |
|---|---|---|
| `out_0` | raw `grid2node` mesh scene (unfocused item) | ❌ not a handle for "keep operating on the base"; sometimes runs but semantically wrong |
| **`out_1`** | **BaseNode** (focused to a named base node like `/lawn`) | ✅ **the first RandomNaturalDecoration.in_0 must connect this** |
| `out_2` | RootScene (the whole root tree) | ❌ tree-level, not the item handle for "scatter on base cells" |

> **In one line**: "keep scattering vegetation on the lawn base" → **`AddBaseGrid.out_1 → Dec_*.in_0`**. Don't use `out_0` (raw grid) or `out_2` (RootScene) as the decoration upstream — docs/intuition both mislead here; go by **`templates.get(AddBaseGrid)` + this table**.

### B. Multi-species vegetation: one group per name + chained Rest + individual density (no "one name, many values, shared density")

- ❌ **Wrong**: cramming multiple `text_panel`s all into **one** RandomNaturalDecoration's `in_1` (tree multi-value) + **one** density → can't tune sparsity separately.
- ✅ **Right**: **instantiate one RandomNaturalDecoration group per vegetation type**, each group:
  - `in_1` ← **a single** asset name (use a built-in asset name)
  - `in_3` ← **an independent** `number_const` (e.g. 0.15 / 0.12 / 0.06 / 0.03)
  - `in_2` ← the shared `seed_control.seed` (reproducible)
  - **Chained Rest**: `Dec_A.out_3` → `Dec_B.in_0` → … (each later type only scatters on cells not yet taken)

### C. merge must take **`out_0` (the complete scene)**, not `out_2` (NaturalDec)

RandomNaturalDecoration port semantics (go by `templates.get`):

| Port | Meaning | Usable for merge |
|---|---|---|
| **`out_0`** | this group's processed **complete scene tree** (base map + all decoration accumulated through this group) | ✅ **connect this for summary/visualization** |
| `out_2` | **NaturalDec**: only the one class of vegetation **newly scattered** by this group | ❌ an incremental fragment only; merge would miss the earlier layers |
| `out_3` | **Rest**: the leftover empty land after removing scattered decoration | ✅ chain to the next group's `in_0`; **not** for merge |

- ✅ **Right**: each group's **`out_0`** → `tree_merge` → `tree_flatten` → **`scene_merge_subtrees`** → **`scene_output`**; when merging multiple groups, **use `out_0` for all**, and cell counts should increase monotonically (e.g. 512→711→891→1059).

### D. node path `tree_N` ≠ render-match name (don't be scared)

- The template-internal `grid2node` has a fixed prefix **`tree_`** → instance paths are `/lawn/tree_0` … **this is normal**.
- The renderer matches the **`asset_name` attribute** (the ObjectAssetName subgroup writes `in_1` into each instance) = the asset name you filled in, **not** the `tree_N` in the path. When unsure, use `scene_get_attribute` to probe the `asset_name` of `/lawn/tree_0`.

### E. Other

- **`scene:renderer.setViewMode` → `topBillboard`** to verify (not `top`).
- With screenshot visual off: execute reporting N instances ≠ seeing the layout land with your own eyes; when honest, ask the user to confirm in Preview.
