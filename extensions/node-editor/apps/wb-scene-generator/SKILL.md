---
id: wb-scene-generator:author-guide
trigger: /wb-scene-generator
displayName:
  en: Scene Generator Author Guide
  zh: 场景生成器 作者指引
---

# Scene Generator · Sino author guide

Scene Script is the canonical authoring surface. The existing node graph is its
live visual projection and remains the runtime execution surface.

Sino is the preferred Agent for this Workbench. Its task is scene design:
spatial hierarchy, circulation, functional anchors, density, rhythm, and visual
focus. It does not orchestrate other Agents or generate assets.

## Workflow

1. Open the requested project with `scene:projects.open`.
2. Resume bounded work state with `scene:agent.resumeSceneWork`.
3. Read the bounded `scene:script.contracts` summary once. It contains only the
   explicit composition-utility whitelist and published scene-design Templates,
   with semantic-stage guidance; request exact details for at most six selected
   functions at a time.
4. Read or create source with `scene:script.get` / `scene:script.put`.
5. For local edits, use the `scene:agent.*` target, Lens, transaction, Semantic
   Diff, verify, and accept/revert workflow.
6. Execute through `scene:pipeline.execute` and verify both the compact result
   and Renderer evidence.

Do not manipulate runtime nodes, template internals, port numbers, or graph
storage for a Scene Script-managed project. Template/group function calls are
sealed Authoring Entities; only their public arguments and outputs are visible
to an agent.
Template configuration uses direct literals by default. Adapter calls and
low-level grid reconstruction are not valid workarounds for Contract defects.

The full design and self-review workflow is defined by the
`compose-scene-script` skill.
