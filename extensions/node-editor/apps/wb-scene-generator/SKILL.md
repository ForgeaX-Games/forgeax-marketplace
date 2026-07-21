---
id: wb-scene-generator:author-guide
trigger: /wb-scene-generator
displayName:
  en: Scene Generator Author Guide
  zh: 场景生成器 作者指引
---

# Scene Generator · AI guide

This plugin extends `@forgeax/node-runtime` with domain ops and surfaces
specific to **Scene Generator** workflows. AI agents drive editor actions
through Studio ToolRegistry (`/api/tools/call`) tools declared in
`forgeax-plugin.json`; nothing in this plugin requires a human-only path.

## Workflow shape

1. `scene:projects.open` — args `{ "id": "<projectId>" }` (acquires the agent
   lock; **required before any graph mutation**).
2. `scene:batteries.list` / `scene:batteries.get` — inspect op IDs and ports.
3. `scene:pipeline.get` — args `{ "projectId": "<same id>" }` (may omit
   `projectId` after step 1 if this agent holds the lock).
4. `scene:pipeline.applyBatch` — args `{ "projectId", "ops", "opts" }`; AI
   batches must include `opts.actor` starting with `ai:` (e.g. `ai:sino`).
5. `scene:pipeline.execute` — args `{ "projectId", "nodeId?" }`; default
   returns a lightweight summary (pass `raw: true` only when you truly need full
   voxel cells).
6. `scene:renderer.*` / `scene:assets.list` — verify execute summary (no
   errors, expected layer/asset names).

> **Field naming:** `projects.open` uses **`id`**; all `pipeline.*` tools use
> **`projectId`** — same string value, different key. Do not guess REST paths
> like `/pipeline/batch`; use the tools (`applyBatch` → `/batch`).

## Domain op catalogue

Use `scene:batteries.list`; the catalog is dynamic and includes plugin domain
ops plus shared node-runtime ops.

## Domain surfaces

- `wb-scene-generator.projects` — project list/create/open/remove actions.
- `wb-scene-generator.pipeline` — graph get/apply/execute/import/export actions.
- `wb-scene-generator.preview` — renderer control and asset inspection actions.

## Path slots

(empty — populated when path slots are declared)
