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

1. `scene:projects.list` / `scene:projects.open` to choose the active project.
2. `scene:batteries.list` and `scene:batteries.get` to inspect exact op IDs and
   ports.
3. `scene:pipeline.get` to read the graph.
4. `scene:pipeline.applyBatch` to create/update/remove nodes and edges.
5. `scene:pipeline.execute` to run the graph.
6. `scene:renderer.*`, `scene:screenshot.capture`, and `scene:assets.list` to
   verify previews and generated assets.

## Domain op catalogue

Use `scene:batteries.list`; the catalog is dynamic and includes plugin domain
ops plus shared node-runtime ops.

## Domain surfaces

- `wb-scene-generator.projects` — project list/create/open/remove actions.
- `wb-scene-generator.pipeline` — graph get/apply/execute/import/export actions.
- `wb-scene-generator.preview` — renderer control, screenshot, and asset
  inspection actions.

## Path slots

(empty — populated when path slots are declared)
