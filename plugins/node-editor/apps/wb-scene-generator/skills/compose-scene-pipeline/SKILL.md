---
name: compose-scene-pipeline
description: >-
  Compose and iterate ForgeaX Scene Generator projects through the official
  Studio ToolRegistry tools. Use when the user asks to create, modify, preview,
  screenshot, export, or iterate a scene, level, map, renderer preview, or
  node-runtime graph in wb-scene-generator.
---

# Compose Scene Pipeline

## Purpose

Build and iterate a **Scene Generator** project by calling Studio ToolRegistry
tools (`/api/tools/call`) that proxy to the plugin backend `/api/v1/*`
contract. Do not directly edit runtime files, do not drive the UI by clicking,
and do not use the legacy `wb-scene` plugin.

## Official Tool Path

Call tools with `caller.kind = "ai"` unless the host provides a different
caller context:

```json
{
  "toolId": "scene:pipeline.applyBatch",
  "args": { "ops": [], "opts": { "actor": "ai:scene", "label": "compose scene" } },
  "caller": { "kind": "ai" }
}
```

Use these tools:

- `scene:projects.list`, `scene:projects.create`, `scene:projects.open`,
  `scene:projects.remove`
- `scene:batteries.list`, `scene:batteries.get`
- `scene:pipeline.get`, `scene:pipeline.applyBatch`,
  `scene:pipeline.execute`, `scene:pipeline.import`, `scene:pipeline.export`
- `scene:assets.list`
- `scene:renderer.info`, `scene:renderer.setViewMode`,
  `scene:renderer.selectLayer`, `scene:renderer.openAllSubLayers`
- `scene:screenshot.capture`, `scene:screenshot.latest`

`scene:projects.remove` requires destructive confirmation for AI callers.
`scene:screenshot.store` is an internal renderer callback and is not exposed to
AI.

## Workflow

1. List/open/create a project with `scene:projects.*`.
2. Inspect available batteries with `scene:batteries.list` and
   `scene:batteries.get`; never guess port names.
3. Read the current graph using `scene:pipeline.get`.
4. Apply graph changes with `scene:pipeline.applyBatch`, using
   `opts.actor = "ai:scene"` and a concise `opts.label`.
5. Execute with `scene:pipeline.execute`.
6. Drive the preview with `scene:renderer.*`, inspect assets with
   `scene:assets.list`, and capture/read preview pixels with
   `scene:screenshot.capture` / `scene:screenshot.latest`.
7. Iterate until the scene matches the request, then optionally save a graph
   template with `scene:pipeline.export`.

## Scene Decisions

- Prefer semantic scene batteries when available; inspect the op catalog first.
- Use node-runtime graph batches for creation, connection, parameter updates,
  grouping, and deletion. Do not write `state/graph.json` by hand.
- Preserve the renderer's supported view modes (`top`, `topBillboard`, `iso`,
  `free3d`) and layer selection contract.
- Use renderer screenshots, generated project assets, and node outputs as
  feedback for multi-turn iteration; do not declare completion from graph edits
  alone.

## References

- [quickstart.md](quickstart.md): ToolRegistry-first workflow.
- [pipeline-schema.md](pipeline-schema.md): graph and batch shape.
- [battery-catalog.md](battery-catalog.md): how to discover batteries.
